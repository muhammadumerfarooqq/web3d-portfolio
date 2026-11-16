// Boat arrival (lazy chunk; first visit only, "explore.arrival" = "seen" afterwards; the HUD can
// replay it). ~9.5 s, P3.4: the town's own rowboat ("Rowboat_baked", see boat.js) rows in from the
// sea along the dock, riding the same Gerstner waves as the sea shader. The sheriff sits on the middle
// thwart playing the Row clip (his hips measured at runtime so he sits ON the seat); the oars from
// oars.glb are attached at oars.json's oarlocks and sweep in time with the clip (blades dip on the
// pull, lift on the recovery, a splash as they bite). The boat bumps gently against the pile, the oars
// come in, he stands (Row → Idle), steps up onto the dock (Walk) and walks to his mark, while the
// camera goes wide from the sea → alongside the boat → the dock → behind him (the gameplay camera).
// Letterbox bars and the title "Byte Island"; Skip (focused), any key or a click skips.
import { AdditiveBlending, DoubleSide, InstancedBufferAttribute, Mesh, MeshBasicNodeMaterial, NormalBlending, PlaneGeometry, Quaternion, Sprite, SpriteNodeMaterial, Vector3 } from 'three/webgpu';
import { abs, clamp, float, hash, instanceIndex, instancedBufferAttribute, length, smoothstep, uniform, uv, vec3 } from 'three/tsl';
import { OARS_JSON_URL, OARS_URL, SEA_LEVEL } from './config.js';
import { OAR_REST as REST, oarPose } from './boat.js';
import { el } from './hud.js';
import { setQuietMrt } from './sprite-mrt.js';

export const ARRIVAL_SECONDS = 9.5;
const SKIP_IGNORE = ['Tab', 'Shift', 'Control', 'Alt', 'Meta'];
const smooth = (k) => k * k * (3 - 2 * k);
const clamp01 = (k) => Math.min(1, Math.max(0, k));
const smoothstepJs = (a, b, x) => smooth(clamp01((x - a) / (b - a)));
const DEG = Math.PI / 180;
const wrapAngle = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

// Timeline (seconds).
const T = { row: 5.6, rowStop: 4.9, bump: 5.6, stand: 5.9, standEnd: 6.4, walkBoat: 6.5, step: 7.1, stepEnd: 7.8, mark: 9.0 };
const RUN_IN = 13; // metres rowed, along the boat's heading

function makeSplashes(mrtOn) {
  const N = 48;
  const data = new Float32Array(N * 4).fill(-100);
  const attr = new InstancedBufferAttribute(data, 4);
  const d = instancedBufferAttribute(attr);
  const now = uniform(0);
  const mat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: NormalBlending });
  const age = now.sub(d.w);
  const life = clamp(age.div(0.7), 0, 1);
  const i = instanceIndex.toFloat();
  const v = vec3(hash(i).sub(0.5).mul(1.4), hash(i.add(3.1)).mul(1.6).add(1.1), hash(i.add(6.2)).sub(0.5).mul(1.4));
  mat.positionNode = d.xyz.add(v.mul(age)).add(vec3(0, age.mul(age).mul(-4.9), 0));
  mat.scaleNode = float(0.05).add(hash(i.add(9.3)).mul(0.07)).mul(float(1).add(life));
  mat.colorNode = vec3(0.86, 0.92, 0.98);
  const round = smoothstep(0.5, 0.0, length(uv().sub(0.5))).pow(1.4);
  const mask = round.mul(float(1).sub(life)).mul(smoothstep(0.0, 0.03, age)).mul(0.75);
  mat.opacityNode = mask;
  mat.alphaTest = 0.01;
  setQuietMrt(mat, mrtOn, mask);
  const sprite = new Sprite(mat);
  sprite.count = N;
  sprite.frustumCulled = false;
  sprite.name = 'explore_arrival_splash';
  let head = 0;
  return {
    sprite,
    mat,
    mask,
    now,
    burst(p, count = 6) {
      for (let k = 0; k < count; k += 1) {
        const o = head * 4;
        data[o] = p.x + (Math.random() - 0.5) * 0.25;
        data[o + 1] = p.y;
        data[o + 2] = p.z + (Math.random() - 0.5) * 0.25;
        data[o + 3] = now.value;
        head = (head + 1) % N;
      }
      attr.needsUpdate = true;
    },
  };
}

