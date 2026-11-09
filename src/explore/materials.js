// Name-based material upgrade pass (TSL node materials). The final town is baked in Blender
// (Baked_<Group> materials carrying an albedo × AO WebP atlas); those keep their map untouched,
// except the dock, which gains a night wet sheen. The untextured ground, sea-side and emissive
// materials keep their colour/roughness from the GLB and gain procedural detail: wet puddles on the
// street at night, sand sparkle, breathing windows, flickering lanterns and glowing gold lettering.
import { Color, MeshStandardNodeMaterial, Vector3 } from 'three/webgpu';
import {
  Fn,
  cameraPosition,
  color,
  dot,
  float,
  floor,
  fract,
  hash,
  materialEmissive,
  max,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  normalView,
  normalWorld,
  normalize,
  pow,
  positionViewDirection,
  positionWorld,
  reflect,
  sin,
  smoothstep,
  texture,
  time,
  uniform,
  vec3,
} from 'three/tsl';
import { MATERIALS } from './config.js';

/** Shared uniforms driven by the time of day (see time-of-day.js). */
export function createMaterialUniforms() {
  return {
    night: uniform(1), // 0 golden hour … 1 night
    wetness: uniform(1),
    windowGlow: uniform(1),
    lantern: uniform(1),
    sunDir: uniform(new Color(0.4, 0.6, -0.3)), // used as a vec3
    sunColor: uniform(new Color(1, 0.6, 0.3)),
  };
}

/** LOW uses one noise octave instead of three. */
let LITE = false;

/** Fake AO: darker where a surface meets the ground and on down-facing faces. */
const contactAO = Fn(() => {
  const ground = smoothstep(-0.05, 0.6, positionWorld.y);
  const facing = normalWorld.y.mul(0.25).add(0.75);
  return mix(0.5, 1.0, ground).mul(facing);
});

function baseOf(material) {
  return {
    color: material.color ? material.color.clone() : new Color(1, 1, 1),
    roughness: material.roughness ?? 0.9,
    metalness: material.metalness ?? 0,
    emissive: material.emissive ? material.emissive.clone() : new Color(0, 0, 0),
    emissiveIntensity: material.emissiveIntensity ?? 1,
  };
}

function nodeMaterial(material, base) {
  const m = new MeshStandardNodeMaterial({ name: material.name, roughness: base.roughness, metalness: base.metalness });
  m.side = material.side;
  m.transparent = material.transparent;
  m.opacity = material.opacity;
  return m;
}

/**
 * The baked final town keeps its albedo × AO atlas untouched. The dock alone gains a wet sheen at
 * night: the boards nearest the water and the low spots pool spray, so the dock lanterns streak
 * across them. The map and the GLB's roughness are kept; only roughness (and a slight darkening of
 * the wet patches) is layered on top.
 */
function bakedDockMaterial(material, u) {
  const m = new MeshStandardNodeMaterial({ name: material.name, roughness: material.roughness ?? 0.85, metalness: material.metalness ?? 0 });
  m.map = material.map;
  m.side = material.side;
  m.transparent = material.transparent;
  m.opacity = material.opacity;
  const p = positionWorld;
  const patches = smoothstep(0.45, 0.7, (LITE ? mx_noise_float(p.mul(0.6)) : mx_fractal_noise_float(p.mul(0.6), 2, 2.0, 0.5)).mul(0.5).add(0.5));
  // up-facing boards only (posts and rails stay dry)
  const up = smoothstep(0.6, 0.95, normalWorld.y);
  const wet = u.wetness.mul(patches).mul(up).mul(0.85);
  m.colorNode = texture(material.map).rgb.mul(color(material.color ?? new Color(1, 1, 1))).mul(mix(1.0, 0.6, wet));
  m.roughnessNode = mix(float(material.roughness ?? 0.85), float(0.12), wet);
  return m;
}

function groundMaterial(material, base, u, { street = false, sand = false } = {}) {
  const m = nodeMaterial(material, base);
  const p = positionWorld;
  const large = (LITE ? mx_noise_float(p.mul(0.08)) : mx_fractal_noise_float(p.mul(0.08), 3, 2.0, 0.5)).mul(0.5).add(0.5);
  const fine = LITE ? float(0.5) : mx_noise_float(p.mul(2.2)).mul(0.5).add(0.5);
  let albedo = color(base.color).mul(mix(0.72, 1.22, large)).mul(mix(0.9, 1.08, fine));
  let rough = float(base.roughness);
  if (street) {
    // Puddle mask: where it pools, night turns the dirt dark and glossy so lanterns and windows smear
    // across it (specular highlights from the pooled point lights, plus SSR on HIGH/ULTRA).
    const puddles = smoothstep(0.48, 0.62, (LITE ? mx_noise_float(p.mul(0.32)) : mx_fractal_noise_float(p.mul(0.32), 2, 2.0, 0.5)).mul(0.5).add(0.5));
    const wet = u.wetness.mul(mix(0.45, 1.0, puddles));
    albedo = albedo.mul(mix(1.0, 0.42, wet));
    rough = mix(rough, mix(0.5, 0.06, puddles), wet);
  }
  m.colorNode = albedo;
  m.roughnessNode = rough;
  if (sand && !LITE) {
    // Sand sparkle: tiny grains catch the low sun; the glints shift as the camera moves.
    const cell = floor(p.mul(70.0));
    const glint = hash(cell.x.add(cell.y.mul(131.0)).add(cell.z.mul(71.0)).add(floor(cameraPosition.x.mul(2.0)).add(floor(cameraPosition.z.mul(2.0)).mul(17.0))));
    const view = normalize(p.sub(cameraPosition));
    const spec = pow(max(dot(reflect(view, normalWorld), vec3(u.sunDir)), 0.0), 24.0);
    m.emissiveNode = vec3(u.sunColor).mul(smoothstep(0.992, 1.0, glint)).mul(spec).mul(float(1.0).sub(u.night)).mul(3.0);
  }
  return m;
}

