// Header state, active section tracking and smooth in-page navigation.
import { getLenis } from './motion.js';

function headerOffset() {
  return document.querySelector('[data-header]')?.offsetHeight ?? 0;
}

/** Scroll to a section (through Lenis when active) and move keyboard focus there. */
export function scrollToTarget(target, reduced) {
  const focusTarget = () => {
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  };

  const lenis = getLenis();
  if (lenis) {
    lenis.scrollTo(target, { offset: -headerOffset(), duration: 1.2, onComplete: focusTarget });
    return;
  }
  target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  focusTarget();
}

function initHeaderState() {
  const header = document.querySelector('[data-header]');
  const sentinel = document.querySelector('[data-top-sentinel]');
  if (!header || !sentinel) return;
  new IntersectionObserver(([entry]) => {
    header.classList.toggle('is-scrolled', !entry.isIntersecting);
  }).observe(sentinel);
}

function initActiveSection() {
  const links = [...document.querySelectorAll('[data-nav-link]')];
  let activeId = null;

  const setActive = (section) => {
    if (section.id === activeId) return;
    activeId = section.id;
    for (const link of links) {
      if (link.hash === `#${section.id}`) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
    window.dispatchEvent(
      new CustomEvent('sectionchange', {
        detail: { id: section.id, index: section.dataset.index, label: section.dataset.label },
      }),
    );
  };

  // A section is active while it crosses the middle band of the viewport.
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) if (entry.isIntersecting) setActive(entry.target);
    },
    { rootMargin: '-45% 0px -50% 0px' },
  );
  for (const section of document.querySelectorAll('[data-section]')) observer.observe(section);
}

function initAnchors(reduced) {
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
    if (!link) return;
    const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
    if (!target) return;

    event.preventDefault();
    scrollToTarget(target, reduced);
    if (window.location.hash !== link.hash) window.history.pushState(null, '', link.hash);
  });
}

// "Explore island" is aria-disabled until P3; its tooltip must be dismissible with Esc.
function initDisabledTooltips() {
  for (const wrap of document.querySelectorAll('[data-tooltip-wrap]')) {
    wrap.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') wrap.classList.add('is-dismissed');
    });
    const reset = () => wrap.classList.remove('is-dismissed');
    wrap.addEventListener('pointerleave', reset);
    wrap.addEventListener('focusout', reset);
    wrap.querySelector('[aria-disabled="true"]')?.addEventListener('click', (event) => event.preventDefault());
  }
}

export function initNav({ reduced }) {
  initHeaderState();
  initActiveSection();
  initAnchors(reduced);
  initDisabledTooltips();
}
