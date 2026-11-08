// Global sound preference (DESIGN.md §11). No audio plays yet; P3/P6 listen for "soundchange".
import { readPref, writePref } from './prefs.js';

export const SOUND_KEY = 'sound';
export const SOUND_VALUES = ['on', 'off'];

export const readSound = (storage) => readPref(SOUND_KEY, SOUND_VALUES, 'off', storage);
export const writeSound = (value, storage) => writePref(SOUND_KEY, value, SOUND_VALUES, storage);

let state = 'off';

function sync() {
  for (const btn of document.querySelectorAll('[data-sound-toggle]')) {
    btn.setAttribute('aria-pressed', String(state === 'on'));
  }
}

/** Set the preference (start screen or toggles); every toggle stays in sync. */
export function setSound(value) {
  if (!SOUND_VALUES.includes(value)) return;
  state = value;
  writeSound(state);
  sync();
  window.dispatchEvent(new CustomEvent('soundchange', { detail: { sound: state } }));
}

export function initSound() {
  state = readSound();
  sync();
  for (const btn of document.querySelectorAll('[data-sound-toggle]')) {
    btn.addEventListener('click', () => setSound(state === 'on' ? 'off' : 'on'));
  }
}
