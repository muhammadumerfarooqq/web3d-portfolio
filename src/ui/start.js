// First-visit intro (placeholder sting, or public/video/intro.mp4 when it exists) and the start
// screen (sound + mode). Without JS neither exists: the Classic page is simply shown.
// Stored values are whitelisted: intro ∈ {"seen"}; sound and mode via their own modules.
import gsap from 'gsap';
import { bootPlan, readIntro, writeIntro } from './boot-rules.js';
import { setupDialog } from './dialog.js';
import { getLenis } from './motion.js';
import { canOfferExplore, chooseMode, getCapabilities, readMode } from './mode.js';
import { readSound, setSound } from './sound.js';

const STING_SECONDS = 6;

function setBackgroundInert(on) {
  for (const el of document.querySelectorAll('[data-inert-when-menu], .skip-link')) el.inert = on;
}

/** Placeholder sting: an ink band wipes the poster, UMER drops in letter by letter, then the tagline (~6 s). */
function playSting(intro, onDone) {
  const tl = gsap.timeline({ onComplete: onDone });
  const sweep = intro.querySelector('.intro__sweep');
  tl.fromTo(sweep, { xPercent: -105, opacity: 1 }, { xPercent: 105, duration: 1.5, ease: 'power3.inOut' }, 0.15)
    .set(sweep, { opacity: 0 })
    // Letters land with a small thud, from a faint, offset state rather than from opacity 0, so
    // the first frame already has contentful text (Chrome's LCP ignores opacity-0 text).
    .from(intro.querySelectorAll('.intro__letter'), { yPercent: -60, opacity: 0.12, duration: 0.55, stagger: 0.16, ease: 'back.out(2.2)' }, 0.5)
    .from(intro.querySelector('.intro__tagline'), { y: 10, opacity: 0.12, duration: 0.6, ease: 'power3.out' }, 1.8)
    .to(intro.querySelector('.intro__stage'), { opacity: 0, duration: 0.5, ease: 'power2.in' }, STING_SECONDS - 0.5);
  return () => tl.kill();
}

function playVideo(video, onDone) {
  video.addEventListener('ended', onDone, { once: true });
  video.play().catch(onDone);
  return () => video.pause();
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

  const plan = bootPlan({ introSeen: readIntro() === 'seen', storedMode: readMode(), reducedMotion: reduced });
  const caps = getCapabilities();
  const exploreOffered = canOfferExplore(caps);

  // ── Start screen ──
  const returning = dialog.querySelectorAll('[data-start-returning]');
  const choices = dialog.querySelector('[data-start-choices]');
  const status = dialog.querySelector('[data-start-status]');
  const summary = dialog.querySelector('[data-start-summary]');
  const options = [...dialog.querySelectorAll('[data-mode-option]')];
  const exploreNote = dialog.querySelector('[data-explore-note]');
  let preferred = readMode() ?? 'classic';

  if (!exploreOffered) {
    exploreNote.textContent = caps.webgl2 ? 'Classic is used with reduced motion or Data Saver' : 'Needs WebGL2 · Classic only';
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
        status.textContent = 'Saved: the island opens here once it is ready (P3). Classic for now.';
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
      summary.textContent = `${readMode() === 'explore' ? 'Classic (Explore saved)' : 'Classic'} · sound ${readSound()}`;
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

    let stop = () => {};
    const done = () => {
      stop();
      document.removeEventListener('keydown', onKey);
      writeIntro('seen');
      root.dataset.boot = 'start';
      intro.hidden = true;
      openStart();
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        done();
      }
    };
    document.addEventListener('keydown', onKey);
    skip.addEventListener('click', done, { once: true });

    const video = intro.querySelector('[data-intro-video]');
    stop = video ? playVideo(video, done) : playSting(intro, done);
  }

  if (plan.showIntro) runIntro();
  else openStart();
}
