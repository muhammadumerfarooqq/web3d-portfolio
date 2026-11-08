// Project detail modal: native <dialog> filled from the card's pre-rendered <details> (cloned
// nodes, never HTML strings). A View Transition morphs the card cover into the modal hero.
// #project-<slug> deep links and hash changes open it; closing returns focus to the opener.
import { setupDialog } from '../dialog.js';
import { initPlayer, pausePlayers } from '../video.js';

const HASH = /^#project-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const COVER_NAME = 'project-cover';

export function initProjectModal({ reduced, root, bySlug }) {
  const dialog = document.querySelector('[data-project-modal]');
  if (!dialog) return null;

  const hero = dialog.querySelector('[data-modal-hero]');
  const meta = dialog.querySelector('[data-modal-meta]');
  const title = dialog.querySelector('[data-modal-title]');
  const tagline = dialog.querySelector('[data-modal-tagline]');
  const body = dialog.querySelector('[data-modal-body]');
  let currentSlug = null;

  const itemFor = (slug) => root.querySelector(`[data-project="${CSS.escape(slug)}"]`);
  const canMorph = () => !reduced && typeof document.startViewTransition === 'function';

  const setHash = (slug) => {
    const hash = slug ? `#project-${slug}` : '';
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${hash}`);
  };

  function fill(slug) {
    const card = itemFor(slug).querySelector('.project-card');
    const project = bySlug.get(slug);
    hero.replaceChildren(card.querySelector('[data-project-cover]').firstElementChild.cloneNode(true));
    meta.replaceChildren(card.querySelector('.project-card__meta').cloneNode(true));
    title.textContent = project.title;
    tagline.textContent = project.tagline;
    const detail = card.querySelector('[data-project-detail]').cloneNode(true);
    body.replaceChildren(detail);
    // A project video becomes the hero (the cover morphs straight into the player).
    const player = detail.querySelector('[data-player]');
    hero.classList.toggle('modal__hero--player', Boolean(player));
    if (player) {
      hero.replaceChildren(player);
      initPlayer(player);
    }
    dialog.scrollTop = 0;
  }

  function finishClose() {
    dialog.close();
  }

  // Close (Esc, button, backdrop) morphs the hero back into the card when the card is visible.
  function requestClose() {
    pausePlayers(body);
    const item = currentSlug ? itemFor(currentSlug) : null;
    const cover = item && !item.hidden ? item.querySelector('[data-project-cover]') : null;
    if (!cover || !canMorph()) {
      finishClose();
      return;
    }
    hero.style.viewTransitionName = COVER_NAME;
    const transition = document.startViewTransition(() => {
      hero.style.viewTransitionName = '';
      cover.style.viewTransitionName = COVER_NAME;
      finishClose();
    });
    transition.finished.finally(() => {
      cover.style.viewTransitionName = '';
    });
  }

  const ui = setupDialog(dialog, {
    onRequestClose: requestClose,
    onClose: () => {
      body.replaceChildren();
      hero.replaceChildren();
      meta.replaceChildren();
      currentSlug = null;
      if (HASH.test(window.location.hash)) setHash(null);
    },
  });

  function open(slug, trigger, { morph = true } = {}) {
    if (!bySlug.has(slug)) return;
    const item = itemFor(slug);
    const opener = trigger ?? item.querySelector('[data-project-open]');
    const show = () => {
      fill(slug);
      currentSlug = slug;
      ui.open(opener);
      setHash(slug);
    };
    const cover = item.querySelector('[data-project-cover]');
    if (dialog.open || !morph || !canMorph() || item.hidden) {
      show();
      return;
    }
    cover.style.viewTransitionName = COVER_NAME;
    const transition = document.startViewTransition(() => {
      cover.style.viewTransitionName = '';
      show();
      hero.style.viewTransitionName = COVER_NAME;
    });
    transition.finished.finally(() => {
      hero.style.viewTransitionName = '';
    });
  }

  // "Details" summaries: open the modal instead of expanding the no-JS disclosure.
  root.addEventListener('click', (event) => {
    const summary = event.target instanceof Element ? event.target.closest('[data-project-open]') : null;
    if (!summary) return;
    event.preventDefault();
    open(summary.dataset.projectOpen, summary);
  });

  // Links to #project-<slug> anywhere (e.g. journey chips) open the modal. Capture phase, so the
  // smooth-scroll handler in nav.js sees defaultPrevented and leaves them alone.
  document.addEventListener(
    'click',
    (event) => {
      const link = event.target instanceof Element ? event.target.closest('a[href^="#project-"]') : null;
      if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const m = link.getAttribute('href').match(HASH);
      if (!m || !bySlug.has(m[1])) return;
      event.preventDefault();
      open(m[1], link);
    },
    true,
  );

  const openFromHash = () => {
    const m = window.location.hash.match(HASH);
    if (m && bySlug.has(m[1]) && currentSlug !== m[1]) open(m[1], null, { morph: false });
  };
  window.addEventListener('hashchange', openFromHash);
  openFromHash();

  return { open };
}
