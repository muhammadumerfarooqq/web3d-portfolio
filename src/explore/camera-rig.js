// Third-person spring camera behind the sheriff: smoothed follow, drag / pointer-lock / touch orbit,
// scroll / pinch zoom, gentle auto-recentre behind the player while he walks forward (P3.4: never
// while the user drags, never for S or strafing), and collision that pulls in in front of walls with a
// five-ray probe and a smoothed boom (no jitter on corners).
import { PerspectiveCamera, Ray, Vector3 } from 'three/webgpu';
import { CAMERA } from './config.js';
import { angleDelta, boomStep, damp, shouldRecentre } from './controller-math.js';

/** Probe offsets (camera right, up) in metres around the boom: the lens is a small sphere. */
const PROBES = [
  [0, 0],
  [0.22, 0],
  [-0.22, 0],
  [0, 0.18],
  [0, -0.18],
];

export function createCameraRig(aspect) {
  const camera = new PerspectiveCamera(CAMERA.fov, aspect, 0.1, 1200);
  let yaw = 0;
  let pitch = CAMERA.pitch;
  let distance = CAMERA.distance;
  let actualDistance = distance;
  let lastManual = -10;
  let dragging = false;
  const target = new Vector3();
  const desired = new Vector3();
  const right = new Vector3();
  const up = new Vector3();
  const ray = new Ray();
  const smoothTarget = new Vector3();
  let first = true;
  // Riding (P3.3): the boom pulls back and up, and the lens widens a little at a gallop.
  let ride = 0;
  let rideTarget = 0;
  let gallop = 0;
  let gallopTarget = 0;

  return {
    camera,
    get yaw() {
      return yaw;
    },
    set yaw(v) {
      yaw = v;
    },
    get pitch() {
      return pitch;
    },
    get distance() {
      return actualDistance;
    },
    /** The user is holding a drag (or looking with pointer lock): no auto-recentre meanwhile. */
    set dragging(v) {
      dragging = v;
    },
    get dragging() {
      return dragging;
    },
    orbit(dx, dy, now) {
      yaw -= dx * CAMERA.yawPerPx;
      pitch = Math.min(CAMERA.maxPitch, Math.max(CAMERA.minPitch, pitch + dy * CAMERA.pitchPerPx));
      lastManual = now;
    },
    /** Debug / screenshots only: place the boom directly (distance may exceed the play limits). */
    setView({ yaw: y = yaw, pitch: p = pitch, distance: d = distance } = {}) {
      yaw = y;
      pitch = p;
      distance = d;
      actualDistance = d;
      lastManual = Infinity;
    },
    /** Riding camera: on = mounted, g = 0…1 gallop amount (FOV kick). */
    setRide(on, g = 0) {
      rideTarget = on ? 1 : 0;
      gallopTarget = on ? g : 0;
    },
    zoom(delta) {
      distance = Math.min(CAMERA.maxDistance, Math.max(CAMERA.minDistance, distance * (1 + delta * 0.001)));
    },
    /**
     * Place the camera. `facing` is the player's (or horse's) yaw; `motion` = { forward, sideways,
     * speed } decides whether the camera drifts back behind him (see shouldRecentre).
     */
    update(dt, focus, facing, motion, bvh, now) {
      ride += (rideTarget - ride) * damp(2, dt);
      gallop += (gallopTarget - gallop) * damp(2.5, dt);
      const fov = CAMERA.fov + 6 * gallop;
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      target.set(focus.x, focus.y + CAMERA.height + ride * 1.1, focus.z);
      if (first) {
        smoothTarget.copy(target);
        first = false;
      } else smoothTarget.lerp(target, damp(CAMERA.follow * 2, dt));

      const m = motion && typeof motion === 'object' ? motion : { forward: motion ? 1 : 0, sideways: 0, speed: motion ? 1 : 0 };
      if (shouldRecentre({ ...m, dragging, sinceManual: now - lastManual })) {
        // Camera yaw that sits behind the player (camera yaw 0 looks down −Z; player facing 0 is +Z).
        // Gentle, and gentler still at walking pace.
        const behind = facing + Math.PI;
        yaw += angleDelta(yaw, behind) * damp(0.6 + 0.6 * Math.min(1, m.speed / 6), dt);
      }

      desired.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      // Collision: shorten the boom in front of anything between the player and the camera; five
      // rays (the lens as a small sphere) so a thin post or a corner cannot flicker the result.
      let d = distance * (1 + 0.5 * ride);
      if (bvh) {
        right.set(Math.cos(yaw), 0, -Math.sin(yaw));
        up.crossVectors(desired, right).normalize();
        for (const [rx, uy] of PROBES) {
          ray.origin.copy(smoothTarget).addScaledVector(right, rx).addScaledVector(up, uy);
          ray.direction.copy(desired);
          const hit = bvh.raycastFirst(ray, 2);
          if (hit && hit.distance < d + 0.3) d = Math.max(0.8, hit.distance - 0.3);
        }
      }
      actualDistance = boomStep(actualDistance, d, dt);
      camera.position.copy(smoothTarget).addScaledVector(desired, actualDistance);
      camera.lookAt(smoothTarget);
    },
  };
}
