// Journey timeline: the aurora line draws with scroll (scrub on scaleY), nodes light up when the
// line reaches them, and the sticky outlined year (desktop) swaps to the active entry's year.
// Without JS or under reduced motion the CSS shows the full line with every node lit; the year
// still follows the scroll, just without animation.
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// The line's tip tracks this viewport position, so nodes light exactly as the tip passes them.
const TIP = 'top 65%';

export function initTimeline({ reduced }) {
  const timeline = document.querySelector('[data-timeline]');
  if (!timeline) return;

  const items = [...timeline.querySelectorAll('[data-timeline-item]')];
  const year = timeline.querySelector('[data-timeline-year]');
  let activeYear = year?.textContent ?? '';

  const showYear = (value) => {
    if (!year || !value || value === activeYear) return;
    activeYear = value;
    year.textContent = value;
    if (!reduced) gsap.fromTo(year, { yPercent: 18, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.7, ease: 'expo.out' });
  };

  if (!reduced) {
    timeline.classList.add('is-animated');
    gsap.fromTo(
      timeline.querySelector('[data-timeline-progress]'),
      { scaleY: 0 },
      { scaleY: 1, ease: 'none', scrollTrigger: { trigger: timeline, start: TIP, end: 'bottom 65%', scrub: 0.6 } },
    );
  }

  items.forEach((item, i) => {
    ScrollTrigger.create({
      trigger: item.querySelector('.timeline__node') ?? item,
      start: TIP,
      onEnter: () => {
        item.classList.add('is-lit');
        showYear(item.dataset.entryYear);
      },
      onLeaveBack: () => {
        item.classList.remove('is-lit');
        showYear(items[Math.max(0, i - 1)].dataset.entryYear);
      },
    });
  });
}
