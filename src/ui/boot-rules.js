// Pure first-visit rules for src/ui/start.js (no DOM; unit-tested in tests/start.test.js).
// public/theme-init.js mirrors readIntro() before first paint: keep the two in step.
import { readPref, writePref } from './prefs.js';

export const INTRO_KEY = 'intro';
export const INTRO_VALUES = ['seen'];

export const readIntro = (storage) => readPref(INTRO_KEY, INTRO_VALUES, null, storage);
export const writeIntro = (value, storage) => writePref(INTRO_KEY, value, INTRO_VALUES, storage);

/**
 * What to show on boot.
 * - The intro plays once, and never under reduced motion.
 * - A visitor with a stored mode gets the one-tap "Continue" start screen.
 */
export function bootPlan({ introSeen = false, storedMode = null, reducedMotion = false } = {}) {
  return {
    showIntro: !introSeen && !reducedMotion,
    startVariant: storedMode === 'classic' || storedMode === 'explore' ? 'returning' : 'first',
  };
}
