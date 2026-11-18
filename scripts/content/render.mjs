// Build-time renderer: /content → static HTML blocks for index.html. Every front-matter string is
// escaped by escapeHtml() (through the html`` template); markdown goes through the safe markdown-it.
import { ContentError } from './load.mjs';
import { renderAchievements, renderIntroStage, renderProjects, renderVideoSection } from './gallery.mjs';
import { SUBJECTS } from '../../src/shared/contact-schema.js';
import {
  ICONS,
  SOCIAL,
  externalAttrs,
  html,
  markdownBlocks,
  markdownText,
  paragraphs,
  raw,
  renderBlocks,
  renderInline,
  splitStat,
  timeEl,
} from './html.mjs';

// Re-exported for tests and callers that import from render.mjs.
export { createMarkdown, escapeHtml, formatDate, html, imageSize, isSafeUrl, markdownBlocks, raw, renderBlocks, renderMarkdown, splitStat } from './html.mjs';

const HUES = ['rust', 'dusk', 'clay', 'brass', 'forest'];

function categoryIcon(name) {
  if (/machine|\bai\b|ml/i.test(name)) return ICONS.neural;
  if (/vision/i.test(name)) return ICONS.eye;
  if (/3d|game|motion/i.test(name)) return ICONS.cube;
  if (/front/i.test(name)) return ICONS.window;
  if (/back|data/i.test(name)) return ICONS.database;
  if (/devops|tool/i.test(name)) return ICONS.cycle;
  if (/lang/i.test(name)) return ICONS.brackets;
  return ICONS.spark;
}

/* ────────────────────────── Head & social ────────────────────────── */

export function metaDescription(profile) {
  return `${profile.name} — ${profile.title}, ${profile.location}. ${profile.headline}`;
}

export function renderHead({ profile }) {
  const description = metaDescription(profile);
  return html`<meta name="description" content="${description}" />
    <meta property="og:description" content="${description}" />`;
}

/**
 * <li> social links from profile.links: the single source for footer, menu and contact.
 * { email: true } adds the public address (profile.links.email) as a plain mailto: link, shown as the
 * address itself (P3.3: Contact and the footer; the menu stays LinkedIn + GitHub).
 */
export function renderSocial({ profile }, { className = 'social-link', email = false } = {}) {
  const links = html`${Object.entries(SOCIAL)
    .filter(([key]) => profile.links[key])
    .map(
      ([key, { label, icon }]) => html`<li>
              <a class="${className}" href="${profile.links[key]}"${externalAttrs(profile.links[key])}>${icon}<span>${label}</span><span class="sr-only"> (opens in a new tab)</span></a>
            </li>`,
    )}`;
  const address = profile.links.email;
  if (!email || !address) return links;
  return html`${links}<li>
              <a class="${className} social-link--email" href="mailto:${address}" data-email>${ICONS.mail}<span>${address}</span></a>
            </li>`;
}

/* ────────────────────────── Hero ────────────────────────── */

export function renderHeroTitle({ profile }) {
  const [first, ...rest] = profile.name.split(' ');
  return html`<h1 id="home-title" class="hero__title" data-reveal="mask-lines" data-reveal-delay="0.15"><span class="text-rust">${first}</span> ${rest.join(' ')}</h1>`;
}

/** profile.headline; the part after " — " gets the gradient. */
export function renderHeroStatement({ profile }) {
  const dash = profile.headline.indexOf(' — ');
  const statement =
    dash === -1
      ? html`${profile.headline}`
      : html`${profile.headline.slice(0, dash)} — <span class="text-rust">${profile.headline.slice(dash + 3)}</span>`;
  return html`<p class="hero__statement" data-reveal="mask-lines" data-reveal-delay="0.3">${statement}</p>`;
}

/** Title + statement together (kept for callers and tests). */
export function renderHeroHeading(content) {
  return html`${renderHeroTitle(content)}${renderHeroStatement(content)}`;
}

export function renderHeroIntro({ profile }) {
  return renderBlocks(paragraphs(profile.body).slice(0, 1), { class: 'hero__intro', 'data-reveal': 'fade-up', 'data-reveal-delay': '0.45' });
}

