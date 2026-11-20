// P10: the accessibility menu's logic is a lazy chunk. The button is plain HTML (in the tab order from the start);
// the chunk loads on the first click or keyboard focus, and the first click then opens the panel. The saved
// settings themselves are applied by theme-init.js before the first paint, so nothing here is needed for them.
//
// P12-UX: the button is no longer a fixed element over the content. It lives in the Classic header (next to the
// language, sound and theme buttons) and, in Explore, in the HUD's top-right cluster: `placeA11y` moves the SAME
// box there on "modechange" and back (so the disclosure, Esc and focus-return logic exists once). It is part of
// the small Classic entry on purpose: the Explore chunk gets no code for it.

/**
 * Keep the box where it belongs: `home` (the header's control row) in Classic, the HUD's top-right cluster in Explore.
 * The HUD is built a moment after the mode changes, so a MutationObserver waits for it (and stops when it appears or when
 * Classic returns). Returns { sync } for tests.
 */
export function placeA11y(box, doc = document, win = window) {
  const home = box.parentElement;
  const after = box.nextElementSibling;
  let watcher = null;
  const stop = () => {
    watcher?.disconnect();
    watcher = null;
  };
  const toHome = () => {
    stop();
    if (box.parentElement !== home) home.insertBefore(box, after?.parentElement === home ? after : null);
  };
  const toHud = () => {
    const slot = doc.querySelector('.xp-top__right');
    if (slot) {
      slot.append(box);
      return;
    }
    if (watcher || typeof win.MutationObserver !== 'function') return;
    watcher = new win.MutationObserver(() => {
      const found = doc.querySelector('.xp-top__right');
      if (found && doc.documentElement.dataset.mode === 'explore') {
        stop();
        found.append(box);
      }
    });
    watcher.observe(doc.body, { childList: true, subtree: true });
  };
  const sync = () => (doc.documentElement.dataset.mode === 'explore' ? toHud() : toHome());
  win.addEventListener('modechange', sync);
  sync();
  return { sync };
}

export function initA11yLoader() {
  const box = document.querySelector('[data-a11y]');
  const toggle = box?.querySelector('[data-a11y-toggle]');
  if (!box || !toggle) return;
  placeA11y(box);
  let loading = null;
  const load = (open) => {
    loading ??= import('./a11y-menu.js').then((m) => m.initA11yMenu(box, { open }));
    return loading;
  };
  toggle.addEventListener('focus', () => load(false).catch(() => {}), { once: true });
  // The first click: the chunk may not be there yet, so open through it (later clicks are the menu's own).
  toggle.addEventListener(
    'click',
    () => {
      if (box.dataset.a11yReady) return;
      load(true).then((menu) => menu?.setOpen(true)).catch(() => {});
    },
    { once: true },
  );
}
