// Magnetic buttons: [data-magnetic] (optional strength, e.g. data-magnetic="0.4") drift toward the
// pointer with transform only and spring back with an elastic ease.
import gsap from 'gsap';

export function initMagnetic({ reduced }) {
  if (reduced || !window.matchMedia('(pointer: fine)').matches) return;

  for (const el of document.querySelectorAll('[data-magnetic]')) {
    const strength = Number.parseFloat(el.dataset.magnetic) || 0.35;
    let rect = null;
    let xTo = null;
    let yTo = null;

    el.addEventListener('pointerenter', () => {
      rect = el.getBoundingClientRect();
      xTo = gsap.quickTo(el, 'x', { duration: 0.45, ease: 'power3.out' });
      yTo = gsap.quickTo(el, 'y', { duration: 0.45, ease: 'power3.out' });
    });

    el.addEventListener('pointermove', (event) => {
      if (!rect || event.pointerType !== 'mouse') return;
      xTo((event.clientX - (rect.left + rect.width / 2)) * strength);
      yTo((event.clientY - (rect.top + rect.height / 2)) * strength);
    });

    el.addEventListener('pointerleave', () => {
      rect = null;
      gsap.to(el, { x: 0, y: 0, duration: 0.9, ease: 'elastic.out(1, 0.5)', overwrite: true });
    });
  }
}
