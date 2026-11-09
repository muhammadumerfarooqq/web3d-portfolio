// Town loading and preparation: GLTF (+ self-hosted Draco), name-based material upgrade, static
// mesh merging by material and region (fewer draw calls, still frustum-cullable), the collision BVH
// (three-mesh-bvh), a terrain height grid for water depth and the island's soft wall, and the anchor
// points other systems need (lanterns, chimneys, flags, signs).
import { Box3, BoxGeometry, BufferGeometry, Group, Mesh, Vector3 } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import { AVATAR_URL, DRACO_PATH, NODES, SEA_LEVEL, SURFACES, TOWN_JSON_URL, TOWN_URL, isLanternNode } from './config.js';
import { castDown, sampleGrid } from './controller-math.js';
import { rimMaterial, upgradeMaterial } from './materials.js';

const HEIGHT_GRID = 160;
const HEIGHT_HALF = 70;
const REGION = 30; // metres per merge cell along x/z

export function createLoaders() {
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_PATH);
  const gltf = new GLTFLoader();
  gltf.setDRACOLoader(draco);
  return { gltf, dispose: () => draco.dispose() };
}

/** Fetch town.json, the town GLB and the avatar GLB with per-file progress callbacks. */
export async function loadAssets(loaders, onProgress, signal) {
  const json = fetch(TOWN_JSON_URL, { signal, credentials: 'same-origin' }).then((r) => {
    if (!r.ok) throw new Error(`town.json: HTTP ${r.status}`);
    return r.json();
  });
  const load = (url, key) =>
    new Promise((resolve, reject) => {
      loaders.gltf.load(url, resolve, (e) => onProgress(key, e.loaded, e.total), reject);
    });
  const [town, townGltf, avatarGltf] = await Promise.all([json, load(TOWN_URL, 'town'), load(AVATAR_URL, 'avatar')]);
  return { town, townGltf, avatarGltf };
}

const startsWithAny = (name, prefixes) => prefixes.some((p) => name.startsWith(p));


/** Keep only attributes every geometry in the group shares, so mergeGeometries can join them. */
function commonAttributes(geometries) {
  const sets = geometries.map((g) => new Set(Object.keys(g.attributes)));
  const shared = [...sets[0]].filter((k) => sets.every((s) => s.has(k)));
  return geometries.map((g) => {
    const out = new BufferGeometry();
    for (const k of shared) out.setAttribute(k, g.attributes[k]);
    if (g.index) out.setIndex(g.index);
    return out;
  });
}

/**
 * Prepare the town: returns { root, collider, bvh, heightAt, depthAt, lanterns, chimneys, flags,
 * surfaceAt, bounds, materials }.
 */
