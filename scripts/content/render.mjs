// Build-time renderer: /content → static HTML for index.html. Every front-matter string is escaped
// by escapeHtml() (through the html`` template); markdown bodies go through markdown-it with raw
// HTML disabled and a link allowlist.
import { readFileSync } from 'node:fs';
import MarkdownIt from 'markdown-it';

/* ────────────────────────── Escaping ────────────────────────── */

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** The one escaping helper for every content string placed into HTML (text or quoted attribute). */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

class SafeHtml {
  constructor(value) {
    this.value = value;
  }

  toString() {
    return this.value;
  }
}

/** Mark trusted markup (our own templates, markdown-it output, static SVG). */
export const raw = (value) => new SafeHtml(String(value));

function toHtml(value) {
  if (value === null || value === undefined || value === false) return '';
  if (Array.isArray(value)) return value.map(toHtml).join('');
  if (value instanceof SafeHtml) return value.value;
  return escapeHtml(value);
}

/** Tagged template: interpolated values are escaped unless they are SafeHtml. */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => {
    out += toHtml(value) + strings[i + 1];
  });
  return new SafeHtml(out);
}

/* ────────────────────────── URLs & markdown ────────────────────────── */

const SAFE_URL = /^(?:https?:\/\/|\/(?!\/)|#)/i;

/** Allowed link targets: http(s), site-relative "/…" (not protocol-relative "//"), and "#…". */
export function isSafeUrl(url) {
  return SAFE_URL.test(String(url).trim());
}

const isExternal = (url) => /^https?:\/\//i.test(url);
const externalAttrs = (url) => (isExternal(url) ? raw(' target="_blank" rel="noopener noreferrer"') : '');

export function createMarkdown() {
  const md = new MarkdownIt({ html: false, linkify: false, typographer: true });
  md.disable(['image']); // no remote images from content
  md.validateLink = (url) => isSafeUrl(url); // anything else stays plain text
  const renderToken = (tokens, idx, options, env, self) => self.renderToken(tokens, idx, options);
  const linkOpen = md.renderer.rules.link_open ?? renderToken;
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const href = tokens[idx].attrGet('href') ?? '';
    if (isExternal(href)) {
      tokens[idx].attrSet('target', '_blank');
      tokens[idx].attrSet('rel', 'noopener noreferrer');
    }
    return linkOpen(tokens, idx, options, env, self);
  };
  return md;
}

const md = createMarkdown();

/** Top-level markdown blocks: [{ type: 'paragraph' | 'bullet_list' | 'heading' | …, tokens }]. */
export function markdownBlocks(source, instance = md) {
  const tokens = instance.parse(source, {});
  const blocks = [];
  let start = -1;
  tokens.forEach((token, i) => {
    if (token.level !== 0) return;
    if (token.nesting === 1) start = i;
    else if (token.nesting === -1) blocks.push({ type: tokens[start].type.replace(/_open$/, ''), tokens: tokens.slice(start, i + 1) });
    else blocks.push({ type: token.type, tokens: [token] });
  });
  return blocks;
}

/** Render blocks to HTML; `attrs` are added to each block's opening tag (e.g. data-reveal). */
export function renderBlocks(blocks, attrs = {}, instance = md) {
  return raw(
    blocks
      .map((block) => {
        for (const [k, v] of Object.entries(attrs)) block.tokens[0].attrSet(k, v);
        return instance.renderer.render(block.tokens, instance.options, {});
      })
      .join(''),
  );
}

/** Render a whole markdown string (used by tests and future sections). */
export const renderMarkdown = (source, instance = md) => raw(instance.render(source));

const paragraphs = (source) => markdownBlocks(source).filter((b) => b.type === 'paragraph');
const firstList = (source) => markdownBlocks(source).filter((b) => b.type === 'bullet_list').slice(0, 1);

/* ────────────────────────── Formatting (presentation only) ────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-08" → "Aug 2026", "2026-10-24" → "24 Oct 2026", "present" → "Present"; anything else as written. */
export function formatDate(value) {
  const s = String(value);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  if (s === 'present') return 'Present';
  return s;
}

const isoDate = (value) => (/^\d{4}(?:-\d{2}){0,2}$/.test(String(value)) ? String(value) : null);

function timeEl(value) {
  const iso = isoDate(value);
  return iso ? html`<time datetime="${iso}">${formatDate(value)}</time>` : html`<span>${formatDate(value)}</span>`;
}

