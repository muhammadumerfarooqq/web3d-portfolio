// The sheriff's horse (lazy chunk, loaded on the first whistle). Press H: the horse appears out of
// view at an open street point, gallops to the sheriff along the street graph (horse-path.js, edges
// checked against the town BVH; it never cuts through walls or into the sea), slows to a trot and a
// walk, stops beside him, shakes its head and idles. E mounts (the avatar plays Ride, attached to the
// spine bone at horse.json's rider offset); riding uses horse-ride.js with capsule collision against
// the BVH and stays on land. E again (slow) dismounts to a free spot beside it. State: horse-machine.js.
// P3.4: A turns left and D right (horse-ride.js turnHeading); the horse's whole footprint must be on dry
// land wherever it stops, idles, wanders or appears (horse-land.js), it snaps to the nearest walkable
// street node when the spot beside the sheriff is wet, and its body is a solid capsule the sheriff
// cannot walk into (obstacle()); the mount prompt measures from the body's surface.
import { AnimationMixer, LoopOnce, Object3D, Quaternion, Ray, Vector3 } from 'three/webgpu';
import { HORSE, HORSE_BODY, HORSE_JSON_URL, HORSE_URL } from './config.js';
import { angleDelta, castDown, closestOnSegment2D, resolveCapsule, stepUpHeight } from './controller-math.js';
import { areaDry, footprintDry, isDry, stopSpot, wanderTarget } from './horse-land.js';
import { byDistance, buildStreetGraph, findPath, pathLength } from './horse-path.js';
import { createHorseMachine } from './horse-machine.js';
import { createRide, gaitFor, halt, parseGaitSpeeds, rideStep, turnHeading } from './horse-ride.js';

