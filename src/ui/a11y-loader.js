// P10: the accessibility menu's logic is a lazy chunk. The button is plain HTML (in the tab order from the start);
// the chunk loads on the first click or keyboard focus, and the first click then opens the panel. The saved
// settings themselves are applied by theme-init.js before the first paint, so nothing here is needed for them.
export function initA11yLoader() {
  const box = document.querySelector('[data-a11y]');
  const toggle = box?.querySelector('[data-a11y-toggle]');
  if (!box || !toggle) return;
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