function emissiveMaterial(material, base, u, kind) {
  const m = nodeMaterial(material, base);
  m.colorNode = color(base.color);
  const e = color(base.emissive).mul(base.emissiveIntensity);
  const p = positionWorld;
  if (kind === 'Window_Warm') {
    // Each window pane breathes slowly (people moving inside), stronger at night.
    const pane = mx_noise_float(vec3(floor(p.x.mul(1.2)), floor(p.y.mul(1.5)), floor(p.z.mul(1.2))).add(time.mul(0.25)));
    // Mullions and glazing bars: a 2 × 3 grid of darker frame lines over each window.
    const bars = smoothstep(0.04, 0.09, fract(p.y.mul(2.6))).mul(smoothstep(0.04, 0.09, fract(p.x.add(p.z).mul(1.9))));
    // Warm interior falloff: brighter towards the bottom of the pane (lamplight on the sill).
    const warmth = mix(1.15, 0.75, fract(p.y.mul(2.6)));
    m.emissiveNode = e.mul(0.085).mul(u.windowGlow).mul(pane.mul(0.2).add(0.85)).mul(mix(0.18, 1.0, bars)).mul(warmth);
  } else if (kind === 'Lantern') {
    // Flame flicker, desynchronised per lantern by its position.
    const seed = p.x.mul(7.31).add(p.z.mul(3.17));
    const flicker = sin(time.mul(11.0).add(seed)).mul(0.08).add(sin(time.mul(23.0).add(seed.mul(1.7))).mul(0.05)).add(0.87);
    m.emissiveNode = e.mul(0.055).mul(mix(0.06, 1.0, u.lantern)).mul(flicker);
  } else {
    // Gold lettering: a soft neon-like glow at night, a warm sheen by day.
    const pulse = sin(time.mul(1.6)).mul(0.06).add(1.0);
    m.emissiveNode = e.mul(mix(0.1, 0.8, u.night)).mul(pulse);
    m.metalness = 0.85;
  }
  return m;
}

function simpleMaterial(material, base, kind) {
  const m = nodeMaterial(material, base);
  const n = mx_noise_float(positionWorld.mul(kind === 'Rope' ? 6.0 : 2.0)).mul(0.5).add(0.5);
  m.colorNode = color(base.color).mul(mix(0.8, 1.15, n)).mul(contactAO());
  if (kind === 'Iron') m.metalness = 0.7;
  return m;
}

/**
 * Upgrade one GLB material by name. Returns the replacement, or the original when it already has a
 * texture map, is not one of ours, or is water (the sea has its own shader).
 */
export function upgradeMaterial(material, u, { lite = false } = {}) {
  if (!material) return material;
  LITE = lite;
  const name = material.name;
  if (name === 'Baked_Dock' && material.map) return bakedDockMaterial(material, u);
  if (material.map) return material;
  const base = baseOf(material);
  if (MATERIALS.emissive.includes(name)) return emissiveMaterial(material, base, u, name);
  if (MATERIALS.ground.includes(name)) return groundMaterial(material, base, u, { street: MATERIALS.street.includes(name), sand: name === 'Sand' });
  if (MATERIALS.misc.includes(name)) return simpleMaterial(material, base, name);
  return material;
}

/**
 * Character lighting for the sheriff at night, in the shader so it never lifts the rest of the scene:
 * a cool moon rim (fresnel) and a warm wrap key from the nearest lantern. index.js drives the
 * uniforms each frame (night level, direction and strength of the nearest lantern).
 */
export function createRimUniforms() {
  return {
    moon: uniform(0),
    moonColor: uniform(new Color(0.45, 0.58, 1.0)),
    key: uniform(0),
    keyDir: uniform(new Vector3(0, 1, 0)),
    keyColor: uniform(new Color(1.0, 0.62, 0.3)),
  };
}

const COPY = ['color', 'map', 'roughness', 'metalness', 'roughnessMap', 'metalnessMap', 'normalMap', 'normalScale', 'emissive', 'emissiveMap', 'emissiveIntensity', 'aoMap', 'aoMapIntensity', 'alphaMap', 'alphaTest', 'transparent', 'opacity', 'side', 'vertexColors', 'depthWrite'];

export function rimMaterial(material, r) {
  if (!material || material.isNodeMaterial) return material;
  const m = new MeshStandardNodeMaterial({ name: material.name });
  for (const k of COPY) {
    const v = material[k];
    if (v === undefined || v === null) continue;
    if (v && typeof v.clone === 'function' && !v.isTexture) m[k] = v.clone();
    else m[k] = v;
  }
  const fresnel = pow(float(1).sub(max(dot(normalView, positionViewDirection), 0.0)), 3.0);
  const rim = vec3(r.moonColor).mul(fresnel).mul(r.moon).mul(0.32);
  const wrap = max(dot(normalWorld, vec3(r.keyDir)).add(0.35).div(1.35), 0.0);
  const key = vec3(r.keyColor).mul(wrap).mul(r.key).mul(0.22);
  m.emissiveNode = materialEmissive.add(rim).add(key);
  return m;
}
