// Sea: Gerstner waves (four trains) displaced on the GPU with analytic normals, fresnel blend between
// the water body and the sky, a sun/moon glitter path, and shore foam driven by a baked water-depth
// texture (sampled from the terrain at load). Waves calm down in the shallows.
import { Color, DataTexture, LinearFilter, Mesh, MeshStandardNodeMaterial, PlaneGeometry, RedFormat, UnsignedByteType } from 'three/webgpu';
import {
  Fn,
  abs,
  cameraPosition,
  clamp,
  cos,
  dot,
  float,
  max,
  mix,
  mx_noise_float,
  mx_noise_vec3,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  reflect,
  sin,
  smoothstep,
  texture,
  time,
  transformNormalToView,
  uniform,
  varying,
  vec2,
  vec3,
} from 'three/tsl';
import { SEA_LEVEL } from './config.js';
import { SEA_SIZE, WAVE_TRAINS } from './waves.js';

/** Bake water depth (metres, 0–4 → 0–255) into a texture from a height sampler. */
export function bakeDepthTexture(heightAt, size, half) {
  const data = new Uint8Array(size * size);
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const x = -half + (i / (size - 1)) * 2 * half;
      const z = -half + (j / (size - 1)) * 2 * half;
      const h = heightAt(x, z);
      const depth = h === null ? 4 : Math.max(0, SEA_LEVEL - h);
      data[j * size + i] = Math.round(Math.min(1, depth / 4) * 255);
    }
  }
  const tex = new DataTexture(data, size, size, RedFormat, UnsignedByteType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Sky reflection plus the sun's (or moon's) glitter path, for a surface normal n seen along view.
 * The glints use a noise-jittered reflection vector, so instead of one mirror disc the light breaks
 * into a long, sparkling path towards the viewer (the jitter stands in for sub-pixel ripples).
 */
function seaReflection(u, view, n) {
  const r = reflect(view.negate(), n);
  const light = normalize(vec3(u.sunDir));
  const skyRefl = mix(vec3(u.skyHorizon), vec3(u.skyZenith), smoothstep(0.0, 0.6, max(r.y, 0.0)));
  const ripple = mx_noise_vec3(vec3(positionWorld.x.mul(1.8), positionWorld.z.mul(1.8), time.mul(0.9))).mul(vec3(0.13, 0.0, 0.13));
  const glints = pow(max(dot(normalize(r.add(ripple)), light), 0.0), 900.0).mul(12.0);
  const glow = pow(max(dot(r, light), 0.0), 16.0).mul(0.05);
  return skyRefl.add(vec3(u.sunColor).mul(glints.add(glow)).mul(u.glitter));
}

