// Third-person spring camera behind the sheriff: smoothed follow, drag/touch orbit, scroll/pinch
// zoom, auto-recentre behind the player while walking, and collision (pulls in in front of walls).
import { PerspectiveCamera, Ray, Vector3 } from 'three/webgpu';
import { CAMERA } from './config.js';
import { angleDelta, damp } from './controller-math.js';

export function createCameraRig(aspect) {
  const camera = new PerspectiveCamera(CAMERA.fov, aspect, 0.1, 1200);
  let yaw = 0;
  let pitch = CAMERA.pitch;
  let distance = CAMERA.distance;
  let actualDistance = distance;
  let lastManual = -10;
  const target = new Vector3();
  const desired = new Vector3();
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
    get distance() {
      return actualDistance;
    },
    orbit(dx, dy, now) {
      yaw -= dx * 0.005;
      pitch = Math.min(CAMERA.maxPitch, Math.max(CAMERA.minPitch, pitch + dy * 0.004));
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
    /** Place the camera; `facing` is the player's yaw, used to drift behind them while moving. */
    update(dt, focus, facing, moving, bvh, now) {
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

      if (moving && now - lastManual > 1.6) {
        // Camera yaw that sits behind the player (camera yaw 0 looks down −Z; player facing 0 is +Z).
        const behind = facing + Math.PI;
        yaw += angleDelta(yaw, behind) * damp(1.6, dt);
      }

      desired.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      // Collision: shorten the boom in front of anything between the player and the camera.
      let d = distance * (1 + 0.5 * ride);
      if (bvh) {
        ray.origin.copy(smoothTarget);
        ray.direction.copy(desired);
        const hit = bvh.raycastFirst(ray, 2);
        if (hit && hit.distance < d + 0.3) d = Math.max(0.8, hit.distance - 0.3);
      }
      actualDistance = d < actualDistance ? d : actualDistance + (d - actualDistance) * damp(3, dt);
      camera.position.copy(smoothTarget).addScaledVector(desired, actualDistance);
      camera.lookAt(smoothTarget);
    },
  };
}
