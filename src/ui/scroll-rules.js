// Classic scrolling rules (pure, unit-tested; P3.4 "hard to navigate"). Lenis smooths the mouse wheel
// only, briefly; trackpads (their own momentum), the keyboard and reduced motion scroll natively. In-page
// links land on the section heading just below the sticky header; the active section is computed from
// the scroll position (robust to jumps, back/forward and deep links).

/** Lenis: a short, crisp ease for mouse wheels (it used to glide for 1.15 s). */
export const LENIS_OPTIONS = Object.freeze({
  autoRaf: false,
  lerp: 0.18,
  smoothWheel: true,
  syncTouch: false,
  wheelMultiplier: 1,
  stopInertiaOnNavigate: true,
});

/** Programmatic scrolls (nav links): quick, eased out. */
export const NAV_SCROLL_SECONDS = 0.7;

/** Gap between the sticky header and the section heading after a nav jump (px). */
export const HEADING_GAP = 16;

/**
 * Should this wheel event scroll natively instead of through Lenis? Trackpads (and precision wheels)
 * send pixel deltas with fractions, horizontal components or small steps, and already carry their own
 * momentum; smoothing that again is what felt floaty. Classic mouse wheels send big line-sized steps.
 */
export function nativeWheel(event) {
  if (!event || !String(event.type).includes('wheel')) return false;
  if (event.ctrlKey) return true; // pinch-zoom gesture
  if (event.deltaMode !== 0) return false; // line / page deltas: a notched mouse wheel
  const dy = Math.abs(event.deltaY ?? 0);
  const dx = Math.abs(event.deltaX ?? 0);
  if (dx > 0.5) return true;
  if (!Number.isInteger(dy)) return true;
  return dy > 0 && dy < 40;
}

const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar']);

/** A key that scrolls the page natively (and must cancel any smooth wheel scroll in flight). */
export function isScrollKey(event) {
  if (!event || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return false;
  if (!SCROLL_KEYS.has(event.key)) return false;
  const t = event.target;
  if (t && typeof t.closest === 'function' && t.closest('input, textarea, select, [contenteditable="true"], [role="slider"], [role="listbox"], video, dialog[open]')) return false;
  return true;
}

/**
 * Scroll position that puts a heading `gap` px under the sticky header. headingTop is the heading's
 * layout top in document coordinates (transforms excluded: reveals translate headings while hidden).
 */
export function anchorTop({ headingTop, headerHeight, gap = HEADING_GAP, maxScroll = Infinity }) {
  return Math.max(0, Math.min(maxScroll, Math.round(headingTop - headerHeight - gap)));
}

/**
 * Index of the active section: the last one whose top has passed a reading line 35 % down the
 * viewport (below the header); the last section once the page is scrolled to the bottom; −1 above
 * the first section (the hero).
 */
export function activeSectionIndex(tops, { scrollY, viewport, headerHeight, maxScroll }) {
  if (!tops.length) return -1;
  if (maxScroll > 0 && scrollY >= maxScroll - 2) return tops.length - 1;
  const line = scrollY + headerHeight + (viewport - headerHeight) * 0.35;
  let index = -1;
  for (let i = 0; i < tops.length; i += 1) if (tops[i] <= line) index = i;
  return index;
}

/** Layout top of an element in document coordinates, ignoring CSS transforms (offset chain). */
export function layoutTop(el) {
  let top = 0;
  // offsetTop is measured inside the offset parent's border, so add that border (the section rule).
  for (let node = el; node; node = node.offsetParent) top += node.offsetTop + (node.offsetParent?.clientTop ?? 0);
  return top;
}

/** The element a jump lines up under the header: a section's heading, else the target itself. */
export function headingOf(target) {
  if (!target.matches('[data-section], section')) return target;
  return target.querySelector('h2, h1, [data-section-heading]') ?? target;
}

/** Where a jump to `target` ends (document px). DOM is read only when called (safe to import in Node). */
export function sectionScrollY(target) {
  const header = document.querySelector('[data-header]')?.offsetHeight ?? 0;
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  return anchorTop({ headingTop: layoutTop(headingOf(target)), headerHeight: header, gap: HEADING_GAP, maxScroll });
}
