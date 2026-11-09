// Lighting: one directional light (sun at golden hour, moon at night) with a tight shadow frustum
// that follows the player (texel-snapped against shimmer), a hemisphere fill tinted per time of day,
// a fixed pool of lantern point lights re-assigned to the nearest lanterns (a fixed count, so shaders
// never recompile), cheap additive light pools on the ground under every lantern (all tiers), and the
// exponential + height fog.
import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  InstancedMesh,
  MeshBasicNodeMaterial,
  Object3D,
  PCFShadowMap,
  PointLight,
  Vector3,
} from 'three/webgpu';
import { densityFogFactor, exponentialHeightFogFactor, float, fog, length, max, smoothstep, uniform, uv, vec3 } from 'three/tsl';
import { SEA_LEVEL } from './config.js';

const SHADOW_HALF = 20;

export function createLights(scene, renderer, settings, lanternPositions, heightAt, surfaceBelow = null) {
  renderer.shadowMap.enabled = settings.shadowMap > 0;
  renderer.shadowMap.type = PCFShadowMap;

  const sun = new DirectionalLight(0xffffff, 2);
  sun.name = 'explore_sun';
  sun.castShadow = settings.shadowMap > 0;
  if (sun.castShadow) {
    sun.shadow.mapSize.set(settings.shadowMap, settings.shadowMap);
    const cam = sun.shadow.camera;
    cam.left = -SHADOW_HALF;
    cam.right = SHADOW_HALF;
    cam.top = SHADOW_HALF;
    cam.bottom = -SHADOW_HALF;
    cam.near = 1;
    cam.far = 160;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
  }
  scene.add(sun, sun.target);

  const hemi = new HemisphereLight(0xffffff, 0x000000, 0.6);
  scene.add(hemi);

  // Soft character light: keeps the sheriff readable against the night street (no shadow).
  const fill = new PointLight(0xffc896, 0, 6, 2);
  fill.name = 'explore_fill';
  scene.add(fill);

  // Lantern pool: fixed size per tier, moved to the nearest lanterns each frame (at night).
  const pool = [];
  for (let i = 0; i < settings.lanterns; i += 1) {
    const l = new PointLight(0xffa64a, 0, 11, 2);
    l.castShadow = false;
    scene.add(l);
    pool.push(l);
  }

  // Ground light pools: one additive radial decal per lantern, at every tier.
  const poolUniform = uniform(1);
  const poolMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
  poolMat.polygonOffset = true;
  poolMat.polygonOffsetFactor = -4;
  const r = length(uv().sub(0.5)).mul(2.0);
  poolMat.colorNode = vec3(1.0, 0.55, 0.2).mul(smoothstep(1.0, 0.0, r).pow(2.2)).mul(poolUniform).mul(0.45);
  const decals = new InstancedMesh(new CircleGeometry(3.2, 24), poolMat, Math.max(1, lanternPositions.length));
  decals.name = 'explore_lantern_pools';
  decals.renderOrder = 2;
  const dummy = new Object3D();
  lanternPositions.forEach((p, i) => {
    // Over water (the dock lamps) the terrain grid is the sea floor: put the pool on the boards instead.
    let ground = heightAt(p.x, p.z);
    if ((ground ?? 0) < SEA_LEVEL && surfaceBelow) ground = surfaceBelow(p.x, p.y - 0.3, p.z) ?? ground;
    dummy.position.set(p.x, (ground ?? 0) + 0.03, p.z);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.updateMatrix();
    decals.setMatrixAt(i, dummy.matrix);
  });
  decals.count = lanternPositions.length;
  decals.instanceMatrix.needsUpdate = true;
  decals.frustumCulled = false;
  scene.add(decals);

  // Fog: exponential with an extra low-lying layer (heavier at night).
  const fogU = { color: uniform(new Color(0.05, 0.06, 0.14)), density: uniform(0.013), height: uniform(0.9) };
  scene.fogNode = fog(fogU.color, max(densityFogFactor(fogU.density), exponentialHeightFogFactor(fogU.density.mul(fogU.height).mul(2.2), float(1.2))));

  const tmp = new Vector3();
  const sorted = lanternPositions.map((p) => ({ p, d: 0 }));

  return {
    sun,
    hemi,
    pool,
    decals,
    fog: fogU,
    /** Apply a time-of-day palette. */
    apply(pal) {
      sun.color.setRGB(...pal.sunColor);
      sun.intensity = pal.sunIntensity;
      hemi.color.setRGB(...pal.hemiSky);
      hemi.groundColor.setRGB(...pal.hemiGround);
      hemi.intensity = pal.hemiIntensity;
      fogU.color.value.setRGB(...pal.fogColor);
      fogU.density.value = pal.fogDensity;
      fogU.height.value = pal.heightFog;
      poolUniform.value = pal.lanternIntensity;
      fill.intensity = 0.3 + 1.6 * pal.t;
      this.sunDir = pal.sunDir;
      this.lanternLevel = pal.lanternIntensity;
    },
    /** Follow the player: snap the shadow centre to texels; move the lantern pool. */
    update(focus, elapsed, cameraPos) {
      const dir = this.sunDir ?? [0.4, 0.6, -0.3];
      const texel = (SHADOW_HALF * 2) / Math.max(256, settings.shadowMap || 256);
      const cx = Math.round(focus.x / texel) * texel;
      const cz = Math.round(focus.z / texel) * texel;
      sun.target.position.set(cx, 0, cz);
      sun.position.set(cx + dir[0] * 70, dir[1] * 70, cz + dir[2] * 70);
      sun.target.updateMatrixWorld();
      // In front of the sheriff, between him and the camera, at chest height: lights the face, not the hat.
      fill.position.set(focus.x, focus.y + 1.5, focus.z);
      if (cameraPos) fill.position.lerp(cameraPos, 0.3);
      if (!pool.length) return;
      const level = this.lanternLevel ?? 0;
      for (const s of sorted) s.d = tmp.copy(s.p).sub(focus).lengthSq();
      sorted.sort((a, b) => a.d - b.d);
      pool.forEach((l, i) => {
        const s = sorted[i];
        if (!s || level <= 0.01) {
          l.intensity = 0;
          return;
        }
        l.position.copy(s.p);
        l.position.y -= 0.15;
        const flicker = 0.88 + Math.sin(elapsed * 11 + i * 1.7) * 0.06 + Math.sin(elapsed * 23 + i * 3.1) * 0.04;
        l.intensity = 9 * level * flicker;
      });
    },
    dispose() {
      decals.geometry.dispose();
      poolMat.dispose();
      sun.shadow.map?.dispose();
      scene.fogNode = null;
    },
  };
}
