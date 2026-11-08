// Pure gallery logic (no DOM): filtering, sorting, search terms, highlight ranges and URL state.
// Every value read from the URL is whitelisted; the query is trimmed and only ever used as text.

export const SORTS = ['featured', 'newest', 'az'];
export const DEFAULT_SORT = 'featured';
export const MAX_QUERY = 60;

const fold = (s) =>
  String(s)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Collapse whitespace, trim, cap at MAX_QUERY characters. */
export function cleanQuery(q) {
  return String(q ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY);
}

export function queryTerms(q) {
  return fold(cleanQuery(q)).split(' ').filter(Boolean);
}

function haystack(project) {
  return fold([project.title, project.tagline, ...project.stack, ...project.highlights, project.bodyText ?? ''].join(' '));
}

/** Category: exact; stacks: any selected (OR); search: every term somewhere in the text (AND). */
export function matchesProject(project, { cat = '', stacks = [], q = '' }) {
  if (cat && !project.categories.includes(cat)) return false;
  if (stacks.length && !stacks.some((s) => project.stack.includes(s))) return false;
  const terms = queryTerms(q);
  if (terms.length) {
    const text = haystack(project);
    if (!terms.every((t) => text.includes(t))) return false;
  }
  return true;
}

const COMPARE = {
  featured: (a, b) => Number(b.featured) - Number(a.featured) || a.order - b.order,
  newest: (a, b) => b.year - a.year || a.order - b.order,
  az: (a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }) || a.order - b.order,
};

export function sortProjects(projects, sort) {
  return [...projects].sort(COMPARE[SORTS.includes(sort) ? sort : DEFAULT_SORT]);
}

export function filterProjects(projects, state) {
  return sortProjects(
    projects.filter((p) => matchesProject(p, state)),
    state.sort,
  );
}

export const isFiltered = (state) => Boolean(state.cat || state.stacks.length || state.q);

/** Read state from a query string; anything not on the allow-lists is dropped. */
export function parseState(search, { categories, stacks }) {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(String(search ?? ''));
  const cat = params.get('cat') ?? '';
  const sort = params.get('sort') ?? '';
  return {
    cat: categories.includes(cat) ? cat : '',
    stacks: [...new Set(params.getAll('stack').filter((s) => stacks.includes(s)))],
    q: cleanQuery(params.get('q') ?? ''),
    sort: SORTS.includes(sort) ? sort : DEFAULT_SORT,
  };
}

/** "?cat=…&stack=…&q=…&sort=…" with defaults omitted ("" when nothing is set). */
export function serializeState(state) {
  const params = new URLSearchParams();
  if (state.cat) params.set('cat', state.cat);
  for (const s of state.stacks) params.append('stack', s);
  const q = cleanQuery(state.q);
  if (q) params.set('q', q);
  if (state.sort && state.sort !== DEFAULT_SORT) params.set('sort', state.sort);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** Merged [start, end) ranges of every term in `text` (case-insensitive), for <mark> building. */
export function highlightRanges(text, terms) {
  const lower = String(text).toLowerCase();
  const ranges = [];
  for (const term of terms) {
    if (!term) continue;
    let from = 0;
    for (let i = lower.indexOf(term, from); i !== -1; i = lower.indexOf(term, from)) {
      ranges.push([i, i + term.length]);
      from = i + term.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}
