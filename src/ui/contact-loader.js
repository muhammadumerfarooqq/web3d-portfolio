// P4: loads the contact form chunk (validation, Turnstile, submit) only when the Telegraph section
// comes near the viewport (or gets keyboard focus). In Explore the section is shown inside the
// Telegraph case file, which brings it on screen the same way. Kept tiny: it ships in Classic's entry.
export function initContactLoader() {
  const box = document.querySelector('[data-contact]');
  if (!box) return;
  let started = false;
  let io = null;
  const start = () => {
    if (started) return;
    started = true;
    io?.disconnect();
    import('./contact.js').then((m) => m.initContact(box)).catch(() => {});
  };
  box.addEventListener('focusin', start, { once: true });
  if (!('IntersectionObserver' in window)) return start();
  io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && start(), { rootMargin: '400px 0px' });
  io.observe(box);
}
