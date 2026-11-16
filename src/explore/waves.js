// Sea waves, shared by the GPU sea (sea.js) and the CPU (the rowboat floats on them, P3.4). Pure maths:
// the same four Gerstner trains, the same shallow-water calming from the baked depth texture (sampled
// the way the GPU samples it), and the same wave phase. The phase is integrated on the CPU
// (phase += dt × wind) and sent to the shader as a uniform, so both sides always agree.
import { SEA_LEVEL } from './config.js';

export const WAVES = [
  // direction x, z, steepness, wavelength (m)
  [1.0, 0.35, 0.16, 18.0],
  [0.6, -0.8, 0.12, 11.0],
  [-0.4, 0.9, 0.09, 6.5],
  [0.9, 0.9, 0.06, 3.3],
];

/** Per train: unit direction, wavenumber k, phase speed c, amplitude/steepness factors. */
export const WAVE_TRAINS = WAVES.map(([dx, dz, steep, length]) => {
  const dl = Math.hypot(dx, dz);
  const k = (2 * Math.PI) / length;
  return { dx: dx / dl, dz: dz / dl, k, c: Math.sqrt(9.8 / k), steep, amp: steep / k };
});

/** The detailed sea plane's size (m); waves die out over its outer 40 m. */
export const SEA_SIZE = 240;

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Bilinear sampler over the baked depth texture's bytes, exactly like the GPU's linear filter
 * (texel centres at (i + 0.5) / size, clamp to edge). Returns water depth in metres (0–4).
 */
export function depthSampler(data, size, half) {
  const at = (i, j) => data[Math.min(size - 1, Math.max(0, j)) * size + Math.min(size - 1, Math.max(0, i))];
  return (x, z) => {
    const u = ((x + half) / (2 * half)) * size - 0.5;
    const v = ((z + half) / (2 * half)) * size - 0.5;
    const i = Math.floor(u);
    const j = Math.floor(v);
    const tx = u - i;
    const ty = v - j;
    const a = at(i, j) * (1 - tx) + at(i + 1, j) * tx;
    const b = at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx;
    return ((a * (1 - ty) + b * ty) / 255) * 4;
  };
}

/** Wave height multiplier at a rest position: calm in the shallows, zero at the plane's edge. */
export function calmAt(depth, x, z, size = SEA_SIZE) {
  const edge = smoothstep(size / 2, size / 2 - 40, Math.max(Math.abs(x), Math.abs(z)));
  return (smoothstep(0, 2.5, depth) * 0.85 + 0.15) * edge;
}

/** Gerstner displacement of the rest point (x, z) at `phase` (out: { x, y, z } offsets in metres). */
export function gerstner(x, z, phase, calm, out = { x: 0, y: 0, z: 0 }) {
  out.x = 0;
  out.y = 0;
  out.z = 0;
  for (const w of WAVE_TRAINS) {
    const f = w.k * (x * w.dx + z * w.dz - phase * w.c);
    const a = calm * w.amp;
    const cf = Math.cos(f);
    out.x += a * cf * w.dx;
    out.y += a * Math.sin(f);
    out.z += a * cf * w.dz;
  }
  return out;
}

const _o = { x: 0, y: 0, z: 0 };

/**
 * World height of the displaced sea surface above the world point (x, z). Gerstner waves also move
 * points sideways, so the rest point under (x, z) is found by fixed-point iteration first.
 */
export function seaHeight(x, z, phase, depthAt, size = SEA_SIZE) {
  let px = x;
  let pz = z;
  for (let i = 0; i < 6; i += 1) {
    gerstner(px, pz, phase, calmAt(depthAt(px, pz), px, pz, size), _o);
    px = x - _o.x;
    pz = z - _o.z;
  }
  gerstner(px, pz, phase, calmAt(depthAt(px, pz), px, pz, size), _o);
  return SEA_LEVEL + _o.y;
}

/**
 * Float pose of a boat at (x, z) with heading `yaw` (Object3D rotation.y): the hull's reference point
 * sits `freeboard` metres above the surface right under it; pitch and roll come from the surface under
 * the bow / stern (± halfLength) and the sides (± halfBeam). Rotation order 'YXZ'.
 */
export function floatPose(x, z, yaw, phase, depthAt, { freeboard = 0.3, halfLength = 1.6, halfBeam = 0.6 } = {}, out = {}) {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  const h = (lx, lz) => seaHeight(x + lx * c + lz * s, z - lx * s + lz * c, phase, depthAt);
  const surface = seaHeight(x, z, phase, depthAt);
  const stern = h(0, halfLength); // local +Z
  const bow = h(0, -halfLength);
  const port = h(halfBeam, 0); // local +X
  const starboard = h(-halfBeam, 0);
  out.surface = surface;
  out.y = surface + freeboard;
  out.pitch = Math.atan2(bow - stern, 2 * halfLength); // bow up → stern dips (rotation.x > 0)
  out.roll = Math.atan2(port - starboard, 2 * halfBeam); // +X side up (rotation.z > 0)
  return out;
}
