// Pointer spotlight for [data-spotlight] cards: writes --mx/--my (px, relative to the card). The CSS
// moves a pre-painted radial highlight with `translate`, so only compositing happens per move.

export function initSpotlight({ reduced }) {
  if (reduced || !window.matchMedia('(pointer: fine)').matches) return;

  let pending = null;
  let frame = 0;

  const flush = () => {
    frame = 0;
    if (!pending) return;
    const { el, x, y } = pending;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${x - rect.left}px`);
    el.style.setProperty('--my', `${y - rect.top}px`);
  };

  // One delegated listener for every card, throttled to one update per frame.
  document.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType !== 'mouse' || !(event.target instanceof Element)) return;
      const el = event.target.closest('[data-spotlight]');
      if (!el) return;
      pending = { el, x: event.clientX, y: event.clientY };
      if (!frame) frame = requestAnimationFrame(flush);
    },
    { passive: true },
  );
}
