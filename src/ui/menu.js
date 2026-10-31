// Full-screen mobile menu: modal dialog with focus trap, Esc to close, focus returned to the toggle.
import { getLenis } from './motion.js';

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function initMenu({ reduced }) {
  const toggle = document.querySelector('[data-menu-toggle]');
  const menu = document.querySelector('[data-menu]');
  if (!toggle || !menu) return;

  const panel = menu.querySelector('.mobile-menu__panel');
  const closeButton = menu.querySelector('[data-menu-close]');
  const background = document.querySelectorAll('[data-inert-when-menu]');
  let open = false;

  function openMenu() {
    if (open) return;
    open = true;
    menu.hidden = false;
    void menu.offsetWidth; // commit the hidden → shown change so the entrance transition runs
    menu.classList.add('is-open');
    toggle.setAttribute('aria-expanded', 'true');
    for (const el of background) el.inert = true;
    document.documentElement.classList.add('menu-open');
    getLenis()?.stop();
    menu.querySelector('[data-menu-link]')?.focus();
  }

  function closeMenu({ restoreFocus = true } = {}) {
    if (!open) return;
    open = false;
    menu.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    for (const el of background) el.inert = false;
    document.documentElement.classList.remove('menu-open');
    getLenis()?.start();

    const finish = () => {
      if (!open) menu.hidden = true;
    };
    if (reduced) {
      finish();
    } else {
      panel.addEventListener('transitionend', finish, { once: true });
      window.setTimeout(finish, 600); // in case transitionend never fires
    }
    if (restoreFocus) toggle.focus();
  }

  function trapFocus(event) {
    const items = [...menu.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  toggle.addEventListener('click', () => (open ? closeMenu() : openMenu()));
  closeButton?.addEventListener('click', () => closeMenu());

  // A link closes the menu; nav.js then scrolls to the section and focuses it.
  menu.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('[data-menu-link]')) {
      closeMenu({ restoreFocus: false });
    }
  });

  document.addEventListener('keydown', (event) => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
    } else if (event.key === 'Tab') {
      trapFocus(event);
    }
  });

  // The menu only exists below the desktop breakpoint.
  window.matchMedia('(min-width: 75rem)').addEventListener('change', (event) => {
    if (event.matches) closeMenu({ restoreFocus: false });
  });
}
