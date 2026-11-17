// P9.3 promo capture mode: DEV SERVER ONLY. src/ui/mode.js reads ?capture=<shot id> and
// src/explore/index.js imports this module only inside `import.meta.env.DEV` branches, which Vite
// replaces with `false` in production builds, so neither this file nor the query handling ships
// (tests/promo-p93.test.js builds the site and checks dist/).
//
// Deterministic, frame-perfect footage for the promo film (docs/promo/STORYBOARD.md):
// - wall-clock time is virtual: performance.now / Date.now only move when the driver steps a frame
//   (dt = 1/24 s exactly), and once the shot starts, setTimeout / setInterval / requestAnimationFrame
//   run on that clock too, so nothing depends on real time;
// - every Math.random() call comes from one seeded generator (shots.json "seed");
// - tier ULTRA, adaptive resolution off, the whole HUD, overlays and cursor hidden, the intro, the
//   arrival and the tutorial skipped; the canvas is the viewport (the driver sets 3840×2160 or
//   960×540 at DPR 1);
// - the shot is scripted from docs/promo/shots.json: a Catmull-Rom camera path (position + look-at,
//   eased) or a damped follow camera, time of day, and events (the boat arrival, the train, the
//   horse gallop, fireworks).
// window.__capture = { ready: Promise, frames, step(): Promise<void>, info() }: the driver awaits
// ready, then for each frame awaits step() (which renders and waits for the GPU) and screenshots.
import { CatmullRomCurve3, Vector3 } from 'three/webgpu';
import SPEC from '../../docs/promo/shots.json';
import './capture.css';

export const FRAME_MS = 1000 / 24;

/** mulberry32: a small, fast, seedable PRNG with a full 2^32 period. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const EASE = {
  linear: (k) => k,
  inOutSine: (k) => 0.5 - 0.5 * Math.cos(Math.PI * k),
  inOutCubic: (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2),
  outCubic: (k) => 1 - (1 - k) ** 3,
  inCubic: (k) => k * k * k,
};

/** Virtual clock: frame n is at base + n · 1000/24 ms (computed, never accumulated). */
function installClock() {
  const realNow = performance.now.bind(performance);
  const base = realNow();
  const dateBase = Date.now();
  let frame = 0;
  const now = () => base + frame * FRAME_MS;
  performance.now = now;
  Date.now = () => Math.round(dateBase + frame * FRAME_MS);
  // Timers on the virtual clock (switched on when the shot starts; the loading phase uses real ones).
  const timers = [];
  let rafs = [];
  let seq = 0;
  const realTimers = { setTimeout: window.setTimeout, clearTimeout: window.clearTimeout, setInterval: window.setInterval, clearInterval: window.clearInterval, requestAnimationFrame: window.requestAnimationFrame, cancelAnimationFrame: window.cancelAnimationFrame };
  const virtualise = () => {
    window.setTimeout = (fn, ms = 0, ...args) => {
      seq += 1;
      timers.push({ id: seq, due: now() + Math.max(0, ms), fn, args, every: 0 });
      return seq;
    };
    window.setInterval = (fn, ms = 0, ...args) => {
      seq += 1;
      timers.push({ id: seq, due: now() + Math.max(1, ms), fn, args, every: Math.max(1, ms) });
      return seq;
    };
    window.clearTimeout = window.clearInterval = (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    };
    window.requestAnimationFrame = (fn) => {
      seq += 1;
      rafs.push({ id: seq, fn });
      return seq;
    };
    window.cancelAnimationFrame = (id) => {
      rafs = rafs.filter((r) => r.id !== id);
    };
  };
  const fire = () => {
    // due timers in (due, id) order; a timer may schedule another one
    for (let guard = 0; guard < 1000; guard += 1) {
      timers.sort((a, b) => a.due - b.due || a.id - b.id);
      const t = timers[0];
      if (!t || t.due > now()) break;
      if (t.every) t.due += t.every;
      else timers.shift();
      try {
        t.fn(...t.args);
      } catch (error) {
        console.warn('[capture] timer', error);
      }
    }
    const due = rafs;
    rafs = [];
    for (const r of due) {
      try {
        r.fn(now());
      } catch (error) {
        console.warn('[capture] raf', error);
      }
    }
  };
  return {
    get frame() {
      return frame;
    },
    advance() {
      frame += 1;
      fire();
    },
    virtualise,
    real: realTimers,
  };
}

