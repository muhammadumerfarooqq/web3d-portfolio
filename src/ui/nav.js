// Header state, active section tracking and smooth in-page navigation.
// P3.4: links land on the section's heading just below the sticky header (both with Lenis and with
// native scrolling); the active section follows the scroll position (scroll-rules.js), so jumps,
// back / forward and deep links all update it; back / forward and #section deep links scroll to
// their section (#project-* links open the project modal instead, see projects/modal.js).
import { getLenis } from './motion.js';
import { NAV_SCROLL_SECONDS, activeSectionIndex, layoutTop, sectionScrollY } from './scroll-rules.js';

function headerOffset() {
  return document.querySelector('[data-header]')?.offsetHeight ?? 0;
}

const maxScroll = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

/** Where a jump to `target` ends (document px): its heading just under the sticky header. */
export const targetScrollY = sectionScrollY;

/** Scroll to a section (through Lenis when active) and move keyboard focus there. */
export function scrollToTarget(target, reduced, { instant = false } = {}) {
  const focusTarget = () => {
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  };
  const top = targetScrollY(target);
  const lenis = getLenis();
  if (lenis) {
    lenis.scrollTo(top, { duration: instant ? 0 : NAV_SCROLL_SECONDS, immediate: instant, force: true, onComplete: focusTarget });
    if (instant) focusTarget();
    return;
  }
  window.scrollTo({ top, behavior: reduced || instant ? 'auto' : 'smooth' });
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
  const sections = [...document.querySelectorAll('[data-section]')];
  let activeId;

  const setActive = (section) => {
    const id = section ? section.id : null;
    if (id === activeId) return;
    activeId = id;
    for (const link of links) {
      if (id && link.hash === `#${id}`) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
    if (!section) return;
    window.dispatchEvent(
      new CustomEvent('sectionchange', {
        detail: { id: section.id, index: section.dataset.index, label: section.dataset.label },
      }),
    );
  };

  let queued = false;
  const update = () => {
    queued = false;
    const tops = sections.map(layoutTop);
    const i = activeSectionIndex(tops, { scrollY: window.scrollY, viewport: window.innerHeight, headerHeight: headerOffset(), maxScroll: maxScroll() });
    setActive(i >= 0 ? sections[i] : null);
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue, { passive: true });
  queue();
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

  // Back / forward between in-page links: go to that section (or the top for the bare URL).
  const fromHash = ({ instant }) => {
    const hash = window.location.hash;
    if (/^#project-/.test(hash)) return; // the project modal handles these
    const target = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
    if (target) scrollToTarget(target, reduced, { instant });
    else if (!hash) {
      const lenis = getLenis();
      if (lenis) lenis.scrollTo(0, { duration: NAV_SCROLL_SECONDS, force: true });
      else window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    }
  };
  // Two frames later: the browser's own scroll restoration for the entry runs after popstate and
  // would otherwise win (seen with native scrolling under reduced motion).
  window.addEventListener('popstate', () => requestAnimationFrame(() => requestAnimationFrame(() => fromHash({ instant: false }))));

  // Deep link (#about, #contact…): the browser jumped before fonts, reveals and the start screen
  // settled the layout; line the section up again once all three are done (scrolling while the
  // reveals are still being set up made a ScrollTrigger refresh fail).
  if (window.location.hash && !/^#project-/.test(window.location.hash)) {
    const root = document.documentElement;
    const booted = root.dataset.boot ? new Promise((r) => window.addEventListener('bootdone', r, { once: true })) : Promise.resolve();
    const motion = root.dataset.motion === 'ready' ? Promise.resolve() : new Promise((r) => window.addEventListener('motionready', r, { once: true }));
    Promise.all([booted, motion, document.fonts?.ready]).then(() => fromHash({ instant: true }));
  }
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
