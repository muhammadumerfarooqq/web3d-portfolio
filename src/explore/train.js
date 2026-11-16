// The station train (lazy chunk; loaded only when the sheriff walks near the station). Entering the
// station zone brings it in from the west along the rails with an ease-out (≈6 s); its wheels turn by
// distance / radius, the stack puffs smoke in time with the chuffs, steam hisses at the cylinders as
// it stops and starts, and a synthesized whistle sounds. When it stops, the Journey case file opens;
// when that closes, the train pulls out to the east and is removed. State: train-machine.js.
import { InstancedBufferAttribute, NormalBlending, Quaternion, Sprite, SpriteNodeMaterial, Vector3 } from 'three/webgpu';
import { clamp, float, instancedBufferAttribute, length, mix, smoothstep, uniform, uv, vec3 } from 'three/tsl';
import { TRAIN_JSON_URL, TRAIN_URL } from './config.js';
import { createTrainMachine } from './train-machine.js';
import { setQuietMrt } from './sprite-mrt.js';

const Z_AXIS = new Vector3(0, 0, 1);
const PUFFS = 64;

/** Puff pool: smoke (grey, rising, growing) and steam (white, short, low). CPU-fed, one draw call. */
function createPuffs(scene, mrtOn) {
  const now = uniform(0);
  const night = uniform(1);
  const dataA = new Float32Array(PUFFS * 4);
  const dataB = new Float32Array(PUFFS * 4);
  for (let i = 0; i < PUFFS; i += 1) dataA[i * 4 + 3] = -100; // start time: long dead
  const attrA = new InstancedBufferAttribute(dataA, 4);
  const attrB = new InstancedBufferAttribute(dataB, 4);
  const a = instancedBufferAttribute(attrA); // xyz + start
  const b = instancedBufferAttribute(attrB); // velocity xyz + kind (0 smoke, 1 steam)
  const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: NormalBlending });
  const age = now.sub(a.w);
  const life = mix(float(3.2), float(0.9), b.w);
  const t = clamp(age.div(life), 0, 1);
  material.positionNode = a.xyz.add(b.xyz.mul(age.max(0))).add(vec3(0, t.mul(t).mul(mix(2.5, 0.4, b.w)), 0));
  material.scaleNode = mix(mix(0.7, 3.6, t), mix(0.35, 1.6, t), b.w);
  const smoke = mix(vec3(0.42, 0.38, 0.36), vec3(0.16, 0.17, 0.24), night);
  const steam = mix(vec3(0.92, 0.9, 0.86), vec3(0.42, 0.45, 0.55), night);
  material.colorNode = mix(smoke, steam, b.w);
  material.opacityNode = smoothstep(0.5, 0.0, length(uv().sub(0.5))).mul(float(1).sub(t)).mul(smoothstep(0.0, 0.06, age)).mul(mix(0.5, 0.42, b.w));
  material.alphaTest = 0.004; // round puffs only (P3.4)
  setQuietMrt(material, mrtOn, material.opacityNode);
  const sprite = new Sprite(material);
  sprite.count = PUFFS;
  sprite.frustumCulled = false;
  sprite.name = 'explore_train_puffs';
  scene.add(sprite);
  let head = 0;
  return {
    now,
    night,
    setMrt: (on) => setQuietMrt(material, on, material.opacityNode),
    emit(p, v, kind) {
      dataA.set([p.x, p.y, p.z, now.value], head * 4);
      dataB.set([v.x, v.y, v.z, kind], head * 4);
      head = (head + 1) % PUFFS;
      attrA.needsUpdate = true;
      attrB.needsUpdate = true;
    },
    dispose() {
      scene.remove(sprite);
      material.dispose();
    },
  };
}

/** Steam whistle: three detuned partials with a breathy attack (WebAudio via audio.tone/noise). */
function whistle(audio, at = 0) {
  for (const [f, g] of [
    [523, 0.035],
    [659, 0.03],
    [784, 0.022],
  ]) {
    audio.tone({ freq: f * 0.97, to: f, type: 'triangle', gain: g, attack: 0.12, hold: 1.1, release: 0.45, at, vibrato: 3 });
  }
  audio.noise({ type: 'bandpass', freq: 1800, q: 1.2, gain: 0.05, decay: 1.4, at });
}

