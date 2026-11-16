// First-visit opening (P3.3: a ~3.5 s desert scene in HTML/SVG + Canvas 2D dust, or
// public/video/intro.mp4 when it exists) and the start screen (sound + mode). Without JS neither
// exists: the Classic page is simply shown. Stored values are whitelisted: intro ∈ {"seen"}; sound
// and mode via their own modules. Reduced motion: a static title card under the start screen.
// P3.4b: the opening plays once per browser session (sessionStorage) or with ?replay=1; it waits for
// the tab to be visible and the fonts (capped) before it starts, pauses while the tab is hidden, and
// start.js always sets html[data-boot] itself, so it can never run invisibly and be marked seen.
import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { bootPlan, introSeenThisSession, isSkipKey, writeIntro, writeIntroSession } from './boot-rules.js';
import { setupDialog } from './dialog.js';
import { getLenis } from './motion.js';
import { canOfferExplore, chooseMode, exploreUnavailableReason, getCapabilities, readMode, urlMode } from './mode.js';
import { readSound, setSound } from './sound.js';

export const OPENING_SECONDS = 3.6;

function setBackgroundInert(on) {
  for (const el of document.querySelectorAll('[data-inert-when-menu], .skip-link')) el.inert = on;
}

/** Drifting dust on a Canvas 2D layer (warm at dawn, pale under the moon). Returns a stop function. */
function startDust(canvas) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) return () => {};
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = (canvas.width = Math.round(canvas.clientWidth * dpr));
  const h = (canvas.height = Math.round(canvas.clientHeight * dpr));
  const colour = document.documentElement.dataset.theme === 'dark' ? '220, 228, 255' : '255, 236, 205';
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const motes = Array.from({ length: 70 }, () => ({ x: rnd() * w, y: h * (0.35 + rnd() * 0.65), r: (0.6 + rnd() * 1.8) * dpr, v: (12 + rnd() * 30) * dpr, a: 0.15 + rnd() * 0.45, p: rnd() * 6.28 }));
  let raf = 0;
  let last = performance.now();
  const born = last;
  const draw = (now) => {
    // Nothing on the canvas for the first 0.4 s: the word, not the dust, is the first contentful paint.
    if (now - born < 400) {
      last = now;
      raf = requestAnimationFrame(draw);
      return;
    }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, w, h);
    for (const m of motes) {
      m.x += m.v * dt;
      m.p += dt * 1.3;
      if (m.x > w + 4) m.x = -4;
      ctx.fillStyle = `rgba(${colour}, ${m.a})`;
      ctx.beginPath();
      ctx.arc(m.x, m.y + Math.sin(m.p) * 6 * dpr, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
}

/**
 * The opening: the sun (or moon) rises, the sheriff star is stamped down with a small screen shake
 * (≤ 4 px), UMER slams in letter by letter, the tagline types out, then the scene fades (~3.6 s).
 * Transform and opacity only.
 */
function playOpening(intro, onDone) {
  const stage = intro.querySelector('[data-opening]');
  const centre = intro.querySelector('.intro__center');
  let stopDust = () => {};
  const split = SplitText.create(intro.querySelector('.intro__tagline'), { type: 'words,chars' }); // words keep line breaks between words
  // Built paused: runIntro starts it once the tab is visible and the fonts are in (see whenReady).
  const tl = gsap.timeline({ onComplete: onDone, paused: true });
  const shake = (at) => tl.to(centre, { keyframes: [{ x: 4, y: -2 }, { x: -3, y: 2 }, { x: 2, y: -1 }, { x: 0, y: 0 }], duration: 0.24, ease: 'none' }, at);
  tl.fromTo(intro.querySelector('.intro__sun'), { y: '26vh' }, { y: '0vh', duration: OPENING_SECONDS, ease: 'power1.out' }, 0)
    .fromTo(intro.querySelector('.intro__badge'), { scale: 3.2, rotation: -32, opacity: 0 }, { scale: 1, rotation: -8, opacity: 1, duration: 0.3, ease: 'power4.in' }, 0.3);
  shake(0.6);
  tl.fromTo(intro.querySelectorAll('.intro__letter'), { scale: 1.15, yPercent: -34, opacity: 0.12 }, { scale: 1, yPercent: 0, opacity: 1, duration: 0.3, stagger: 0.08, ease: 'power4.in' }, 0.95);
  shake(1.55);
  tl.set(intro.querySelector('.intro__tagline'), { opacity: 1 }, 1.7)
    .from(split.chars, { opacity: 0, duration: 0.01, stagger: 0.042, ease: 'none' }, 1.7)
    .to(stage, { opacity: 0, duration: 0.35, ease: 'power2.in' }, OPENING_SECONDS - 0.35);
  let started = false;
  return {
    play() {
      if (!started) stopDust = startDust(intro.querySelector('[data-intro-dust]'));
      started = true;
      tl.play();
    },
    pause: () => tl.pause(),
    stop() {
      tl.kill();
      stopDust();
      split.revert();
    },
  };
}

/** Resolves when the tab is visible and the web fonts are in (fonts capped at 1.5 s; visibility not). */
function whenReady() {
  const fonts = Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 1500))]);
  const visible = () =>
    new Promise((resolve) => {
      if (document.visibilityState !== 'hidden') return resolve();
      const onChange = () => {
        if (document.visibilityState === 'hidden') return;
        document.removeEventListener('visibilitychange', onChange);
        resolve();
      };
      document.addEventListener('visibilitychange', onChange);
    });
  return fonts.then(visible);
}

