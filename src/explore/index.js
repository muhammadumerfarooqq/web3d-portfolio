// Explore mode entry (lazy chunk; imported only by src/ui/mode.js when Explore starts).
// startExplore() builds the renderer (three/webgpu: WebGPU, falling back to WebGL2), loads the town
// and the sheriff, wires the controller, camera, zones, HUD, audio and post-processing, and returns
// { dispose } which frees every GPU and DOM resource (repeated Classic ⇄ Explore toggles do not leak).
import './explore.css';
import { ACESFilmicToneMapping, Scene, Vector3, WebGPURenderer } from 'three/webgpu';
import { readPref, writePref } from '../ui/prefs.js';
import { setSound } from '../ui/sound.js';
import { createAmbient } from './ambient.js';
import { createAudio } from './audio.js';
import { BADGES_EMPTY, BADGES_KEY, BADGES_VALUES, createBadges } from './badges.js';
import { createCameraRig } from './camera-rig.js';
import { PLAYER, QUALITY_KEY, QUALITY_VALUES, TIERS, TIME_KEY, TIME_VALUES, TOWN_JSON_URL, TUTORIAL_KEY, TUTORIAL_VALUES } from './config.js';
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
export async function startExplore({ onExit, soundOn = false, reducedMotion = false, debug = false, forceWebGL = false } = {}) {
  const touch = window.matchMedia('(pointer: coarse)').matches;
  let quality = readQuality();
  let night = (readTime() ?? 'night') === 'night'; // night is the hero and the default
  const showTutorial = readTutorial() !== 'done';

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
    night,
    touch,
    debug,
    showTutorial,
    onExit: () => onExit(),
    onTravel: (z) => api?.travel(z),
    onSound: (on) => setSound(on ? 'on' : 'off'),
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
      renderer = new WebGPURenderer({ antialias: false, forceWebGL });
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
    let post = createPost({ renderer, scene, camera, settings, sun: lights.sun, sky, particles, reducedMotion });
    const audio = createAudio({ enabled: soundOn });

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
      onKey: (action, down) => {
        audio.unlock();
        if (tutorialOpen) {
          hud.keycap(action, down);
          if (down && hud.tutorialDone()) setTimeout(() => api?.finishTutorial(), 600);
        }
      },
    });
    listen(window, 'pointerdown', () => audio.unlock(), { passive: true });
    listen(window, 'soundchange', (e) => {
      audio.setEnabled(e.detail.sound === 'on');
      hud.setSound(e.detail.sound === 'on');
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
      post = createPost({ renderer, scene, camera, settings, sun: lights.sun, sky, particles, reducedMotion });
      post.uniforms.fade.value = 0;
      post.uniforms.glitch.value = reducedMotion ? 0 : 0.4;
      glitchT = 0.35;
      // The shadow map is resized in place (the god-ray node keeps a reference to it).
      if (lights.sun.castShadow && settings.shadowMap > 0) lights.sun.shadow.mapSize.set(settings.shadowMap, settings.shadowMap);
      renderer.setPixelRatio(basePR() * resScale);
      fireworks?.setEmissiveMrt(settings.bloom === 'full');
      palette = applyPalette(tState.t);
    };

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
            input.setPaused(open || ceremony);
            if (info?.zone === 'journey') {
              if (open) train?.overlayOpened();
              else train?.overlayClosed();
            }
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
      input.setPaused(true);
      hud.setCinematic(true);
      hud.announce('Case closed. Every case on Byte Island is closed.');
      try {
        const { createFireworks, showOrigin } = await import('./fireworks.js');
        if (disposed) return;
        fireworks?.dispose();
        fireworks = createFireworks({ scene, origin: showOrigin(camera, player.position), reducedMotion, audio, emissiveMrt: settings.bloom === 'full' });
        rig.setView({ pitch: 0.06, distance: Math.max(rig.distance, 8) });
        setTimeout(() => player.wave(true), 350);
        await caseFiles.stamp();
        await new Promise((r) => setTimeout(r, reducedMotion ? 300 : 1800));
      } catch (error) {
        console.error('[explore] ceremony', error);
      }
      if (disposed) return;
      ceremony = false;
      hud.setCinematic(false);
      caseFiles.openCertificate();
    }

    // The train loads only once the sheriff is near the station; it arrives on entering the zone.
    const station = zones.find((z) => z.zone === 'journey');
    const loadTrain = () =>
      (trainLoad ??= import('./train.js')
        .then((m) => m.createTrain({ loaders, scene, station: stationLandmark, audio, reducedMotion, signal: abort.signal }))
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
        if (!currentZone || overlayOpen || ceremony) return;
        audio.blip();
        window.dispatchEvent(new CustomEvent('explore:zone', { detail: { zone: currentZone.zone, title: currentZone.title, anchor: currentZone.anchor } }));
        openCase(currentZone);
      },
      /** Star counter: the certificate at 8/8, otherwise the case board. */
      openStars() {
        if (ceremony) return;
        loadCaseFiles().then((cf) => (badges.complete ? cf?.openCertificate() : cf?.openBoard()));
      },
      destroy() {
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

    if (debug) {
      // Screenshot / QA hooks, only with ?debug=1.
      window.__exploreDebug = {
        teleport: (x, z, yaw) => player.teleport([x, (groundAt(x, z) ?? 0) + 0.2, z], yaw),
        view: (o) => rig.setView(o),
        night: (n) => api.setNight(n, true),
        quality: (q) => api.setQuality(q),
        open: (id) => openCase(zones.find((z) => z.zone === id)),
        stars: () => api.openStars(),
        award: (id) => {
          const r = badges.award(id);
          hud.setStars(badges.set);
          if (r.completedNow) loadCaseFiles().then(() => (overlayOpen ? (ceremonyPending = true) : runCeremony()));
          return r;
        },
        state: () => ({ fireworks: fireworks ? Number(fireworks.duration.toFixed(1)) : null, stars: badges.value, overlay: overlayOpen, kind: caseFiles?.current?.kind ?? null, ceremony, train: train?.machine.state ?? (trainLoad ? 'loading' : 'none'), trainX: train?.machine.x ?? null }),
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
      const blocked = overlayOpen || ceremony;
      const moveInput = blocked ? { x: 0, z: 0, magnitude: 0, run: false, jump: false } : { ...iv, run: s.run, jump: input.take('jump') };
      const ev = player.update(dt, moveInput, rig.yaw, surfaceUnder);
      if (ev.footstep) {
        audio.footstep(ev.footstep);
        if (ev.footstep === 'sand') particles.puff(player.position.x, player.position.y, player.position.z);
      }
      if (ev.landed) particles.puff(player.position.x, player.position.y, player.position.z);
      if (input.take('interact') && !blocked) api.interact();

      const moving = player.speed > 0.4;
      rig.update(dt, player.position, player.object.rotation.y, moving, town.bvh, elapsed);

      // zones
      const near = nearestZone([player.position.x, player.position.y, player.position.z], zones, PLAYER.zoneRadius);
      if (near !== currentZone) {
        currentZone = near;
        hud.setPrompt(near);
        if (near && near === station) train?.arrive();
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
        for (const e of train.update(dt, palette.t)) if (e === 'openOverlay' && !overlayOpen && !ceremony) openCase(station);
        if (train.blocks(player.position)) player.teleport([player.position.x, player.position.y, stationLandmark.train.rail_z - 2.4]);
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
      lights.update(tmpFocus, elapsed, camera.position);
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
      const r = adaptive.update(dt);
      if (r.changed) {
        resScale = r.scale;
        renderer.setPixelRatio(basePR() * resScale);
      }
      if (r.wantLowerTier && quality === 'auto' && tier !== 'LOW') {
        rebuildQuality(lowerTier(tier));
        hud.announce(`Graphics lowered to ${tier} to keep it smooth.`);
      }

      post.render();

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
      if (document.hidden) {
        renderer.setAnimationLoop(null);
        audio.suspend();
      } else {
        last = performance.now();
        renderer.setAnimationLoop(frame);
        audio.resume();
      }
    });
    renderer.setAnimationLoop(frame);
  })().catch((error) => {
    console.error('[explore]', error);
    if (!disposed) hud.showError('Something went wrong in the 3D town. The Classic portfolio has everything.');
  });

  return { dispose };
}
