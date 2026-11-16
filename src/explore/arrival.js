// Boat arrival (lazy chunk; first visit only, "explore.arrival" = "seen" afterwards; the HUD can
// replay it). ~8 s: a rowboat glides in towards the end of the dock with gentle bobbing and a wake;
// the camera starts wide from the sea (lighthouse, lit town), moves alongside the boat, then swings
// behind the sheriff into the gameplay camera; he stands up and steps onto the dock (Walk → Idle).
// Letterbox bars and the title "Byte Island"; Skip (focused), any key or a click skips.
// The town GLB bakes its moored rowboat into Dock_baked, so this boat is built here from the same
// kit dimensions (blender/town/kit.py: hull 0.75 × 2.3 × 0.55 m, three thwarts).
import { AdditiveBlending, BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion, SphereGeometry, Vector3 } from 'three/webgpu';
import { SEA_LEVEL } from './config.js';
import { el } from './hud.js';

export const ARRIVAL_SECONDS = 8;
const smooth = (k) => k * k * (3 - 2 * k);
const clamp01 = (k) => Math.min(1, Math.max(0, k));
const SKIP_IGNORE = ['Tab', 'Shift', 'Control', 'Alt', 'Meta'];

/** The rowboat: an open half-ellipsoid hull with three seats (origin at the gunwale centre). */
export function buildRowboat() {
  const boat = new Group();
  boat.name = 'explore_arrival_rowboat';
  const hullGeo = new SphereGeometry(1, 24, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  hullGeo.scale(0.75, 0.55, 2.3);
  const wood = new MeshStandardMaterial({ color: 0x6b4426, roughness: 0.85, side: DoubleSide });
  const hull = new Mesh(hullGeo, wood);
  hull.castShadow = true;
  boat.add(hull);
  const seatMat = new MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.8 });
  for (const z of [-0.8, 0.3, 1.2]) {
    const seat = new Mesh(new BoxGeometry(1.25, 0.06, 0.22), seatMat);
    seat.position.set(0, -0.05, z);
    boat.add(seat);
  }
  // Wake: two pale streaks spreading behind the stern.
  const wakeMat = new MeshBasicMaterial({ color: 0xdfe8f0, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, fog: false });
  for (const s of [-1, 1]) {
    const w = new Mesh(new PlaneGeometry(0.5, 7), wakeMat);
    w.rotation.set(-Math.PI / 2, 0, s * 0.28);
    w.position.set(s * 1.0, -0.28, 5.2);
    boat.add(w);
  }
  boat.userData.wake = wakeMat;
  return boat;
}

