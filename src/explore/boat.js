// The rowboat (P3.4): the town's own "Rowboat_baked" node, moored at the end of the dock, riding the
// same Gerstner waves as the sea shader (waves.js) every frame: height from the surface right under
// it, pitch and roll from the surface under its bow, stern and sides (with a little inertia). The
// arrival cinematic takes it over while it plays (controlled = true) and hands it back at the mooring.
import { approach } from './controller-math.js';
import { floatPose } from './waves.js';

/** Hull reference: the node's origin is the gunwale top; it sits 0.30 m above calm water. */
export const BOAT = { freeboard: 0.3, halfLength: 1.6, halfBeam: 0.6 };

const DOUBLE_SIDE = 2; // THREE.DoubleSide (kept numeric so this module also runs in Node tests)

/**
 * Open the hull. The kit builds the boat from a UV sphere whose upper half is flattened onto the
 * gunwale plane (blender/town/kit.py), which leaves a flat lid over the seats: the rower looked as if
 * he sat on a red disc. Drop every triangle lying in that top plane (the thwarts sit lower and stay)
 * and draw the hull from both sides so its inside shows. Returns { removed, lid } where lid is an index
 * list of the removed triangles (reused as the water mask, see createBoat).
 */
export function openHull(mesh) {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  g.computeBoundingBox();
  const top = g.boundingBox.max.y - 0.004;
  const src = g.index ? g.index.array : Array.from({ length: pos.count }, (_, i) => i);
  const keep = [];
  const lid = [];
  for (let t = 0; t < src.length; t += 3) {
    const a = src[t];
    const b = src[t + 1];
    const c = src[t + 2];
    if (pos.getY(a) > top && pos.getY(b) > top && pos.getY(c) > top) lid.push(a, b, c);
    else keep.push(a, b, c);
  }
  const removed = lid.length / 3;
  g.setIndex(keep);
  g.computeBoundingSphere();
  mesh.material = mesh.material.clone();
  mesh.material.side = DOUBLE_SIDE;
  return { removed, lid };
}

/**
 * The water mask: the old lid, invisible (depth only), drawn after every opaque object (the hull,
 * the thwarts, the rower) and before the sea, so the sea never shows inside the open hull.
 */
export const MASK_ORDER = 5;
export const SEA_ORDER = 6;

export function createBoat({ mesh, depthAt, getPhase, maskMaterial = null }) {
  const { lid } = openHull(mesh);
  if (maskMaterial && lid.length) {
    const g = mesh.geometry.clone();
    g.setIndex(lid);
    for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
    g.computeBoundingSphere();
    maskMaterial.colorWrite = false;
    maskMaterial.depthWrite = true;
    maskMaterial.side = DOUBLE_SIDE;
    const mask = new mesh.constructor(g, maskMaterial);
    mask.name = 'explore_boat_water_mask';
    mask.renderOrder = MASK_ORDER;
    mask.castShadow = false;
    mask.receiveShadow = false;
    mesh.add(mask);
  }
  mesh.rotation.order = 'YXZ';
  const home = { x: mesh.position.x, z: mesh.position.z, yaw: mesh.rotation.y };
  const pose = {};
  let pitch = 0;
  let roll = 0;
  let first = true;

  const boat = {
    mesh,
    home,
    /** The arrival cinematic owns the boat while true. */
    controlled: false,
    /** The last float pose: { surface, y, pitch, roll } (pitch / roll before smoothing). */
    pose,
    /** Float the boat at (x, z) with heading yaw; returns the surface height under it. */
    place(x, z, yaw, dt = 1 / 60) {
      floatPose(x, z, yaw, getPhase(), depthAt, BOAT, pose);
      if (first) {
        pitch = pose.pitch;
        roll = pose.roll;
        first = false;
      } else {
        pitch = approach(pitch, pose.pitch, 5, dt);
        roll = approach(roll, pose.roll, 5, dt);
      }
      mesh.position.set(x, pose.y, z);
      mesh.rotation.set(pitch, yaw, roll);
      mesh.updateMatrixWorld(true);
      return pose.surface;
    },
    update(dt) {
      if (!boat.controlled) boat.place(home.x, home.z, home.yaw, dt);
    },
  };
  boat.place(home.x, home.z, home.yaw);
  return boat;
}

const DEG = Math.PI / 180;
const smoothstep = (a, b, x) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/**
 * Oar pose for a stroke phase (0…1 over one Row clip loop), as oars.json describes it:
 * t = 0.5 − 0.5·cos(2π·phase): t = 0 catch (blade forward, in the water), t = 1 finish; the yaw sweeps
 * ±28°, the blade dips into the water on the pull (phase 0…0.5) and lifts ~10° on the recovery.
 * Returns the LEFT oar's { yaw, dip, inWater } in radians (the right oar mirrors yaw and dip).
 * Oar_L lies along +X: yaw > 0 swings the blade towards the bow (−Z), dip < 0 lowers it.
 */
export function oarPose(phase) {
  const p = ((phase % 1) + 1) % 1;
  const t = 0.5 - 0.5 * Math.cos(2 * Math.PI * p);
  const lifted = smoothstep(0.44, 0.56, p) * (1 - smoothstep(0.9, 0.99, p));
  return { yaw: 28 * DEG * (1 - 2 * t), dip: (-13.5 + 10 * lifted) * DEG, inWater: lifted < 0.5 };
}

/** Shipped oars: swung in along the gunwale, blades towards the stern, resting on the thwarts. */
export const OAR_REST = { yaw: -98 * DEG, dip: -4 * DEG };
