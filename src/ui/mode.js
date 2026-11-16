// Explore ⇄ Classic mode shell: the single place that sets html[data-mode] and dispatches
// "modechange". Explore (the 3D town, src/explore/) is a lazy chunk imported only here, when the
// effective mode becomes "explore"; leaving disposes it completely. Rules are pure functions
// (unit-tested).
import { sectionScrollY } from './scroll-rules.js';
import { readPref, writePref } from './prefs.js';
import { readSound } from './sound.js';

export const MODE_KEY = 'mode';
export const MODE_VALUES = ['classic', 'explore'];
/** P3: the island exists. */
export const EXPLORE_READY = true;

export const readMode = (storage) => readPref(MODE_KEY, MODE_VALUES, null, storage);
export const writeMode = (value, storage) => writePref(MODE_KEY, value, MODE_VALUES, storage);

/**
 * Launch parameters, captured once at start-up (the gallery's URL-state hygiene later removes keys it
 * does not own). Whitelisted values only: mode ∈ {classic, explore}, debug = "1", backend = "webgl".
 */
export function launchParams(search = typeof window === 'undefined' ? '' : window.location.search) {
  const p = new URLSearchParams(search);
  const mode = p.get('mode');
  return {
    mode: MODE_VALUES.includes(mode) ? mode : null,
    debug: p.get('debug') === '1',
    forceWebGL: p.get('backend') === 'webgl',
  };
}
const LAUNCH = launchParams();

/** `?mode=explore` / `?mode=classic` (anything else is ignored). */
export function urlMode(search) {
  return search === undefined ? LAUNCH.mode : launchParams(search).mode;
}

/** Explore is offered only with WebGL2, and never under reduced motion or Save-Data. */
export function canOfferExplore({ webgl2 = false, reducedMotion = false, saveData = false } = {}) {
  return Boolean(webgl2) && !reducedMotion && !saveData;
}

/** The mode actually shown: Classic unless Explore is stored, offered and ready. */
export function resolveMode(stored, caps, ready = EXPLORE_READY) {
  return stored === 'explore' && ready && canOfferExplore(caps) ? 'explore' : 'classic';
}

/** Why Explore is not offered (shown next to the disabled choice), or null when it is. */
export function exploreUnavailableReason(caps) {
  if (canOfferExplore(caps)) return null;
  if (!caps.webgl2) return 'Needs WebGL2 · Classic only';
  if (caps.reducedMotion) return 'Off with reduced motion · Classic has the same content';
  return 'Off with Data Saver · Classic has the same content';
}

/** Feature detection only: a WebGL2 context is created, checked and released at once. */
export function detectCapabilities(win = window) {
  let webgl2 = false;
  try {
    const gl = win.document.createElement('canvas').getContext('webgl2');
    webgl2 = Boolean(gl);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webgl2 = false;
  }
  return {
    webgl2,
    reducedMotion: win.matchMedia('(prefers-reduced-motion: reduce)').matches,
    saveData: Boolean(win.navigator.connection?.saveData),
  };
}

let capabilities = null;
export const getCapabilities = () => (capabilities ??= detectCapabilities());

export function currentMode() {
  return document.documentElement.dataset.mode === 'explore' ? 'explore' : 'classic';
}

function applyMode(mode) {
  const next = MODE_VALUES.includes(mode) ? mode : 'classic';
  const changed = document.documentElement.dataset.mode !== next;
  document.documentElement.dataset.mode = next;
  if (changed) window.dispatchEvent(new CustomEvent('modechange', { detail: { mode: next } }));
  return next;
}

/**
 * Record the visitor's preferred mode (if allowed) and apply the effective one.
 * Returns { preferred, effective, offered }.
 */
export function chooseMode(preferred) {
  const caps = getCapabilities();
  const offered = canOfferExplore(caps);
  const stored = preferred === 'explore' && !offered ? 'classic' : preferred;
  writeMode(MODE_VALUES.includes(stored) ? stored : 'classic');
  return { preferred: stored, effective: applyMode(resolveMode(stored, caps)), offered };
}

// ── Explore session (lazy chunk) ──
let session = null;
let starting = null;
let returnFocus = null;

function setClassicInert(on) {
  // (motion.js pauses smooth scrolling itself on "modechange")
  for (const el of document.querySelectorAll('[data-inert-when-menu], .skip-link')) el.inert = on;
}

function leaveExplore(anchor) {
  chooseMode('classic');
  if (anchor) {
    const target = document.querySelector(anchor);
    // The section's heading lands just below the sticky header (scroll-rules.js), as with nav links.
    if (target) window.scrollTo({ top: sectionScrollY(target), behavior: 'auto' });
    target?.focus?.({ preventScroll: true });
  }
}

async function startSession() {
  if (session || starting) return;
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  setClassicInert(true);
  starting = import('../explore/index.js')
    .then((m) => m.startExplore({ onExit: leaveExplore, soundOn: readSound() === 'on', reducedMotion: getCapabilities().reducedMotion, debug: LAUNCH.debug, forceWebGL: LAUNCH.forceWebGL }))
    .then((s) => {
      if (currentMode() !== 'explore') s.dispose(); // left while it was starting
      else session = s;
    })
    .catch((error) => {
      console.error('[mode] Explore failed to start', error);
      chooseMode('classic');
    })
    .finally(() => {
      starting = null;
    });
  await starting;
}

function endSession() {
  session?.dispose();
  session = null;
  setClassicInert(false);
  const usable = returnFocus && returnFocus !== document.body && returnFocus.isConnected && !returnFocus.closest('[data-explore]');
  const back = usable ? returnFocus : document.querySelector('.site-header [data-mode-toggle]');
  back?.focus?.({ preventScroll: true });
  returnFocus = null;
}

export function initMode() {
  const caps = getCapabilities();
  // With the start screen up, Classic shows until the visitor enters (start.js calls chooseMode);
  // without it (no boot layer) the stored or URL choice applies at once.
  const booting = Boolean(document.documentElement.dataset.boot);
  applyMode(booting ? 'classic' : resolveMode(urlMode() ?? readMode(), caps));
  window.addEventListener('modechange', (e) => {
    if (e.detail.mode === 'explore') startSession();
    else endSession();
  });
  if (currentMode() === 'explore') startSession();

  const reason = exploreUnavailableReason(caps);
  for (const button of document.querySelectorAll('[data-mode-toggle]')) {
    const tip = button.getAttribute('aria-describedby') && document.getElementById(button.getAttribute('aria-describedby'));
    if (reason) {
      button.setAttribute('aria-disabled', 'true');
      if (tip) tip.textContent = reason;
    } else {
      button.removeAttribute('aria-disabled');
      if (tip) tip.textContent = 'Walk the 3D town';
    }
    button.addEventListener('click', () => {
      if (!canOfferExplore(caps)) return;
      // From the mobile menu: close it first so Classic is tidy when the visitor comes back.
      if (button.closest('[data-menu]')) document.querySelector('[data-menu-close]')?.click();
      chooseMode(currentMode() === 'explore' ? 'classic' : 'explore');
    });
  }
}