export function renderProfileCard({ profile }, { photoSize, cvHref }) {
  const mode = profile.work_mode.join(' · ');
  return html`<div class="poster-wrap" data-reveal="fade-up" data-reveal-delay="0.4">
              <article class="profile-card paper case-frame" aria-labelledby="profile-name">
                <span class="pin" aria-hidden="true"></span>
                <p class="wanted__title" aria-hidden="true">Wanted</p>
                <p class="wanted__sub" aria-hidden="true">— for building AI people use —</p>
                <div class="wanted__photo">
                  <img class="wanted__img" src="${profile.photo}" width="${photoSize.width}" height="${photoSize.height}" alt="${profile.photo_alt}" fetchpriority="high" decoding="async" />
                  <span class="stamp" aria-hidden="true">${mode}</span>
                </div>
                <div class="profile-card__id">
                  <p class="profile-card__name" id="profile-name">${profile.name}</p>
                  <p class="profile-card__title">${profile.title}</p>
                </div>
                <div class="profile-card__fact">
                  <p class="hud-label">Open to</p>
                  <ul class="chips chips--compact">${[...profile.open_to, ...profile.work_mode].map((item) => html`<li class="chip">${item}</li>`)}</ul>
                </div>
                <p class="profile-card__langs"><span class="hud-label">Languages</span><span>${profile.languages.join(' · ')}</span></p>
                <div class="wanted__foot">
                  <span>Last seen<b>${profile.location}</b></span>
                  <span>Status<b class="status-ok">Available for work</b></span>
                </div>
                <div class="profile-card__actions">
                  <a class="icon-btn" href="${profile.links.linkedin}"${externalAttrs(profile.links.linkedin)} aria-label="LinkedIn (opens in a new tab)" data-cursor>${ICONS.linkedin}</a>
                  <a class="icon-btn" href="${profile.links.github}"${externalAttrs(profile.links.github)} aria-label="GitHub (opens in a new tab)" data-cursor>${ICONS.github}</a>
                  ${cvHref ? html`<a class="btn btn--sm btn--ink" href="${cvHref}" download data-cursor>${ICONS.download}<span>Download CV</span></a>` : ''}
                </div>
              </article>
            </div>`;
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

/* ────────────────────────── About & skills ────────────────────────── */

export function renderAbout({ about }) {
  return html`<div class="about">
            <div class="about__bio prose">${renderBlocks(paragraphs(about.body), { 'data-reveal': 'mask-lines' })}</div>
            <ul class="stats">
              ${about.stats.map((stat, i) => {
                const { prefix, number, suffix } = splitStat(stat.value);
                const value = number
                  ? html`${prefix}<span data-count="${number}">${number}</span>${suffix}`
                  : html`${stat.value}`;
                return html`<li class="stat" data-reveal="fade-up" data-reveal-delay="${(i * 0.08).toFixed(2)}">
                <p class="stat__value"><span class="sr-only">${stat.value}</span><span class="text-rust" aria-hidden="true">${value}</span></p>
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
                (category, i) => html`<li class="bento__card paper bento__card--span-${spans[i]}" data-hue="${HUES[i % HUES.length]}" data-reveal="stagger">
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

/* ────────────────────────── Journey ────────────────────────── */

const PROJECT_REF = /\(See project: ([^)]+?)\.?\)/;

/** Every "(See project: X)" reference in a markdown body. */
export function findProjectRefs(source) {
  return [...source.matchAll(new RegExp(PROJECT_REF.source, 'g'))].map((m) => m[1].trim());
}

/** A reference matches a non-draft project's full title or its part before " — "; exactly one must match. */
export function resolveProjectRef(ref, projects, file = 'content') {
  const matches = projects.filter((p) => !p.draft && (p.title === ref || p.title.split(' — ')[0] === ref));
  if (matches.length !== 1) {
    throw new ContentError(`${file}: "(See project: ${ref})" matches ${matches.length} published project titles (need exactly 1)`);
  }
  return matches[0];
}

/** Bullets: bold lead on its own line, body below; "(See project: X)" becomes a link chip. */
function renderRolePoints(body, projects, file) {
  const list = markdownBlocks(body).find((b) => b.type === 'bullet_list');
  if (!list) return '';
  const items = list.tokens.filter((t) => t.type === 'inline').map((t) => t.content);
  return html`<ul class="timeline__points timeline__points--split">${items.map((source) => {
    const m = source.match(/^\*\*(.+?)\*\*\s*[—–-]\s*([\s\S]*)$/);
    const lead = m ? m[1] : null;
    let rest = m ? m[2] : source;
    const ref = rest.match(PROJECT_REF);
    let chip = '';
    if (ref) {
      const project = resolveProjectRef(ref[1].trim(), projects, file);
      rest = rest.replace(PROJECT_REF, '').trim();
      chip = html`<a class="chip chip--link" href="#${project.anchor}" data-cursor>See project: ${ref[1].trim()} ${ICONS.arrow}</a>`;
    }
    return html`<li>${lead ? html`<strong class="point__lead">${lead}</strong>` : ''}<span class="point__body">${renderInline(rest)}</span>${chip}</li>`;
  })}</ul>`;
}

/** Chronological timeline: education entries, roles and dated awards, sorted by start date. */
export function renderJourney({ education, experience, achievements, projects }) {
  const entries = [];

  education.entries.forEach((entry, i) => {
    entries.push({
      sort: entry.start,
      id: i === 0 ? education.anchor : null,
      kind: education.title,
      hue: 'dusk',
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
      hue: 'rust',
      when: html`${timeEl(role.start)} – ${timeEl(role.end)}`,
      title: role.role,
      org: `${role.company} · ${role.location}`,
      body: html`<p class="timeline__summary">${role.summary}</p>
                  ${i === 0 ? renderRolePoints(experience.body, projects, experience.file) : ''}`,
    });
  });

  // Awards with a full date (YYYY-MM-DD) join the timeline; they link to their gallery entry.
  for (const item of achievements.items) {
    if (item.type === 'certification' || !/^\d{4}-\d{2}-\d{2}$/.test(String(item.date ?? ''))) continue;
    entries.push({
      sort: String(item.date),
      id: null,
      kind: 'Award',
      hue: 'brass',
      when: timeEl(item.date),
      title: item.title,
      org: item.event,
      body: html`${item.detail ? html`<p class="timeline__summary">${item.detail}</p>` : ''}
                  <a class="text-link" href="#${item.anchor}" data-cursor>View in achievements ${ICONS.arrow}</a>`,
    });
  }

  entries.sort((a, b) => a.sort.localeCompare(b.sort));
  const firstYear = entries[0]?.sort.slice(0, 4) ?? '';

  return html`<div class="timeline" data-timeline>
            <div class="timeline__years" aria-hidden="true"><span class="timeline__year" data-timeline-year>${firstYear}</span></div>
            <span class="timeline__rail" aria-hidden="true"><span class="timeline__progress" data-timeline-progress></span></span>
            <ol class="timeline__list">
              ${entries.map(
                (entry) => html`<li class="timeline__item"${entry.id ? html` id="${entry.id}"` : ''} data-hue="${entry.hue}" data-entry-year="${entry.sort.slice(0, 4)}" data-timeline-item>
                <span class="timeline__node" aria-hidden="true"></span>
                <article class="timeline__card paper" data-reveal="fade-up">
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

/* ────────────────────────── Assemble ────────────────────────── */

/** All index.html blocks, keyed by marker name. */
export function renderSections(content, { photoSize, cvHref, root }) {
  return {
    head: renderHead(content),
    'hero-title': renderHeroTitle(content),
    'hero-statement': renderHeroStatement(content),
    'hero-intro': renderHeroIntro(content),
    'profile-card': renderProfileCard(content, { photoSize, cvHref }),
    marquee: renderMarquee(content),
    about: renderAbout(content),
    skills: renderSkills(content),
    projects: renderProjects(content, { root }),
    achievements: renderAchievements(content, { root }),
    journey: renderJourney(content),
    video: renderVideoSection({ root }),
    intro: renderIntroStage(content, { root }),
    'social-menu': renderSocial(content),
    'social-contact': renderSocial(content, { email: true }),
    'social-footer': renderSocial(content, { email: true }),
    // P4: the contact form's subject list comes from the same allow-list the server validates against.
    'contact-subjects': html`${SUBJECTS.map((subject) => html`<option value="${subject}">${subject}</option>`)}`,
  };
}

/** Public JSON for virtual:content: front matter (+ plain-text project bodies for search), drafts removed. */
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
    projects: content.projects.filter((p) => !p.draft).map((p) => ({ ...strip(p), bodyText: markdownText(p.body) })),
  };
}
