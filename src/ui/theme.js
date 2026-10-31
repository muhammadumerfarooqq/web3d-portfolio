// Day/night theme. public/theme-init.js sets the first theme before paint; this module handles
// the toggle, the circular View Transition reveal and the "themechange" event (P3's island listens).
import { readPref, writePref } from './prefs.js';

export const THEME_KEY = 'theme';
export const THEME_VALUES = ['light', 'dark'];

export const readTheme = (storage) => readPref(THEME_KEY, THEME_VALUES, null, storage);
export const writeTheme = (value, storage) => writePref(THEME_KEY, value, THEME_VALUES, storage);

// Resolved lazily so the storage helpers above can be imported in tests without a DOM.
const docRoot = () => document.documentElement;

export function currentTheme() {
  return docRoot().dataset.theme === 'light' ? 'light' : 'dark';
}

function syncControls(theme) {
  for (const btn of document.querySelectorAll('[data-theme-toggle]')) {
    btn.setAttribute('aria-pressed', String(theme === 'dark'));
  }
  // Keep the browser UI colour in step with a manual choice.
  const bg = getComputedStyle(docRoot()).getPropertyValue('--bg').trim();
  if (bg) {
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute('content', bg);
  }
}

function applyTheme(theme) {
  docRoot().dataset.theme = theme;
  syncControls(theme);
  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
}

function switchTheme(button, reduced) {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  writeTheme(next);

  if (reduced || typeof document.startViewTransition !== 'function') {
    applyTheme(next);
    return;
  }

  // Circular reveal growing from the toggle button.
  const rect = button.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

  const transition = document.startViewTransition(() => applyTheme(next));
  transition.ready
    .then(() => {
      docRoot().animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 750, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    })
    .catch(() => {});
}

export function initTheme({ reduced }) {
  syncControls(currentTheme());
  for (const btn of document.querySelectorAll('[data-theme-toggle]')) {
    btn.addEventListener('click', () => switchTheme(btn, reduced));
  }

  // Follow the system setting live until the visitor makes a choice.
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (event) => {
    if (!readTheme()) applyTheme(event.matches ? 'light' : 'dark');
  });
}
