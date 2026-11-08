// Custom cursor: dot + lagging ring. Only for a fine pointer without reduced
// motion. The native cursor returns over text fields; keyboard focus rings are never covered.
import gsap from 'gsap';

const INTERACTIVE = 'a[href], button, [role="button"], [data-cursor], label, summary';
const NATIVE = 'input, textarea, select, [contenteditable="true"]';

function createPart(className) {
  const el = document.createElement('div');
  el.className = className;
  el.setAttribute('aria-hidden', 'true');
  document.body.append(el);
  return el;
}

export function initCursor({ reduced }) {
  if (reduced || !window.matchMedia('(pointer: fine)').matches) return;

  const root = document.documentElement;
  const dot = createPart('cursor cursor--dot');
  const ring = createPart('cursor cursor--ring');

  const dotX = gsap.quickTo(dot, 'x', { duration: 0.12, ease: 'power3.out' });
  const dotY = gsap.quickTo(dot, 'y', { duration: 0.12, ease: 'power3.out' });
  const ringX = gsap.quickTo(ring, 'x', { duration: 0.5, ease: 'power3.out' });
  const ringY = gsap.quickTo(ring, 'y', { duration: 0.5, ease: 'power3.out' });
  let placed = false;

  const hide = () => root.classList.remove('cursor-visible');

  window.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType !== 'mouse') {
        // Touch or pen: the native cursor and no custom one.
        hide();
        root.classList.remove('has-cursor');
        return;
      }
      if (!placed) {
        // First real mouse move: place both parts under the pointer, then reveal them. Until now
        // they sat off-screen and invisible, and the native cursor stayed.
        gsap.set([dot, ring], { x: event.clientX, y: event.clientY });
        placed = true;
      }
      root.classList.add('has-cursor', 'cursor-visible');
      dotX(event.clientX);
      dotY(event.clientY);
      ringX(event.clientX);
      ringY(event.clientY);
    },
    { passive: true },
  );

  document.addEventListener('pointerover', (event) => {
    if (!(event.target instanceof Element)) return;
    const native = event.target.closest(NATIVE);
    const interactive = !native && event.target.closest(INTERACTIVE);
    root.classList.toggle('cursor-native', Boolean(native));
    ring.classList.toggle('is-hover', Boolean(interactive));
    dot.classList.toggle('is-hover', Boolean(interactive));
  });

  document.addEventListener('pointerdown', () => ring.classList.add('is-press'));
  document.addEventListener('pointerup', () => ring.classList.remove('is-press'));
  document.addEventListener('mouseout', (event) => {
    if (!event.relatedTarget) hide(); // pointer left the window
  });
  window.addEventListener('blur', hide);
  // Keyboard users get the native focus ring only; the custom cursor steps aside.
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') hide();
  });
}
