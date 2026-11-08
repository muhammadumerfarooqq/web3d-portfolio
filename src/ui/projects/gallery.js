// Projects gallery enhancement: category chips, stack listbox, debounced search with <mark>
// highlights (built from text nodes), sort, result count, URL state and a GSAP Flip reflow.
// Cards are pre-rendered at build time; this module only filters and reorders them.
import gsap from 'gsap';
import { Flip } from 'gsap/Flip';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import content from 'virtual:content';
import { cleanQuery, filterProjects, highlightRanges, isFiltered, parseState, queryTerms, serializeState } from './filter.js';
import { initProjectModal } from './modal.js';
import { initStackSelect } from './stack-select.js';

gsap.registerPlugin(Flip, ScrollTrigger);

const SEARCH_DELAY = 150;

export function initGallery({ reduced }) {
  const root = document.querySelector('[data-gallery]');
  if (!root) return;

  const projects = content.projects;
  const bySlug = new Map(projects.map((p) => [p.slug, p]));
  const categories = [...new Set(projects.flatMap((p) => p.categories))];
  const stacks = [...new Set(projects.flatMap((p) => p.stack))];

  const grid = root.querySelector('[data-gallery-grid]');
  const items = new Map([...grid.querySelectorAll('[data-project]')].map((li) => [li.dataset.project, li]));
  const catButtons = [...root.querySelectorAll('[data-cat]')];
  const search = root.querySelector('[data-gallery-search]');
  const sort = root.querySelector('[data-gallery-sort]');
  const count = root.querySelector('[data-gallery-count]');
  const clears = [...root.querySelectorAll('[data-gallery-clear]')];
  const empty = root.querySelector('[data-gallery-empty]');
  const stackSelect = initStackSelect(root.querySelector('[data-stack-select]'), {
    onChange: (values) => update({ stacks: values }),
  });

  root.querySelector('[data-gallery-controls]').hidden = false;

  // Original text of every highlightable element, so marks can be rebuilt from scratch.
  const searchables = [...root.querySelectorAll('[data-searchable]')].map((el) => ({ el, text: el.textContent }));

  let state = parseState(window.location.search, { categories, stacks });

  function applyHighlights(terms) {
    for (const { el, text } of searchables) {
      const ranges = terms.length ? highlightRanges(text, terms) : [];
      if (ranges.length === 0) {
        if (el.childElementCount) el.textContent = text;
        continue;
      }
      const fragment = document.createDocumentFragment();
      let pos = 0;
      for (const [start, end] of ranges) {
        fragment.append(text.slice(pos, start));
        const mark = document.createElement('mark');
        mark.textContent = text.slice(start, end);
        fragment.append(mark);
        pos = end;
      }
      fragment.append(text.slice(pos));
      el.replaceChildren(fragment);
    }
  }

  function syncControls() {
    for (const b of catButtons) b.setAttribute('aria-pressed', String(b.dataset.cat === state.cat));
    if (document.activeElement !== search) search.value = state.q;
    sort.value = state.sort;
    stackSelect.setSelected(state.stacks);
  }

  function writeUrl() {
    const next = `${window.location.pathname}${serializeState(state)}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, '', next);
    }
  }

  function render({ animate = true } = {}) {
    syncControls();
    const list = filterProjects(projects, state);
    const shown = new Set(list.map((p) => p.slug));
    const flipState = animate && !reduced ? Flip.getState([...items.values()]) : null;

    for (const p of list) grid.append(items.get(p.slug));
    for (const [slug, li] of items) {
      li.hidden = !shown.has(slug);
      if (li.hidden) grid.append(li);
    }

    const filtered = isFiltered(state);
    count.textContent = list.length === 0
      ? 'No projects match'
      : filtered
        ? `Showing ${list.length} of ${projects.length} projects`
        : `${projects.length} projects`;
    empty.hidden = list.length > 0;
    clears[0].hidden = !filtered;
    applyHighlights(queryTerms(state.q));
    writeUrl();

    if (flipState) {
      Flip.from(flipState, {
        duration: 0.6,
        ease: 'expo.out',
        absolute: true,
        onEnter: (els) => gsap.fromTo(els, { opacity: 0, scale: 0.96 }, { opacity: 1, scale: 1, duration: 0.5, ease: 'expo.out' }),
        onLeave: (els) => gsap.to(els, { opacity: 0, scale: 0.96, duration: 0.3 }),
        onComplete: () => ScrollTrigger.refresh(),
      });
    } else {
      ScrollTrigger.refresh();
    }
  }

  function update(patch) {
    state = { ...state, ...patch };
    render();
  }

  for (const b of catButtons) b.addEventListener('click', () => update({ cat: b.dataset.cat }));

  let timer = 0;
  search.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => update({ q: cleanQuery(search.value) }), SEARCH_DELAY);
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && search.value) {
      event.stopPropagation();
      search.value = '';
      update({ q: '' });
    }
  });

  sort.addEventListener('change', () => update({ sort: sort.value }));

  for (const c of clears) {
    c.addEventListener('click', () => {
      search.value = '';
      update({ cat: '', stacks: [], q: '' });
      catButtons[0].focus();
    });
  }

  window.addEventListener('popstate', () => {
    state = parseState(window.location.search, { categories, stacks });
    render({ animate: false });
  });

  render({ animate: false });
  initProjectModal({ reduced, root, bySlug });
}
