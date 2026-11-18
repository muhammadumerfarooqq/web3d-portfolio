// P5: loads the chat chunk (schema, Turnstile, rendering) only when the Ask my AI section comes near the
// viewport or gets keyboard focus. In Explore the section is shown inside the Saloon's case file, which
// brings it on screen the same way. Kept tiny: it ships in Classic's entry.
export function initChatLoader() {
  const box = document.querySelector('[data-chat]');
  if (!box) return;
  let started = false;
  let io = null;
  const start = () => {
    if (started) return;
    started = true;
    io?.disconnect();
    import('./chat.js').then((m) => m.initChat(box)).catch(() => {});
  };
  box.addEventListener('focusin', start, { once: true });
  if (!('IntersectionObserver' in window)) return start();
  io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && start(), { rootMargin: '400px 0px' });
  io.observe(box);
}