export function createSea({ depthTexture, half, size = SEA_SIZE, segments = 192 }) {
  const u = {
    deep: uniform(new Color(0.004, 0.02, 0.05)),
    shallow: uniform(new Color(0.02, 0.12, 0.12)),
    skyZenith: uniform(new Color(0.01, 0.01, 0.04)),
    skyHorizon: uniform(new Color(0.07, 0.07, 0.17)),
    sunDir: uniform(new Color(0.4, 0.6, -0.3)),
    sunColor: uniform(new Color(1, 0.6, 0.3)),
    glitter: uniform(1),
    foam: uniform(0.5),
    wind: uniform(1),
    /** Wave phase in seconds of wave travel, integrated on the CPU (phase += dt × wind) so the
     * rowboat (waves.js) and the shader always agree, and gusts never make the waves jump. */
    phase: uniform(0),
  };

  const depthUV = (p) => vec2(p.x.add(half).div(half * 2), p.z.add(half).div(half * 2));
  const waterDepth = (p) => texture(depthTexture, depthUV(p)).r.mul(4.0);

  // Vertex: sum of Gerstner waves (GPU Gems 1, ch. 1) with an analytic tangent frame. The plane is
  // rotated −90° about X, so local (x, y, 0) is world (x, 0, −y).
  const world = vec3(positionLocal.x, 0, positionLocal.y.negate());
  // Waves calm in the shallows and die out over the plane's outer 40 m, so its edge meets the flat far
  // ocean with the same normal (no visible seam at the horizon).
  const edge = smoothstep(size / 2, size / 2 - 40, max(abs(world.x), abs(world.z)));
  const calm = smoothstep(0.0, 2.5, texture(depthTexture, depthUV(world)).level(0).r.mul(4.0)).mul(0.85).add(0.15).mul(edge);
  let offset = vec3(0, 0, 0);
  let tangent = vec3(1, 0, 0);
  let binormal = vec3(0, 0, 1);
  for (const { dx: ddx, dz: ddz, k, c, steep, amp } of WAVE_TRAINS) {
    const f = float(k).mul(world.x.mul(ddx).add(world.z.mul(ddz)).sub(u.phase.mul(c)));
    const a = calm.mul(amp);
    const s = calm.mul(steep);
    const cf = cos(f);
    const sf = sin(f);
    offset = offset.add(vec3(a.mul(cf).mul(ddx), a.mul(sf), a.mul(cf).mul(ddz)));
    tangent = tangent.add(vec3(s.mul(sf).mul(-ddx * ddx), s.mul(cf).mul(ddx), s.mul(sf).mul(-ddx * ddz)));
    binormal = binormal.add(vec3(s.mul(sf).mul(-ddx * ddz), s.mul(cf).mul(ddz), s.mul(sf).mul(-ddz * ddz)));
  }
  const worldN = normalize(binormal.cross(tangent));

  const material = new MeshStandardNodeMaterial({ roughness: 0.06, metalness: 0.0 });
  material.name = 'Sea_Gerstner';
  const worldNormal = varying(worldN, 'vSeaNormal');
  const crest = varying(offset.y, 'vSeaCrest');
  // world offset (x, y, z) → local (x, −z, y)
  material.positionNode = positionLocal.add(vec3(offset.x, offset.z.negate(), offset.y));
  // world normal → local, then to view space
  material.normalNode = transformNormalToView(vec3(worldNormal.x, worldNormal.z.negate(), worldNormal.y));

  const view = normalize(cameraPosition.sub(positionWorld));
  const fresnel = Fn(() => float(0.02).add(float(0.98).mul(pow(float(1).sub(max(dot(worldNormal, view), 0.0)), 5.0))));
  const depth = waterDepth(positionWorld);

  material.colorNode = Fn(() => {
    const body = mix(vec3(u.shallow), vec3(u.deep), smoothstep(0.2, 3.5, depth));
    return body;
  })();

  material.emissiveNode = Fn(() => {
    const refl = seaReflection(u, view, worldNormal);
    // Shore foam: thin band where the water gets shallow, broken up by moving noise; plus wave crests.
    const n = mx_noise_float(vec3(positionWorld.x.mul(0.9), positionWorld.z.mul(0.9), time.mul(0.35))).mul(0.5).add(0.5);
    // narrow band only where the water is genuinely shallow (not across flat sand under the plane)
    const band = smoothstep(0.32, 0.06, depth).mul(smoothstep(0.0, 0.03, depth));
    const shore = band.mul(smoothstep(0.45, 0.75, n));
    const crestFoam = smoothstep(0.32, 0.5, crest).mul(0.3);
    const foam = clamp(shore.add(crestFoam), 0.0, 1.0);
    const foamColor = mix(vec3(u.skyHorizon), vec3(0.85, 0.82, 0.78), 0.55).mul(u.foam);
    return mix(refl.mul(fresnel()), foamColor, foam);
  })();

  const geometry = new PlaneGeometry(size, size, segments, segments);
  const mesh = new Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = SEA_LEVEL;
  mesh.name = 'explore_sea';
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  return { mesh, uniforms: u };
}

/** The GLB's huge flat sea becomes the far ocean around the detailed sea: the same shading as the
 * detailed sea's calm outer edge (deep body, sky reflection, sun/moon glitter), just without waves.
 * P3.4: it is cut away inside the detailed sea's square. It used to lie 8 cm under the whole detailed
 * sea, so every trough deeper than that showed a flat plane over the water (and hid the rowboat). */
export function createFarSea(seaMesh, u, size = SEA_SIZE) {
  const material = new MeshStandardNodeMaterial({ roughness: 0.06, metalness: 0.0 });
  material.name = 'Sea_Far';
  const view = normalize(cameraPosition.sub(positionWorld));
  const up = vec3(0, 1, 0);
  const fres = float(0.02).add(float(0.98).mul(pow(float(1).sub(max(view.y, 0.0)), 5.0)));
  material.colorNode = vec3(u.deep);
  material.emissiveNode = seaReflection(u, view, up).mul(fres);
  material.maskNode = max(abs(positionWorld.x), abs(positionWorld.z)).greaterThan(size / 2 - 0.5);
  seaMesh.material = material;
  seaMesh.position.y -= 0.08;
  seaMesh.receiveShadow = false;
  seaMesh.castShadow = false;
  return seaMesh;
}
