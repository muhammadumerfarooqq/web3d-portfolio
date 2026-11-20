// P3.4 Classic navigation ("hard to navigate"): Lenis is short and wheel-only (trackpads, touch, the
// keyboard and reduced motion scroll natively), scroll keys cancel a smooth scroll in flight, nav links
// land on the section heading under the sticky header, the active section follows the scroll position,
// and back / forward and deep links return to their section.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HEADING_GAP, LENIS_OPTIONS, NAV_SCROLL_SECONDS, activeSectionIndex, anchorTop, isScrollKey, nativeWheel } from '../src/ui/scroll-rules.js';

const ROOT = join(import.meta.dirname, '..');
const ui = (f) => readFileSync(join(ROOT, 'src', 'ui', f), 'utf8');
const wheel = (o) => ({ type: 'wheel', deltaMode: 0, deltaX: 0, deltaY: 0, ctrlKey: false, ...o });
const key = (k, o = {}) => ({ key: k, defaultPrevented: false, altKey: false, ctrlKey: false, metaKey: false, target: { closest: () => null }, ...o });

describe('Lenis: short, wheel-only smoothing', () => {
  it('uses a crisp lerp instead of the old 1.15 s glide, and never smooths touch', () => {
    expect(LENIS_OPTIONS).not.toHaveProperty('duration');
    expect(LENIS_OPTIONS.lerp).toBeGreaterThanOrEqual(0.15);
    expect(LENIS_OPTIONS.lerp).toBeLessThanOrEqual(0.3);
    expect(LENIS_OPTIONS.smoothWheel).toBe(true);
    expect(LENIS_OPTIONS.syncTouch).toBe(false);
    expect(LENIS_OPTIONS.autoRaf).toBe(false);
    expect(NAV_SCROLL_SECONDS).toBeLessThan(1.2);
    const motion = ui('motion.js');
    expect(motion).toMatch(/new Lenis\(\{ \.\.\.LENIS_OPTIONS, virtualScroll: \(\{ event \}\) => !nativeWheel\(event\) \}\)/);
    expect(motion).not.toMatch(/duration: 1\.15/);
  });

  it('reduced motion gets no Lenis at all (native scrolling)', () => {
    expect(ui('motion.js')).toMatch(/export function initMotion\(\{ reduced \}\) \{\s*if \(reduced\) return;/);
  });

  it('trackpads (pixel deltas, fractions, sideways, small steps) and pinch scroll natively; notched mouse wheels are smoothed', () => {
    expect(nativeWheel(wheel({ deltaY: 100 }))).toBe(false); // Chrome / Windows mouse notch
    expect(nativeWheel(wheel({ deltaY: -120 }))).toBe(false);
    expect(nativeWheel(wheel({ deltaMode: 1, deltaY: 3 }))).toBe(false); // Firefox line mode
    expect(nativeWheel(wheel({ deltaY: 4.5 }))).toBe(true); // trackpad momentum
    expect(nativeWheel(wheel({ deltaY: 12 }))).toBe(true);
    expect(nativeWheel(wheel({ deltaY: 30, deltaX: 6 }))).toBe(true);
    expect(nativeWheel(wheel({ deltaY: 100, ctrlKey: true }))).toBe(true);
    expect(nativeWheel({ type: 'touchmove' })).toBe(false); // touch is never smoothed anyway (syncTouch off)
  });
});

describe('keyboard scrolling works everywhere', () => {
  it('arrows, Page Up/Down, Space, Home and End count as scroll keys (not in fields, not with modifiers)', () => {
    for (const k of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', ' ', 'Home', 'End']) expect(isScrollKey(key(k))).toBe(true);
    expect(isScrollKey(key('a'))).toBe(false);
    expect(isScrollKey(key('ArrowDown', { ctrlKey: true }))).toBe(false);
    expect(isScrollKey(key(' ', { defaultPrevented: true }))).toBe(false);
    expect(isScrollKey(key(' ', { target: { closest: (sel) => (sel.includes('input') ? {} : null) } }))).toBe(false);
  });

  it('a scroll key stops a smooth wheel scroll in flight, then the browser scrolls natively', () => {
    expect(ui('motion.js')).toMatch(/if \(lenis\?\.isScrolling === 'smooth' && isScrollKey\(event\)\) lenis\.scrollTo\(window\.scrollY, \{ immediate: true, force: true \}\);/);
  });

  it('no Classic handler swallows the scroll keys globally', () => {
    for (const f of ['main.js', 'nav.js', 'start.js']) {
      const code = f === 'main.js' ? readFileSync(join(ROOT, 'src', f), 'utf8') : ui(f);
      const handlers = code.match(/(window|document)\.addEventListener\('keydown'[\s\S]{0,400}?\n {2}\}\)?;?/g) ?? [];
      for (const h of handlers) if (/preventDefault/.test(h)) expect(h).not.toMatch(/ArrowDown|PageDown|'End'|'Home'/);
    }
  });
});

describe('nav links land exactly on the section heading', () => {
  it('the heading ends up HEADING_GAP px under the sticky header, clamped to the page', () => {
    expect(anchorTop({ headingTop: 2400, headerHeight: 72 })).toBe(2400 - 72 - HEADING_GAP);
    expect(anchorTop({ headingTop: 40, headerHeight: 72 })).toBe(0);
    expect(anchorTop({ headingTop: 9000, headerHeight: 72, maxScroll: 8000 })).toBe(8000);
  });

  it('nav.js scrolls to the heading (layout top, ignoring reveal transforms) through Lenis or natively', () => {
    const rules = ui('scroll-rules.js');
    expect(rules).toMatch(/for \(let node = el; node; node = node\.offsetParent\) top \+= node\.offsetTop \+ \(node\.offsetParent\?\.clientTop \?\? 0\);/);
    expect(rules).toMatch(/querySelector\('h2, h1, \[data-section-heading\]'\)/);
    const nav = ui('nav.js');
    expect(nav).toMatch(/lenis\.scrollTo\(top, \{ duration: instant \? 0 : NAV_SCROLL_SECONDS/);
    expect(nav).toMatch(/window\.scrollTo\(\{ top, behavior: reduced \|\| instant \? 'auto' : 'smooth' \}\);/);
    expect(ui('mode.js')).toMatch(/window\.scrollTo\(\{ top: sectionScrollY\(target\), behavior: 'auto' \}\);/);
  });
});

describe('the active-section indicator', () => {
  const tops = [800, 1900, 3200, 4100];
  const at = (scrollY, extra = {}) => activeSectionIndex(tops, { scrollY, viewport: 900, headerHeight: 72, maxScroll: 5000, ...extra });

  it('none above the first section (the hero), then each section as it passes the reading line', () => {
    expect(at(0)).toBe(-1);
    expect(at(800 - 72 - 16)).toBe(0); // a nav jump to section 0 makes it active at once
    expect(at(1900 - 72 - 16)).toBe(1);
    expect(at(2500)).toBe(1);
    expect(at(3200 - 72 - 16)).toBe(2);
  });

  it('the last section once the page bottom is reached, even if it is short', () => {
    expect(at(5000)).toBe(3);
    expect(at(4999)).toBe(3);
  });

  it('nav.js recomputes it on every scroll (rAF-throttled) and on resize, not with a one-shot observer band', () => {
    const nav = ui('nav.js');
    expect(nav).toMatch(/window\.addEventListener\('scroll', queue, \{ passive: true \}\);/);
    expect(nav).toMatch(/window\.addEventListener\('resize', queue, \{ passive: true \}\);/);
    expect(nav).not.toMatch(/rootMargin: '-45% 0px -50% 0px'/);
  });
});

describe('back / forward and deep links', () => {
  it('popstate scrolls to the section of the new hash (or the top); #project-* stays with the modal', () => {
    const nav = ui('nav.js');
    expect(nav).toMatch(/window\.addEventListener\('popstate', \(\) => requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => fromHash\(\{ instant: false \}\)\)\)\);/);
    expect(nav).toMatch(/if \(\/\^#project-\/\.test\(hash\)\) return;/);
    expect(ui('projects/modal.js')).toMatch(/window\.addEventListener\('hashchange', openFromHash\);/);
  });

  it('a #section deep link is lined up again once the start screen / fonts have settled the layout', () => {
    const nav = ui('nav.js');
    expect(nav).toMatch(/window\.addEventListener\('bootdone', r, \{ once: true \}\)/);
    expect(nav).toMatch(/window\.addEventListener\('motionready', r, \{ once: true \}\)/);
    expect(nav).toMatch(/Promise\.all\(\[booted, motion, document\.fonts\?\.ready\]\)\.then\(\(\) => fromHash\(\{ instant: true \}\)\)/);
    expect(readFileSync(join(ROOT, 'src', 'main.js'), 'utf8')).toMatch(/root\.dataset\.motion = 'ready';\s*window\.dispatchEvent\(new CustomEvent\('motionready'\)\);/);
  });

  it('a deep link that opens the page scrolled down does not crash the reveals (no `once` trigger created past its start)', () => {
    const motion = ui('motion.js');
    expect(motion).toMatch(/const alreadyPassed = \(el\) => el\.getBoundingClientRect\(\)\.top < window\.innerHeight \* REVEAL_LINE;/);
    expect(motion).toMatch(/el\.closest\('\[data-reveal-immediate\], \[data-reveal-done\]'\) \|\| alreadyPassed\(el\) \? undefined :/);
  });

  it('in-page clicks push a history entry, so Back returns to the previous section', () => {
    expect(ui('nav.js')).toMatch(/window\.history\.pushState\(null, '', link\.hash\);/);
  });
});