/** "1st / 70+" → { prefix: "1st / ", number: "70", suffix: "+" } (the last number rolls). */
export function splitStat(value) {
  const m = String(value).match(/^(.*?)(\d+(?:\.\d+)?)(\D*)$/);
  return m ? { prefix: m[1], number: m[2], suffix: m[3] } : { prefix: String(value), number: null, suffix: '' };
}

/** Pixel size of a JPEG or PNG (no dependencies). */
export function imageSize(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset < buf.length) {
      if (buf[offset] !== 0xff) break;
      const marker = buf[offset + 1];
      const length = buf.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  throw new Error(`Unsupported or corrupt image: ${path}`);
}

/* ────────────────────────── Icons (hand-written, static) ────────────────────────── */

const svg = (body, viewBox = '0 0 24 24') =>
  raw(
    `<svg viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`,
  );

const ICONS = {
  pin: svg('<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21Z"/><circle cx="12" cy="10" r="2.4"/>'),
  linkedin: raw(
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.56V9h3.56v11.45Z"/></svg>',
  ),
  github: raw(
    '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>',
  ),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  // Skill categories
  neural: svg('<circle cx="5" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="m6.7 7.1 3.6 3.8M6.7 16.9l3.6-3.8M13.7 10.9l3.6-3.8M13.7 13.1l3.6 3.8"/>'),
  eye: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/><path d="M12 2v1.5M12 20.5V22M4 4l1 1M19 19l1 1"/>'),
  cube: svg('<path d="m12 2.8 8 4.6v9.2l-8 4.6-8-4.6V7.4Z"/><path d="m4 7.4 8 4.6 8-4.6M12 12v9.2"/>'),
  window: svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 8.5h18M6 6.3h.01M8.5 6.3h.01"/><path d="m9.5 12.5-2 2 2 2M14.5 12.5l2 2-2 2"/>'),
  database: svg('<ellipse cx="12" cy="5.5" rx="7" ry="2.8"/><path d="M5 5.5v13c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-13"/><path d="M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8"/>'),
  cycle: svg('<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.7"/><path d="M20 4v4.7h-4.7"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.3"/><path d="M4 20v-4.7h4.7"/>'),
  code: svg('<path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 4.5l-3 15"/>'),
  spark: svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>'),
};

function categoryIcon(name) {
  if (/machine|\bai\b|ml/i.test(name)) return ICONS.neural;
  if (/vision/i.test(name)) return ICONS.eye;
  if (/3d|game|motion/i.test(name)) return ICONS.cube;
  if (/front/i.test(name)) return ICONS.window;
  if (/back|data/i.test(name)) return ICONS.database;
  if (/devops|tool/i.test(name)) return ICONS.cycle;
  if (/lang/i.test(name)) return ICONS.code;
  return ICONS.spark;
}

const HUES = ['violet', 'cyan', 'magenta', 'amber', 'mint'];

/* ────────────────────────── Sections ────────────────────────── */

export function metaDescription(profile) {
  return `${profile.name} — ${profile.title}, ${profile.location}. ${profile.headline}`;
}

export function renderHead({ profile }) {
  const description = metaDescription(profile);
  return html`<meta name="description" content="${description}" />
    <meta property="og:description" content="${description}" />`;
}

/** h1 + statement line. The name's first word and the headline's part after " — " get the gradient. */
export function renderHeroHeading({ profile }) {
  const [first, ...rest] = profile.name.split(' ');
  const dash = profile.headline.indexOf(' — ');
  const statement =
    dash === -1
      ? html`${profile.headline}`
      : html`${profile.headline.slice(0, dash)} — <span class="text-aurora">${profile.headline.slice(dash + 3)}</span>`;
  return html`<h1 id="home-title" class="hero__title" data-reveal="mask-lines" data-reveal-delay="0.15"><span class="text-aurora">${first}</span> ${rest.join(' ')}</h1>
          <p class="hero__statement" data-reveal="mask-lines" data-reveal-delay="0.35">${statement}</p>`;
}

export function renderHeroIntro({ profile }) {
  return renderBlocks(paragraphs(profile.body).slice(0, 1), { class: 'hero__intro', 'data-reveal': 'fade-up', 'data-reveal-delay': '0.5' });
}

function chips(items, className = 'chip') {
  return html`<ul class="chips">${items.map((item) => html`<li class="${className}">${item}</li>`)}</ul>`;
}