export function createArrival({ scene, camera, player, root, spawn, audio, final, onDone }) {
  const boat = buildRowboat();
  scene.add(boat);
  const seaY = SEA_LEVEL + 0.3;
  const dockEnd = new Vector3(spawn.pos[0], spawn.pos[1] - 0.07, spawn.pos[2] + 2.5);
  const moor = new Vector3(spawn.pos[0], seaY, spawn.pos[2] + 5.6);
  const start = new Vector3(spawn.pos[0] + 2, seaY, spawn.pos[2] + 30);
  const avatar = player.object;
  const facing = Math.PI; // down the dock towards the town (−Z)

  // Seated in the stern, facing the bow.
  boat.position.copy(start);
  boat.rotation.y = 0;
  boat.add(avatar);
  avatar.position.set(0, -0.42, 0.55);
  avatar.rotation.set(0, Math.PI, 0);
  player.playClip('Ride', 0);

  // ── overlay: letterbox, title, skip ──
  const title = el('p', { class: 'xp-cine__title', text: 'Byte Island' });
  const skipBtn = el('button', { type: 'button', class: 'xp-btn xp-cine__skip' }, [el('span', { text: 'Skip' }), el('kbd', { text: 'Esc' })]);
  const overlay = el('div', { class: 'xp-cine', 'aria-label': 'Arrival on Byte Island' }, [el('span', { class: 'xp-cine__bar xp-cine__bar--top' }), el('span', { class: 'xp-cine__bar xp-cine__bar--bottom' }), title, skipBtn]);
  root.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-on'));
  skipBtn.focus({ preventScroll: true });

  let t = 0;
  let done = false;
  let phase = 'boat';
  let lapIn = 0.4;
  const camFrom = new Vector3();
  const qFrom = new Quaternion();
  const look = new Vector3();
  const walkFrom = new Vector3();

  function finish() {
    if (done) return;
    done = true;
    window.removeEventListener('keydown', onKey, true);
    overlay.removeEventListener('pointerdown', finish);
    scene.attach(avatar);
    avatar.rotation.set(0, facing, 0);
    player.teleport([spawn.pos[0], spawn.pos[1], spawn.pos[2]], facing);
    player.playClip('Idle', 0.3);
    boat.position.copy(moor);
    boat.userData.wake.opacity = 0;
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
    update(dt) {
      t += dt;
      if (done) {
        // Moored: it keeps riding the swell beside the dock.
        boat.position.y = seaY + Math.sin(t * 1.6) * 0.05;
        boat.rotation.z = Math.sin(t * 1.1) * 0.035;
        return;
      }
      // Boat: ease in to the mooring over 5 s, bobbing on the swell.
      const k = smooth(clamp01(t / 5));
      boat.position.lerpVectors(start, moor, k);
      boat.position.y = seaY + Math.sin(t * 1.6) * 0.05;
      boat.rotation.z = Math.sin(t * 1.1) * 0.035;
      boat.rotation.x = Math.sin(t * 1.3 + 1) * 0.02;
      boat.userData.wake.opacity = 0.35 * (1 - k) * clamp01(t / 0.6);
      lapIn -= dt;
      if (lapIn <= 0) {
        audio.noise({ type: 'lowpass', freq: 320, q: 0.6, gain: 0.07, decay: 0.55 });
        lapIn = 1.1 + Math.random() * 0.4;
      }
      if (t > 1.0) title.classList.add('is-on');
      if (t > 5.4) title.classList.remove('is-on');

      // The sheriff: stands up at 5 s, steps onto the dock, walks to his mark.
      if (phase === 'boat' && t >= 5.0) {
        phase = 'stand';
        scene.attach(avatar);
        player.playClip('Idle', 0.35);
      }
      if (phase === 'stand' && t >= 5.4) {
        phase = 'walk';
        walkFrom.copy(avatar.position);
        player.playClip('Walk', 0.3);
        audio.noise({ type: 'bandpass', freq: 700, q: 3, gain: 0.08, decay: 0.25 }); // the boat creaks
      }
      if (phase === 'walk') {
        const w = clamp01((t - 5.4) / 2.0);
        if (w < 0.45) avatar.position.lerpVectors(walkFrom, dockEnd, smooth(w / 0.45));
        else avatar.position.lerpVectors(dockEnd, new Vector3(spawn.pos[0], spawn.pos[1] - 0.07, spawn.pos[2]), (w - 0.45) / 0.55);
        avatar.rotation.set(0, facing, 0);
        if (w >= 1) {
          phase = 'idle';
          player.playClip('Idle', 0.35);
        }
      }

      // Camera: wide from the sea → alongside the boat → behind the sheriff (the gameplay camera).
      if (t < 3.2) {
        const c = t / 3.2;
        camera.position.set(spawn.pos[0] - 22 + 6 * c, 9 - 2 * c, spawn.pos[2] + 44 - 6 * c);
        look.set(spawn.pos[0] - 8, 3, spawn.pos[2] - 22);
        camera.lookAt(look);
      } else if (t < 5.8) {
        const c = (t - 3.2) / 2.6;
        camera.position.set(boat.position.x + 8 - 2 * c, 2.4, boat.position.z + 3 - 3 * c);
        look.set(boat.position.x, boat.position.y + 0.6, boat.position.z - 1);
        camera.lookAt(look);
        camFrom.copy(camera.position);
        qFrom.copy(camera.quaternion);
      } else {
        const c = smooth(clamp01((t - 5.8) / 2.0));
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
      }
      overlay.remove();
      scene.remove(boat);
      boat.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          o.material.dispose();
        }
      });
    },
  };
}
