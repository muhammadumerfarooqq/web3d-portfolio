// Name-based material upgrade pass (TSL node materials). Each town material keeps its colour,
// roughness and emissive from the GLB and gains procedural detail: triplanar wood grain and board
// seams, sun-bleached wear, a dust gradient near the ground, fake contact AO, wet sheen on the street
// at night, sand sparkle, pulsing windows, flickering lanterns and glowing gold lettering.
// A material that already has a texture map (the baked final town) is left untouched.
import { Color, MeshStandardNodeMaterial } from 'three/webgpu';
import {
  Fn,
  abs,
  cameraPosition,
  clamp,
  color,
  dot,
  float,
  floor,
  fract,
  hash,
  max,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  normalWorld,
  normalize,
  pow,
  positionWorld,
  reflect,
  sin,
  smoothstep,
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

const triWeights = Fn(() => {
  const w = pow(abs(normalWorld), vec3(4));
  return w.div(w.x.add(w.y).add(w.z).add(1e-4));
});

/** 1 near the camera, 0 far away: fine procedural lines fade out before they alias into moiré. */
const nearFade = Fn(([near, far]) => smoothstep(far, near, positionWorld.sub(cameraPosition).length()));

/** Clapboard walls and plank floors: board seams + stretched grain, projected on three planes. */
const woodPattern = Fn(() => {
  const p = positionWorld;
  const w = triWeights();
  // walls facing ±Z: horizontal boards (seam along y), grain along x
  const seamZ = smoothstep(0.0, 0.06, fract(p.y.mul(5.0))).mul(smoothstep(1.0, 0.94, fract(p.y.mul(5.0))));
  const grainZ = mx_noise_float(vec3(p.x.mul(0.7), p.y.mul(16.0), p.z));
  // walls facing ±X: horizontal boards, grain along z
  const grainX = mx_noise_float(vec3(p.z.mul(0.7), p.y.mul(16.0), p.x));
  // floors and roofs facing ±Y: planks along x (seam along z)
  const seamY = smoothstep(0.0, 0.07, fract(p.z.mul(4.2))).mul(smoothstep(1.0, 0.93, fract(p.z.mul(4.2))));
  const grainY = mx_noise_float(vec3(p.x.mul(0.7), p.z.mul(14.0), p.y));
  const grain = grainX.mul(w.x).add(grainY.mul(w.y)).add(grainZ.mul(w.z));
  const seam = mix(float(1), seamZ.mul(w.x.add(w.z)).add(seamY.mul(w.y)), nearFade(10.0, 28.0));
  return vec3(grain.mul(0.5).add(0.5), seam, 0);
});

/** Large-scale weathering: sun-bleached patches (0 … 1). LOW uses one octave instead of three. */
let LITE = false;
const wearMask = Fn(() => {
  const n = LITE ? mx_noise_float(positionWorld.mul(0.35)) : mx_fractal_noise_float(positionWorld.mul(0.35), 3, 2.0, 0.5);
  return smoothstep(0.15, 0.75, n.mul(0.5).add(0.5));
});

/** Fake AO: darker where a surface meets the ground and on down-facing faces. */
const contactAO = Fn(() => {
  const ground = smoothstep(-0.05, 0.6, positionWorld.y);
  const facing = normalWorld.y.mul(0.25).add(0.75);
  return mix(0.5, 1.0, ground).mul(facing);
});

/** Dust settling on the lowest half metre. */
const dustMask = Fn(() => smoothstep(0.9, 0.0, positionWorld.y).mul(0.55));

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

const DUST = color(0.62, 0.42, 0.24);

function woodMaterial(material, base, u) {
  const m = nodeMaterial(material, base);
  const c = color(base.color);
  const wood = woodPattern();
  const grainTint = mix(0.72, 1.18, wood.x);
  const seamShade = mix(0.55, 1.0, wood.y);
  const bleached = mix(c, c.mul(1.9).add(vec3(0.05, 0.04, 0.03)), wearMask().mul(0.45));
  const albedo = bleached.mul(grainTint).mul(seamShade).mul(contactAO());
  m.colorNode = mix(albedo, DUST, dustMask());
  m.roughnessNode = clamp(float(base.roughness).add(wood.x.sub(0.5).mul(0.2)), 0.35, 1.0);
  return m;
}

function roofMaterial(material, base) {
  const m = nodeMaterial(material, base);
  const p = positionWorld;
  const rows = mix(float(1), smoothstep(0.0, 0.12, fract(p.y.mul(6.0))), nearFade(12.0, 32.0));
  const tile = hash(floor(p.x.mul(3.5)).add(floor(p.y.mul(6.0)).mul(57.0)).add(floor(p.z.mul(3.5)).mul(113.0)));
  const c = color(base.color).mul(mix(0.6, 1.25, tile)).mul(mix(0.55, 1.0, rows));
  m.colorNode = mix(c, c.mul(1.8), wearMask().mul(0.35));
  m.roughnessNode = float(base.roughness);
  return m;
}

function trimMaterial(material, base) {
  const m = nodeMaterial(material, base);
  m.colorNode = color(base.color).mul(mix(0.82, 1.05, mx_noise_float(positionWorld.mul(3.0)).mul(0.5).add(0.5))).mul(contactAO());
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
    m.emissiveNode = e.mul(0.13).mul(u.windowGlow).mul(pane.mul(0.2).add(0.85)).mul(mix(0.18, 1.0, bars)).mul(warmth);
  } else if (kind === 'Lantern') {
    // Flame flicker, desynchronised per lantern by its position.
    const seed = p.x.mul(7.31).add(p.z.mul(3.17));
    const flicker = sin(time.mul(11.0).add(seed)).mul(0.08).add(sin(time.mul(23.0).add(seed.mul(1.7))).mul(0.05)).add(0.87);
    m.emissiveNode = e.mul(0.11).mul(mix(0.06, 1.0, u.lantern)).mul(flicker);
  } else {
    // Gold lettering: a soft neon-like glow at night, a warm sheen by day.
    const pulse = sin(time.mul(1.6)).mul(0.06).add(1.0);
    m.emissiveNode = e.mul(mix(0.12, 1.6, u.night)).mul(pulse);
    m.metalness = 0.85;
  }
  return m;
}

function simpleMaterial(material, base, kind) {
  const m = nodeMaterial(material, base);
  const n = mx_noise_float(positionWorld.mul(kind === 'Hay' ? 6.0 : 2.0)).mul(0.5).add(0.5);
  m.colorNode = color(base.color).mul(mix(0.8, 1.15, n)).mul(contactAO());
  if (kind === 'Iron') m.metalness = 0.7;
  return m;
}

/**
 * Upgrade one GLB material by name. Returns the replacement, or the original when it already has a
 * texture map, is not one of ours, or is water (the sea has its own shader).
 */
export function upgradeMaterial(material, u, { lite = false } = {}) {
  if (!material || material.map) return material;
  LITE = lite;
  const name = material.name;
  const base = baseOf(material);
  if (MATERIALS.emissive.includes(name)) return emissiveMaterial(material, base, u, name);
  if (MATERIALS.wood.includes(name)) return woodMaterial(material, base, u);
  if (MATERIALS.roof.includes(name)) return roofMaterial(material, base);
  if (MATERIALS.trim.includes(name)) return trimMaterial(material, base);
  if (MATERIALS.ground.includes(name)) return groundMaterial(material, base, u, { street: MATERIALS.street.includes(name), sand: name === 'Sand' });
  if (MATERIALS.misc.includes(name)) return simpleMaterial(material, base, name);
  return material;
}
