import { describe, it, expect, beforeAll } from 'vitest';
import { renderCover } from '../scripts/content/covers.mjs';
import { loadContent } from '../scripts/content/load.mjs';
import { findProjectRefs, publicData, resolveProjectRef } from '../scripts/content/render.mjs';
import {
  DEFAULT_SORT,
  MAX_QUERY,
  cleanQuery,
  filterProjects,
  highlightRanges,
  isFiltered,
  parseState,
  queryTerms,
  serializeState,
  sortProjects,
} from '../src/ui/projects/filter.js';
import { buildSite, ROOT } from './helpers/build-site.js';

const { content } = loadContent(ROOT);
const projects = publicData(content).projects;
const known = {
  categories: [...new Set(projects.flatMap((p) => p.categories))],
  stacks: [...new Set(projects.flatMap((p) => p.stack))],
};
const slugs = (list) => list.map((p) => p.slug);
const base = { cat: '', stacks: [], q: '', sort: DEFAULT_SORT };

describe('filter.js', () => {
  it('filters by category', () => {
    const out = filterProjects(projects, { ...base, cat: 'Games & 3D' });
    expect(out.length).toBeGreaterThan(0);
    for (const p of out) expect(p.categories).toContain('Games & 3D');
    expect(out.length).toBe(projects.filter((p) => p.categories.includes('Games & 3D')).length);
  });

  it('filters by stack (any selected stack matches)', () => {
    const out = filterProjects(projects, { ...base, stacks: ['Docker', 'Unreal Engine'] });
    expect(out.length).toBe(projects.filter((p) => p.stack.includes('Docker') || p.stack.includes('Unreal Engine')).length);
    for (const p of out) expect(p.stack.some((s) => s === 'Docker' || s === 'Unreal Engine')).toBe(true);
  });

  it('searches title, tagline, stack, highlights and body (every term, case/diacritic-insensitive)', () => {
    expect(slugs(filterProjects(projects, { ...base, q: 'TALEEM' }))).toContain('taleem360');
    expect(slugs(filterProjects(projects, { ...base, q: 'arcface' }))).toContain('face-recognition-attendance'); // stack
    expect(slugs(filterProjects(projects, { ...base, q: 'timezone bug' }))).toEqual(['knodesk-voice-agent']); // body only
    expect(filterProjects(projects, { ...base, q: 'zzzz-no-match' })).toEqual([]);
  });

  it('sorts: featured, newest, A–Z', () => {
    const featured = sortProjects(projects, 'featured');
    const firstNonFeatured = featured.findIndex((p) => !p.featured);
    expect(featured.slice(0, firstNonFeatured).every((p) => p.featured)).toBe(true);
    expect(featured.slice(firstNonFeatured).every((p) => !p.featured)).toBe(true);
    expect(featured[0].slug).toBe('taleem360');

    const newest = sortProjects(projects, 'newest');
    for (let i = 1; i < newest.length; i++) expect(newest[i - 1].year).toBeGreaterThanOrEqual(newest[i].year);

    const az = sortProjects(projects, 'az').map((p) => p.title);
    expect(az).toEqual([...az].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));

    expect(slugs(sortProjects(projects, 'bogus'))).toEqual(slugs(featured));
  });

  it('combines category, stack, search and sort', () => {
    const out = filterProjects(projects, { cat: 'AI & RAG', stacks: ['Python'], q: 'rag', sort: 'az' });
    for (const p of out) {
      expect(p.categories).toContain('AI & RAG');
      expect(p.stack).toContain('Python');
    }
    expect(out.map((p) => p.title)).toEqual([...out.map((p) => p.title)].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
    expect(out.length).toBeGreaterThan(0);
  });

  it('highlight ranges are merged, case-insensitive and in order', () => {
    expect(highlightRanges('RAG pipeline for rag', ['rag'])).toEqual([[0, 3], [17, 20]]);
    expect(highlightRanges('abcdef', ['bcd', 'cde'])).toEqual([[1, 5]]);
    expect(highlightRanges('nothing', [])).toEqual([]);
  });

  it('query cleaning trims, collapses spaces and caps the length', () => {
    expect(cleanQuery('  a   b  ')).toBe('a b');
    expect(cleanQuery('x'.repeat(500))).toHaveLength(MAX_QUERY);
    expect(queryTerms('Café  RAG')).toEqual(['cafe', 'rag']);
  });
});

describe('URL state', () => {
  it('round-trips parse ⇄ serialize', () => {
    const state = { cat: 'AI & RAG', stacks: ['Python', 'Docker'], q: 'rag pipeline', sort: 'az' };
    const query = serializeState(state);
    expect(parseState(query, known)).toEqual(state);
    expect(serializeState(parseState(query, known))).toBe(query);
  });

  it('omits defaults (empty state → empty query)', () => {
    expect(serializeState(base)).toBe('');
    expect(isFiltered(base)).toBe(false);
    expect(parseState('', known)).toEqual(base);
  });
});

describe('rendered gallery', () => {
  let site;
  beforeAll(async () => {
    site = await buildSite();
  }, 120_000);

  it('every non-draft project is rendered exactly once with a unique anchor; overdrive is absent', () => {
    const published = content.projects.filter((p) => !p.draft);
    for (const p of published) {
      const ids = site.indexHtml.match(new RegExp(`id="${p.anchor}"`, 'g')) ?? [];
      expect(ids.length, p.anchor).toBe(1);
      expect(site.indexHtml.match(new RegExp(`data-project="${p.slug}"`, 'g'))?.length, p.slug).toBe(1);
    }
    expect(site.indexHtml).not.toMatch(/overdrive/i);
  });

  it('every "(See project: X)" in content resolves to exactly one published project', () => {
    const sources = [content.experience, content.about, content.profile, content.education, content.achievements, content.faq, content.skills, ...content.projects];
    const refs = sources.flatMap((s) => findProjectRefs(s.body).map((ref) => [s.file, ref]));
    expect(refs.length).toBeGreaterThan(0);
    for (const [file, ref] of refs) {
      const project = resolveProjectRef(ref, content.projects, file);
      expect(site.indexHtml).toContain(`href="#${project.anchor}"`);
    }
  });

  it('a reference that matches no project fails the build', () => {
    expect(() => resolveProjectRef('No Such Project', content.projects, 'content/experience.md')).toThrow(/matches 0 published project titles/);
  });

  it('generated covers contain no data: URIs, external URLs, url() or ids', () => {
    for (const p of content.projects) {
      const svg = renderCover(p).toString();
      expect(svg).toMatch(/^<svg class="cover-art cover--/);
      expect(svg).not.toMatch(/data:/i);
      expect(svg).not.toMatch(/https?:\/\//i);
      expect(svg).not.toMatch(/url\(/i);
      expect(svg).not.toMatch(/\sid="/);
      expect(renderCover(p).toString()).toBe(svg); // deterministic
    }
  });
});