const v3 = (a) => new Vector3(a[0], a[1], a[2]);

/** Camera from a shot spec: { type: 'path' | 'follow' | 'static', … }. Returns update(k, dt, ctx). */
export function cameraPlan(spec) {
  if (spec.type === 'path') {
    const pos = new CatmullRomCurve3(spec.position.map(v3), false, 'centripetal');
    const look = new CatmullRomCurve3(spec.lookAt.map(v3), false, 'centripetal');
    const ease = EASE[spec.ease ?? 'inOutSine'];
    const fov = spec.fov ?? [40, 40];
    return {
      at(k) {
        const e = ease(Math.min(1, Math.max(0, k)));
        return { position: spec.position.length > 1 ? pos.getPointAt(e) : v3(spec.position[0]), lookAt: spec.lookAt.length > 1 ? look.getPointAt(e) : v3(spec.lookAt[0]), fov: fov[0] + (fov[fov.length - 1] - fov[0]) * e };
      },
    };
  }
  if (spec.type === 'static') return { at: () => ({ position: v3(spec.position), lookAt: v3(spec.lookAt), fov: spec.fov ?? 40 }) };
  return null; // follow: evaluated against a live target in the runner
}

/** Offset [right, up, forward] in a yaw-only frame (yaw 0 faces +Z; right = (−cos, sin)). */
export function yawOffset(origin, yaw, [right, up, forward]) {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  return new Vector3(origin.x - c * right + s * forward, origin.y + up, origin.z + s * right + c * forward);
}

