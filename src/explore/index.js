// Explore mode entry (lazy chunk; imported only by src/ui/mode.js when Explore starts).
// startExplore() builds the renderer (three/webgpu: WebGPU, falling back to WebGL2), loads the town
// and the sheriff, wires the controller, camera, zones, HUD, audio and post-processing, and returns
// { dispose } which frees every GPU and DOM resource (repeated Classic ⇄ Explore toggles do not leak).
import './explore.css';
import { ACESFilmicToneMapping, MeshBasicNodeMaterial, Scene, Vector3, WebGPURenderer } from 'three/webgpu';
import { REPLAY } from '../ui/boot-rules.js';
import { readPref, sessionStore, writePref } from '../ui/prefs.js';
import { setSound } from '../ui/sound.js';
import { createAmbient } from './ambient.js';
import { createAudio } from './audio.js';
import { BADGES_EMPTY, BADGES_KEY, BADGES_VALUES, createBadges } from './badges.js';
import { SEA_ORDER, createBoat } from './boat.js';
import { createCameraRig } from './camera-rig.js';
import { ARRIVAL_KEY, ARRIVAL_VALUES, BOUNTY_POSTERS, MUSIC_KEY, MUSIC_VALUES, PLAYER, QUALITY_KEY, QUALITY_VALUES, TIERS, TIME_KEY, TIME_VALUES, TOWN_JSON_URL, TUTORIAL_KEY, TUTORIAL_VALUES } from './config.js';
import { castDown, inputVector } from './controller-math.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createLights } from './lights.js';
import { createProgress } from './loader-progress.js';
import { createMaterialUniforms, createRimUniforms } from './materials.js';
import { createParticles } from './particles.js';
import { createPlayer } from './player.js';
import { createPost } from './post.js';
import { AdaptiveResolution, isIntegratedGpu, lowerTier, pickTier, tierSettings } from './quality.js';
import { bakeDepthTexture, createFarSea, createSea } from './sea.js';
import { depthSampler } from './waves.js';
import { createSky } from './sky.js';
import { startTransition, stepTransition, timeOfDay } from './time-of-day.js';
import { arrowAngle, loadZones, nearestZone, nextUnvisited } from './zones.js';
import { createLoaders, disposeObject, loadAssets, prepareAvatar, prepareTown } from './world.js';

const readQuality = () => readPref(QUALITY_KEY, QUALITY_VALUES, 'auto');
const readTutorial = () => readPref(TUTORIAL_KEY, TUTORIAL_VALUES, null);
const readTime = () => readPref(TIME_KEY, TIME_VALUES, null);

function detectSoftware(renderer) {
  try {
    const backend = renderer.backend;
    if (backend.isWebGPUBackend) {
      const info = backend.device?.adapterInfo ?? {};
      const text = `${info.vendor ?? ''} ${info.architecture ?? ''} ${info.description ?? ''}`.toLowerCase();
      return { software: /swiftshader|llvmpipe|software|basic render/.test(text), adapter: text.trim() || 'WebGPU adapter' };
    }
    const gl = backend.gl;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return { software: /swiftshader|llvmpipe|software|basic render/i.test(String(name)), adapter: String(name) };
  } catch {
    return { software: false, adapter: 'unknown' };
  }
}

/**
 * Start Explore. options: { onExit(anchor?), soundOn, reducedMotion }.
 * Resolves to { dispose } once the loader is up (the town keeps loading behind it).
 */
