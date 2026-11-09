// Zones (pure, unit-tested): read from public/models/town.json, never hard-coded. Proximity trigger on
// the door position, "next unvisited zone" for the edge arrow, and the arrow angle on screen.

/** The section each zone opens in Classic (same anchors). */
export const ZONE_ANCHORS = {
  about: '#about',
  projects: '#projects',
  skills: '#skills',
  achievements: '#achievements',
  contact: '#contact',
  promo: '#video',
  journey: '#journey',
  chat: '#chat',
};

const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

/** Parse town.json → { spawn, zones[] }. Only landmarks with a known zone become zones. */
export function loadZones(town) {
  const landmarks = town?.landmarks ?? {};
  const spawn = landmarks.spawn && isVec3(landmarks.spawn.pos) ? { pos: landmarks.spawn.pos, yawDeg: Number(landmarks.spawn.yaw_deg) || 0 } : { pos: [0, 0, 0], yawDeg: 0 };
  const zones = [];
  for (const [id, lm] of Object.entries(landmarks)) {
    if (!lm || !lm.zone || !(lm.zone in ZONE_ANCHORS)) continue;
    if (!isVec3(lm.door) || !isVec3(lm.center)) continue;
    zones.push({ id, zone: lm.zone, title: String(lm.title ?? lm.zone), door: lm.door, center: lm.center, anchor: ZONE_ANCHORS[lm.zone] });
  }
  return { spawn, zones };
}

const distXZ = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/** The zone whose door is within `radius` (XZ metres) of `pos`, nearest first, or null. */
export function nearestZone(pos, zones, radius) {
  let best = null;
  let bestD = Infinity;
  for (const z of zones) {
    const d = distXZ(pos, z.door);
    if (d <= radius && d < bestD) {
      best = z;
      bestD = d;
    }
  }
  return best;
}

/** The closest zone not yet visited (by door distance), or null when all eight are done. */
export function nextUnvisited(pos, zones, visited) {
  let best = null;
  let bestD = Infinity;
  for (const z of zones) {
    if (visited.has(z.zone)) continue;
    const d = distXZ(pos, z.door);
    if (d < bestD) {
      best = z;
      bestD = d;
    }
  }
  return best;
}

/**
 * Edge-arrow angle (radians, 0 = straight ahead/up on screen, clockwise positive) from the camera
 * yaw towards a target. three.js cameras look down −Z, so yaw 0 faces −Z.
 */
export function arrowAngle(from, to, cameraYaw) {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const worldAngle = Math.atan2(dx, -dz); // 0 = −Z
  let a = worldAngle + cameraYaw;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