/** Wake: a soft V of foam trailing the stern on the water (a flat plane, round-edged, no quad edges). */
function makeWake(mrtOn) {
  const strength = uniform(0);
  const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, fog: false });
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  const q = uv(); // x across (0…1), y along (0 at the stern → 1 far behind)
  const along = float(1).sub(q.y);
  const across = q.x.sub(0.5).mul(2); // −1…1
  const arm = abs(abs(across).sub(along.mul(0.75).add(0.08)));
  const line = smoothstep(0.12, 0.0, arm).mul(smoothstep(0.0, 0.08, along)).mul(smoothstep(1.0, 0.35, along));
  const fill = smoothstep(0.35, 0.0, abs(across)).mul(smoothstep(0.6, 0.0, along)).mul(0.25);
  const mask = line.add(fill).mul(strength);
  mat.colorNode = vec3(0.75, 0.82, 0.88).mul(mask).mul(0.55);
  mat.opacityNode = mask;
  mat.alphaTest = 0.005;
  setQuietMrt(mat, mrtOn, float(0)); // additive foam: no glow, never touches normals / SSR
  const geo = new PlaneGeometry(4.2, 8);
  geo.rotateX(-Math.PI / 2); // lie flat: uv.y = 1 edge → −Z
  geo.translate(0, 0, 4); // z 0 (stern, uv.y = 1) … 8 (far behind, uv.y = 0): trails +Z behind a boat rowing −Z
  const mesh = new Mesh(geo, mat);
  mesh.name = 'explore_arrival_wake';
  mesh.renderOrder = 3;
  return { mesh, mat, strength };
}