export async function startExplore(options = {}) {
  const { onExit, soundOn = false, reducedMotion = false, debug = false, forceWebGL = false } = options;
  // P9.3 promo capture (dev server only): import.meta.env.DEV is false in production builds, so every
  // `import.meta.env.DEV && dev` branch below and the capture module itself are dropped from dist/.
  const dev = import.meta.env.DEV && options.devCapture ? await import('./capture-mode.js').then((m) => m.createCaptureMode(options.devCapture)) : null;
  const touch = window.matchMedia('(pointer: coarse)').matches;
  let quality = import.meta.env.DEV && dev ? dev.tier : readQuality();
  let night = import.meta.env.DEV && dev ? dev.night : (readTime() ?? 'night') === 'night'; // night is the hero and the default
  let musicOn = readPref(MUSIC_KEY, MUSIC_VALUES, 'on') === 'on';
  const showTutorial = !(import.meta.env.DEV && dev) && readTutorial() !== 'done';

  let disposed = false;
  const cleanups = [];
  const abort = new AbortController();
  const listen = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  };

  // town.json first (tiny): the HUD needs the zone list.
  const zonesRes = await fetch(TOWN_JSON_URL, { signal: abort.signal, credentials: 'same-origin' }).then((r) => r.json()).catch(() => ({ landmarks: {} }));
  const { spawn, zones } = loadZones(zonesRes);
  const stationLandmark = zonesRes.landmarks?.station;
  // Stars persist (explore.badges, whitelisted); the chips and the edge arrow follow them.
  const badges = createBadges(readPref(BADGES_KEY, BADGES_VALUES, BADGES_EMPTY), { onChange: (v) => writePref(BADGES_KEY, v, BADGES_VALUES) });

  let api = null; // filled once the world exists
  const hud = createHud({
    zones,
    tiers: TIERS,
    quality,
    sound: soundOn,
    music: musicOn,
    night,
    touch,
    debug,
    showTutorial,
    onExit: () => onExit(),
    onTravel: (z) => api?.travel(z),
    onSound: (on) => setSound(on ? 'on' : 'off'),
    onMusic: (on) => api?.setMusic(on),
    onReplay: () => api?.replayArrival(),
    onTime: (n) => api?.setNight(n, true),
    onQuality: (q) => api?.setQuality(q),
    onSkipTutorial: () => api?.finishTutorial(),
    onInteract: () => api?.interact(),
    onStars: () => api?.openStars(),
  });
  hud.setStars(badges.set);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    abort.abort();
    api?.destroy();
    for (const off of cleanups) off();
    hud.dispose();
  };

  (async () => {
    let renderer;
    try {
      renderer = new WebGPURenderer(import.meta.env.DEV && dev ? { antialias: false, forceWebGL, powerPreference: 'high-performance' } : { antialias: false, forceWebGL });
      await renderer.init();
      if (disposed) {
        renderer.dispose();
        return;
      }
    } catch (error) {
      hud.showError('This browser could not start the 3D renderer. The Classic portfolio has everything.');
      console.error('[explore] renderer', error);
      return;
    }
    const backend = renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl';
    const { software, adapter } = detectSoftware(renderer);
    const auto = pickTier({
      backend,
      mobile: touch,
      deviceMemory: navigator.deviceMemory ?? 8,
      cores: navigator.hardwareConcurrency ?? 4,
      saveData: Boolean(navigator.connection?.saveData),
      software,
      integrated: isIntegratedGpu(adapter),
    });
    let tier = quality === 'auto' ? auto : quality;
    let settings = tierSettings(tier, backend);
    const basePR = () => Math.min(window.devicePixelRatio || 1, settings.pixelRatio);
    renderer.setPixelRatio(basePR());
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    hud.canvasHost.append(renderer.domElement);

    const progress = createProgress({ town: 70, avatar: 20, build: 10 });
    const loaders = createLoaders();
    let assets;
    try {
      assets = await loadAssets(loaders, (key, loaded, total) => hud.setProgress(progress.update(key, loaded, total)), abort.signal);
    } catch (error) {
      if (!disposed) hud.showError('The town could not be loaded. Please try again, or use the Classic portfolio.');
      console.error('[explore] load', error);
      renderer.dispose();
      loaders.dispose();
      return;
    }
    if (disposed) {
      renderer.dispose();
      loaders.dispose();
      return;
    }
    progress.done('town');
    progress.done('avatar');
    hud.setProgress(progress.value());
    hud.loaderMessage('Raising the town…');
    await new Promise((r) => setTimeout(r, 30));

    // ── world ──
    const scene = new Scene();
    const rig = createCameraRig(window.innerWidth / window.innerHeight);
    const camera = rig.camera;
    const matU = createMaterialUniforms();
    const town = prepareTown(assets.townGltf, matU, { lite: tier === 'LOW' });
    scene.add(town.root);

    const depthTexture = bakeDepthTexture(town.heightAt, 128, town.heightHalf);
    const sea = createSea({ depthTexture, half: town.heightHalf, size: 240, segments: settings.seaSegments });
    scene.add(sea.mesh);
    const farSea = town.seaMesh ? createFarSea(town.seaMesh, sea.uniforms) : null;
    if (farSea) scene.add(farSea);
    // The moored rowboat rides the same waves as the sea shader (P3.4; waves.js samples the same depth).
    const seaDepth = depthSampler(depthTexture.image.data, depthTexture.image.width, town.heightHalf);
    const boat = town.rowboat ? createBoat({ mesh: town.rowboat, depthAt: seaDepth, getPhase: () => sea.uniforms.phase.value, maskMaterial: new MeshBasicNodeMaterial() }) : null;
    // The sea draws after the boat's water mask (opaque order), so no water shows inside the hull.
    sea.mesh.renderOrder = SEA_ORDER;
    if (farSea) farSea.renderOrder = SEA_ORDER;
    const sky = createSky();
    scene.add(sky.mesh);
    const lights = createLights(scene, renderer, settings, town.lanterns, town.heightAt, (x, y, z) => castDown(town.bvh, new Vector3(x, y, z), 6)?.point.y ?? null);

    const rimU = createRimUniforms();
    const avatarData = prepareAvatar(assets.avatarGltf, rimU);
    scene.add(avatarData.avatar);
    const player = createPlayer({ avatarData, bvh: town.bvh, depthAt: town.depthAt, spawn });
    rig.yaw = 0;

    const smith = zones.find((z) => z.zone === 'skills');
    const forge = smith ? new Vector3(smith.door[0] + (smith.center[0] - smith.door[0]) * 0.25, 0.9, smith.door[2] + 1.2) : null;
    let particles = createParticles({ scene, renderer, settings, backend, chimneys: town.chimneys, forge, heightAt: town.heightAt });
    const rayOrigin = new Vector3();
    const groundAt = (x, z) => {
      const hit = castDown(town.bvh, rayOrigin.set(x, 30, z), 60);
      return hit ? hit.point.y : null;
    };
    /** Highest ground in a small cross (± 0.2 m): one ray can fall through a gap between dock planks. */
    const standAt = (x, z, from = 30, len = 60) => {
      let best = null;
      for (const [dx, dz] of [[0, 0], [0.2, 0], [-0.2, 0], [0, 0.2], [0, -0.2]]) {
        const y = castDown(town.bvh, rayOrigin.set(x + dx, from, z + dz), len)?.point.y;
        if (y !== undefined && (best === null || y > best)) best = y;
      }
      return best;
    };
    const ambient = createAmbient({ scene, flags: town.flags, signs: town.signs, wallBoxes: town.wallBoxes, heightAt: town.heightAt, bvhRaycastDown: groundAt });

    // One plain render first: it creates the sun's shadow map, which the god-ray node reads when the
    // pipeline is built.
    rig.update(0.016, player.position, Math.PI, false, town.bvh, 0);
    lights.update(player.position, 0, camera.position);
    try {
      renderer.render(scene, camera);
    } catch (error) {
      console.warn('[explore] first render', error);
    }
    let post = createPost({ renderer, scene, camera, settings, sun: lights.sun, sky, particles, effects: [lights], reducedMotion });
    const audio = createAudio({ enabled: soundOn });
    let music = null; // the lazy score (music.js); declared before applyPalette, which sets its mood
    let musicLoad = null;

    const surfaceUnder = () => {
      const hit = castDown(town.bvh, rayOrigin.set(player.position.x, player.position.y + 0.5, player.position.z), 1.5);
      return hit ? town.surfaceAt(hit.faceIndex) : 'sand';
    };

    // ── time of day ──
    let tState = startTransition(night ? 1 : 0, night ? 1 : 0);
    tState.progress = 1;
    const applyPalette = (t) => {
      const p = timeOfDay(t);
      lights.apply(p);
      renderer.toneMappingExposure = p.exposure;
      const su = sky.uniforms;
      su.zenith.value.setRGB(...p.skyZenith);
      su.horizon.value.setRGB(...p.skyHorizon);
      su.sunDir.value.setRGB(...p.sunDir);
      su.sunColor.value.setRGB(...p.sunColor);
      su.day.value = 1 - p.t;
      su.stars.value = p.stars;
      su.moon.value = p.moon;
      su.groundColor.value.setRGB(...p.fogColor);
      const wu = sea.uniforms;
      wu.skyZenith.value.setRGB(...p.skyZenith);
      wu.skyHorizon.value.setRGB(...p.skyHorizon);
      wu.sunDir.value.setRGB(...p.sunDir);
      wu.sunColor.value.setRGB(...p.sunColor);
      wu.deep.value.setRGB(0.02 + (0.004 - 0.02) * p.t, 0.06 + (0.012 - 0.06) * p.t, 0.09 + (0.035 - 0.09) * p.t);
      wu.shallow.value.setRGB(0.06 + (0.01 - 0.06) * p.t, 0.2 + (0.05 - 0.2) * p.t, 0.17 + (0.08 - 0.17) * p.t);
      wu.glitter.value = 1 - 0.25 * p.t; // the moon lays a glitter path beside the dock
      wu.foam.value = 0.55 - 0.42 * p.t;
      matU.night.value = p.t;
      rimU.moon.value = p.t;
      music?.setMood(p.t > 0.5);
      matU.wetness.value = p.wetness;
      matU.windowGlow.value = p.windowGlow;
      matU.lantern.value = p.lanternIntensity;
      matU.sunDir.value.setRGB(...p.sunDir);
      matU.sunColor.value.setRGB(...p.sunColor);
      particles.shared.night.value = p.fireflies;
      particles.shared.day.value = 1 - p.t;
      particles.shared.sunColor.value.setRGB(...p.sunColor);
      const pu = post.uniforms;
      pu.grade.value = p.grade;
      pu.bloom.value = p.bloomStrength * (settings.bloom === 'full' ? 1.05 : 0.6);
      pu.flare.value = (1 - p.t) * 0.9;
      pu.godrays.value = 0.12 + (1 - p.t) * 0.33;
      pu.ssr.value = 0.2 + 0.55 * p.wetness;
      pu.sunColor.value.setRGB(...p.sunColor);
      return p;
    };
    let palette = applyPalette(tState.t);

    // ── input ──
    const start = performance.now();
    const now = () => (performance.now() - start) / 1000;
    let tutorialOpen = showTutorial;
    const input = createInput({
      surface: hud.surface,
      ...hud.touchEls,
      onOrbit: (dx, dy) => rig.orbit(dx, dy, now()),
      onZoom: (d) => rig.zoom(d),
      onDrag: (on) => (rig.dragging = on),
      onPointerLock: (on) => {
        hud.setPointerLock(on);
        hud.announce(on ? 'Mouse look on. Press Escape to release the mouse.' : 'Mouse look off.');
      },
      onKey: (action, down) => {
        audio.unlock();
        startMusic();
        if (tutorialOpen) {
          hud.keycap(action, down);
          if (down && hud.tutorialDone()) setTimeout(() => api?.finishTutorial(), 600);
        }
      },
    });
    listen(window, 'pointerdown', () => {
      audio.unlock();
      startMusic();
    }, { passive: true });
    listen(window, 'keydown', () => startMusic(), { passive: true });
    listen(window, 'soundchange', (e) => {
      audio.setEnabled(e.detail.sound === 'on');
      hud.setSound(e.detail.sound === 'on');
      if (e.detail.sound === 'on') startMusic();
    });
    listen(window, 'themechange', (e) => api?.setNight(e.detail.theme === 'dark', true));

    const resize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    listen(window, 'resize', resize);

    // ── zones ──
    let currentZone = null;
    let glitchT = 0;
    const glitch = (amount, seconds) => {
      if (reducedMotion) return;
      post.uniforms.glitch.value = Math.max(post.uniforms.glitch.value, amount);
      glitchT = Math.max(glitchT, seconds);
    };

    const adaptive = new AdaptiveResolution({ target: touch ? 32 : 55, floorFps: touch ? 24 : 30 });
    let resScale = 1;

    const rebuildQuality = (nextTier) => {
      tier = nextTier;
      settings = tierSettings(tier, backend);
      post.dispose();
      particles.dispose();
      particles = createParticles({ scene, renderer, settings, backend, chimneys: town.chimneys, forge, heightAt: town.heightAt });
      post = createPost({ renderer, scene, camera, settings, sun: lights.sun, sky, particles, effects: [lights, fireworks, train, arrival], reducedMotion });
      post.uniforms.fade.value = 0;
      post.uniforms.glitch.value = reducedMotion ? 0 : 0.4;
      glitchT = 0.35;
      // The shadow map is resized in place (the god-ray node keeps a reference to it).
      if (lights.sun.castShadow && settings.shadowMap > 0) lights.sun.shadow.mapSize.set(settings.shadowMap, settings.shadowMap);
      renderer.setPixelRatio(basePR() * resScale);
      palette = applyPalette(tState.t);
    };

    // ── music (lazy chunk): starts after a user gesture, only with sound on and the music toggle on ──
    audio.setMusic(musicOn);
    function startMusic() {
      if (musicLoad || !musicOn || disposed) return;
      const out = audio.context();
      if (!out) return;
      musicLoad = import('./music.js')
        .then((m) => {
          if (disposed) return;
          music = m.createMusic({ ctx: out.ctx, out: out.music, noise: out.noise, night: palette.t > 0.5 });
        })
        .catch((error) => console.warn('[explore] music', error));
    }
    const duckFor = (id, level, seconds) => {
      audio.duck(id, level);
      setTimeout(() => audio.duck(id, null), seconds * 1000);
    };

    // ── the horse (lazy chunk, first whistle) ──
    let horse = null;
    let horseLoad = null;
    let promptKey = null;
    const loadHorse = () =>
      (horseLoad ??= import('./horse.js')
        .then((m) => m.createHorse({ loaders, scene, town, townJson: zonesRes, player, camera, audio, signal: abort.signal }))
        .then((h) => {
          if (disposed) {
            h.dispose();
            return null;
          }
          horse = h;
          return h;
        })
        .catch((error) => console.warn('[explore] horse', error)));
    // ── the Bounty Board posters (lazy chunk, P9.5): painted the first time the sheriff comes near ──
    const bountyZone = zones.find((z) => z.zone === 'projects');
    let postersLoad = null;
    const loadPosters = () =>
      (postersLoad ??= bountyZone
        ? import('./bounty-posters.js')
            .then((m) => m.createBountyPosters({ projects: m.readProjects(document), center: bountyZone.center }))
            .then((p) => {
              if (disposed) {
                p.dispose();
                return null;
              }
              scene.add(p.group);
              cleanups.push(() => p.dispose());
              return p;
            })
            .catch((error) => console.warn('[explore] posters', error))
        : Promise.resolve(null));

    // P5: the Saloon's chat (the shared Classic module, src/ui/chat.js) reports its state with a window
    // event; the sheriff thinks while it waits, talks while the answer appears, then nods.
    // P5: a source chip in the Saloon chat → leave Explore for Classic at the cited section / project.
    listen(window, 'chatsource', (event) => {
      const anchor = event.detail?.anchor;
      if (typeof anchor !== 'string' || !/^[a-z0-9-]{1,80}$/.test(anchor)) return;
      event.preventDefault();
      onExit(anchor);
    });
    listen(window, 'chatstate', (event) => {
      if (horse?.riding || cinematic || ceremony || reducedMotion) return;
      const state = event.detail?.state;
      if (state === 'thinking') player.pose('Think', 20);
      else if (state === 'answer') player.talk(Math.min(6, Math.max(1.5, (Number(event.detail?.chars) || 120) / 28)));
      else player.release();
    });

    function whistle() {
      if (horse?.riding) return;
      player.playOnce('Whistle');
      audio.whistle();
      loadHorse().then((h) => {
        if (!h) return;
        const r = h.whistle();
        if (!r.ok && r.reason === 'unreachable') hud.notice("Your horse can't reach you here");
        else if (r.ok) hud.announce('Your horse is on its way.');
      });
    }

    // ── the boat arrival (lazy chunk; first visit, replayable) ──
    let arrival = null;
    let cinematic = false;
    // P3.4b: once per browser session (sessionStorage), or forced with ?replay=1. The localStorage key
    // stays whitelisted and written, but it no longer blocks the arrival.
    const session = sessionStore();
    const arrivalSeenThisSession = () => !REPLAY && readPref(ARRIVAL_KEY, ARRIVAL_VALUES, null, session) === 'seen';
    const markArrivalSeen = () => {
      writePref(ARRIVAL_KEY, 'seen', ARRIVAL_VALUES, session);
      writePref(ARRIVAL_KEY, 'seen', ARRIVAL_VALUES);
    };
    async function runArrival(first) {
      if (cinematic || overlayOpen || ceremony || reducedMotion) return;
      if (horse?.riding) horse.dismount(true);
      cinematic = true;
      input.setPaused(true);
      hud.setCinematic(true);
      try {
        const m = await import('./arrival.js');
        if (disposed) return;
        // The gameplay camera at the spawn, where the last shot ends.
        player.teleport([spawn.pos[0], spawn.pos[1], spawn.pos[2]], Math.PI);
        rig.yaw = 0;
        rig.update(0.016, player.position, Math.PI, false, town.bvh, 0);
        const final = { position: camera.position.clone(), quaternion: camera.quaternion.clone() };
        arrival?.dispose();
        arrival = null;
        if (!boat) throw new Error('town.glb has no Rowboat_baked node');
        arrival = await m.createArrival({
          scene,
          camera,
          player,
          root: hud.root,
          spawn,
          audio,
          final,
          boat,
          loaders,
          groundAt: (x, z) => standAt(x, z, 3, 5),
          mrt: post.hasMrt,
          signal: abort.signal,
          onDone: () => {
            cinematic = false;
            input.setPaused(overlayOpen || ceremony);
            hud.setCinematic(false);
            hud.canvasHost.focus({ preventScroll: true });
            if (first) markArrivalSeen();
          },
        });
      } catch (error) {
        // A failed load is not "seen": the next visit in this session tries again.
        console.warn('[explore] arrival', error);
        cinematic = false;
        input.setPaused(false);
        hud.setCinematic(false);
      }
    }

    // ── case files, stars and the Case Closed ceremony (lazy chunks) ──
    let caseFiles = null;
    let caseFilesLoad = null;
    let overlayOpen = false;
    let ceremony = false;
    let ceremonyPending = false;
    let fireworks = null;
    let train = null;
    let trainLoad = null;
    const loadCaseFiles = () =>
      (caseFilesLoad ??= import('./case-files.js').then((m) => {
        if (disposed) return null;
        caseFiles = m.createCaseFiles({
          host: hud.root,
          canvasHost: hud.canvasHost,
          starButton: hud.starButton,
          zones,
          sound: audio,
          announce: (t) => hud.announce(t),
          reducedMotion,
          getStars: () => badges.set,
          onClassic: (anchor) => onExit(anchor),
          onTravel: (z) => api.travel(z),
          onOpenChange: (open, info) => {
            overlayOpen = open;
            audio.duck('case', open ? 0.35 : null);
            input.setPaused(open || ceremony);
            if (info?.zone === 'journey') {
              if (open) train?.overlayOpened();
              else train?.overlayClosed();
            }
            if (!open) player.release(); // P5: no chat pose left over
            if (!open && ceremonyPending) runCeremony();
          },
          onEngaged: (zoneId) => {
            const r = badges.award(zoneId);
            if (!r.awarded) return;
            hud.setStars(badges.set);
            caseFiles.flyStar();
            const z = zones.find((x) => x.zone === zoneId);
            hud.announce(`Star earned: ${z?.title ?? zoneId}. ${r.count} of ${badges.total}.`);
            if (r.completedNow) ceremonyPending = true;
          },
          onReset: () => {
            badges.reset();
            hud.setStars(badges.set);
          },
        });
        return caseFiles;
      }));
    const openCase = (zone, opts) =>
      loadCaseFiles()
        .then((cf) => cf?.open(zone, opts))
        .catch((error) => console.error('[explore] case file', error));

    // 8/8: fireworks, the sheriff waves, the CASE CLOSED stamp, then the Deputy's Commission.
    async function runCeremony() {
      ceremonyPending = false;
      ceremony = true;
      audio.duck('ceremony', 0.2);
      input.setPaused(true);
      hud.setCinematic(true);
      hud.announce('Case closed. Every case on Byte Island is closed.');
      try {
        const { createFireworks, showOrigin } = await import('./fireworks.js');
        if (disposed) return;
        fireworks?.dispose();
        fireworks = createFireworks({ scene, origin: showOrigin(camera, player.position), reducedMotion, audio, mrt: post.hasMrt });
        rig.setView({ pitch: 0.06, distance: Math.max(rig.distance, 8) });
        setTimeout(() => player.wave(true), 350);
        await caseFiles.stamp();
        await new Promise((r) => setTimeout(r, reducedMotion ? 300 : 1800));
      } catch (error) {
        console.error('[explore] ceremony', error);
      }
      if (disposed) return;
      ceremony = false;
      audio.duck('ceremony', null);
      hud.setCinematic(false);
      caseFiles.openCertificate();
    }

    // The train loads only once the sheriff is near the station; it arrives on entering the zone.
    const station = zones.find((z) => z.zone === 'journey');
    const loadTrain = () =>
      (trainLoad ??= import('./train.js')
        .then((m) => m.createTrain({ loaders, scene, station: stationLandmark, audio, reducedMotion, signal: abort.signal, mrt: post.hasMrt }))
        .then((t) => {
          if (disposed) {
            t.dispose();
            return null;
          }
          train = t;
          if (currentZone && currentZone === station) train.arrive();
          return t;
        })
        .catch((error) => console.warn('[explore] train', error)));

    api = {
      travel(z) {
        if (horse?.riding) horse.dismount(true);
        audio.blip(true);
        glitch(0.55, 0.45);
        player.teleport([z.door[0] + (z.door[0] - z.center[0]) * 0.35, z.door[1], z.door[2] + (z.door[2] - z.center[2]) * 0.35]);
        hud.announce(`Travelled to ${z.title}.`);
      },
      setNight(n, user) {
        if (n === night && user) return;
        night = n;
        writePref(TIME_KEY, night ? 'night' : 'day', TIME_VALUES);
        tState = startTransition(tState.t, night ? 1 : 0);
        hud.setNight(night);
        glitch(0.35, 0.35);
        hud.announce(night ? 'Night falls over the town.' : 'Golden hour.');
      },
      setQuality(q) {
        if (!QUALITY_VALUES.includes(q)) return;
        quality = q;
        writePref(QUALITY_KEY, q, QUALITY_VALUES);
        rebuildQuality(q === 'auto' ? auto : q);
        hud.announce(`Graphics quality: ${q === 'auto' ? `auto (${tier})` : q}.`);
      },
      finishTutorial() {
        if (!tutorialOpen) return;
        tutorialOpen = false;
        writePref(TUTORIAL_KEY, 'done', TUTORIAL_VALUES);
        hud.hideTutorial();
      },
      interact() {
        if (overlayOpen || ceremony || cinematic) return;
        if (!currentZone) {
          // E with no building near: mount, or (slow enough) dismount.
          if (horse?.riding) horse.dismount();
          else if (horse?.near(player.position)) horse.mount();
          return;
        }
        if (horse?.riding) horse.dismount(true); // a case file always opens on foot
        audio.blip();
        window.dispatchEvent(new CustomEvent('explore:zone', { detail: { zone: currentZone.zone, title: currentZone.title, anchor: currentZone.anchor } }));
        openCase(currentZone);
      },
      setMusic(on) {
        musicOn = on;
        writePref(MUSIC_KEY, on ? 'on' : 'off', MUSIC_VALUES);
        audio.setMusic(on);
        hud.setMusic(on);
        if (on) startMusic();
        hud.announce(on ? 'Music on.' : 'Music off.');
      },
      replayArrival() {
        runArrival(false);
      },
      /** Star counter: the certificate at 8/8, otherwise the case board. */
      openStars() {
        if (ceremony) return;
        loadCaseFiles().then((cf) => (badges.complete ? cf?.openCertificate() : cf?.openBoard()));
      },
      destroy() {
        music?.dispose();
        horse?.dispose();
        arrival?.dispose();
        caseFiles?.dispose();
        train?.dispose();
        fireworks?.dispose();
        renderer.setAnimationLoop(null);
        delete window.__explore;
        input.dispose();
        audio.dispose();
        post.dispose();
        particles.dispose();
        ambient.dispose();
        lights.dispose();
        player.dispose();
        disposeObject(scene);
        depthTexture.dispose();
        scene.clear();
        loaders.dispose();
        renderer.dispose();
      },
    };

    // ── compile, reveal ──
    hud.loaderMessage('Lighting the lanterns…');
    rig.update(0.016, player.position, Math.PI, false, town.bvh, 0);
    // Warm up through the real pipeline (MRT and all) behind the loader, so the first visible frame
    // does not stall on shader compilation.
    try {
      post.render();
      await new Promise((r) => requestAnimationFrame(r));
      post.render();
    } catch (error) {
      console.warn('[explore] warm-up', error);
    }
    if (disposed) return;
    progress.done('build');
    hud.setProgress(100);
    hud.ready();
    hud.announce(`You are in the town. ${zones.length} buildings to visit. Walk with W A S D or the arrow keys, open a building with E.`);
    post.uniforms.fade.value = 1;
    if (!reducedMotion) post.uniforms.glitch.value = 0.8;
    let fadeIn = 0;
    if (!arrivalSeenThisSession()) runArrival(true);

    if (debug) {
      // Screenshot / QA hooks, only with ?debug=1.
      window.__exploreDebug = {
        teleport: (x, z, yaw) => player.teleport([x, (standAt(x, z) ?? 0) + 0.2, z], yaw),
        view: (o) => rig.setView(o),
        night: (n) => api.setNight(n, true),
        quality: (q) => api.setQuality(q),
        open: (id) => openCase(zones.find((z) => z.zone === id)),
        whistle: () => whistle(),
        mount: () => horse?.mount(),
        dismount: () => horse?.dismount(true),
        arrival: () => runArrival(false),
        skipArrival: () => arrival?.skip(),
        horse: () => (horse ? { state: horse.machine.state, x: +horse.position.x.toFixed(2), z: +horse.position.z.toFixed(2), yaw: +horse.yaw.toFixed(3), speed: +horse.speed.toFixed(2), riding: horse.riding, nodes: horse.graph.nodes.length, edges: horse.graph.edges.length, near: horse.near(player.position) } : null),
        ground: (x, z) => town.heightAt(x, z),
        ray: (x, y, z, len = 60) => castDown(town.bvh, new Vector3(x, y, z), len)?.point.y ?? null,
        player: () => ({ x: +player.position.x.toFixed(2), y: +player.position.y.toFixed(2), z: +player.position.z.toFixed(2), facing: +player.facing.toFixed(3), camYaw: +rig.yaw.toFixed(3) }),
        boat: () => (boat ? { x: +boat.mesh.position.x.toFixed(2), y: +boat.mesh.position.y.toFixed(3), z: +boat.mesh.position.z.toFixed(2), pitch: +boat.mesh.rotation.x.toFixed(3), roll: +boat.mesh.rotation.z.toFixed(3), surface: +boat.pose.surface.toFixed(3), controlled: boat.controlled, arrival: arrival?.state ?? null } : null),
        boats: () => {
          let n = 0;
          scene.traverse((o) => {
            if (/rowboat/i.test(o.name)) n += 1;
          });
          return n;
        },
        stars: () => api.openStars(),
        award: (id) => {
          const r = badges.award(id);
          hud.setStars(badges.set);
          if (r.completedNow) loadCaseFiles().then(() => (overlayOpen ? (ceremonyPending = true) : runCeremony()));
          return r;
        },
        state: () => ({ cinematic, music: music?.mood ?? null, fireworks: fireworks ? Number(fireworks.duration.toFixed(1)) : null, stars: badges.value, overlay: overlayOpen, kind: caseFiles?.current?.kind ?? null, ceremony, train: train?.machine.state ?? (trainLoad ? 'loading' : 'none'), trainX: train?.machine.x ?? null }),
      };
      cleanups.push(() => delete window.__exploreDebug);
    }

    let last = performance.now();
    let debugAcc = 0;
    let frames = 0;
    let fps = 0;
    const tmpFocus = new Vector3();

    const frame = () => {
      const t = performance.now();
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const elapsed = now();

      // entering: pixelation dissolve from the case-file ink colour
      if (fadeIn < 1) {
        fadeIn = Math.min(1, fadeIn + dt / 0.9);
        post.uniforms.fade.value = 1 - fadeIn;
        if (!reducedMotion) post.uniforms.glitch.value = 0.8 * (1 - fadeIn);
      }

      // input + player
      const s = input.state;
      const iv = inputVector(s);
      const blocked = overlayOpen || ceremony || cinematic;
      const riding = Boolean(horse?.riding);
      if (input.take('whistle') && !blocked) whistle();
      sea.uniforms.phase.value += dt * sea.uniforms.wind.value; // the waves' phase (waves.js / sea.js)
      arrival?.update(dt); // drives the boat while the cinematic plays; splash timing afterwards
      boat?.update(dt); // moored: rides the waves (skipped while the arrival owns it)
      if (cinematic) {
        // the arrival moves the sheriff and the camera
      } else if (riding) {
        // In the saddle: W/S step the gait, A/D (or the stick) steer; the sheriff rides along.
        const steer = Math.max(-1, Math.min(1, (s.right ? 1 : 0) - (s.left ? 1 : 0) + s.x));
        horse.update(dt, blocked ? {} : { forward: s.forward || s.y > 0.35, back: s.back || s.y < -0.35, steer });
        input.take('jump'); // no jumping on horseback
        player.position.copy(horse.position);
        player.animate(dt);
      } else {
        const moveInput = blocked ? { x: 0, z: 0, magnitude: 0, run: false, jump: false } : { ...iv, run: s.run, jump: input.take('jump') };
        const body = horse?.obstacle();
        const ev = player.update(dt, moveInput, rig.yaw, surfaceUnder, body ? [body] : null);
        if (ev.footstep) {
          audio.footstep(ev.footstep);
          if (ev.footstep === 'sand') particles.puff(player.position.x, player.position.y, player.position.z);
        }
        if (ev.landed) particles.puff(player.position.x, player.position.y, player.position.z);
      }
      if (horse && !riding && !cinematic) horse.update(dt);
      if (input.take('interact') && !blocked) api.interact();

      if (!cinematic) {
        rig.setRide(riding, horse?.gallop ?? 0);
        hud.setLegend(riding ? 'ride' : 'walk');
        // Recentre behind him only while he goes forward (shouldRecentre in controller-math.js).
        const motion = riding ? { forward: horse.speed > 0.4 ? 1 : 0, sideways: 0, speed: Math.abs(horse.speed) } : { forward: blocked ? 0 : iv.z, sideways: blocked ? 0 : iv.x, speed: player.speed };
        rig.update(dt, player.position, riding ? horse.yaw : player.object.rotation.y, motion, town.bvh, elapsed);
      }
      if (import.meta.env.DEV && dev) dev.afterCamera(dt);

      // zones
      const near = nearestZone([player.position.x, player.position.y, player.position.z], zones, PLAYER.zoneRadius);
      // Prompt: the building first; otherwise Mount / Dismount near the horse.
      const ridingNow = Boolean(horse?.riding);
      const horsePrompt = !near && !cinematic && horse ? (ridingNow ? (Math.abs(horse.speed) < 1 ? 'Dismount' : null) : horse.near(player.position) ? 'Mount' : null) : null;
      const key = near ? near.zone : horsePrompt;
      if (key !== promptKey) {
        promptKey = key;
        hud.setPrompt(near ?? (horsePrompt ? { title: horsePrompt } : null));
        if (horsePrompt === 'Mount') hud.announce('Your horse. Press E to mount.');
      }
      if (near !== currentZone) {
        currentZone = near;
        if (near && near === station && train?.arrive()) duckFor('train', 0.4, 2.4);
        if (near) {
          hud.announce(`${near.title}. Press E to open.`);
          player.wave();
          glitch(0.12, 0.15);
          audio.blip();
        }
      }
      const next = currentZone ? null : nextUnvisited([player.position.x, 0, player.position.z], zones, badges.set);
      hud.setArrow(next ? arrowAngle([player.position.x, 0, player.position.z], next.door, rig.yaw) : null, next ? next.title : '');

      // time of day
      if (!tState.done) {
        tState = stepTransition(tState, dt, 2);
        palette = applyPalette(tState.t);
      }

      // character key light: the nearest lantern warms the sheriff at night (shader-only, see rimMaterial)
      let best = Infinity;
      for (const l of town.lanterns) {
        const d = l.distanceToSquared(player.position);
        if (d < best) {
          best = d;
          rimU.keyDir.value.copy(l).sub(player.position).normalize();
        }
      }
      const dist = Math.sqrt(best);
      rimU.key.value = palette.lanternIntensity * Math.min(1, Math.max(0, (9 - dist) / 6));

      // the train: load when close to the station, then run it
      if (station && stationLandmark?.train && !trainLoad && Math.hypot(player.position.x - station.door[0], player.position.z - station.door[2]) < 24) loadTrain();
      if (train) {
        for (const e of train.update(dt, palette.t)) {
          if (e === 'openOverlay' && !overlayOpen && !ceremony) openCase(station);
          if (e === 'departing') duckFor('train', 0.4, 2.4);
        }
        if (train.blocks(player.position)) {
          if (horse?.riding) horse.teleport(player.position.x, stationLandmark.train.rail_z - 3);
          else player.teleport([player.position.x, player.position.y, stationLandmark.train.rail_z - 2.4]);
        }
      }
      if (fireworks) {
        fireworks.update(dt);
        if (fireworks.done) {
          fireworks.dispose();
          fireworks = null;
        }
      }

      // world systems
      tmpFocus.copy(player.position);
      if (import.meta.env.DEV && dev?.focus()) tmpFocus.copy(dev.focus());
      lights.update(tmpFocus, elapsed, camera.position);
      if (!postersLoad && bountyZone && Math.hypot(tmpFocus.x - bountyZone.center[0], tmpFocus.z - bountyZone.center[2]) < BOUNTY_POSTERS.near) loadPosters();
      particles.update(tmpFocus, elapsed);
      ambient.update(dt, elapsed);
      sky.mesh.position.copy(camera.position);
      const gust = 1 + Math.sin(elapsed * 0.31) * 0.35 + Math.sin(elapsed * 1.13) * 0.15;
      particles.shared.wind.value.set(Math.cos(elapsed * 0.05) * 1.4 * gust, 0, Math.sin(elapsed * 0.05) * 0.6 * gust);
      ambient.wind.value = gust;
      sea.uniforms.wind.value = 0.9 + 0.2 * gust;
      const shore = Math.min(1, Math.max(0, (Math.hypot(player.position.x, player.position.z) - 25) / 30));
      audio.update(palette.t, shore, gust - 0.5);

      // post uniforms
      const pu = post.uniforms;
      pu.ca.value = Math.min(1, player.speed / PLAYER.runSpeed) * 0.9;
      // DOF: everything up to ~30 m past the player stays sharp (post.js clamps the near field); only
      // the far mesas and sea soften, gently.
      pu.focus.value = rig.distance + 24;
      pu.focal.value = 70;
      if (glitchT > 0) {
        glitchT -= dt;
        if (glitchT <= 0) pu.glitch.value = 0;
        else pu.glitch.value *= 0.9;
      }

      // adaptive resolution
      const r = import.meta.env.DEV && dev ? { scale: resScale, changed: false, wantLowerTier: false } : adaptive.update(dt);
      if (r.changed) {
        resScale = r.scale;
        renderer.setPixelRatio(basePR() * resScale);
      }
      if (r.wantLowerTier && quality === 'auto' && tier !== 'LOW') {
        rebuildQuality(lowerTier(tier));
        hud.announce(`Graphics lowered to ${tier} to keep it smooth.`);
      }

      if (import.meta.env.DEV && dev) dev.beforeRender(dt);
      if (!(import.meta.env.DEV && dev?.skipRender)) post.render();

      // debug overlay
      frames += 1;
      debugAcc += dt;
      if (debugAcc >= 0.5) {
        fps = Math.round(frames / debugAcc);
        frames = 0;
        debugAcc = 0;
        if (debug) {
          const info = renderer.info.render;
          hud.debug(
            [
              `fps ${fps}`,
              `backend ${backend}${software ? ' (software)' : ''}`,
              `adapter ${adapter.slice(0, 48)}`,
              `tier ${tier}${quality === 'auto' ? ' (auto)' : ''}  scale ${resScale.toFixed(2)}`,
              `draw calls ${info.drawCalls}  triangles ${info.triangles}`,
              `dust ${particles.dustMode}  lanterns ${settings.lanterns}`,
              `effects ${post.enabled.join(', ')}`,
              `pos ${player.position.x.toFixed(1)} ${player.position.y.toFixed(1)} ${player.position.z.toFixed(1)}`,
            ].join('\n'),
          );
        }
        window.__explore = { debug, fps, backend, adapter, tier, software, drawCalls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles, effects: post.enabled, scale: resScale, ready: true, dust: particles.dustMode };
      }
    };

    listen(document, 'visibilitychange', () => {
      if (import.meta.env.DEV && dev) return; // capture steps frames itself
      if (document.hidden) {
        renderer.setAnimationLoop(null);
        audio.suspend();
        music?.pause();
      } else {
        last = performance.now();
        renderer.setAnimationLoop(frame);
        audio.resume();
        music?.resume();
      }
    });
    if (import.meta.env.DEV && dev) {
      dev.attach({
        frame,
        renderer,
        scene,
        camera,
        player,
        input,
        sky,
        boat,
        loaders,
        audio,
        standAt,
        stationLandmark,
        signal: abort.signal,
        post: () => post,
        palette: () => palette,
        horse: () => horse,
        loadHorse,
        loadPosters,
        runArrival: () => runArrival(false),
        setTime: (t) => {
          night = t > 0.5;
          tState = startTransition(t, t);
          tState.progress = 1;
          palette = applyPalette(t);
        },
      });
    } else renderer.setAnimationLoop(frame);
  })().catch((error) => {
    console.error('[explore]', error);
    if (!disposed) hud.showError('Something went wrong in the 3D town. The Classic portfolio has everything.');
  });

  return { dispose };
}