export function renderProfileCard({ profile }, { photoSize, cvHref }) {
  const facts = [
    ['Open to', profile.open_to],
    ['Work mode', profile.work_mode],
    ['Languages', profile.languages],
  ];
  return html`<article class="profile-card glass hud-frame" aria-labelledby="profile-name" data-tilt data-reveal="fade-up" data-reveal-delay="0.55">
              <span class="tilt-glare" aria-hidden="true"></span>
              <div class="profile-card__top">
                <div class="holo">
                  <span class="holo__ring" aria-hidden="true"></span>
                  <img class="holo__img" src="${profile.photo}" width="${photoSize.width}" height="${photoSize.height}" alt="${profile.photo_alt}" fetchpriority="high" decoding="async" />
                  <span class="holo__dot" aria-hidden="true"></span>
                </div>
                <div class="profile-card__id">
                  <p class="profile-card__name" id="profile-name">${profile.name}</p>
                  <p class="profile-card__title">${profile.title}</p>
                  <p class="profile-card__location">${ICONS.pin}<span>${profile.location}</span></p>
                </div>
              </div>
              <p class="status-pill"><span class="status-pill__dot" aria-hidden="true"></span>Available for work</p>
              <dl class="profile-card__facts">
                ${facts.map(([label, items]) => html`<div class="profile-card__fact"><dt class="hud-label">${label}</dt><dd>${chips(items)}</dd></div>`)}
              </dl>
              <div class="profile-card__actions">
                <a class="icon-btn" href="${profile.links.linkedin}"${externalAttrs(profile.links.linkedin)} aria-label="LinkedIn (opens in a new tab)" data-magnetic="0.4" data-cursor>${ICONS.linkedin}</a>
                <a class="icon-btn" href="${profile.links.github}"${externalAttrs(profile.links.github)} aria-label="GitHub (opens in a new tab)" data-magnetic="0.4" data-cursor>${ICONS.github}</a>
                ${cvHref ? html`<a class="btn btn--sm aurora-border" href="${cvHref}" download data-magnetic data-cursor>${ICONS.download}<span>Download CV</span></a>` : ''}
              </div>
            </article>`;
}

function uniqueSkills(skills) {
  return [...new Set(skills.categories.flatMap((c) => c.items))];
}

function marqueeTrack(items, hidden) {
  return html`<ul class="marquee__track"${hidden ? raw(' aria-hidden="true"') : ''}>${items.map(
    (item, i) => html`<li class="marquee__item${i % 2 ? ' marquee__item--outline' : ''}">${item}</li>`,
  )}</ul>`;
}

export function renderMarquee({ skills }) {
  const all = uniqueSkills(skills);
  const rows = [all.filter((_, i) => i % 2 === 0), all.filter((_, i) => i % 2 === 1)];
  return html`<div class="marquee" role="region" aria-label="Skills, scrolling (pauses on hover or focus)" tabindex="0" data-marquee>
        ${rows.map(
          (items, r) => html`<div class="marquee__row${r ? ' marquee__row--reverse' : ''}">${marqueeTrack(items, false)}${marqueeTrack(items, true)}</div>`,
        )}
      </div>`;
}

export function renderAbout({ about }) {
  return html`<div class="about">
            <div class="about__bio prose">${renderBlocks(paragraphs(about.body), { 'data-reveal': 'mask-lines' })}</div>
            <ul class="stats">
              ${about.stats.map((stat, i) => {
                const { prefix, number, suffix } = splitStat(stat.value);
                const value = number
                  ? html`${prefix}<span data-count="${number}">${number}</span>${suffix}`
                  : html`${stat.value}`;
                return html`<li class="stat glass" data-spotlight data-reveal="fade-up" data-reveal-delay="${(i * 0.08).toFixed(2)}">
                <span class="spotlight" aria-hidden="true"></span>
                <p class="stat__value"><span class="sr-only">${stat.value}</span><span class="text-aurora" aria-hidden="true">${value}</span></p>
                <p class="stat__label">${stat.label}</p>
              </li>`;
              })}
            </ul>
          </div>`;
}

// Bento spans on the 12-column desktop grid for the current 7 categories; other counts get even halves.
const BENTO_SPANS = [7, 5, 4, 4, 4, 5, 7];

export function renderSkills({ skills }) {
  const spans = skills.categories.length === BENTO_SPANS.length ? BENTO_SPANS : skills.categories.map(() => 6);
  return html`<div class="skills">
            <div class="skills__intro prose">${renderBlocks(paragraphs(skills.body), { 'data-reveal': 'fade-up' })}</div>
            <ul class="bento">
              ${skills.categories.map(
                (category, i) => html`<li class="bento__card glass bento__card--span-${spans[i]}" data-hue="${HUES[i % HUES.length]}" data-spotlight data-reveal="stagger">
                <span class="spotlight" aria-hidden="true"></span>
                <div class="bento__head">
                  <span class="bento__icon">${categoryIcon(category.name)}</span>
                  <h3 class="bento__title">${category.name}</h3>
                  <span class="bento__count" aria-hidden="true">${String(category.items.length).padStart(2, '0')}</span>
                </div>
                <ul class="chips">${category.items.map((item) => html`<li class="chip chip--skill" data-reveal-item>${item}</li>`)}</ul>
              </li>`,
              )}
            </ul>
            <div class="skills__3d" data-slot="skills-3d" aria-hidden="true"></div>
          </div>`;
}

