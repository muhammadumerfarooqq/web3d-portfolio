// One motion loop (DESIGN.md §9): Lenis smooth scroll driven by gsap.ticker, ScrollTrigger updated
// from Lenis, and attribute-driven reveals. Nothing here runs under prefers-reduced-motion.
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { LENIS_OPTIONS, isScrollKey, nativeWheel } from './scroll-rules.js';

gsap.registerPlugin(ScrollTrigger, SplitText);

let lenis = null;

/** The active Lenis instance, or null (reduced motion, or not initialised yet). */
export function getLenis() {
  return lenis;
}

const delayOf = (el) => Number.parseFloat(el.dataset.revealDelay) || 0;

// While the intro / start screen covers the page (html[data-boot], src/ui/start.js), hero reveals
// wait, then play when start.js dispatches "bootdone".
const held = new Set();
function hold(el, tween) {
  if (document.documentElement.dataset.boot && el.closest('[data-reveal-immediate]')) {
    tween.pause(0);
    held.add(tween);
  }
  return tween;
}
window.addEventListener('bootdone', () => {
  for (const tween of held) tween.restart(true);
  held.clear();
});
// Inside [data-reveal-immediate] (the hero) reveals play on load; elsewhere they wait for scroll.
// [data-reveal-done] (a section shown in an Explore case file) never waits: a re-split plays at once.
// P3.4: an element already past its start line when it is set up (a #section deep link opens the page
// scrolled down) just plays: a `once` trigger created past its start fires and kills itself inside
// ScrollTrigger's own refresh loop, which crashed the whole reveal set-up on deep links.
const REVEAL_LINE = 0.88;
const alreadyPassed = (el) => el.getBoundingClientRect().top < window.innerHeight * REVEAL_LINE;
const triggerFor = (el) =>
  el.closest('[data-reveal-immediate], [data-reveal-done]') || alreadyPassed(el) ? undefined : { trigger: el, start: `top ${REVEAL_LINE * 100}%`, once: true };

// Explore shows a Classic section inside a case-file dialog, outside the page scroll: finish every
// pending reveal and counter in it at once (they would otherwise wait for a scroll that never comes).
window.addEventListener('revealall', (e) => {
  const root = e.detail?.root;
  if (!(root instanceof Element)) return;
  root.setAttribute('data-reveal-done', '');
  for (const st of ScrollTrigger.getAll()) {
    if (!(st.trigger instanceof Element) || !root.contains(st.trigger)) continue;
    st.animation?.progress(1);
    st.kill();
  }
});

// data-reveal="…" → animation factory. Split reveals return their tween from onSplit, so
// SplitText can revert and rebuild it when fonts load or the line breaks change.
// Opacity only (never autoAlpha/visibility): links in a not-yet-revealed card must stay focusable,
// and focusing one scrolls it into view, which plays its reveal.
const REVEALS = {
  'fade-up': (el) =>
    hold(el, gsap.from(el, {
      y: 48,
      opacity: 0,
      duration: 1.1,
      ease: 'expo.out',
      delay: delayOf(el),
      scrollTrigger: triggerFor(el),
    })),

  'mask-lines': (el) =>
    SplitText.create(el, {
      type: 'lines',
      mask: 'lines',
      linesClass: 'split-line',
      aria: 'none', // P11: the default adds aria-label to the <p>, which ARIA prohibits; the text stays readable in the DOM
      autoSplit: true,
      onSplit: (self) =>
        hold(el, gsap.from(self.lines, {
          yPercent: 110,
          duration: 1.1,
          ease: 'expo.out',
          stagger: 0.08,
          delay: delayOf(el),
          scrollTrigger: triggerFor(el),
        })),
    }),

  chars: (el) =>
    SplitText.create(el, {
      type: 'words,chars',
      aria: 'none',
      autoSplit: true,
      onSplit: (self) =>
        hold(el, gsap.from(self.chars, {
          yPercent: 70,
          opacity: 0,
          duration: 0.9,
          ease: 'expo.out',
          stagger: 0.03,
          delay: delayOf(el),
          scrollTrigger: triggerFor(el),
        })),
    }),

  // The card rises, then its [data-reveal-item] children (chips) follow in a quick stagger.
  stagger: (el) =>
    hold(el, gsap
      .timeline({ delay: delayOf(el), scrollTrigger: triggerFor(el) })
      .from(el, { y: 40, opacity: 0, duration: 1, ease: 'expo.out' })
      .from(el.querySelectorAll('[data-reveal-item]'), { y: 14, opacity: 0, duration: 0.6, ease: 'expo.out', stagger: 0.04 }, '-=0.7')),

  'type-on': (el) =>
    SplitText.create(el, {
      type: 'words,chars',
      aria: 'none',
      onSplit: (self) =>
        hold(el, gsap.from(self.chars, {
          opacity: 0,
          duration: 0.01,
          stagger: 0.035,
          ease: 'none',
          delay: delayOf(el),
          scrollTrigger: triggerFor(el),
        })),
    }),
};

/** Yield to the main thread so start-up never becomes one long task (Lighthouse TBT). */
export const yieldToMain = () =>
  globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0));

// Each SplitText measures layout after the previous one mutated the DOM, so every reveal costs a
// layout pass: one element per task keeps each task short.
async function initReveals() {
  for (const el of document.querySelectorAll('[data-reveal]')) {
    REVEALS[el.dataset.reveal]?.(el);
    await yieldToMain();
  }
}

// data-count="12" (optional data-count-suffix="+") rolls the number up when it scrolls into view.
// Pair the animated element with aria-hidden and a visually hidden final value for screen readers.
function initCounters() {
  for (const el of document.querySelectorAll('[data-count]')) {
    const raw = el.dataset.count;
    const end = Number.parseFloat(raw);
    if (!Number.isFinite(end)) continue;
    const decimals = (raw.split('.')[1] ?? '').length;
    const suffix = el.dataset.countSuffix ?? '';
    const state = { value: 0 };
    const render = () => {
      el.textContent = `${state.value.toFixed(decimals)}${suffix}`;
    };
    render();
    gsap.to(state, { value: end, duration: 1.8, ease: 'expo.out', onUpdate: render, scrollTrigger: triggerFor(el) });
  }
}

/** Lenis + ticker (synchronous: the start screen and nav need the instance). */
export function initMotion({ reduced }) {
  if (reduced) return;

  // P3.4: a short wheel ease; trackpads, touch and the keyboard scroll natively (scroll-rules.js).
  lenis = new Lenis({ ...LENIS_OPTIONS, virtualScroll: ({ event }) => !nativeWheel(event) });
  // A scroll key (arrows, Page Up/Down, Space, Home/End) stops any smooth wheel scroll in flight, so the
  // browser's own keyboard scrolling takes over at once instead of being pulled back.
  window.addEventListener('keydown', (event) => {
    if (lenis?.isScrolling === 'smooth' && isScrollKey(event)) lenis.scrollTo(window.scrollY, { immediate: true, force: true });
  });
  // Explore mode covers the page: no smooth scrolling underneath it.
  window.addEventListener('modechange', (e) => (e.detail.mode === 'explore' ? lenis?.stop() : lenis?.start()));
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}

/** Reveal start states + counters, spread over many short tasks. Resolve before data-motion=ready. */
export async function initRevealMotion({ reduced }) {
  if (reduced) return;
  await initReveals();
  initCounters();

  // Line breaks and trigger positions settle once the web fonts are in.
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
}
