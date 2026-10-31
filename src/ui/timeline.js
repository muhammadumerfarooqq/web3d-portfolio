// Journey timeline: the aurora line draws with scroll (scrub on scaleY) and each node lights up when
// the line reaches it. Without JS or under reduced motion the CSS shows the full line, all nodes lit.
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// The line's tip tracks this viewport position, so nodes light exactly as the tip passes them.
const TIP = 'top 65%';

export function initTimeline({ reduced }) {
  const timeline = document.querySelector('[data-timeline]');
  if (!timeline || reduced) return;

  const progress = timeline.querySelector('[data-timeline-progress]');
  timeline.classList.add('is-animated');

  gsap.fromTo(
    progress,
    { scaleY: 0 },
    { scaleY: 1, ease: 'none', scrollTrigger: { trigger: timeline, start: TIP, end: 'bottom 65%', scrub: 0.6 } },
  );

  for (const item of timeline.querySelectorAll('[data-timeline-item]')) {
    ScrollTrigger.create({
      trigger: item.querySelector('.timeline__node') ?? item,
      start: TIP,
      onEnter: () => item.classList.add('is-lit'),
      onLeaveBack: () => item.classList.remove('is-lit'),
    });
  }
}
