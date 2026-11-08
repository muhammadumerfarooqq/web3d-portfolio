import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { collectAnchors, loadContent, parseContentFile, validate } from '../scripts/content/load.mjs';
import { contentPlugin } from '../scripts/content/plugin.mjs';
import { escapeHtml, metaDescription } from '../scripts/content/render.mjs';
import { FILE_SCHEMAS, profileSchema, projectSchema } from '../src/shared/content-schema.js';
import { buildSite, ROOT } from './helpers/build-site.js';

const CONTENT = join(ROOT, 'content');
const topLevel = Object.keys(FILE_SCHEMAS);
const projectFiles = readdirSync(join(CONTENT, 'projects')).filter((f) => f.endsWith('.md'));
const parse = (path, file) => parseContentFile(readFileSync(path, 'utf8'), file);

describe('content files pass their schemas', () => {
  it.each(topLevel)('content/%s', (name) => {
    const { data } = parse(join(CONTENT, name), name);
    expect(() => validate(FILE_SCHEMAS[name], data, name)).not.toThrow();
  });

  it.each(projectFiles)('content/projects/%s', (name) => {
    const { data } = parse(join(CONTENT, 'projects', name), name);
    expect(() => validate(projectSchema, data, name)).not.toThrow();
  });

  it('a typo’d key fails with the file and field (.strict)', () => {
    const { data } = parse(join(CONTENT, 'profile.md'), 'profile.md');
    expect(() => validate(profileSchema, { ...data, nmae: 'typo' }, 'content/profile.md')).toThrow(/content\/profile\.md.*nmae/s);
  });

  it('every rendered anchor is unique', () => {
    const { content } = loadContent(ROOT);
    const anchors = collectAnchors(content);
    expect(new Set(anchors).size).toBe(anchors.length);
    expect(anchors).toEqual(expect.arrayContaining(['home', 'about', 'skills', 'experience', 'education', 'achievement-best-fydp']));
  });
});

describe('build output', () => {
  let site;
  let content;
  beforeAll(async () => {
    site = await buildSite();
    ({ content } = loadContent(ROOT));
  }, 120_000);

  it('overdrive (draft: true) is absent from the built HTML', () => {
    expect(content.projects.find((p) => p.slug === 'overdrive')?.draft).toBe(true);
    expect(site.indexHtml).not.toMatch(/overdrive/i);
  });

  it('overdrive is absent from virtual:content', () => {
    const plugin = contentPlugin();
    plugin.configResolved({ root: ROOT });
    const code = plugin.load('\0virtual:content');
    expect(code).not.toMatch(/overdrive/i);
    const data = JSON.parse(code.replace(/^export default /, '').replace(/;\s*$/, ''));
    expect(data.projects.map((p) => p.slug).sort()).toEqual(
      content.projects.filter((p) => !p.draft).map((p) => p.slug).sort(),
    );
    expect(JSON.stringify(data)).not.toMatch(/"draft"/);
  });

  it('the built index.html contains each rendered section', () => {
    const html = site.indexHtml;
    expect(html).not.toMatch(/<!--\s*content:/);
    for (const id of ['home', 'about', 'skills', 'journey', 'experience', 'education']) {
      expect(html, `#${id}`).toMatch(new RegExp(`id="${id}"`));
    }
    expect(html).toContain('class="profile-card');
    expect(html).toContain('data-marquee');
    expect(html).toContain('data-timeline');
    for (const stat of content.about.stats) expect(html).toContain(escapeHtml(stat.label));
    for (const category of content.skills.categories) expect(html).toContain(escapeHtml(category.name));
    expect(html).toContain(escapeHtml(content.experience.roles[0].company));
    expect(html).toContain(escapeHtml(content.education.entries[0].degree));
    expect(html).toContain('href="#achievement-best-fydp"');
  });

  it('meta description and og:description come from profile.md', () => {
    const description = escapeHtml(metaDescription(content.profile));
    expect(site.indexHtml).toContain(`<meta name="description" content="${description}"`);
    expect(site.indexHtml).toContain(`<meta property="og:description" content="${description}"`);
  });

  it('footer, mobile-menu and contact social links come from profile.links only', () => {
    const source = readFileSync(join(ROOT, 'index.html'), 'utf8');
    expect(source).not.toMatch(/linkedin\.com|github\.com/i); // no hard-coded copies left
    const block = (open) => {
      const i = site.indexHtml.indexOf(open);
      return site.indexHtml.slice(i, site.indexHtml.indexOf('</ul>', i));
    };
    for (const open of ['<ul class="mobile-menu__social">', '<ul class="social-list">']) {
      const hrefs = [...block(open).matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      expect(hrefs, open).toEqual([content.profile.links.linkedin, content.profile.links.github]);
    }
    expect(site.indexHtml.match(new RegExp(content.profile.links.linkedin.replace(/[.]/g, '\\.'), 'g')).length).toBeGreaterThanOrEqual(4);
  });

  it('admin/index.html receives no content', () => {
    expect(site.adminHtml).not.toContain('profile-card');
    expect(site.adminHtml).not.toContain(content.profile.headline);
  });
});

describe('section numbering', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const sections = [...html.matchAll(/<section id="([a-z-]+)"[^>]*data-index="(\d\d)" data-label="([^"]+)"/g)].map(([, id, index, label]) => ({ id, index, label }));

  it('sections are numbered 00…08 in order, with no gaps', () => {
    expect(sections.map((s) => s.id)).toEqual(['home', 'about', 'skills', 'projects', 'achievements', 'journey', 'video', 'chat', 'contact']);
    expect(sections.map((s) => s.index)).toEqual(sections.map((_, i) => String(i).padStart(2, '0')));
  });

  // P2.5: the typewriter eyebrow uses case-file wording ("03 · The bounty board"). The section number
  // must still be its own, and the real heading (h2 / h1) next to it is unchanged.
  it('each section eyebrow starts with its own number (home: the case-file header)', () => {
    for (const s of sections) {
      const block = html.slice(html.indexOf(`<section id="${s.id}"`));
      const hud = block.match(/class="hud-label"[^>]*>([^<]+)</)[1];
      if (s.index === '00') expect(hud).toMatch(/^Case file No\. \d+ · /);
      else expect(hud, s.id).toMatch(new RegExp(`^${s.index} · \\S`));
    }
  });

  it('desktop nav and mobile menu point at real sections; menu numbers equal HUD numbers', () => {
    const byId = Object.fromEntries(sections.map((s) => [s.id, s]));
    const desktop = [...html.matchAll(/class="nav-link" href="#([a-z-]+)"/g)].map((m) => m[1]);
    expect(desktop.length).toBe(8);
    for (const id of desktop) expect(byId[id], `nav → #${id}`).toBeDefined();

    const mobile = [...html.matchAll(/class="mobile-menu__link" href="#([a-z-]+)"[^>]*><span class="mobile-menu__num"[^>]*>(\d\d)</g)];
    expect(mobile.map((m) => m[1])).toEqual(desktop);
    for (const [, id, num] of mobile) expect(num, `menu number for #${id}`).toBe(byId[id].index);
  });
});