export async function createArrival({ scene, camera, player, root, spawn, audio, final, boat, loaders, groundAt, mrt = false, signal, onDone }) {
  // Oars (tiny; failing to load them never blocks the cinematic).
  let oars = null;
  try {
    const [gltf, meta] = await Promise.all([loaders.gltf.loadAsync(OARS_URL), fetch(OARS_JSON_URL, { signal, credentials: 'same-origin' }).then((r) => r.json())]);
    oars = { gltf, meta };
  } catch (error) {
    console.warn('[explore] oars', error);
  }

  const hull = boat.mesh;
  const home = boat.home;
  const avatar = player.object;
  const facingTown = Math.PI; // down the dock towards the town (−Z)
  const heading = { x: Math.sin(home.yaw), z: Math.cos(home.yaw) }; // the boat's local +Z (stern) in world
  const lateral = { x: Math.cos(home.yaw), z: -Math.sin(home.yaw) }; // local +X in world (away from the dock)

  // ── oars on the boat ──
  const oarParts = [];
  const oarL = oars?.gltf.scene.getObjectByName('Oar_L') ?? null;
  const oarR = oars?.gltf.scene.getObjectByName('Oar_R') ?? null;
  for (const [name, side] of [['Oar_L', 'Oar_L'], ['Oar_L_lock', 'Oar_L'], ['Oar_R', 'Oar_R'], ['Oar_R_lock', 'Oar_R']]) {
    const part = oars?.gltf.scene.getObjectByName(name);
    const at = oars?.meta?.oarlock_local_three?.[side];
    if (!part || !at) continue;
    part.removeFromParent();
    part.position.fromArray(at);
    part.rotation.order = 'YZX';
    part.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    hull.add(part);
    oarParts.push(part);
  }
  const bladeL = new Vector3();
  const bladeR = new Vector3();
  const setOars = ({ yaw, dip }) => {
    if (oarL) oarL.rotation.set(0, yaw, dip);
    if (oarR) oarR.rotation.set(0, -yaw, -dip);
  };

  // ── the sheriff on the middle thwart, his hips measured on the Row pose ──
  const seatAt = new Vector3().fromArray(oars?.meta?.rower?.seat_local_three ?? [0, -0.02, -0.3]);
  boat.controlled = true;
  const start = { x: home.x + heading.x * RUN_IN + lateral.x * 0.35, z: home.z + heading.z * RUN_IN + lateral.z * 0.35 };
  boat.place(start.x, start.z, home.yaw);
  hull.add(avatar);
  avatar.position.set(0, 0, 0);
  avatar.rotation.set(0, 0, 0); // a rower faces the stern (local +Z); the boat travels bow first (−Z)
  player.playClip('Row', 0);
  player.animate(1 / 60);
  player.animate(1 / 60);
  avatar.updateMatrixWorld(true);
  const hips = avatar.getObjectByName('hips');
  const hipsLocal = hips ? avatar.worldToLocal(hips.getWorldPosition(new Vector3())).multiply(avatar.scale) : new Vector3(0, 0.5, 0);
  const SIT = 0.1; // seat surface → hip joint (the seat of the trousers)
  const seated = new Vector3(seatAt.x - hipsLocal.x, seatAt.y - hipsLocal.y + SIT, seatAt.z - hipsLocal.z);
  const standing = new Vector3(0, -0.48, seatAt.z);
  const boatEdge = new Vector3(-0.3, -0.48, 1.0); // by the gunwale nearest the dock, towards the stern
  avatar.position.copy(seated);
  const rowClip = player.clipDuration('Row') || 1.333;

  // Boat run-in: a stroke-shaped speed (surge on each pull) under an ease-out envelope, normalised so
  // the hull reaches the mooring exactly at T.row.
  const STEPS = 240;
  const travel = new Float32Array(STEPS + 1);
  for (let i = 1; i <= STEPS; i += 1) {
    const t = (i / STEPS) * T.row;
    const envelope = Math.max(0, 1 - (t / T.row) ** 2);
    const rowing = t < T.rowStop ? 1 + 0.35 * Math.cos(2 * Math.PI * (t / rowClip)) : 0.75;
    travel[i] = travel[i - 1] + envelope * rowing;
  }
  const runIn = (t) => {
    const f = (clamp01(t / T.row) * STEPS) | 0;
    const g = clamp01(t / T.row) * STEPS - f;
    const v = travel[f] + (travel[Math.min(STEPS, f + 1)] - travel[f]) * g;
    return v / travel[STEPS];
  };

  // ── effects ──
  const splash = makeSplashes(mrt);
  const wake = makeWake(mrt);
  scene.add(splash.sprite, wake.mesh);
  let lastPhase = 0;

  // ── overlay: letterbox, title, skip ──
  const title = el('p', { class: 'xp-cine__title', text: 'Byte Island' });
  const skipBtn = el('button', { type: 'button', class: 'xp-btn xp-cine__skip' }, [el('span', { text: 'Skip' }), el('kbd', { text: 'Esc' })]);
  const overlay = el('div', { class: 'xp-cine', 'aria-label': 'Arrival on Byte Island' }, [el('span', { class: 'xp-cine__bar xp-cine__bar--top' }), el('span', { class: 'xp-cine__bar xp-cine__bar--bottom' }), title, skipBtn]);
  root.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-on'));
  skipBtn.focus({ preventScroll: true });

  let t = 0;
  let done = false;
  let phase = 'row';
  let lapIn = 0.4;
  let bumped = false;
  const camFrom = new Vector3();
  const qFrom = new Quaternion();
  const look = new Vector3();
  const stepFrom = new Vector3();
  const stepTo = new Vector3();
  const mark = new Vector3();
  const tmp = new Vector3();

  // The dock: open end past the rope rail (the rope stops ~2 m short of the end), then the spawn mark.
  const deckY = (x, z) => groundAt(x, z) ?? spawn.pos[1] - 0.07;
  const landing = new Vector3(home.x - lateral.x * 1.75 + heading.x * 1.5, 0, home.z - lateral.z * 1.75 + heading.z * 1.5);
  landing.y = deckY(landing.x, landing.z);
  mark.set(spawn.pos[0], deckY(spawn.pos[0], spawn.pos[2]), spawn.pos[2]);

  function shipOars() {
    setOars(REST);
  }

  function finish() {
    if (done) return;
    done = true;
    window.removeEventListener('keydown', onKey, true);
    overlay.removeEventListener('pointerdown', finish);
    scene.attach(avatar);
    avatar.rotation.set(0, facingTown, 0);
    player.teleport([spawn.pos[0], spawn.pos[1], spawn.pos[2]], facingTown);
    player.playClip('Idle', 0.3);
    shipOars();
    boat.controlled = false;
    boat.update(1 / 60);
    wake.strength.value = 0;
    camera.position.copy(final.position);
    camera.quaternion.copy(final.quaternion);
    overlay.classList.remove('is-on');
    title.classList.remove('is-on');
    setTimeout(() => overlay.remove(), 800);
    onDone?.();
  }
  const onKey = (e) => {
    if (SKIP_IGNORE.includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    finish();
  };
  window.addEventListener('keydown', onKey, true);
  overlay.addEventListener('pointerdown', finish);
  skipBtn.addEventListener('click', finish);

  return {
    get done() {
      return done;
    },
    skip: finish,
    /** Debug / tests: the current boat surface error (m) and the oars' stroke phase. */
    get state() {
      return { t: Number(t.toFixed(2)), phase, boatY: hull.position.y, surface: boat.pose.surface, oars: oarParts.length };
    },
    setMrt(on) {
      setQuietMrt(splash.mat, on, splash.mask);
      setQuietMrt(wake.mat, on, float(0));
    },
    update(dt) {
      splash.now.value += dt;
      if (done) return;
      t += dt;

      // ── boat: row in along the dock, then the bump against the pile ──
      const k = runIn(t);
      const side = 0.35 * (1 - smoothstepJs(0.55, 1, k));
      const left = RUN_IN * (1 - k);
      let bx = home.x + heading.x * left + lateral.x * side;
      let bz = home.z + heading.z * left + lateral.z * side;
      if (t >= T.bump) {
        const s = t - T.bump;
        const knock = 0.07 * Math.exp(-3.2 * s) * Math.sin(10 * s);
        bx += lateral.x * knock;
        bz += lateral.z * knock;
        if (!bumped) {
          bumped = true;
          audio.noise({ type: 'lowpass', freq: 180, q: 0.9, gain: 0.22, decay: 0.3 }); // wood on the pile
        }
      }
      const surface = boat.place(bx, bz, home.yaw, dt);
      const speed = t < T.row ? (RUN_IN * (runIn(t + 0.05) - runIn(t))) / 0.05 : 0;
      wake.mesh.position.set(bx + heading.x * 2.1, surface + 0.02, bz + heading.z * 2.1);
      wake.mesh.rotation.y = home.yaw;
      wake.strength.value = Math.min(1, speed / 2.2);
      lapIn -= dt;
      if (lapIn <= 0) {
        audio.noise({ type: 'lowpass', freq: 320, q: 0.6, gain: 0.07, decay: 0.55 });
        lapIn = 1.1 + Math.random() * 0.4;
      }
      if (t > 1.0) title.classList.add('is-on');
      if (t > 5.0) title.classList.remove('is-on');

      // ── oars in time with the Row clip ──
      if (phase === 'row') {
        const stroke = (player.clipTime('Row') / rowClip) % 1;
        if (t < T.rowStop) {
          const pose = oarPose(stroke);
          setOars(pose);
          // The blades bite: a splash at each catch (phase wraps past 0).
          if (stroke < lastPhase && oarL && oarR) {
            for (const [oar, out, s] of [[oarL, bladeL, 1], [oarR, bladeR, -1]]) {
              oar.localToWorld(out.set(1.62 * s, 0, 0));
              out.y = surface + 0.02;
              splash.burst(out, 7);
            }
            audio.noise({ type: 'bandpass', freq: 1400, q: 0.8, gain: 0.05, decay: 0.18 });
          }
          lastPhase = stroke;
        } else {
          // Last stroke done: blades out of the water, held level, the boat glides in.
          const hold = smoothstepJs(T.rowStop, T.rowStop + 0.5, t);
          const p = oarPose(0.75);
          setOars({ yaw: p.yaw * (1 - hold) + -10 * DEG * hold, dip: -3 * DEG });
        }
      }

      // ── the sheriff: stand, cross to the stern, step up onto the dock, walk to his mark ──
      if (phase === 'row' && t >= T.stand) {
        phase = 'stand';
        player.playClip('Idle', 0.45);
      }
      if (phase === 'stand') {
        const s = smoothstepJs(T.stand, T.standEnd, t);
        avatar.position.lerpVectors(seated, standing, s);
        setOars({ yaw: -10 * DEG + (REST.yaw + 10 * DEG) * s, dip: -3 * DEG + (REST.dip + 3 * DEG) * s });
        if (t >= T.walkBoat) {
          phase = 'boatwalk';
          player.playClip('Walk', 0.3);
          audio.noise({ type: 'bandpass', freq: 700, q: 3, gain: 0.08, decay: 0.25 }); // the boat creaks
        }
      }
      if (phase === 'boatwalk') {
        const s = smoothstepJs(T.walkBoat, T.step, t);
        avatar.position.lerpVectors(standing, boatEdge, s);
        avatar.rotation.set(0, -0.6 * smoothstepJs(0.5, 1, s), 0); // turning towards the dock
        if (t >= T.step) {
          phase = 'step';
          scene.attach(avatar);
          stepFrom.copy(avatar.position);
          stepTo.copy(landing);
        }
      }
      if (phase === 'step') {
        const s = smoothstepJs(T.step, T.stepEnd, t);
        avatar.position.lerpVectors(stepFrom, stepTo, s);
        avatar.position.y += Math.sin(s * Math.PI) * 0.35; // up over the gunwale onto the boards
        avatar.rotation.set(0, Math.atan2(stepTo.x - stepFrom.x, stepTo.z - stepFrom.z), 0);
        if (t >= T.stepEnd) {
          phase = 'walk';
          stepFrom.copy(stepTo);
          audio.footstep?.('wood');
        }
      }
      if (phase === 'walk') {
        const s = clamp01((t - T.stepEnd) / (T.mark - T.stepEnd));
        avatar.position.lerpVectors(stepFrom, mark, smooth(s));
        const toMark = Math.atan2(mark.x - stepFrom.x, mark.z - stepFrom.z);
        const turn = smoothstepJs(0.7, 1, s);
        avatar.rotation.set(0, toMark + wrapAngle(facingTown - toMark) * turn, 0);
        if (s >= 1) {
          phase = 'idle';
          player.playClip('Idle', 0.35);
        }
      }

      // ── camera ──
      if (t < 2.8) {
        // Wide from the sea, behind the boat: the rower faces us, the dock, lighthouse and town beyond.
        const c = t / 2.8;
        camera.position.set(home.x - 9 + 2 * c, 3.4 - 0.5 * c, home.z + RUN_IN + 9 - 2 * c);
        look.set(hull.position.x - 2.5, 1.2, hull.position.z - 9);
        camera.lookAt(look);
      } else if (t < 5.8) {
        // Alongside and a little astern (he rows facing the stern): his face, the oars mid-stroke, the wake.
        const c = smoothstepJs(2.8, 5.8, t);
        const side = 5.4 - 0.6 * c;
        const aft = 3.4 - 1.4 * c;
        // Held well above the swell's crests (a crest between lens and boat used to hide the hull).
        camera.position.set(hull.position.x + lateral.x * side + heading.x * aft, SEA_LEVEL + 3.0, hull.position.z + lateral.z * side + heading.z * aft);
        look.set(hull.position.x + heading.x * 0.4, surface + 0.45, hull.position.z + heading.z * 0.4);
        camera.lookAt(look);
      } else if (t < 7.9) {
        // From just past the dock end, on the dock side: the bump, the oars shipped, the step up.
        const c = smoothstepJs(5.8, 7.9, t);
        camera.position.set(home.x - lateral.x * (4.0 - 0.4 * c) + heading.x * (4.8 - 0.6 * c), 2.5 + 0.2 * c, home.z - lateral.z * (4.0 - 0.4 * c) + heading.z * (4.8 - 0.6 * c));
        look.set(hull.position.x, 0.2, hull.position.z + heading.z * 0.4);
        tmp.set(landing.x, landing.y + 1.1, landing.z);
        look.lerp(tmp, c);
        camera.lookAt(look);
        camFrom.copy(camera.position);
        qFrom.copy(camera.quaternion);
      } else {
        // Swing round behind him into the gameplay camera.
        const c = smoothstepJs(7.9, ARRIVAL_SECONDS - 0.2, t);
        camera.position.lerpVectors(camFrom, final.position, c);
        camera.quaternion.slerpQuaternions(qFrom, final.quaternion, c);
      }
      player.animate(dt);
      if (t >= ARRIVAL_SECONDS) finish();
    },
    dispose() {
      if (!done) {
        done = true;
        window.removeEventListener('keydown', onKey, true);
        scene.attach(avatar);
        boat.controlled = false;
      }
      overlay.remove();
      for (const part of oarParts) {
        part.removeFromParent();
        part.traverse((o) => {
          if (o.isMesh) {
            o.geometry.dispose();
            for (const m of [].concat(o.material)) m.dispose();
          }
        });
      }
      scene.remove(splash.sprite, wake.mesh);
      splash.sprite.geometry?.dispose();
      splash.mat.dispose();
      wake.mesh.geometry.dispose();
      wake.mat.dispose();
    },
  };
}
