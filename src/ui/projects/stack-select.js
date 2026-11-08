// Stack filter: a button that opens a popover multi-select listbox (WAI-ARIA listbox pattern with
// aria-activedescendant). ↑/↓/Home/End move, Space/Enter toggle, Esc closes and returns focus.

export function initStackSelect(root, { onChange }) {
  const button = root.querySelector('[data-stack-button]');
  const popover = root.querySelector('[data-stack-popover]');
  const listbox = root.querySelector('[data-stack-listbox]');
  const badge = root.querySelector('[data-stack-badge]');
  const options = [...listbox.querySelectorAll('[role="option"]')];
  let active = 0;

  const values = () => options.filter((o) => o.getAttribute('aria-selected') === 'true').map((o) => o.dataset.stack);

  const syncBadge = () => {
    const n = values().length;
    badge.hidden = n === 0;
    badge.textContent = String(n);
    button.setAttribute('aria-label', n ? `Stack, ${n} selected` : 'Stack');
  };

  const setActive = (i) => {
    active = Math.max(0, Math.min(options.length - 1, i));
    options.forEach((o, k) => o.classList.toggle('is-active', k === active));
    listbox.setAttribute('aria-activedescendant', options[active].id);
    options[active].scrollIntoView({ block: 'nearest' });
  };

  const toggleOption = (i) => {
    const option = options[i];
    option.setAttribute('aria-selected', String(option.getAttribute('aria-selected') !== 'true'));
    syncBadge();
    onChange(values());
  };

  const onOutside = (event) => {
    if (!root.contains(event.target)) close({ focusButton: false });
  };

  function open() {
    popover.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    const firstSelected = options.findIndex((o) => o.getAttribute('aria-selected') === 'true');
    setActive(firstSelected === -1 ? 0 : firstSelected);
    listbox.focus();
    document.addEventListener('pointerdown', onOutside, true);
  }

  function close({ focusButton = true } = {}) {
    if (popover.hidden) return;
    popover.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    listbox.removeAttribute('aria-activedescendant');
    document.removeEventListener('pointerdown', onOutside, true);
    if (focusButton) button.focus();
  }

  button.addEventListener('click', () => (popover.hidden ? open() : close()));
  button.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && popover.hidden) {
      event.preventDefault();
      open();
    }
  });

  listbox.addEventListener('keydown', (event) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive(active + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive(active - 1);
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(options.length - 1);
        break;
      case ' ':
      case 'Enter':
        event.preventDefault();
        toggleOption(active);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      case 'Tab':
        close({ focusButton: false });
        break;
      default:
    }
  });

  options.forEach((option, i) => {
    option.addEventListener('click', () => {
      setActive(i);
      toggleOption(i);
    });
  });

  return {
    setSelected(list) {
      for (const o of options) o.setAttribute('aria-selected', String(list.includes(o.dataset.stack)));
      syncBadge();
    },
    values,
  };
}