export async function createHorse({ loaders, scene, town, townJson, player, camera, audio, signal }) {
  const [gltf, meta] = await Promise.all([loaders.gltf.loadAsync(HORSE_URL), fetch(HORSE_JSON_URL, { signal, credentials: 'same-origin' }).then((r) => r.json())]);
  const model = gltf.scene;
  model.name = 'explore_horse';
  model.visible = false;
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
    }
  });
  scene.add(model);
  const speeds = parseGaitSpeeds(meta);
  const { bvh, depthAt, heightAt, surfaceAt } = town;

  // ── rider attachment: avatar root at rider.root_offset_three (horse space), carried by the spine ──
  model.updateMatrixWorld(true);
  const spine = model.getObjectByName(meta.rider?.attach_bone ?? 'spine') ?? model;
  const seat = new Object3D();
  seat.name = 'explore_horse_seat';
  const offset = new Vector3().fromArray(meta.rider?.root_offset_three ?? [0, 0.57, -0.02]);
  spine.add(seat);
  seat.position.copy(spine.worldToLocal(offset.clone()));
  seat.quaternion.copy(spine.getWorldQuaternion(new Quaternion()).invert());

  // ── animation ──
  const mixer = new AnimationMixer(model);
  const actions = {};
  for (const clip of gltf.animations) actions[clip.name] = mixer.clipAction(clip);
  if (actions.HeadShake) {
    actions.HeadShake.setLoop(LoopOnce, 1);
    actions.HeadShake.clampWhenFinished = true;
  }
  let current = null;
  const play = (name, fade = 0.3) => {
    const next = actions[name];
    if (!next || current === next) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    current?.fadeOut(fade);
    current = next;
  };
  play('Idle', 0);

  // ── the street graph, with every edge and node checked against the town ──
  const ray = new Ray();
  const groundAt = (x, z, from = 4) => castDown(bvh, new Vector3(x, from, z), from + 4)?.point.y ?? heightAt(x, z) ?? 0;
  const onLand = (x, z) => isDry(heightAt, x, z);
  const bodyDry = (x, z, y) => footprintDry(heightAt, x, z, y);
  /** Clear line between two ground points at knee and chest height (rocks, porches, walls block). */
  const clear = (ax, az, bx, bz, heights = [0.6, 1.4]) => {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) return true;
    for (const h of heights) {
      ray.origin.set(ax, groundAt(ax, az) + h, az);
      ray.direction.set((bx - ax) / len, 0, (bz - az) / len);
      const hit = bvh.raycastFirst(ray, 2);
      if (hit && hit.distance < len - 0.2) return false;
    }
    return true;
  };
  const raw = buildStreetGraph(townJson);
  const nodes = raw.nodes.filter((n) => areaDry(heightAt, n.x, n.z));
  const ids = new Set(nodes.map((n) => n.id));
  const pos = new Map(nodes.map((n) => [n.id, n]));
  const graph = { nodes, edges: raw.edges.filter(([a, b]) => ids.has(a) && ids.has(b) && clear(pos.get(a).x, pos.get(a).z, pos.get(b).x, pos.get(b).z)) };

  // ── state ──
  const machine = createHorseMachine();
  const position = new Vector3();
  let yaw = 0;
  let speed = 0;
  let route = []; // [{ x, z }] still to visit
  let stuckT = 0;
  const lastProgress = new Vector3();
  let wanderTo = null;
  let stopYaw = 0;
  let snortIn = 6;
  let hoofT = 0;
  const ride = createRide(speeds);
  let seatBlend = 1;
  const blendFrom = new Vector3();
  const blendQ = new Quaternion();
  const tmp = new Vector3();
  const segA = new Vector3();
  const segB = new Vector3();

  const place = () => {
    position.y = groundAt(position.x, position.z, position.y + 1.5);
    model.position.copy(position);
    model.rotation.y = yaw + HORSE.forwardYaw;
  };

  /** Spot beside the horse where the sheriff lands when dismounting: dry, clear line from it. */
  function besideSpot(p, facing, dist = 1.9) {
    for (const a of [Math.PI / 2, -Math.PI / 2, Math.PI, 0]) {
      const x = p.x + Math.sin(facing + a) * dist;
      const z = p.z + Math.cos(facing + a) * dist;
      if (onLand(x, z) && clear(p.x, p.z, x, z, [0.6, 1.2])) return { x, z };
    }
    return null;
  }

  const clearLow = (ax, az, bx, bz) => clear(ax, az, bx, bz, [0.6, 1.2]);

  /** The graph node the horse can come from to reach the sheriff, or null (dock, water, indoors, rocks). */
  function reachFrom(p) {
    if (depthAt(p.x, p.z) > 0.15) return null; // in the water (the horse still stops on dry land: stopSpot)
    if (p.y - (heightAt(p.x, p.z) ?? 0) > 1.4) return null;
    for (const n of byDistance(graph, p.x, p.z).slice(0, 6)) {
      if (Math.hypot(n.x - p.x, n.z - p.z) > HORSE.reach) break;
      if (clear(n.x, n.z, p.x, p.z)) return n;
    }
    return null;
  }

  const inView = (x, z) => {
    tmp.set(x, groundAt(x, z) + 1, z).project(camera);
    return tmp.z < 1 && Math.abs(tmp.x) < 1.15 && Math.abs(tmp.y) < 1.15;
  };

  /** Start node: out of view, 20–70 m of road away, connected; else the farthest connected one. */
  function startNode(target) {
    let best = null;
    let fallback = null;
    for (const n of graph.nodes) {
      const path = findPath(graph, n.id, target.id);
      if (!path) continue;
      const len = pathLength(graph, path);
      if (!fallback || len > fallback.len) fallback = { n, path, len };
      if (len >= 20 && len <= 70 && !inView(n.x, n.z) && (!best || len < best.len)) best = { n, path, len };
    }
    return best ?? fallback;
  }

  // ── sounds ──
  const hoof = (surface, accent = 1) => {
    if (surface === 'wood' || surface === 'stone') audio.noise({ type: 'bandpass', freq: 1100 + Math.random() * 300, q: 2.2, gain: 0.22 * accent, decay: 0.06 });
    else audio.noise({ type: 'lowpass', freq: 420 + Math.random() * 120, q: 0.7, gain: 0.26 * accent, decay: 0.11 });
  };
  const snort = () => audio.noise({ type: 'bandpass', freq: 650, q: 1.1, gain: 0.16, decay: 0.38 });
  const neigh = () => {
    audio.tone({ freq: 520, to: 880, type: 'sawtooth', gain: 0.018, attack: 0.05, hold: 0.25, release: 0.4, vibrato: 28 });
    audio.tone({ freq: 760, to: 420, type: 'sawtooth', gain: 0.014, attack: 0.04, hold: 0.2, release: 0.5, at: 0.35, vibrato: 34 });
  };
  const CADENCE = { Walk: [0.32, 1], Trot: [0.26, 1], Gallop: [0.13, 1] };
  let beat = 0;
  const surfaceUnder = () => {
    const hit = castDown(bvh, new Vector3(position.x, position.y + 0.6, position.z), 1.6);
    return hit ? surfaceAt(hit.faceIndex) : 'sand';
  };

  // ── movement ──
  /** Move by (dx, dz) with step-up, capsule collision, and the shore: returns false if blocked. */
  function move(dx, dz) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-5) return true;
    const rise = stepUpHeight(bvh, position, dx, dz, HORSE.radius, HORSE.stepHeight);
    const nx = position.x + dx;
    const nz = position.z + dz;
    if (!bodyDry(nx, nz, yaw)) return false;
    const cx = nx + Math.sin(yaw) * HORSE.centreZ;
    const cz = nz + Math.cos(yaw) * HORSE.centreZ;
    const y = position.y + rise;
    segA.set(cx, y + HORSE.radius + 0.25, cz);
    segB.set(cx, y + 1.6, cz);
    const { segment } = resolveCapsule(bvh, segA, segB, HORSE.radius);
    const fx = nx + (segment.start.x - cx);
    const fz = nz + (segment.start.z - cz);
    if (!bodyDry(fx, fz, yaw)) return false;
    const g = groundAt(fx, fz, y + 1.5);
    if (g - position.y > HORSE.stepHeight + 0.1) return false;
    const moved = Math.hypot(fx - position.x, fz - position.z);
    position.x = fx;
    position.z = fz;
    return moved > len * 0.25;
  }

  function travel(dt) {
    if (!route.length) return true;
    const goal = route[0];
    const left = route.reduce((d, w, i) => d + Math.hypot(w.x - (i ? route[i - 1].x : position.x), w.z - (i ? route[i - 1].z : position.z)), 0);
    const want = left > 16 ? speeds.Gallop : left > 6 ? speeds.Trot : Math.max(0.6, Math.min(speeds.Walk, left * 0.8));
    speed += Math.sign(want - speed) * Math.min(Math.abs(want - speed), (want > speed ? 5 : 7) * dt);
    const heading = Math.atan2(goal.x - position.x, goal.z - position.z);
    yaw += angleDelta(yaw, heading) * Math.min(1, dt * (speed > 5 ? 3 : 5));
    move(Math.sin(yaw) * speed * dt, Math.cos(yaw) * speed * dt);
    if (Math.hypot(goal.x - position.x, goal.z - position.z) < (route.length > 1 ? 1.4 : 0.35)) route.shift();
    // Stuck behind something: hop to the next waypoint (only ever out of the sheriff's view).
    stuckT += dt;
    if (stuckT > 1.5) {
      if (position.distanceTo(lastProgress) < 0.6 && route.length && !inView(route[0].x, route[0].z)) {
        position.x = route[0].x;
        position.z = route[0].z;
        route.shift();
      }
      lastProgress.copy(position);
      stuckT = 0;
    }
    return route.length === 0;
  }

  function animateGait(dt, s) {
    const gait = gaitFor(s, speeds);
    if (machine.state !== 'greet') play(gait === 'Idle' ? 'Idle' : gait, 0.35);
    if (current && gait !== 'Idle') current.timeScale = Math.max(0.6, Math.min(1.6, Math.abs(s) / speeds[gait]));
    if (gait !== 'Idle') {
      hoofT -= dt;
      if (hoofT <= 0) {
        const [gap] = CADENCE[gait];
        beat = (beat + 1) % 4;
        hoof(surfaceUnder(), gait === 'Gallop' && beat === 3 ? 1.3 : 0.9);
        hoofT = gait === 'Gallop' && beat === 3 ? gap * 2.4 : gap / Math.max(0.6, Math.abs(s) / speeds[gait]);
      }
    }
  }

  return {
    machine,
    position,
    get yaw() {
      return yaw;
    },
    get speed() {
      return machine.state === 'ridden' ? ride.speed : speed;
    },
    get riding() {
      return machine.riding;
    },
    get gallop() {
      return machine.state === 'ridden' ? Math.max(0, Math.min(1, (ride.speed - speeds.Trot) / (speeds.Gallop - speeds.Trot))) : 0;
    },
    /** H: { ok } or { ok: false, reason: 'unreachable' | 'riding' | 'coming' }. */
    whistle() {
      const p = player.position;
      const target = reachFrom(p);
      const spot = target && stopSpot({ heightAt, clear: clearLow, nodes: graph.nodes, p, facing: player.facing, reach: HORSE.reach });
      const r = machine.whistle({ reachable: Boolean(target && spot) });
      if (!r.ok) return r;
      const visibleNow = model.visible && position.distanceTo(p) < 40;
      if (visibleNow) {
        // Already nearby: walk straight over (along the graph if the direct line is blocked).
        const direct = clear(position.x, position.z, spot.x, spot.z);
        const from = byDistance(graph, position.x, position.z)[0];
        const path = direct ? [] : (findPath(graph, from.id, target.id) ?? []);
        route = [...path.map((id) => pos.get(id)), spot];
        stopYaw = spot.yaw;
      } else {
        const start = startNode(target);
        if (!start) return { ok: false, reason: 'unreachable' };
        position.set(start.n.x, 0, start.n.z);
        const nextId = start.path[1];
        const next = nextId ? pos.get(nextId) : spot;
        yaw = Math.atan2(next.x - position.x, next.z - position.z);
        route = [...start.path.slice(1).map((id) => pos.get(id)), spot];
        stopYaw = spot.yaw;
        speed = 0;
      }
      lastProgress.copy(position);
      return r;
    },
    /** Close enough to mount? Measured from the body's surface (beside it; he can never be inside). */
    near(p) {
      if (!model.visible || !['greet', 'idle', 'wander'].includes(machine.state)) return false;
      const b = this.obstacle();
      const c = closestOnSegment2D(p.x, p.z, b.ax, b.az, b.bx, b.bz);
      return Math.hypot(p.x - c.x, p.z - c.z) - b.r < HORSE_BODY.mountReach;
    },
    /** The body as a solid horizontal capsule (world XZ) while it stands on its own, else null. */
    obstacle() {
      if (!model.visible || machine.riding || machine.state === 'mounting') return null;
      const s = Math.sin(yaw);
      const c = Math.cos(yaw);
      return {
        ax: position.x + s * HORSE_BODY.tail,
        az: position.z + c * HORSE_BODY.tail,
        bx: position.x + s * HORSE_BODY.chest,
        bz: position.z + c * HORSE_BODY.chest,
        r: HORSE_BODY.radius,
        bottom: position.y,
        top: position.y + HORSE_BODY.top,
      };
    },
    mount() {
      if (!machine.mount({ near: this.near(player.position) })) return false;
      halt(ride);
      const avatar = player.object;
      seat.attach(avatar); // keep the world pose, then blend into the saddle
      blendFrom.copy(avatar.position);
      blendQ.copy(avatar.quaternion);
      seatBlend = 0;
      player.playClip(meta.rider?.avatar_clip ?? 'Ride', 0.35);
      snort();
      return true;
    },
    /** E (slow) or forced (case file): off to a free spot beside the horse. */
    dismount(force = false) {
      const ok = force ? machine.forceDismount() : machine.dismount({ speed: ride.speed });
      if (!ok) return false;
      halt(ride);
      const avatar = player.object;
      scene.attach(avatar);
      const spot = besideSpot(position, yaw, 1.5) ?? { x: position.x, z: position.z };
      avatar.rotation.set(0, yaw, 0);
      player.teleport([spot.x, groundAt(spot.x, spot.z, position.y + 1.5), spot.z], yaw);
      play('Idle');
      return true;
    },
    /** Push the horse (and rider) to a spot, e.g. off the rails before the train. */
    teleport(x, z) {
      position.x = x;
      position.z = z;
      place();
    },
    /** Per frame. rideInput { forward, back, steer } while ridden. Returns machine events. */
    update(dt, rideInput) {
      const events = machine.step(dt);
      const state = machine.state;
      if (events.includes('depart')) {
        model.visible = true;
        place();
      }
      if (state === 'travel') {
        model.visible = true;
        if (travel(dt)) {
          speed = 0;
          machine.arrived(); // the greet turns it to stopYaw (the footprint was checked facing that way)
        }
        animateGait(dt, speed);
      } else if (state === 'greet') {
        yaw += angleDelta(yaw, stopYaw) * Math.min(1, dt * 4);
        if (events.includes('greeting')) {
          play('HeadShake', 0.2);
          neigh();
        }
        speed = 0;
      } else if (state === 'wander') {
        // A short stroll, clamped to dry land (never into the surf).
        if (!wanderTo) wanderTo = wanderTarget({ heightAt, clear, x: position.x, z: position.z }) ?? { x: position.x, z: position.z };
        const d = Math.hypot(wanderTo.x - position.x, wanderTo.z - position.z);
        speed = d > 0.3 ? 0.9 : 0;
        if (speed) {
          yaw += angleDelta(yaw, Math.atan2(wanderTo.x - position.x, wanderTo.z - position.z)) * Math.min(1, dt * 3);
          if (!move(Math.sin(yaw) * speed * dt, Math.cos(yaw) * speed * dt)) wanderTo = { x: position.x, z: position.z };
        }
        animateGait(dt, speed);
      } else if (state === 'ridden' || state === 'mounting') {
        if (state === 'ridden') {
          rideStep(ride, rideInput ?? {}, dt);
          yaw = turnHeading(yaw, ride.yawRate, dt); // D (steer +1) turns right: yaw decreases
          if (!move(Math.sin(yaw) * ride.speed * dt, Math.cos(yaw) * ride.speed * dt) && Math.abs(ride.speed) > 0.2) {
            halt(ride);
            snort();
          }
        }
        animateGait(dt, state === 'ridden' ? ride.speed : 0);
      } else if (state === 'idle') {
        wanderTo = null;
        speed = 0;
        play('Idle', 0.4);
      }
      if (events.includes('greeted') || events.includes('dismounted')) play('Idle', 0.4);
      // Seat blend (0.45 s) after mounting.
      if (seatBlend < 1) {
        seatBlend = Math.min(1, seatBlend + dt / 0.45);
        const k = seatBlend * seatBlend * (3 - 2 * seatBlend);
        player.object.position.lerpVectors(blendFrom, new Vector3(0, 0, 0), k);
        player.object.quaternion.slerpQuaternions(blendQ, new Quaternion(), k);
      }
      // Idle life: an occasional snort.
      if (model.visible && (state === 'idle' || state === 'greet')) {
        snortIn -= dt;
        if (snortIn <= 0) {
          snort();
          snortIn = 7 + Math.random() * 9;
        }
      }
      if (model.visible) {
        place();
        mixer.update(dt);
      }
      return events;
    },
    dispose() {
      if (machine.riding) scene.attach(player.object);
      mixer.stopAllAction();
      scene.remove(model);
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        for (const m of [].concat(o.material)) m.dispose();
      });
    },
    /** Debug: the validated graph. */
    graph,
  };
}
