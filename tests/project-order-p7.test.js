// P7: the pure ordering logic (shared by the admin API, the admin page and the public gallery) and the
// "Featured" sort with a saved order.
import { describe, expect, it } from 'vitest';
import { applyRanks, mergeOrder, move, validateOrder } from '../src/shared/project-order.js';
import { sortProjects } from '../src/ui/projects/filter.js';

const SLUGS = ['a', 'b', 'c', 'd'];

describe('P7 ordering logic', () => {
  it('validateOrder accepts known slugs once each (a subset is fine) and refuses everything else', () => {
    expect(validateOrder(['c', 'a'], SLUGS)).toEqual({ ok: true, order: ['c', 'a'] });
    expect(validateOrder(SLUGS, SLUGS).ok).toBe(true);
    expect(validateOrder(['a', 'zzz'], SLUGS)).toEqual({ ok: false, reason: 'unknown' });
    expect(validateOrder(['a', 'a'], SLUGS)).toEqual({ ok: false, reason: 'duplicate' });
    expect(validateOrder([], SLUGS).ok).toBe(false);
    expect(validateOrder([...SLUGS, 'e'], SLUGS).ok).toBe(false);
    for (const bad of [null, undefined, 'a', { 0: 'a' }, [1], [null], [['a']], ['__proto__'], ['constructor']]) expect(validateOrder(bad, SLUGS).ok, JSON.stringify(bad)).toBe(false);
  });

  it('mergeOrder: saved first, then never-saved projects in the built-in order; unknown and repeated saved slugs are dropped', () => {
    expect(mergeOrder(['c', 'a'], SLUGS)).toEqual(['c', 'a', 'b', 'd']);
    expect(mergeOrder(['ghost', 'd', 'd', 'b'], SLUGS)).toEqual(['d', 'b', 'a', 'c']);
    expect(mergeOrder([], SLUGS)).toEqual(SLUGS);
    expect(mergeOrder(undefined, SLUGS)).toEqual(SLUGS);
    expect(mergeOrder('abc', SLUGS)).toEqual(SLUGS);
  });

  it('move: up, down, to a position; clamped; the input is never mutated', () => {
    const list = ['a', 'b', 'c', 'd'];
    expect(move(list, 2, 1)).toEqual(['a', 'c', 'b', 'd']);
    expect(move(list, 1, 2)).toEqual(['a', 'c', 'b', 'd']);
    expect(move(list, 0, 3)).toEqual(['b', 'c', 'd', 'a']);
    expect(move(list, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(move(list, 0, -1)).toEqual(list);
    expect(move(list, 3, 99)).toEqual(list);
    expect(move(list, 7, 0)).toEqual(list);
    expect(move(list, -1, 0)).toEqual(list);
    expect(list).toEqual(['a', 'b', 'c', 'd']);
  });

  it('applyRanks gives ranks from the saved order, leaves the others unranked and counts them', () => {
    const projects = SLUGS.map((slug, order) => ({ slug, order, featured: order === 0 }));
    expect(applyRanks(projects, ['c', 'a', 'ghost'])).toBe(2);
    expect(projects.map((p) => p.rank)).toEqual([1, undefined, 0, undefined]);
    expect(applyRanks(projects, [])).toBe(0);
    expect(projects.every((p) => p.rank === undefined)).toBe(true);
    expect(applyRanks(projects, 'nope')).toBe(0);
  });

  it('the Featured sort puts ranked projects first by rank, then the rest by the built-in rule', () => {
    const projects = SLUGS.map((slug, order) => ({ slug, order, featured: order === 0, year: 2026, title: slug.toUpperCase() }));
    expect(sortProjects(projects, 'featured').map((p) => p.slug)).toEqual(['a', 'b', 'c', 'd']);
    applyRanks(projects, ['d', 'c', 'b', 'a']);
    expect(sortProjects(projects, 'featured').map((p) => p.slug)).toEqual(['d', 'c', 'b', 'a']);
    applyRanks(projects, ['d', 'b']); // a project added later is unranked: it follows the ranked ones, in the built-in order
    expect(sortProjects(projects, 'featured').map((p) => p.slug)).toEqual(['d', 'b', 'a', 'c']);
    applyRanks(projects, ['d', 'c', 'b', 'a']);
    expect(sortProjects(projects, 'az').map((p) => p.slug)).toEqual(['a', 'b', 'c', 'd']); // other sorts are untouched
  });
});
