// P10 accessibility menu (lazy chunk, loaded by a11y-loader.js on first use). The "Accessibility" button in the page
// is a disclosure (aria-expanded + aria-controls); the panel holds five switches (real buttons with aria-pressed)
// and a reset. A switch is a data- attribute on <html> (CSS in src/styles/a11y.css); the choice is remembered in
// localStorage (only through prefs.js, which wraps every access in try / catch), as a short list of known option names: a visitor convenience, nothing
// personal. A failing storage never breaks anything. Escape closes the panel and returns focus to the button.
import { track } from './analytics.js';
import { writePref } from './prefs.js';

export const A11Y_KEY = 'a11y';
/** option → [attribute on <html>, value]. The only things the stored value may switch on. */
export const OPTIONS = {
  motion: ['data-a11y-motion', 'reduce'],
  text: ['data-a11y-text', 'large'],
  contrast: ['data-a11y-contrast', 'high'],
  spacing: ['data-a11y-spacing', 'readable'],
  links: ['data-a11y-links', 'underline'],
};

/** Every stored value the menu can write: each combination of the option names, in declared order (prefs.js whitelist). */
const ALLOWED = (() => {
  const names = Object.keys(OPTIONS);
  const out = ['none']; // 'none' = nothing switched on (prefs.js has no remove, and parseStored ignores it)
  for (let mask = 1; mask < 1 << names.length; mask += 1) out.push(names.filter((_, i) => mask & (1 << i)).join(','));
  return out;
})();

/** The known option names in a stored value (anything else is ignored). */
export const parseStored = (value) => [...new Set(String(value ?? '').split(',').filter((n) => Object.hasOwn(OPTIONS, n)))];

/** State on <html> + persistence. `html` needs get / set / removeAttribute; `storage` (default: prefs.js's) may be null or throw. */
export function createA11y({ html, storage }) {
  const isOn = (name) => html.getAttribute(OPTIONS[name][0]) === OPTIONS[name][1];
  const active = () => Object.keys(OPTIONS).filter(isOn);
  const persist = () => {
    try {
      writePref(A11Y_KEY, active().join(',') || 'none', ALLOWED, storage);
    } catch {
      /* storage blocked: the setting still applies to this page */
    }
  };
  return {
    isOn,
    active,
    set(name, on) {
      if (!Object.hasOwn(OPTIONS, name)) return false;
      if (on) html.setAttribute(OPTIONS[name][0], OPTIONS[name][1]);
      else html.removeAttribute(OPTIONS[name][0]);
      persist();
      return true;
    },
    reset() {
      for (const name of Object.keys(OPTIONS)) html.removeAttribute(OPTIONS[name][0]);
      persist();
    },
  };
}

/** Wire the menu markup. `open` opens the panel at once (the click that loaded this chunk). */
export function initA11yMenu(box, { open = false } = {}) {
  if (!box || box.dataset.a11yReady) return null;
  box.dataset.a11yReady = 'true';
  const toggle = box.querySelector('[data-a11y-toggle]');
  const panel = box.querySelector('[data-a11y-panel]');
  const switches = [...box.querySelectorAll('[data-a11y-option]')];
  const reset = box.querySelector('[data-a11y-reset]');
  const note = box.querySelector('[data-a11y-note]');
  const reload = box.querySelector('[data-a11y-reload]');
  const classic = box.querySelector('[data-a11y-classic]');
  if (!toggle || !panel) return null;
  const state = createA11y({ html: document.documentElement }); // storage: prefs.js's own (null when blocked)

  const paint = () => {
    for (const b of switches) b.setAttribute('aria-pressed', String(state.isOn(b.dataset.a11yOption)));
  };
  const setOpen = (on, { focus = false } = {}) => {
    panel.hidden = !on;
    toggle.setAttribute('aria-expanded', String(on));
    if (!on && focus) toggle.focus();
  };

  toggle.addEventListener('click', () => setOpen(panel.hidden));
  for (const b of switches) {
    b.addEventListener('click', () => {
      const name = b.dataset.a11yOption;
      state.set(name, !state.isOn(name));
      paint();
      track('a11y_menu_used', { once: true });
      if (name === 'motion' && note && reload) {
        note.hidden = false;
        reload.hidden = false;
      }
    });
  }
  reset?.addEventListener('click', () => {
    state.reset();
    paint();
    track('a11y_menu_used', { once: true });
    if (note && reload) {
      note.hidden = false;
      reload.hidden = false;
    }
  });
  reload?.addEventListener('click', () => window.location.reload());
  classic?.addEventListener('click', () => {
    setOpen(false);
    // The header's mode button toggles Explore <-> Classic (mode.js owns it); this link only shows in Explore.
    document.querySelector('.site-header [data-mode-toggle]')?.click();
  });
  box.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false, { focus: true });
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!panel.hidden && !box.contains(event.target)) setOpen(false);
  });
  paint();
  if (open) setOpen(true);
  return { state, setOpen, paint };
}
