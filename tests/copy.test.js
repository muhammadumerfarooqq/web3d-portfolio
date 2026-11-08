// P2.5b: case-file copy. Visible headings and labels follow the mockup, while every landmark, nav
// item, the <title>, the meta description, the h1 and the no-JS HTML stay plain, real and accurate.
import { describe, it, expect, beforeAll } from 'vitest';
import { loadContent } from '../scripts/content/load.mjs';
import { rewardOf } from '../scripts/content/gallery.mjs';
import { buildSite, ROOT } from './helpers/build-site.js';

const strip = (html) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// id → [number, eyebrow, h2, plain landmark name]
const SECTIONS = {
  about: ['01', 'The sheriff’s office', 'Know your sheriff', 'About'],
  skills: ['02', 'The workshop', 'Tools of the trade', 'Skills'],
  projects: ['03', 'The bounty board', 'Cases I’ve closed', 'Projects'],
  achievements: ['04', 'The vault', 'Trophies in the vault', 'Achievements'],
  journey: ['05', 'The railway', 'Stations so far', 'Journey'],
  video: ['06', 'The picture house', 'Now showing', 'Video'],
  chat: ['07', 'Question the sheriff', 'Ask my AI', 'Ask my AI'],
  contact: ['08', 'The telegraph office', 'Send a telegram', 'Contact'],
};

// nav href → [visible name, plain name]
const NAV = {
  about: ['Office', 'About'],
  skills: ['Workshop', 'Skills'],
  projects: ['Bounties', 'Projects'],
  achievements: ['Vault', 'Achievements'],
  journey: ['Railway', 'Journey'],
  contact: ['Telegraph', 'Contact'],
};

let html;
let content;
beforeAll(async () => {
  html = (await buildSite()).indexHtml;
  content = loadContent(ROOT).content;
}, 120_000);

const sectionHtml = (id) => {
  const start = html.indexOf(`<section id="${id}"`);
  return html.slice(start, html.indexOf('</section>', start));
};

describe('section headings and eyebrows', () => {
  it.each(Object.entries(SECTIONS))('#%s has exactly one H2 with the new heading', (id, [, , h2]) => {
    const block = sectionHtml(id);
    const h2s = [...block.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)];
    expect(h2s).toHaveLength(1);
    expect(strip(h2s[0][1]).replace('&amp;', '&')).toBe(h2);
  });

  it.each(Object.entries(SECTIONS))('#%s eyebrow reads "NN · The …" with its real position', (id, [num, eyebrow]) => {
    const block = sectionHtml(id);
    expect(block).toContain(`data-index="${num}"`);
    expect(block.match(/class="hud-label"[^>]*>([^<]+)</)[1]).toBe(`${num} · ${eyebrow}`);
  });

  it('keeps the section order and numbers (home first, then 01 to 08)', () => {
    const ids = [...html.matchAll(/<section id="([a-z]+)" class="section[^"]*" data-section data-index="(\d\d)"/g)];
    expect(ids.map((m) => m[1])).toEqual(['home', ...Object.keys(SECTIONS)]);
    expect(ids.map((m) => m[2])).toEqual(['00', ...Object.values(SECTIONS).map((s) => s[0])]);
  });

  it.each(Object.entries(SECTIONS).filter(([id]) => id !== 'chat'))('#%s landmark has the plain name', (id, [, , , plain]) => {
    expect(sectionHtml(id)).toMatch(new RegExp(`^<section id="${id}"[^>]* aria-label="${plain}"`));
  });

  it('#chat keeps its heading as the landmark name (it is already the plain "Ask my AI")', () => {
    expect(sectionHtml('chat')).toMatch(/^<section id="chat"[^>]* aria-labelledby="chat-title"/);
  });

  it('the page has exactly one h1, the real name', () => {
    const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)];
    expect(h1s).toHaveLength(1);
    expect(strip(h1s[0][1])).toBe(content.profile.name);
  });
});

describe('navigation: case-file names with plain accessible names', () => {
  const desktopLink = (id) => [...html.matchAll(new RegExp(`<a class="nav-link" href="#${id}" data-nav-link( aria-label="([^"]+)")?>([^<]+)</a>`, 'g'))];
  const mobileLink = (id) => [...html.matchAll(new RegExp(`<a class="mobile-menu__link" href="#${id}" data-nav-link data-menu-link( aria-label="([^"]+)")?><span class="mobile-menu__num"[^>]*>[0-9]{2}</span><span class="mobile-menu__text">([^<]+)</span>`, 'g'))];

  it.each(Object.entries(NAV))('desktop and mobile "%s": visible name, plain aria-label that still contains it', (id, [visible, plain]) => {
    for (const found of [desktopLink(id), mobileLink(id)]) {
      expect(found).toHaveLength(1);
      const [, , label, text] = found[0];
      expect(text).toBe(visible);
      expect(label.startsWith(plain)).toBe(true); // plain word first (screen readers, SEO)
      expect(label.toLowerCase()).toContain(visible.toLowerCase()); // WCAG 2.5.3 label in name
    }
  });

  it('all 8 desktop and 8 mobile items exist, and every renamed one has an aria-label', () => {
    const links = [...html.matchAll(/<a class="(?:nav-link|mobile-menu__link)"[^>]*>/g)].map((m) => m[0]);
    expect(links).toHaveLength(16);
    for (const tag of links) {
      const id = tag.match(/href="#([a-z]+)"/)[1];
      if (NAV[id]) expect(tag, tag).toMatch(/aria-label="[^"]+"/);
    }
  });

  it('the untouched items keep their plain names', () => {
    expect(html).toMatch(/href="#video" data-nav-link>Video</);
    expect(html).toMatch(/href="#chat" data-nav-link>Ask my AI</);
  });

  it('header CTA and hero buttons use the mockup wording and the same targets', () => {
    expect(html).toMatch(/data-mode-toggle>\s*<span>Ride to the island<\/span>\s*<svg[^>]*aria-hidden="true"/);
    expect(html).toMatch(/<a class="btn btn--ink" href="#projects"[^>]*>\s*<span>See the bounty board<\/span>/);
    expect(html).toMatch(/<a class="btn" href="#chat"[^>]*>\s*<span>Question the sheriff<\/span>/);
  });

  it('the footer carries the filing line, the copyright and the year hook', () => {
    expect(html).toContain('Filed by the Byte Island Sheriff’s Dept. · Karachi');
    expect(html).toMatch(/© <span data-year>\d{4}<\/span> Muhammad Umer Farooq/);
  });
});