export async function createCaptureMode(shotId) {
  const probe = shotId === 'probe';
  const shot = probe ? { id: 'probe', frames: 1, time: 'night', preroll: 0.5, camera: { type: 'static', position: [3, 6, 60], lookAt: [0, 2, 0], fov: 40 }, events: [] } : SPEC.shots.find((s) => s.id === shotId);
  if (!shot) throw new Error(`[capture] unknown shot ${shotId}`);
  const root = document.documentElement;
  root.dataset.capture = shot.id;
  Math.random = seededRandom(SPEC.seed + shot.id.charCodeAt(1) * 7919 + shot.id.length);
  const clock = installClock();
  // ULTRA, the shot's time of day and no tutorial are applied by index.js (the only Explore module that
  // touches prefs); the driver marks the arrival as seen for the session so it never starts on its own.

  let resolveReady;
  let rejectReady;
  const ready = new Promise((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });
  let ctx = null;
  let frameFn = null;
  let skip = false;
  let recorded = 0; // frames rendered for the driver
  let simTime = 0; // seconds since the shot's frame 0 (negative in the pre-roll)
  const events = [...(shot.events ?? [])].sort((a, b) => a.at - b.at);
  let nextEvent = 0;
  const plan = cameraPlan(shot.camera);
  const camState = { position: new Vector3(), lookAt: new Vector3(), init: false };
  let owned = { fireworks: null, train: null, ride: null };
  let fireworksModule = null;
  let manual = null; // probe: a static camera set from the console / driver

  const runEvent = (e) => {
    if (e.type === 'fireworks' && fireworksModule) {
      owned.fireworks?.dispose();
      owned.fireworks = fireworksModule.createFireworks({ scene: ctx.scene, origin: v3(e.origin), reducedMotion: false, audio: null, mrt: ctx.post().hasMrt });
    } else if (e.type === 'train' && owned.train) {
      owned.train.arrive();
      owned.train.overlayOpened(); // no Journey overlay at the platform
    } else if (e.type === 'gallop') {
      owned.ride = { waypoints: e.waypoints.map(([x, z]) => ({ x, z })), index: 0 };
    } else if (e.type === 'wave') {
      ctx.player.wave(true);
    }
  };

  /** Per frame, before the world updates: events, ride input. */
  const preFrame = () => {
    while (nextEvent < events.length && events[nextEvent].at <= simTime + 1e-6) runEvent(events[nextEvent++]);
    const horse = ctx.horse();
    if (owned.ride && horse?.riding) {
      const r = owned.ride;
      let wp = r.waypoints[r.index];
      while (wp && Math.hypot(wp.x - horse.position.x, wp.z - horse.position.z) < 3 && r.index < r.waypoints.length - 1) wp = r.waypoints[++r.index];
      const want = Math.atan2(wp.x - horse.position.x, wp.z - horse.position.z);
      let d = want - horse.yaw;
      d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
      const s = ctx.input.state;
      s.forward = true;
      s.x = Math.max(-1, Math.min(1, -d * 2.5)); // steer > 0 turns right (yaw decreases)
    }
  };
  /** Per frame, after the world updates: owned systems. */
  const postFrame = (dt) => {
    owned.fireworks?.update(dt);
    owned.train?.update(dt, ctx.palette().t);
  };

  const targetOf = (name) => {
    if (name === 'boat') return ctx.boat ? { position: ctx.boat.mesh.position, yaw: ctx.boat.home.yaw } : null;
    if (name === 'horse') {
      const h = ctx.horse();
      return h ? { position: h.position, yaw: h.yaw } : null;
    }
    if (name === 'train') return owned.train ? { position: new Vector3(owned.train.machine.x, 0, ctx.stationLandmark.train.rail_z), yaw: Math.PI / 2 } : null;
    return { position: ctx.player.position, yaw: ctx.player.object.rotation.y };
  };

  const placeCamera = (dt) => {
    const cam = ctx.camera;
    let want;
    if (manual) want = manual;
    else if (plan) want = plan.at(simTime / Math.max(1e-6, (shot.frames - 1) / 24));
    else {
      const t = targetOf(shot.camera.target);
      if (!t) return;
      const p = yawOffset(t.position, t.yaw, shot.camera.offset);
      if (shot.camera.height !== undefined) p.y = shot.camera.height; // absolute height (above the swell)
      const l = yawOffset(t.position, t.yaw, shot.camera.look ?? [0, 1, 0]);
      const k = camState.init ? 1 - Math.exp(-dt * (shot.camera.damping ?? 6)) : 1;
      camState.position.lerp(p, k);
      camState.lookAt.lerp(l, k);
      if (!camState.init) {
        camState.position.copy(p);
        camState.lookAt.copy(l);
      }
      camState.init = true;
      want = { position: camState.position, lookAt: camState.lookAt, fov: shot.camera.fov ?? 40 };
    }
    cam.position.copy(want.position);
    cam.up.set(0, 1, 0);
    cam.lookAt(want.lookAt);
    if (cam.fov !== want.fov) {
      cam.fov = want.fov;
      cam.updateProjectionMatrix();
    }
    ctx.sky.mesh.position.copy(cam.position);
  };

  /** One simulated frame (the clock advances first, so dt = 1/24 s in the world's frame()). */
  const tick = (render) => {
    clock.advance();
    skip = !render;
    preFrame();
    frameFn();
    simTime += 1 / 24;
  };

  const gpuIdle = async () => {
    const device = ctx.renderer.backend?.device;
    if (device?.queue?.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
  };

  async function setup(c) {
    ctx = c;
    frameFn = c.frame;
    ctx.setTime(shot.time === 'night' ? 1 : 0);
    if (shot.player) ctx.player.teleport([shot.player.pos[0], (ctx.standAt(shot.player.pos[0], shot.player.pos[1]) ?? 0) + 0.2, shot.player.pos[1]], shot.player.yaw ?? 0);
    const types = new Set(events.map((e) => e.type));
    if (types.has('fireworks')) fireworksModule = await import('./fireworks.js');
    if (types.has('train')) {
      const m = await import('./train.js');
      owned.train = await m.createTrain({ loaders: ctx.loaders, scene: ctx.scene, station: ctx.stationLandmark, audio: ctx.audio, reducedMotion: false, signal: ctx.signal, mrt: ctx.post().hasMrt });
    }
    // simulated warm-up: the entry dissolve and glitch finish (no rendering)
    const preroll = Math.round((shot.preroll ?? 1) * 24);
    simTime = -preroll / 24;
    if (types.has('mount')) {
      simTime = -1e9; // no shot events while the horse comes over
      // The horse: whistle it to the sheriff, wait until it stands beside him, mount (simulated).
      const h = await ctx.loadHorse();
      if (!h) throw new Error('[capture] the horse did not load');
      const r = h.whistle();
      if (!r.ok) throw new Error(`[capture] whistle: ${r.reason}`);
      for (let i = 0; i < 24 * 40 && !h.near(ctx.player.position); i += 1) tick(false);
      if (!h.mount()) throw new Error('[capture] could not mount');
      for (let i = 0; i < 24 * 2; i += 1) tick(false);
      simTime = -preroll / 24;
    }
    if (types.has('arrival')) await ctx.runArrival();
    await ctx.loadPosters?.(); // P9.5: the bounty posters are in every shot (the game loads them near the board)
    clock.virtualise();
    for (let i = 0; i < preroll; i += 1) {
      const render = i >= preroll - 6; // render the last frames of the pre-roll (shaders, history)
      tick(render);
      if (render) await gpuIdle();
    }
  }

  const api = {
    ready,
    frames: shot.frames,
    shot: shot.id,
    async step() {
      if (!ctx) throw new Error('[capture] not ready');
      if (recorded >= shot.frames && !probe) throw new Error('[capture] past the last frame');
      tick(true);
      await gpuIdle();
      recorded += 1;
    },
    info() {
      const h = ctx?.horse();
      return {
        shot: shot.id,
        frame: recorded,
        simTime: +simTime.toFixed(4),
        clockFrame: clock.frame,
        canvas: ctx ? [ctx.renderer.domElement.width, ctx.renderer.domElement.height] : null,
        camera: ctx ? ctx.camera.position.toArray().map((x) => +x.toFixed(2)) : null,
        player: ctx ? ctx.player.position.toArray().map((x) => +x.toFixed(2)) : null,
        boat: ctx?.boat ? { home: ctx.boat.home, pos: ctx.boat.mesh.position.toArray().map((x) => +x.toFixed(2)) } : null,
        horse: h ? { x: +h.position.x.toFixed(2), z: +h.position.z.toFixed(2), yaw: +h.yaw.toFixed(3), speed: +h.speed.toFixed(2), riding: h.riding } : null,
        train: owned.train ? { x: +owned.train.machine.x.toFixed(2), state: owned.train.machine.state } : null,
      };
    },
    /** Probe only: a static camera (position, look-at, fov) and the time of day, for authoring shots. */
    look(position, lookAt, fov = 40, t) {
      manual = { position: v3(position), lookAt: v3(lookAt), fov };
      if (t !== undefined) ctx.setTime(t);
    },
    teleport(x, z, yaw = 0) {
      ctx.player.teleport([x, (ctx.standAt(x, z) ?? 0) + 0.2, z], yaw);
    },
  };
  window.__capture = api;

  return {
    shot,
    tier: SPEC.tier,
    night: shot.time === 'night',
    /** startExplore → the world is built: run the shot's setup and resolve ready. */
    attach(c) {
      setup(c).then(() => resolveReady({ frames: shot.frames, width: c.renderer.domElement.width, height: c.renderer.domElement.height }), (error) => {
        console.error('[capture] setup', error);
        rejectReady(error);
      });
    },
    get skipRender() {
      return skip;
    },
    /** After the camera rig: the shot's camera (lights, sky and post read it afterwards). */
    afterCamera(dt) {
      placeCamera(dt);
    },
    /** Just before post.render(): owned systems, DOF and exposure. */
    beforeRender(dt) {
      postFrame(dt);
      const pu = ctx.post().uniforms;
      if (shot.dof) {
        pu.focus.value = shot.dof.focus;
        pu.focal.value = shot.dof.focal;
      }
      pu.ca.value = 0;
      if (shot.exposure) ctx.renderer.toneMappingExposure = ctx.palette().exposure * shot.exposure;
    },
    /** Light / shadow / dust focus: the shot's subject instead of the sheriff. */
    focus() {
      return shot.focus ? v3(shot.focus) : null;
    },
  };
}
