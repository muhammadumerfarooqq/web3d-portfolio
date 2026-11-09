// Character controller maths (pure, unit-tested): input → camera-relative movement, frame-rate
// independent damping, capsule-vs-BVH collision (three-mesh-bvh shapecast), step-up, ground test and
// the island's soft wall. Imports only three's maths classes so it runs in Node tests.
import { Box3, Line3, Ray, Vector3 } from 'three';

/** Keyboard state → unit input vector in camera space (x = right, z = forward). */
export function inputVector({ forward = false, back = false, left = false, right = false, x = 0, y = 0 } = {}) {
  let ix = (right ? 1 : 0) - (left ? 1 : 0) + x;
  let iz = (forward ? 1 : 0) - (back ? 1 : 0) + y;
  const len = Math.hypot(ix, iz);
  if (len > 1) {
    ix /= len;
    iz /= len;
  }
  return { x: ix, z: iz, magnitude: Math.min(1, len) };
}

/**
 * Camera-relative input → world XZ direction. Camera yaw 0 looks down −Z (three.js default), so
 * "forward" is (−sin yaw, −cos yaw) and "right" is (cos yaw, −sin yaw).
 */
export function worldMove(input, yaw) {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  return { x: input.x * c - input.z * s, z: -input.x * s - input.z * c };
}

/** Frame-rate independent exponential smoothing factor. */
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

/** Move `current` towards `target` with exponential damping. */
export const approach = (current, target, rate, dt) => current + (target - current) * damp(rate, dt);

/** Shortest signed angle difference a → b in radians. */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

const _box = new Box3();
const _triPoint = new Vector3();
const _capPoint = new Vector3();
const _push = new Vector3();

/**
 * Push a capsule (segment start→end, radius) out of every triangle of a three-mesh-bvh MeshBVH.
 * Returns { segment, groundNormalY } where groundNormalY is the most upward push normal seen
 * (≈ 1 on flat ground, < cos(maxSlope) on walls, −1 when nothing touched).
 */
export function resolveCapsule(bvh, start, end, radius, iterations = 2) {
  const segment = new Line3(start.clone(), end.clone());
  let groundNormalY = -1;
  for (let i = 0; i < iterations; i += 1) {
    _box.makeEmpty();
    _box.expandByPoint(segment.start);
    _box.expandByPoint(segment.end);
    _box.min.addScalar(-radius);
    _box.max.addScalar(radius);
    let moved = false;
    bvh.shapecast({
      intersectsBounds: (box) => box.intersectsBox(_box),
      intersectsTriangle: (tri) => {
        const distance = tri.closestPointToSegment(segment, _triPoint, _capPoint);
        if (distance < radius) {
          const depth = radius - distance;
          _push.subVectors(_capPoint, _triPoint);
          if (_push.lengthSq() < 1e-12) tri.getNormal(_push);
          _push.normalize();
          segment.start.addScaledVector(_push, depth);
          segment.end.addScaledVector(_push, depth);
          groundNormalY = Math.max(groundNormalY, _push.y);
          moved = true;
        }
        return false;
      },
    });
    if (!moved) break;
  }
  return { segment, groundNormalY };
}

const _ray = new Ray();

/** First hit straight down from `origin` within `length`, or null. */
export function castDown(bvh, origin, length) {
  _ray.origin.copy(origin);
  _ray.direction.set(0, -1, 0);
  const hit = bvh.raycastFirst(_ray, 2 /* DoubleSide */);
  return hit && hit.distance <= length ? hit : null;
}

/**
 * Step assist: when walking into something low (a porch step, a kerb), lift the feet onto it.
 * Returns the height to rise (0 when there is no climbable step ahead).
 */
export function stepUpHeight(bvh, feet, dirX, dirZ, radius, stepHeight) {
  const len = Math.hypot(dirX, dirZ);
  if (len < 1e-3) return 0;
  const probe = new Vector3(feet.x + (dirX / len) * (radius + 0.12), feet.y + stepHeight + 0.05, feet.z + (dirZ / len) * (radius + 0.12));
  const hit = castDown(bvh, probe, stepHeight + 0.1);
  if (!hit) return 0;
  const rise = hit.point.y - feet.y;
  return rise > 0.04 && rise <= stepHeight ? rise : 0;
}

/**
 * Island soft wall: where the sea under the player is deeper than `maxDepth`, return a push towards
 * dry land (the island centre) that grows with the depth. depthAt(x, z) → water depth in metres.
 */
export function softWall(pos, depthAt, maxDepth = 0.12, strength = 10) {
  const depth = depthAt(pos.x, pos.z);
  if (depth <= maxDepth) return { x: 0, z: 0, depth };
  const len = Math.hypot(pos.x, pos.z) || 1;
  const k = Math.min(1, (depth - maxDepth) / 0.6) * strength;
  return { x: (-pos.x / len) * k, z: (-pos.z / len) * k, depth };
}

/** Sample a square height grid (size×size covering [-half, half]²) bilinearly. */
export function sampleGrid(grid, size, half, x, z) {
  const fx = ((x + half) / (2 * half)) * (size - 1);
  const fz = ((z + half) / (2 * half)) * (size - 1);
  if (fx < 0 || fz < 0 || fx > size - 1 || fz > size - 1) return null;
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const x1 = Math.min(size - 1, x0 + 1);
  const z1 = Math.min(size - 1, z0 + 1);
  const tx = fx - x0;
  const tz = fz - z0;
  const a = grid[z0 * size + x0] * (1 - tx) + grid[z0 * size + x1] * tx;
  const b = grid[z1 * size + x0] * (1 - tx) + grid[z1 * size + x1] * tx;
  return a * (1 - tz) + b * tz;
}
