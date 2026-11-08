// 3D tilt toward the pointer for [data-tilt] cards (≤ 8°), with a glare highlight that follows the
// pointer. Transform-only (GSAP); fine pointer only; off under reduced motion.
import gsap from 'gsap';

const MAX_DEG = 8;

export function initTilt({ reduced }) {
  if (reduced || !window.matchMedia('(pointer: fine)').matches) return;

  for (const card of document.querySelectorAll('[data-tilt]')) {
    const max = Number.parseFloat(card.dataset.tilt) || MAX_DEG; // data-tilt="3" for a lighter tilt
    const glare = card.querySelector('.tilt-glare');
    gsap.set(card, { transformPerspective: 900 });
    const rotX = gsap.quickTo(card, 'rotationX', { duration: 0.6, ease: 'power3.out' });
    const rotY = gsap.quickTo(card, 'rotationY', { duration: 0.6, ease: 'power3.out' });
    const glareX = glare ? gsap.quickTo(glare, 'x', { duration: 0.35, ease: 'power3.out' }) : null;
    const glareY = glare ? gsap.quickTo(glare, 'y', { duration: 0.35, ease: 'power3.out' }) : null;
    let rect = null;

    card.addEventListener('pointerenter', () => {
      rect = card.getBoundingClientRect();
      card.classList.add('is-tilting');
    });

    card.addEventListener('pointermove', (event) => {
      if (!rect || event.pointerType !== 'mouse') return;
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;
      rotY((px - 0.5) * 2 * max);
      rotX(-(py - 0.5) * 2 * max);
      glareX?.(px * rect.width);
      glareY?.(py * rect.height);
    });

    card.addEventListener('pointerleave', () => {
      rect = null;
      card.classList.remove('is-tilting');
      rotX(0);
      rotY(0);
    });
  }
}