export function prepareTown(gltf, uniforms, { lite = false } = {}) {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);

  const upgraded = new Map();
  const upgrade = (mat) => {
    if (!upgraded.has(mat)) upgraded.set(mat, upgradeMaterial(mat, uniforms, { lite }));
    return upgraded.get(mat);
  };

  const lanterns = [];
  const chimneys = [];
  const flags = [];
  const signs = [];
  const wallBoxes = new Map();
  const box = new Box3();
  const center = new Vector3();
  let groundMesh = null;
  let seaMesh = null;
  let dockBox = null;
  let ropeBox = null;

  // Static meshes grouped by (material, region) for merging; collision geometry separately.
  const groups = new Map();
  const collide = [];
  const surfaceRanges = []; // [triangleStart, triangleCount, surface]
  let collideTris = 0;
  const keep = [];

  scene.traverse((obj) => {
    if (!obj.isMesh) return;
    const name = obj.name;
    box.setFromObject(obj);
    if (isLanternNode(name)) {
      box.getCenter(center);
      lanterns.push(center.clone());
    }
    if (name.endsWith('_walls')) wallBoxes.set(name, box.clone());
    if (name === NODES.dock) dockBox = box.clone();
    if (name === NODES.dockRope) ropeBox = box.clone();
    if (NODES.smoke.includes(name)) {
      chimneys.push(new Vector3((box.min.x + box.max.x) / 2 + (box.max.x - box.min.x) * 0.25, box.max.y + 0.3, (box.min.z + box.max.z) / 2));
    }
    if (name === NODES.sea) {
      seaMesh = obj;
      return;
    }
    if (name === NODES.ground) groundMesh = obj;

    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    obj.material = Array.isArray(obj.material) ? materials.map(upgrade) : upgrade(obj.material);

    const animated = startsWithAny(name, NODES.flagPrefixes) || name.endsWith(NODES.signSuffix);
    if (startsWithAny(name, NODES.flagPrefixes)) flags.push(obj);
    if (name.endsWith(NODES.signSuffix)) signs.push(obj);

    // Collision geometry (world space, positions only).
    if (!startsWithAny(name, NODES.noCollide)) {
      const g = obj.geometry.clone();
      g.applyMatrix4(obj.matrixWorld);
      const pos = new BufferGeometry();
      pos.setAttribute('position', g.attributes.position);
      if (g.index) pos.setIndex(g.index);
      const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
      const matName = materials[0]?.name ?? '';
      surfaceRanges.push([collideTris, tris, SURFACES[matName] ?? 'sand']);
      collideTris += tris;
      collide.push(pos);
    }

    const isGround = name === NODES.ground;
    obj.castShadow = !isGround && !startsWithAny(name, ['wire', 'rope']);
    obj.receiveShadow = true;

    if (animated || Array.isArray(obj.material) || obj.isSkinnedMesh) {
      keep.push(obj);
      return;
    }
    box.getCenter(center);
    const rx = Math.floor(center.x / REGION);
    const rz = Math.floor(center.z / REGION);
    const key = `${obj.material.uuid}|${isGround ? 'g' : `${rx},${rz}`}|${obj.castShadow ? 1 : 0}`;
    if (!groups.has(key)) groups.set(key, { material: obj.material, castShadow: obj.castShadow, meshes: [] });
    groups.get(key).meshes.push(obj);
  });

  const root = new Group();
  root.name = 'explore_town';

  // Merge each group into one mesh (world space). Groups whose attributes cannot be merged stay as-is.
  for (const { material, castShadow, meshes } of groups.values()) {
    if (meshes.length === 1) {
      keep.push(meshes[0]);
      continue;
    }
    const geometries = meshes.map((m) => {
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      return g;
    });
    const merged = mergeGeometries(commonAttributes(geometries), false);
    for (const g of geometries) g.dispose();
    if (!merged) {
      keep.push(...meshes);
      continue;
    }
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    const mesh = new Mesh(merged, material);
    mesh.name = `merged_${material.name}`;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
  }
  // Unmerged meshes keep their world transform under the new root.
  for (const m of keep) {
    m.updateWorldMatrix(true, false);
    const world = m.matrixWorld.clone();
    m.removeFromParent();
    world.decompose(m.position, m.quaternion, m.scale);
    root.add(m);
  }

  // Invisible dock rails: the rope rails are visual only (thin, non-colliding), so collision-only
  // walls follow them along both sides and close the far end. The shore end stays open.
  if (dockBox && ropeBox) {
    const y0 = ropeBox.min.y - 1.0;
    const h = ropeBox.max.y - y0 + 0.4;
    const z0 = ropeBox.min.z;
    const z1 = dockBox.max.z + 0.1;
    const wall = (sx, sz, cx, cz) => {
      const g = new BoxGeometry(sx, h, sz).translate(cx, y0 + h / 2, cz);
      const pos = new BufferGeometry();
      pos.setAttribute('position', g.attributes.position);
      pos.setIndex(g.index);
      const tris = g.index.count / 3;
      surfaceRanges.push([collideTris, tris, 'wood']);
      collideTris += tris;
      collide.push(pos);
    };
    wall(0.1, z1 - z0, ropeBox.min.x - 0.05, (z0 + z1) / 2);
    wall(0.1, z1 - z0, ropeBox.max.x + 0.05, (z0 + z1) / 2);
    wall(ropeBox.max.x - ropeBox.min.x + 0.2, 0.1, (ropeBox.min.x + ropeBox.max.x) / 2, z1);
  }

  // Collision BVH over every collidable triangle (indirect: keeps triangle order for surface lookup).
  const collider = mergeGeometries(collide.map((g) => (g.index ? g.toNonIndexed() : g)), false);
  for (const g of collide) g.dispose();
  const bvh = new MeshBVH(collider, { targetLeafSize: 12, indirect: true });
  collider.boundsTree = bvh;

  const surfaceAt = (faceIndex) => {
    for (const [start, count, surface] of surfaceRanges) if (faceIndex >= start && faceIndex < start + count) return surface;
    return 'sand';
  };

  // Terrain height grid from the ground mesh alone (roofs and props must not count as land).
  const heights = new Float32Array(HEIGHT_GRID * HEIGHT_GRID).fill(SEA_LEVEL - 4);
  if (groundMesh) {
    const g = groundMesh.geometry.clone();
    g.applyMatrix4(groundMesh.matrixWorld);
    const gb = new MeshBVH(g);
    const origin = new Vector3();
    for (let j = 0; j < HEIGHT_GRID; j += 1) {
      for (let i = 0; i < HEIGHT_GRID; i += 1) {
        origin.set(-HEIGHT_HALF + (i / (HEIGHT_GRID - 1)) * 2 * HEIGHT_HALF, 60, -HEIGHT_HALF + (j / (HEIGHT_GRID - 1)) * 2 * HEIGHT_HALF);
        const hit = castDown(gb, origin, 120);
        if (hit) heights[j * HEIGHT_GRID + i] = hit.point.y;
      }
    }
    g.dispose();
  }
  const heightAt = (x, z) => sampleGrid(heights, HEIGHT_GRID, HEIGHT_HALF, x, z);
  const depthAt = (x, z) => {
    const h = heightAt(x, z);
    return h === null ? 10 : Math.max(0, SEA_LEVEL - h);
  };

  if (seaMesh) {
    // The detailed Gerstner sea replaces the GLB sea near the island; the GLB plane stays as the far
    // ocean, just under it.
    seaMesh.removeFromParent();
  }

  const bounds = new Box3().setFromObject(root);
  return { root, collider, bvh, heightAt, depthAt, lanterns, chimneys, flags, signs, wallBoxes, surfaceAt, bounds, seaMesh, heightHalf: HEIGHT_HALF };
}

/** Free every geometry and material under an object (used on exit). */
export function disposeObject(root) {
  root.traverse((obj) => {
    if (obj.geometry) {
      obj.geometry.boundsTree = undefined;
      obj.geometry.dispose();
    }
    const mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
      m.dispose();
    }
  });
}

/** Bake a few avatar attributes the controller needs. */
export function prepareAvatar(gltf, rim) {
  const avatar = gltf.scene;
  avatar.name = 'explore_avatar';
  const morphMeshes = [];
  const swapped = new Map();
  avatar.traverse((o) => {
    if (o.isMesh) {
      if (rim) {
        const one = (mat) => {
          if (!swapped.has(mat)) swapped.set(mat, rimMaterial(mat, rim));
          return swapped.get(mat);
        };
        o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
      }
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
      if (o.morphTargetDictionary) {
        // Shape keys can export with a default influence of 1.0: reset them all.
        if (o.morphTargetInfluences) o.morphTargetInfluences.fill(0);
        morphMeshes.push(o);
      }
    }
  });
  const box = new Box3().setFromObject(avatar);
  const height = box.max.y - box.min.y;
  return { avatar, clips: gltf.animations, morphMeshes, height, footOffset: box.min.y };
}

