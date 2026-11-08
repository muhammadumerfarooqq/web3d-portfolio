// Achievements lightbox: a[data-lightbox] links (which open the image directly without JS) show
// the photo in a native <dialog>. Caption from data-caption; ←/→ when there are several photos.
import { setupDialog } from './dialog.js';

const LOCAL_IMAGE = /^\/images\/[A-Za-z0-9._/-]+$/;

export function initLightbox() {
  const dialog = document.querySelector('[data-lightbox-dialog]');
  const links = [...document.querySelectorAll('a[data-lightbox]')].filter((a) => LOCAL_IMAGE.test(a.getAttribute('href') ?? ''));
  if (!dialog || links.length === 0) return;

  const img = dialog.querySelector('[data-lightbox-img]');
  const caption = dialog.querySelector('[data-lightbox-caption]');
  const prev = dialog.querySelector('[data-lightbox-prev]');
  const next = dialog.querySelector('[data-lightbox-next]');
  const several = links.length > 1;
  prev.hidden = !several;
  next.hidden = !several;
  let index = 0;

  const ui = setupDialog(dialog, {
    onClose: () => img.removeAttribute('src'),
  });

  const show = (i) => {
    index = (i + links.length) % links.length;
    const link = links[index];
    img.src = link.getAttribute('href');
    img.alt = link.querySelector('img')?.alt ?? '';
    caption.textContent = link.dataset.caption ?? '';
  };

  links.forEach((link, i) => {
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      show(i);
      ui.open(link);
    });
  });

  prev.addEventListener('click', () => show(index - 1));
  next.addEventListener('click', () => show(index + 1));
  dialog.addEventListener('keydown', (event) => {
    if (!several) return;
    if (event.key === 'ArrowRight') show(index + 1);
    else if (event.key === 'ArrowLeft') show(index - 1);
  });
}
