// The sheriff: capsule physics against the town BVH (gravity, slopes, step height, the shore as a
// soft wall), camera-relative movement, AnimationMixer crossfades (Idle/Walk/Run/Jump, IdleArmsCrossed
// after a long idle, Wave on entering a zone), auto-blink and footstep events.
import { AnimationMixer, LoopOnce, Vector3 } from 'three/webgpu';
import { PLAYER, SEA_LEVEL } from './config.js';
import { angleDelta, approach, castDown, damp, resolveCapsule, softWall, stepUpHeight, worldMove } from './controller-math.js';

const UP = new Vector3(0, 1, 0);

export function createPlayer({ avatarData, bvh, depthAt, spawn }) {
  const { avatar, clips, morphMeshes, height, footOffset } = avatarData;
  const scale = height > 0.5 && height < 4 ? PLAYER.height / height : 1;
  avatar.scale.setScalar(scale);
  const footLift = -footOffset * scale;

  const position = new Vector3(spawn.pos[0], spawn.pos[1] + 0.5, spawn.pos[2]);
  const velocity = new Vector3();
  let facing = (spawn.yawDeg * Math.PI) / 180 + Math.PI; // face down the street (−Z) by default
  let onGround = false;
  let idleTime = 0;
  let strideAcc = 0;
  let blinkIn = 2 + Math.random() * 3;
  let blinkT = -1;
  let waving = 0;
  let jumpLock = 0;

  // ── animation ──
  const mixer = new AnimationMixer(avatar);
  const actions = {};
  for (const clip of clips) actions[clip.name] = mixer.clipAction(clip);
  for (const name of ['Jump', 'Wave']) {
    if (actions[name]) {
      actions[name].setLoop(LoopOnce, 1);
      actions[name].clampWhenFinished = true;
    }
  }
  let current = null;
  const play = (name, fade = 0.25) => {
    const next = actions[name];
    if (!next || current === next) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (current) current.fadeOut(fade);
    current = next;
  };
  play('Idle', 0);

  const blinkMeshes = morphMeshes.filter((m) => m.morphTargetDictionary?.Blink !== undefined);
  const setBlink = (v) => {
    for (const m of blinkMeshes) m.morphTargetInfluences[m.morphTargetDictionary.Blink] = v;
  };

  const tmpStart = new Vector3();
  const tmpEnd = new Vector3();
  const R = PLAYER.radius;
  const H = PLAYER.height;
  const maxSlopeY = Math.cos((PLAYER.maxSlopeDeg * Math.PI) / 180);

  function sync() {
    avatar.position.set(position.x, position.y + footLift, position.z);
    avatar.rotation.y = facing;
  }
  sync();

  return {
    object: avatar,
    position,
    velocity,
    get onGround() {
      return onGround;
    },
    get speed() {
      return Math.hypot(velocity.x, velocity.z);
    },
    teleport(p, yaw) {
      position.set(p[0], p[1] + 0.6, p[2]);
      velocity.set(0, 0, 0);
      if (yaw !== undefined) facing = yaw;
      sync();
    },
    /** Wave (entering a zone; forced for the Case Closed ceremony, when input is paused). */
    wave(force = false) {
      if (waving > 0 || !onGround || (!force && this.speed > 0.6)) return;
      waving = actions.Wave ? actions.Wave.getClip().duration : 0;
      play('Wave', 0.2);
    },
    /**
     * One physics + animation step. input: { x, z, magnitude } (camera space), run, jump.
     * Returns events: { footstep: surface|null, landed: bool, jumped: bool }.
     */
    update(dt, input, cameraYaw, surfaceUnder) {
      const events = { footstep: null, landed: false, jumped: false };
      const dir = worldMove(input, cameraYaw);
      const speed = (input.run ? PLAYER.runSpeed : PLAYER.walkSpeed) * input.magnitude;
      const control = onGround ? 1 : PLAYER.airControl;
      velocity.x = approach(velocity.x, dir.x * speed, PLAYER.accel * control, dt);
      velocity.z = approach(velocity.z, dir.z * speed, PLAYER.accel * control, dt);

      // Soft wall: the sea pushes you back towards the island, but only when the feet are actually at
      // the waterline (a dock or a jetty over deep water is walkable).
      if (position.y < SEA_LEVEL + 0.35) {
        const wall = softWall(position, depthAt);
        velocity.x += wall.x * dt * 10;
        velocity.z += wall.z * dt * 10;
      }

      jumpLock = Math.max(0, jumpLock - dt);
      if (input.jump && onGround && jumpLock === 0) {
        velocity.y = PLAYER.jumpSpeed;
        onGround = false;
        jumpLock = 0.35;
        events.jumped = true;
        play('Jump', 0.1);
      }
      velocity.y += PLAYER.gravity * dt;
      if (onGround && velocity.y < 0) velocity.y = -1.5; // stick to slopes

      // Step assist before moving.
      if (onGround) {
        const rise = stepUpHeight(bvh, position, velocity.x, velocity.z, R, PLAYER.stepHeight);
        if (rise > 0) position.y += rise + 0.01;
      }

      position.addScaledVector(velocity, dt);

      tmpStart.set(position.x, position.y + R, position.z);
      tmpEnd.set(position.x, position.y + H - R, position.z);
      const { segment, groundNormalY } = resolveCapsule(bvh, tmpStart, tmpEnd, R);
      const corrected = segment.start.clone().addScaledVector(UP, -R);
      const delta = corrected.clone().sub(position);
      const wasGround = onGround;
      onGround = groundNormalY >= maxSlopeY && delta.y > Math.abs(dt * velocity.y * 0.25);
      position.copy(corrected);
      if (onGround) {
        if (velocity.y < 0) velocity.y = 0;
      } else if (delta.lengthSq() > 1e-10) {
        const n = delta.normalize();
        velocity.addScaledVector(n, -n.dot(velocity));
      }
      // Safety net: never fall through the world.
      if (position.y < -12) {
        const hit = castDown(bvh, new Vector3(position.x, 60, position.z), 120);
        position.y = hit ? hit.point.y + 0.2 : 2;
        velocity.set(0, 0, 0);
      }
      if (onGround && !wasGround && events.jumped === false) events.landed = true;

      // Facing follows movement.
      const hs = Math.hypot(velocity.x, velocity.z);
      if (hs > 0.3) facing += angleDelta(facing, Math.atan2(velocity.x, velocity.z)) * damp(12, dt);

      // Animation state.
      if (waving > 0) {
        waving -= dt;
        if (hs > 0.6) waving = 0;
      }
      if (waving <= 0) {
        if (!onGround && velocity.y > 0.5) play('Jump', 0.1);
        else if (onGround) {
          if (hs > PLAYER.walkSpeed + 0.6) play('Run', 0.2);
          else if (hs > 0.25) play('Walk', 0.2);
          else if (idleTime > PLAYER.idleArmsCrossedAfter) play('IdleArmsCrossed', 0.6);
          else play('Idle', 0.3);
        }
      }
      idleTime = hs < 0.2 && onGround ? idleTime + dt : 0;
      if (current && actions.Walk === current) current.timeScale = Math.max(0.6, hs / PLAYER.walkSpeed);
      if (current && actions.Run === current) current.timeScale = Math.max(0.7, hs / PLAYER.runSpeed);

      // Footsteps by distance travelled.
      if (onGround && hs > 0.3) {
        strideAcc += hs * dt;
        const stride = hs > PLAYER.walkSpeed + 0.6 ? 1.25 : 0.72;
        if (strideAcc > stride) {
          strideAcc = 0;
          events.footstep = surfaceUnder();
        }
      }

      // Auto-blink.
      blinkIn -= dt;
      if (blinkIn <= 0 && blinkT < 0) blinkT = 0;
      if (blinkT >= 0) {
        blinkT += dt;
        const k = blinkT / 0.16;
        setBlink(k < 0.5 ? k * 2 : Math.max(0, 2 - k * 2));
        if (k >= 1) {
          blinkT = -1;
          blinkIn = 2.2 + Math.random() * 3.5;
          setBlink(0);
        }
      }

      mixer.update(dt);
      sync();
      return events;
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(avatar);
    },
  };
}
