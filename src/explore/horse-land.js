// Where the horse may stand (pure, unit-tested; P3.4). In P3.3 only the horse's origin was tested
// against "water no deeper than 15 cm", so on the beach its body could stop in the surf (the real-GPU
// report: "the horse was standing in the sea"). Now every stop, idle, wander and spawn point needs its
// whole footprint (nose, rump, both flanks) on DRY ground: the terrain at least 25 cm above sea level,
// above the wave crests that wash the beach. When the spot beside the sheriff is wet, the horse snaps
// to the nearest walkable street node instead; wander targets shrink towards the horse until dry.
import { SEA_LEVEL } from './config.js';

/** Ground must be this far above sea level to count as dry (beach crests reach ~0.12 m). */
export const DRY = 0.25;

/** Footprint samples in horse space [lateral x, along z] (metres; nose +z, from the mesh bounds). */
export const FOOTPRINT = [
  [0, 0],
  [0, 1.05],
  [0, -0.75],
  [0.42, 0.15],
  [-0.42, 0.15],
];

/** heightAt(x, z) → ground height or null (off the terrain). */
export function isDry(heightAt, x, z) {
  const h = heightAt(x, z);
  return h !== null && h !== undefined && Number.isFinite(h) && h >= SEA_LEVEL + DRY;
}

/** Is the whole horse (standing at x, z facing yaw; facing 0 = +Z) on dry ground? */
export function footprintDry(heightAt, x, z, yaw) {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  return FOOTPRINT.every(([lx, lz]) => isDry(heightAt, x + lx * c + lz * s, z - lx * s + lz * c));
}

/** Dry in every direction within r (a street node the horse may face any way at). */
export function areaDry(heightAt, x, z, r = 1.1) {
  if (!isDry(heightAt, x, z)) return false;
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    if (!isDry(heightAt, x + Math.sin(a) * r, z + Math.cos(a) * r)) return false;
  }
  return true;
}

/**
 * Where the horse stops for the sheriff at p (facing `facing`): beside him (right, left, behind,
 * ahead, near then a little farther) with a dry footprint and a clear line from him; otherwise the
 * nearest dry street node within `reach` with a clear line. Returns { x, z, yaw, snapped } or null.
 * clear(ax, az, bx, bz) → no wall in between.
 */
export function stopSpot({ heightAt, clear, nodes = [], p, facing, dist = 1.9, reach = 14 }) {
  for (const d of [dist, dist + 0.8]) {
    for (const a of [Math.PI / 2, -Math.PI / 2, Math.PI, 0]) {
      const x = p.x + Math.sin(facing + a) * d;
      const z = p.z + Math.cos(facing + a) * d;
      if (footprintDry(heightAt, x, z, facing) && clear(p.x, p.z, x, z)) return { x, z, yaw: facing, snapped: false };
    }
  }
  const near = nodes
    .map((n) => ({ n, d: Math.hypot(n.x - p.x, n.z - p.z) }))
    .filter((o) => o.d <= reach)
    .sort((a, b) => a.d - b.d);
  for (const { n } of near) {
    const yaw = Math.atan2(p.x - n.x, p.z - n.z);
    if (footprintDry(heightAt, n.x, n.z, yaw) && clear(n.x, n.z, p.x, p.z)) return { x: n.x, z: n.z, yaw, snapped: true };
  }
  return null;
}

/**
 * A short wander from (x, z): a random direction, `radius` metres, shrinking towards the horse until
 * the footprint is dry and the way is clear. Returns { x, z, yaw } or null (stay put).
 */
export function wanderTarget({ heightAt, clear, x, z, radius = 2.5, rng = Math.random }) {
  const a = rng() * Math.PI * 2;
  for (const r of [radius, radius * 0.6, radius * 0.3]) {
    const tx = x + Math.sin(a) * r;
    const tz = z + Math.cos(a) * r;
    const yaw = Math.atan2(tx - x, tz - z);
    if (footprintDry(heightAt, tx, tz, yaw) && clear(x, z, tx, tz)) return { x: tx, z: tz, yaw };
  }
  return null;
}
