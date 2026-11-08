// Control C8: DOM-sink and URL-state hygiene.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ContentError, parseContentFile } from '../../scripts/content/load.mjs';
import { MAX_QUERY, parseState, serializeState } from '../../src/ui/projects/filter.js';
import { buildSite, ROOT } from '../helpers/build-site.js';

function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? jsFiles(path) : path.endsWith('.js') ? [path] : [];
  });
}

const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('C8 no HTML-string DOM sinks in src/', () => {
  const files = jsFiles(join(ROOT, 'src'));

  it('scans every source module', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each([
    ['innerHTML', /\.innerHTML\b/],
    ['outerHTML', /\.outerHTML\b/],
    ['insertAdjacentHTML', /insertAdjacentHTML/],
    ['document.write', /document\.write(?:ln)?\s*\(/],
    ['eval(', /(?<![\w.])eval\s*\(/],
    ['new Function', /new\s+Function\s*\(/],
    ['setTimeout/setInterval with a string', /set(?:Timeout|Interval)\s*\(\s*['"`]/],
  ])('no %s', (_name, pattern) => {
    for (const file of files) {
      expect(stripComments(readFileSync(file, 'utf8')), file).not.toMatch(pattern);
    }
  });
});

describe('C8 hostile URL parameters are ignored or truncated', () => {
  const known = { categories: ['AI & RAG', 'Games & 3D'], stacks: ['Python', 'Docker'] };

  it('unknown category, stack and sort values are dropped', () => {
    const state = parseState('?cat=..%2F..%2Fx&stack=%22%20onmouseover%3D%22alert(1)&stack=Python&sort=evil', known);
    expect(state.cat).toBe('');
    expect(state.stacks).toEqual(['Python']);
    expect(state.sort).toBe('featured');
  });

  it('a script payload in q stays plain text and is capped', () => {
    const state = parseState(`?q=${encodeURIComponent('<script>alert(1)</script>')}`, known);
    expect(state.q).toBe('<script>alert(1)</script>'); // only ever assigned to input.value / textContent
    expect(typeof state.q).toBe('string');
  });

  it(`a 10,000-character q is truncated to ${MAX_QUERY}`, () => {
    const state = parseState(`?q=${'A'.repeat(10_000)}`, known);
    expect(state.q).toHaveLength(MAX_QUERY);
  });

  it('serialising a hostile state only emits allow-listed keys', () => {
    const state = parseState('?cat=x&stack=y&q=hi&sort=z&evil=1&__proto__=1', known);
    expect(serializeState(state)).toBe('?q=hi');
  });

  it('the gallery assigns the query only through value/textContent', () => {
    const gallery = stripComments(readFileSync(join(ROOT, 'src/ui/projects/gallery.js'), 'utf8'));
    expect(gallery).toMatch(/search\.value = state\.q/);
    expect(gallery).toMatch(/mark\.textContent = /);
    expect(gallery).not.toMatch(/\.innerHTML|insertAdjacentHTML/);
  });
});

describe('C8 card and modal links', () => {
  let site;
  beforeAll(async () => {
    site = await buildSite();
  }, 120_000);

  it('are http(s) or site-relative only; external ones carry rel="noopener noreferrer"', () => {
    const start = site.indexHtml.indexOf('data-gallery');
    const end = site.indexHtml.indexOf('id="achievements"');
    const gallery = site.indexHtml.slice(start, end);
    const anchors = [...gallery.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
    expect(anchors.length).toBeGreaterThan(0);
    for (const tag of anchors) {
      const href = tag.match(/href="([^"]*)"/)?.[1] ?? '';
      expect(href, tag).toMatch(/^(?:https?:\/\/|\/(?!\/)|#)/);
      if (/^https?:/.test(href)) expect(tag, tag).toMatch(/rel="noopener noreferrer"/);
    }
    // Media sources inside the gallery are local files only.
    for (const [, src] of gallery.matchAll(/\s(?:src|poster)="([^"]*)"/g)) expect(src).toMatch(/^\/(?:images|video)\//);
  });
});

describe('C8 / A1 unbalanced-bracket guard', () => {
  const fixture = (name) => readFileSync(join(ROOT, 'tests/fixtures/content', name), 'utf8');

  it('a YAML flow list split inside brackets fails with file and field', () => {
    expect(() => parseContentFile(fixture('unbalanced-brackets.md'), 'unbalanced-brackets.md')).toThrow(ContentError);
    expect(() => parseContentFile(fixture('unbalanced-brackets.md'), 'unbalanced-brackets.md')).toThrow(/unbalanced-brackets\.md: items\.0: unbalanced brackets/);
  });

  it('the quoted form passes', () => {
    const quoted = fixture('unbalanced-brackets.md').replace('[Vector databases (ChromaDB, pgvector), Python]', '["Vector databases (ChromaDB, pgvector)", Python]');
    expect(parseContentFile(quoted, 'quoted.md').data.items).toEqual(['Vector databases (ChromaDB, pgvector)', 'Python']);
  });
});
