// Global sound preference (DESIGN.md §11). No audio plays yet; P3/P6 listen for "soundchange".
import { readPref, writePref } from './prefs.js';

export const SOUND_KEY = 'sound';
export const SOUND_VALUES = ['on', 'off'];

export const readSound = (storage) => readPref(SOUND_KEY, SOUND_VALUES, 'off', storage);
export const writeSound = (value, storage) => writePref(SOUND_KEY, value, SOUND_VALUES, storage);

function sync(state) {
  for (const btn of document.querySelectorAll('[data-sound-toggle]')) {
    btn.setAttribute('aria-pressed', String(state === 'on'));
  }
}

export function initSound() {
  let state = readSound();
  sync(state);
  for (const btn of document.querySelectorAll('[data-sound-toggle]')) {
    btn.addEventListener('click', () => {
      state = state === 'on' ? 'off' : 'on';
      writeSound(state);
      sync(state);
      window.dispatchEvent(new CustomEvent('soundchange', { detail: { sound: state } }));
    });
  }
}