/** Chronological timeline: education entries, roles and dated awards, sorted by start date. */
export function renderJourney({ education, experience, achievements }) {
  const entries = [];

  education.entries.forEach((entry, i) => {
    entries.push({
      sort: entry.start,
      id: i === 0 ? education.anchor : null,
      kind: education.title,
      hue: 'cyan',
      when: html`${timeEl(entry.start)} – ${timeEl(entry.end)}`,
      title: entry.degree,
      org: entry.institution,
      body: html`<dl class="timeline__facts">
                    ${entry.specialization ? html`<div><dt>Specialization</dt><dd>${entry.specialization}</dd></div>` : ''}
                    ${entry.cgpa ? html`<div><dt>CGPA</dt><dd>${entry.cgpa}</dd></div>` : ''}
                  </dl>
                  ${entry.highlights ? html`<ul class="timeline__points">${entry.highlights.map((h) => html`<li>${h}</li>`)}</ul>` : ''}`,
    });
  });

  experience.roles.forEach((role, i) => {
    entries.push({
      sort: role.start,
      id: i === 0 ? experience.anchor : null,
      kind: experience.title,
      hue: 'violet',
      when: html`${timeEl(role.start)} – ${timeEl(role.end)}`,
      title: role.role,
      org: `${role.company} · ${role.location}`,
      body: html`<p class="timeline__summary">${role.summary}</p>
                  ${i === 0 ? renderBlocks(firstList(experience.body), { class: 'timeline__points' }) : ''}`,
    });
  });

  // Awards with a full date (YYYY-MM-DD) join the timeline; they link to their gallery entry.
  for (const item of achievements.items) {
    if (item.type === 'certification' || !/^\d{4}-\d{2}-\d{2}$/.test(String(item.date ?? ''))) continue;
    entries.push({
      sort: String(item.date),
      id: null,
      kind: 'Award',
      hue: 'amber',
      when: timeEl(item.date),
      title: item.title,
      org: item.event,
      body: html`${item.detail ? html`<p class="timeline__summary">${item.detail}</p>` : ''}
                  <a class="text-link" href="#${item.anchor}" data-cursor>View in achievements ${ICONS.arrow}</a>`,
    });
  }

  entries.sort((a, b) => a.sort.localeCompare(b.sort));

  return html`<div class="timeline" data-timeline>
            <span class="timeline__rail" aria-hidden="true"><span class="timeline__progress" data-timeline-progress></span></span>
            <ol class="timeline__list">
              ${entries.map(
                (entry) => html`<li class="timeline__item"${entry.id ? html` id="${entry.id}"` : ''} data-hue="${entry.hue}" data-timeline-item>
                <span class="timeline__node" aria-hidden="true"></span>
                <article class="timeline__card glass" data-spotlight data-reveal="fade-up">
                  <span class="spotlight" aria-hidden="true"></span>
                  <p class="timeline__meta"><span class="chip chip--kind">${entry.kind}</span><span class="timeline__when">${entry.when}</span></p>
                  <h3 class="timeline__title">${entry.title}</h3>
                  <p class="timeline__org">${entry.org}</p>
                  ${entry.body}
                </article>
              </li>`,
              )}
            </ol>
          </div>`;
}

/** All index.html blocks, keyed by marker name. */
export function renderSections(content, { photoSize, cvHref }) {
  return {
    head: renderHead(content),
    'hero-heading': renderHeroHeading(content),
    'hero-intro': renderHeroIntro(content),
    'profile-card': renderProfileCard(content, { photoSize, cvHref }),
    marquee: renderMarquee(content),
    about: renderAbout(content),
    skills: renderSkills(content),
    journey: renderJourney(content),
  };
}

/** Public JSON for virtual:content: front matter only, drafts removed. */
export function publicData(content) {
  const strip = ({ body, bodyStartLine, file, draft, ...rest }) => rest;
  return {
    profile: strip(content.profile),
    about: strip(content.about),
    skills: strip(content.skills),
    experience: strip(content.experience),
    education: strip(content.education),
    achievements: strip(content.achievements),
    faq: strip(content.faq),
    projects: content.projects.filter((p) => !p.draft).map(strip),
  };
}
