// Shared native <dialog> behaviour: showModal, backdrop click, [data-dialog-close] buttons, Lenis
// paused while open, and focus returned to whatever opened it.
import { getLenis } from './motion.js';

export function setupDialog(dialog, { onClose, onRequestClose } = {}) {
  let trigger = null;

  // Esc / close button / backdrop all go through one path, so callers can animate the close.
  const requestClose = () => (onRequestClose ? onRequestClose() : dialog.close());

  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    requestClose();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) requestClose(); // a click on the ::backdrop targets the dialog itself
  });
  for (const button of dialog.querySelectorAll('[data-dialog-close]')) button.addEventListener('click', requestClose);

  dialog.addEventListener('close', () => {
    document.documentElement.classList.remove('dialog-open');
    getLenis()?.start();
    onClose?.();
    const back = trigger;
    trigger = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
  });

  return {
    open(from) {
      trigger = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      if (!dialog.open) dialog.showModal();
      document.documentElement.classList.add('dialog-open');
      getLenis()?.stop();
    },
    close: () => dialog.open && dialog.close(),
    requestClose,
  };
}
