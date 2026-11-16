// Whitelisted localStorage access. Only values from an explicit allow-list are ever read back
// or written, so stored preferences can never inject arbitrary strings into the page.

function defaultStorage() {
  try {
    return window.localStorage;
  } catch {
    return null; // no window (tests) or storage blocked (privacy mode, sandboxed iframe)
  }
}

/**
 * sessionStorage (this browser tab's session), or null when blocked. P3.4b: the opening and the boat
 * arrival play once per session, so their "seen" flags live here; still read and written only through
 * readPref / writePref with the same whitelists.
 */
export function sessionStore() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readPref(key, allowed, fallback, storage = defaultStorage()) {
  try {
    const value = storage?.getItem(key);
    return allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key, value, allowed, storage = defaultStorage()) {
  if (!allowed.includes(value)) return false;
  try {
    storage?.setItem(key, value);
    return Boolean(storage);
  } catch {
    return false;
  }
}
