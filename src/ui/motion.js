// One motion loop (DESIGN.md §9): Lenis smooth scroll driven by gsap.ticker, ScrollTrigger updated
// from Lenis, and attribute-driven reveals. Nothing here runs under prefers-reduced-motion.
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';

gsap.registerPlugin(ScrollTrigger, SplitText);

let lenis = null;

/** The active Lenis instance, or null (reduced motion, or not initialised yet). */
export function getLenis() {
  return lenis;
}

const delayOf = (el) => Number.parseFloat(el.dataset.revealDelay) || 0;
// Inside [data-reveal-immediate] (the hero) reveals play on load; elsewhere they wait for scroll.
const triggerFor = (el) =>
  el.closest('[data-reveal-immediate]') ? undefined : { trigger: el, start: 'top 88%', once: true };

// data-reveal="…" → animation factory. Split reveals return their tween from onSplit, so
// SplitText can revert and rebuild it when fonts load or the line breaks change.
// Opacity only (never autoAlpha/visibility): links in a not-yet-revealed card must stay focusable,
// and focusing one scrolls it into view, which plays its reveal.
const REVEALS = {
  'fade-up': (el) =>
    gsap.from(el, {
      y: 48,
      opacity: 0,
      duration: 1.1,
      ease: 'expo.out',
      delay: delayOf(el),
      scrollTrigger: triggerFor(el),
    }),

  'mask-lines': (el) =>
    SplitText.create(el, {
      type: 'lines',
      mask: 'lines',
      linesClass: 'split-line',
      autoSplit: true,
      onSplit: (self) =>
        gsap.from(self.lines, {
          yPercent: 110,
          duration: 1.1,
          ease: 'expo.out',
          stagger: 0.08,
          delay: delayOf(el),
          scrollTrigger: triggerFor(el),
        }),
    }),

  chars: (el) =>
    SplitText.create(el, {
      type: 'words,chars',
      autoSplit: true,
      onSplit: (self) =>
        gsap.from(self.chars, {
          yPercent: 70,
          opacity: 0,
          duration: 0.9,
          ease: 'expo.out',
          stagger: 0.03,
          delay: delayOf(el),
          scrollTrigger: triggerFor(el),
        }),
    }),

  // The card rises, then its [data-reveal-item] children (chips) follow in a quick stagger.
  stagger: (el) =>
    gsap
      .timeline({ delay: delayOf(el), scrollTrigger: triggerFor(el) })
      .from(el, { y: 40, opacity: 0, duration: 1, ease: 'expo.out' })
      .from(el.querySelectorAll('[data-reveal-item]'), { y: 14, opacity: 0, duration: 0.6, ease: 'expo.out', stagger: 0.04 }, '-=0.7'),

  'type-on': (el) =>
    SplitText.create(el, {
      type: 'words,chars',
      onSplit: (self) =>
        gsap.from(self.chars, {
          opacity: 0,
          duration: 0.01,
          stagger: 0.035,
          ease: 'none',
          delay: delayOf(el),
          scrollTrigger: triggerFor(el),
        }),
    }),
};

function initReveals() {
  for (const el of document.querySelectorAll('[data-reveal]')) {
    REVEALS[el.dataset.reveal]?.(el);
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

export function initMotion({ reduced }) {
  if (reduced) return;

  lenis = new Lenis({ autoRaf: false, duration: 1.15, smoothWheel: true });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);

  initReveals();
  initCounters();

  // Line breaks and trigger positions settle once the web fonts are in.
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
}
