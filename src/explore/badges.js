// Star badges (pure, unit-tested). One star per case file (the eight zone ids), earned when its
// overlay stays open ≥ 3 s or the visitor interacts with it. Persisted in localStorage under
// "explore.badges" as the earned ids in canonical order ("about,skills"), or "none". Every one of the
// 256 possible values is precomputed, so readPref / writePref validate against an exact whitelist and
// anything else (a hand-edited or hostile value) is ignored.
import { ZONE_ANCHORS } from './zones.js';

export const ZONE_IDS = Object.keys(ZONE_ANCHORS);
export const BADGES_KEY = 'explore.badges';
export const BADGES_EMPTY = 'none';

/** The canonical stored form of a set of zone ids (unknown ids are dropped). */
export function encodeBadges(ids) {
  const set = new Set(ids);
  const known = ZONE_IDS.filter((id) => set.has(id));
  return known.length ? known.join(',') : BADGES_EMPTY;
}

/** Every valid stored value: one per subset of the eight zone ids (2^8 = 256). */
export const BADGES_VALUES = Array.from({ length: 2 ** ZONE_IDS.length }, (_, mask) => encodeBadges(ZONE_IDS.filter((_, i) => mask & (1 << i))));

/** Stored value → Set of zone ids. Anything off the whitelist decodes to the empty set. */
export function decodeBadges(value) {
  if (typeof value !== 'string' || value === BADGES_EMPTY || !BADGES_VALUES.includes(value)) return new Set();
  return new Set(value.split(','));
}

/**
 * The badge store. award(id) → { awarded, count, completedNow }: completedNow is true exactly once,
 * on the award that completes the set (a visitor who already had 8/8 stored never re-triggers the
 * ceremony; after reset() the next full set does). onChange(value) receives the canonical value to
 * persist.
 */
export function createBadges(initial = BADGES_EMPTY, { onChange } = {}) {
  let earned = decodeBadges(initial);
  let ceremonyDone = earned.size === ZONE_IDS.length;
  return {
    total: ZONE_IDS.length,
    get count() {
      return earned.size;
    },
    get complete() {
      return earned.size === ZONE_IDS.length;
    },
    get value() {
      return encodeBadges(earned);
    },
    /** A live read-only view for the HUD chips and the edge arrow. */
    get set() {
      return earned;
    },
    has: (id) => earned.has(id),
    award(id) {
      if (!ZONE_IDS.includes(id) || earned.has(id)) return { awarded: false, count: earned.size, completedNow: false };
      earned = new Set([...earned, id]);
      const completedNow = earned.size === ZONE_IDS.length && !ceremonyDone;
      if (completedNow) ceremonyDone = true;
      onChange?.(encodeBadges(earned));
      return { awarded: true, count: earned.size, completedNow };
    },
    reset() {
      earned = new Set();
      ceremonyDone = false;
      onChange?.(BADGES_EMPTY);
    },
  };
}
