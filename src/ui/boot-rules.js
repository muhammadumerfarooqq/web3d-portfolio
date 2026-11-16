// Pure first-visit rules for src/ui/start.js (no DOM; unit-tested in tests/start.test.js).
// public/theme-init.js mirrors introSeenThisSession() before first paint: keep the two in step.
import { readPref, sessionStore, writePref } from './prefs.js';

export const INTRO_KEY = 'intro';
export const INTRO_VALUES = ['seen'];

/** localStorage "intro" (kept and whitelisted since P2; P3.4b: written, but it no longer blocks the opening). */
export const readIntro = (storage) => readPref(INTRO_KEY, INTRO_VALUES, null, storage);
export const writeIntro = (value, storage) => writePref(INTRO_KEY, value, INTRO_VALUES, storage);

/** P3.4b: the opening plays once per browser session (sessionStorage "intro" = "seen"). */
export const readIntroSession = (storage = sessionStore()) => readPref(INTRO_KEY, INTRO_VALUES, null, storage);
export const writeIntroSession = (value, storage = sessionStore()) => writePref(INTRO_KEY, value, INTRO_VALUES, storage);

/** `?replay=1` forces the opening (and the Explore boat arrival) even if already seen this session. */
export const replayRequested = (search = '') => new URLSearchParams(search).get('replay') === '1';
/** Captured once at start-up (the gallery's URL hygiene later drops parameters it does not own). */
export const REPLAY = replayRequested(typeof window === 'undefined' ? '' : window.location.search);

/** Seen this session and not forced by ?replay=1. */
export const introSeenThisSession = ({ session = sessionStore(), replay = REPLAY } = {}) => !replay && readIntroSession(session) === 'seen';

/**
 * What to show on boot (introSeen = seen this session, see introSeenThisSession).
 * - The opening plays once per session (or with ?replay=1), and never animated under reduced motion.
 * - Under reduced motion the first visit gets the static title card behind the start screen (P3.3).
 * - A visitor with a stored mode gets the one-tap "Continue" start screen.
 */
export function bootPlan({ introSeen = false, storedMode = null, reducedMotion = false } = {}) {
  return {
    showIntro: !introSeen && !reducedMotion,
    staticCard: !introSeen && reducedMotion,
    startVariant: storedMode === 'classic' || storedMode === 'explore' ? 'returning' : 'first',
  };
}

/** Keys that skip the opening: any key except focus navigation and bare modifiers. */
export const isSkipKey = (key) => !['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(key);