function playVideo(video, onDone) {
  video.addEventListener('ended', onDone, { once: true });
  return { play: () => video.play().catch(onDone), pause: () => video.pause(), stop: () => video.pause() };
}

export function initStart(options) {
  try {
    boot(options);
  } catch (error) {
    // Never leave the page covered: drop the boot layer and show Classic.
    delete document.documentElement.dataset.boot;
    document.querySelector('[data-intro]')?.setAttribute('hidden', '');
    setBackgroundInert(false);
    window.dispatchEvent(new CustomEvent('bootdone'));
    throw error;
  }
}

function boot({ reduced }) {
  const root = document.documentElement;
  const intro = document.querySelector('[data-intro]');
  const dialog = document.querySelector('[data-start]');
  if (!intro || !dialog) {
    delete root.dataset.boot;
    window.dispatchEvent(new CustomEvent('bootdone'));
    return;
  }

  const plan = bootPlan({ introSeen: introSeenThisSession(), storedMode: readMode(), reducedMotion: reduced });
  // start.js owns the boot layer from here: theme-init.js guessed it before paint, and its 4 s
  // failsafe may already have dropped it on a slow load; either way the layer now matches the plan.
  root.dataset.boot = plan.showIntro ? 'intro' : 'start';
  const caps = getCapabilities();
  const exploreOffered = canOfferExplore(caps);

  // ── Start screen ──
  const returning = dialog.querySelectorAll('[data-start-returning]');
  const choices = dialog.querySelector('[data-start-choices]');
  const status = dialog.querySelector('[data-start-status]');
  const summary = dialog.querySelector('[data-start-summary]');
  const options = [...dialog.querySelectorAll('[data-mode-option]')];
  const exploreNote = dialog.querySelector('[data-explore-note]');
  let preferred = urlMode() ?? readMode() ?? 'classic';

  if (!exploreOffered) {
    exploreNote.textContent = exploreUnavailableReason(caps);
    if (preferred === 'explore') preferred = 'classic';
  }

  const syncOptions = () => {
    for (const o of options) o.setAttribute('aria-pressed', String(o.dataset.modeOption === preferred));
  };

  const ui = setupDialog(dialog, {
    onRequestClose: () => enter(readSound()), // Esc keeps the current sound setting
  });

  function finish() {
    delete root.dataset.boot;
    setBackgroundInert(false);
    getLenis()?.start();
    window.dispatchEvent(new CustomEvent('bootdone'));
  }

  function enter(sound) {
    setSound(sound);
    chooseMode(preferred);
    finish(); // background un-inert first: the dialog's close handler returns focus to the skip link
    ui.close();
  }

  for (const o of options) {
    o.addEventListener('click', () => {
      if (o.dataset.modeOption === 'explore') {
        if (!exploreOffered) {
          status.textContent = 'Explore needs WebGL2 and full motion. Classic it is.';
          return;
        }
        preferred = 'explore';
        status.textContent = 'Explore the island selected: the 3D town loads when you enter.';
      } else {
        preferred = 'classic';
        status.textContent = 'Classic portfolio selected.';
      }
      syncOptions();
    });
  }
  for (const b of dialog.querySelectorAll('[data-start-enter]')) b.addEventListener('click', () => enter(b.dataset.startEnter));
  dialog.querySelector('[data-start-continue]')?.addEventListener('click', () => enter(readSound()));
  dialog.querySelector('[data-start-change]')?.addEventListener('click', () => {
    for (const el of returning) el.hidden = true;
    choices.hidden = false;
    options.find((o) => o.getAttribute('aria-pressed') === 'true')?.focus();
  });

  function openStart() {
    syncOptions();
    const isReturning = plan.startVariant === 'returning';
    for (const el of returning) el.hidden = !isReturning;
    choices.hidden = isReturning;
    if (isReturning) {
      summary.textContent = `${readMode() === 'explore' ? 'Explore the island' : 'Classic'} · sound ${readSound()}`;
    }
    // Focus goes back to the top of the page (the skip link), so the next Tab reaches the nav.
    ui.open(document.querySelector('.skip-link'));
    (isReturning ? dialog.querySelector('[data-start-continue]') : dialog.querySelector('[data-start-enter="off"]'))?.focus();
  }

  // ── Intro ──
  function runIntro() {
    intro.hidden = false;
    setBackgroundInert(true);
    getLenis()?.stop();
    const skip = intro.querySelector('[data-intro-skip]');
    skip.focus();

    let player = null;
    let finished = false;
    // A hidden tab pauses the opening (the GSAP ticker has no lag smoothing, so it would otherwise
    // jump to the end on return and count as seen without being seen).
    const onVisibility = () => {
      if (!player || finished) return;
      if (document.visibilityState === 'hidden') player.pause();
      else player.play();
    };
    const done = () => {
      if (finished) return;
      finished = true;
      player?.stop();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      intro.removeEventListener('pointerdown', onPointer);
      writeIntroSession('seen');
      writeIntro('seen'); // the P2 key stays whitelisted and written; it no longer blocks the opening
      root.dataset.boot = 'start';
      intro.hidden = true;
      openStart();
    };
    // Skip: the button, Esc or any other key (not Tab / modifiers), or a click anywhere.
    const onKey = (event) => {
      if (!isSkipKey(event.key)) return;
      event.preventDefault();
      done();
    };
    const onPointer = () => done();
    document.addEventListener('keydown', onKey);
    intro.addEventListener('pointerdown', onPointer);
    skip.addEventListener('click', done, { once: true });

    const video = intro.querySelector('[data-intro-video]');
    player = video ? playVideo(video, done) : playOpening(intro, done);
    document.addEventListener('visibilitychange', onVisibility);
    whenReady().then(() => {
      if (!finished && document.visibilityState !== 'hidden') player.play();
    });
  }

  // Reduced motion, first visit: the opening's final frame as a still title card behind the start screen.
  function showStaticCard() {
    if (intro.querySelector('[data-intro-video]')) return;
    intro.classList.add('is-static');
    intro.querySelector('[data-intro-skip]')?.setAttribute('hidden', '');
    intro.hidden = false;
    writeIntroSession('seen');
    writeIntro('seen');
    dialog.addEventListener(
      'close',
      () => {
        intro.hidden = true;
        intro.classList.remove('is-static');
      },
      { once: true },
    );
  }

  if (plan.showIntro) runIntro();
  else {
    if (plan.staticCard) showStaticCard();
    openStart();
  }
}