describe('metadata and the no-JS HTML stay plain and accurate', () => {
  const head = () => html.slice(html.indexOf('<head>'), html.indexOf('</head>'));

  it('<title>, description and og tags carry name and role, with no case-file words', () => {
    const title = head().match(/<title>([^<]+)<\/title>/)[1];
    expect(title).toBe('Muhammad Umer Farooq | 3D Portfolio');
    const description = head().match(/<meta name="description" content="([^"]+)"/)[1];
    expect(description).toContain(content.profile.name);
    expect(description).toContain(content.profile.title);
    expect(head()).not.toMatch(/sheriff|bounty|wanted|telegram|case file|vault|railway/i);
  });

  it('the pre-rendered HTML (no JS needed) contains the plain name and role', () => {
    expect(strip(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)[1])).toBe('Muhammad Umer Farooq');
    const card = html.slice(html.indexOf('class="profile-card'), html.indexOf('</article>', html.indexOf('class="profile-card')));
    expect(card).toContain(content.profile.name);
    expect(card).toContain(content.profile.title);
    expect(card).toContain(content.profile.location);
    expect(html).toContain(content.profile.headline.split(' — ')[0]);
  });
});

describe('project cards', () => {
  const visible = () => content.projects.filter((p) => !p.draft);
  const cards = () => [...html.matchAll(/<article class="project-card paper" id="(project-[a-z0-9-]+)"[\s\S]*?<\/article>/g)];

  it('every card has "Bounty · <category>", a status, "Open case →" and a plain accessible name', () => {
    expect(cards()).toHaveLength(visible().length);
    for (const [card, anchor] of cards()) {
      const project = visible().find((p) => p.anchor === anchor);
      expect(card).toContain(`Bounty · ${project.categories[0].replace('&', '&amp;')}`);
      expect(card).toMatch(project.status === 'live' ? />Live</ : project.status === 'completed' ? />Closed</ : />In development</);
      expect(card).toMatch(/Open case <svg[^>]*aria-hidden="true"/);
      expect(card).toContain(`: ${project.title.replace('&', '&amp;')}</span></summary>`);
    }
  });

  it('closed projects are the completed ones (the CASE CLOSED stamp hangs on status--completed)', () => {
    for (const [card, anchor] of cards()) {
      const project = visible().find((p) => p.anchor === anchor);
      expect(card.includes('status--completed')).toBe(project.status === 'completed');
    }
  });

  it('a Reward line only ever repeats a highlight that already exists in content, verbatim', () => {
    let withReward = 0;
    for (const [card, anchor] of cards()) {
      const project = visible().find((p) => p.anchor === anchor);
      const m = card.match(/class="project-card__reward"><span class="project-card__reward-label">Reward:<\/span> <span data-searchable>([^<]*)<\/span>/);
      const expected = rewardOf(project);
      if (!expected) {
        expect(m, anchor).toBeNull();
        continue;
      }
      withReward += 1;
      expect(project.highlights).toContain(expected);
      expect(m[1]).toBe(expected.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
      expect(expected).toMatch(/\d/);
    }
    expect(withReward).toBeGreaterThan(0);
  });

  it('rewardOf never invents: it returns an existing highlight with a number, or null', () => {
    expect(rewardOf({ highlights: ['No numbers here', 'Used daily by 25+ people', '10+ businesses'] })).toBe('Used daily by 25+ people');
    expect(rewardOf({ highlights: ['Only words', 'More words'] })).toBeNull();
    expect(rewardOf({ highlights: [] })).toBeNull();
  });

  it('the reward bullet is not repeated in the bullets above it', () => {
    for (const [card, anchor] of cards()) {
      const project = visible().find((p) => p.anchor === anchor);
      const reward = rewardOf(project);
      if (!reward) continue;
      const bullets = card.match(/<ul class="project-card__highlights">([\s\S]*?)<\/ul>/)[1];
      expect(strip(bullets)).not.toContain(strip(reward).slice(0, 30));
    }
  });

  it('filter chips read "All 8" (the dot between name and count is CSS)', () => {
    const all = html.match(/data-cat="">All <span class="filter-chip__count">(\d+)<\/span>/);
    expect(all).not.toBeNull();
    expect(Number(all[1])).toBe(visible().length);
    for (const [, name, count] of html.matchAll(/data-cat="([^"]+)">[^<]+ <span class="filter-chip__count">(\d+)<\/span>/g)) {
      const real = visible().filter((p) => p.categories.includes(name.replace('&amp;', '&'))).length;
      expect(Number(count), name).toBe(real);
    }
  });
});
