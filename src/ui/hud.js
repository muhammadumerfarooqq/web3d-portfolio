// HUD: aurora scroll-progress bar and the left-edge section index ("03 — PROJECTS").

function initProgress() {
  const bar = document.querySelector('[data-progress-bar]');
  if (!bar) return;
  let queued = false;

  const update = () => {
    queued = false;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    bar.style.transform = `scaleX(${progress})`;
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };

  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  update();
}

function initSectionIndex(reduced) {
  const index = document.querySelector('[data-section-index]');
  if (!index) return;
  const num = index.querySelector('[data-section-index-num]');
  const label = index.querySelector('[data-section-index-label]');
  let timer = 0;

  window.addEventListener('sectionchange', (event) => {
    const { index: n, label: text } = event.detail;
    const apply = () => {
      num.textContent = n ?? '';
      label.textContent = text ?? '';
      index.classList.remove('is-changing');
    };
    window.clearTimeout(timer);
    if (reduced) {
      apply();
      return;
    }
    index.classList.add('is-changing');
    timer = window.setTimeout(apply, 200); // swap while faded out
  });
}

export function initHud({ reduced }) {
  initProgress();
  initSectionIndex(reduced);
}
