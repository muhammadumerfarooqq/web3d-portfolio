// Explore ⇄ Classic mode shell: the single place that sets html[data-mode] and dispatches
// "modechange". P3 hooks the 3D island in here. Rules are pure functions (unit-tested).
import { readPref, writePref } from './prefs.js';

export const MODE_KEY = 'mode';
export const MODE_VALUES = ['classic', 'explore'];
/** Flipped to true in P3 when the island exists. Until then Explore is a stored preference only. */
export const EXPLORE_READY = false;

export const readMode = (storage) => readPref(MODE_KEY, MODE_VALUES, null, storage);
export const writeMode = (value, storage) => writePref(MODE_KEY, value, MODE_VALUES, storage);

/** Explore is offered only with WebGL2, and never under reduced motion or Save-Data. */
export function canOfferExplore({ webgl2 = false, reducedMotion = false, saveData = false } = {}) {
  return Boolean(webgl2) && !reducedMotion && !saveData;
}

/** The mode actually shown: Classic unless Explore is stored, offered and ready. */
export function resolveMode(stored, caps, ready = EXPLORE_READY) {
  return stored === 'explore' && ready && canOfferExplore(caps) ? 'explore' : 'classic';
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

export function initMode() {
  applyMode(resolveMode(readMode(), getCapabilities()));
  // Header "Explore island": routed through here; inert until EXPLORE_READY (P3).
  for (const button of document.querySelectorAll('[data-mode-toggle]')) {
    button.addEventListener('click', () => {
      if (!EXPLORE_READY) return;
      chooseMode(currentMode() === 'explore' ? 'classic' : 'explore');
    });
  }
}