export async function createTrain({ loaders, scene, station, audio, reducedMotion = false, signal, mrt = false }) {
  const [gltf, meta] = await Promise.all([
    loaders.gltf.loadAsync(TRAIN_URL),
    fetch(TRAIN_JSON_URL, { signal, credentials: 'same-origin' }).then((r) => r.json()),
  ]);
  const model = gltf.scene;
  model.name = 'explore_train';
  model.visible = false;

  // Wheels (by train.json, with their radii) keep their rest rotation; spin is about the parent's Z
  // (the axle: wheel discs lie in the X/Y plane, the train runs along +X).
  const wheels = [];
  for (const w of meta.wheels ?? []) {
    const node = model.getObjectByName(w.name);
    if (node && w.radius > 0) wheels.push({ node, radius: w.radius, rest: node.quaternion.clone() });
  }
  const spin = new Quaternion();

  // Emitters from the stack / cylinder geometry (robust to the json's axis note).
  model.updateMatrixWorld(true);
  const bboxTop = (name, fallback) => {
    const n = model.getObjectByName(name);
    if (!n) return fallback;
    n.geometry?.computeBoundingBox?.();
    const bb = n.geometry?.boundingBox;
    if (!bb) return fallback;
    const c = new Vector3((bb.min.x + bb.max.x) / 2, bb.max.y, (bb.min.z + bb.max.z) / 2);
    return c.applyMatrix4(n.matrixWorld);
  };
  const stack = bboxTop('loco_stack', new Vector3(18.1, 4.2, 0));
  const cyl = bboxTop('loco_cylinders', new Vector3(17.8, 1.0, 0));
  cyl.y -= 0.35;

  // Emissive windows and lamps: tuned to the town (dim by day, warm at night).
  const glow = [];
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const m = o.material;
    if (m?.emissive && (m.emissive.r > 0 || m.emissive.g > 0)) glow.push({ m, base: m.emissiveIntensity ?? 1 });
  });

  const cfg = station.train;
  const machine = createTrainMachine({ enterX: cfg.enter_from_x, stopX: cfg.stop_x, exitX: cfg.exit_to_x, reducedMotion });
  const y0 = (cfg.rail_top_y ?? 0.35) - 0.35; // train.glb rails sit at 0.35 above its origin
  model.position.set(cfg.enter_from_x, y0, cfg.rail_z);
  scene.add(model);
  const puffs = createPuffs(scene, mrt);

  const drive = wheels.reduce((r, w) => Math.max(r, w.radius), 0.78);
  const chuffEvery = (2 * Math.PI * drive) / 4; // four exhaust beats per drive-wheel turn
  let rolled = 0;
  let sinceChuff = 0;
  let elapsed = 0;
  let wheelAngle = 0;
  const tmp = new Vector3();
  const vel = new Vector3();
  const wind = new Vector3(0.4, 0, 0.15);

  const steam = (n) => {
    for (let i = 0; i < n; i += 1) {
      for (const side of [-1, 1]) {
        tmp.set(cyl.x, cyl.y, cyl.z + side * 1.1).add(model.position);
        vel.set((Math.random() - 0.5) * 0.6, 0.15 + Math.random() * 0.2, side * (0.9 + Math.random() * 0.6));
        puffs.emit(tmp, vel, 1);
      }
    }
    audio.noise({ type: 'highpass', freq: 2600, q: 0.5, gain: 0.07, decay: 0.9 });
  };

  return {
    machine,
    /** Visitor entered the station zone. */
    arrive() {
      if (!machine.enterStation()) return false;
      model.visible = true;
      model.position.x = machine.x;
      whistle(audio, 0.2);
      return true;
    },
    /** The scene pass has an MRT (quality changes): keep the smoke out of the normal / SSR targets. */
    setMrt: (on) => puffs.setMrt(on),
    overlayOpened: () => machine.overlayOpened(),
    overlayClosed: () => machine.overlayClosed(),
    /** Is a point inside the train's footprint (so the sheriff can be stepped onto the platform)? */
    blocks(p) {
      if (!model.visible) return false;
      const x = p.x - model.position.x;
      return Math.abs(p.z - cfg.rail_z) < 1.75 && x > (meta.rear_x ?? -6.1) - 0.5 && x < (meta.front_x ?? 19.8) + 0.5;
    },
    /** Per frame. Returns the machine's events ("openOverlay", "despawn", …). */
    update(dt, night) {
      elapsed += dt;
      puffs.now.value = elapsed;
      puffs.night.value = night;
      for (const g of glow) g.m.emissiveIntensity = g.base * (0.08 + 0.55 * night) * 0.12;
      if (!machine.visible) return [];
      const { x, dx, events } = machine.step(dt);
      model.position.x = x;
      // wheels: angle = −distance / radius (rolling towards +X)
      wheelAngle -= dx;
      for (const w of wheels) w.node.quaternion.copy(spin.setFromAxisAngle(Z_AXIS, wheelAngle / w.radius)).multiply(w.rest);
      // chuffs + stack smoke by distance; a lazy idle wisp while standing
      rolled += Math.abs(dx);
      sinceChuff += dt;
      const speed = Math.abs(dx) / Math.max(dt, 1e-4);
      if (rolled >= chuffEvery && speed > 0.3) {
        rolled = 0;
        sinceChuff = 0;
        audio.noise({ type: 'bandpass', freq: 420 + Math.random() * 80, q: 0.9, gain: Math.min(0.32, 0.12 + speed * 0.02), decay: 0.16 });
        tmp.copy(stack).add(model.position);
        vel.set(-Math.sign(dx) * Math.min(speed, 8) * 0.25, 2.6, 0).add(wind);
        puffs.emit(tmp, vel, 0);
      } else if (speed <= 0.3 && sinceChuff > 0.9) {
        sinceChuff = 0;
        tmp.copy(stack).add(model.position);
        puffs.emit(tmp, vel.set(0.1, 1.2, 0).add(wind), 0);
      }
      for (const e of events) {
        if (e === 'stopped') steam(3);
        if (e === 'departing') {
          whistle(audio);
          steam(3);
        }
        if (e === 'despawn') model.visible = false;
      }
      return events;
    },
    dispose() {
      puffs.dispose();
      scene.remove(model);
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        for (const m of [].concat(o.material)) {
          for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
          m.dispose();
        }
      });
    },
  };
}

