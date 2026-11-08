// Build-time renderers for the projects gallery, achievements and the reusable video player.
// Everything is static HTML (works with JS off); src/ui/projects/* and src/ui/lightbox.js enhance it.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { renderCover } from './covers.mjs';
import { ICONS, chips, externalAttrs, html, imageSize, isExternal, isSafeUrl, md, raw, timeEl } from './html.mjs';
import { PROJECT_CATEGORIES } from '../../src/shared/content-schema.js';

const STATUS = {
  live: 'Live',
  completed: 'Closed',
  'in-development': 'In development',
};

const LINKS = {
  live: { label: 'Live', icon: ICONS.external },
  repo: { label: 'Code', icon: ICONS.github },
  dashboard: { label: 'Dashboard', icon: ICONS.chart },
  video: { label: 'Video', icon: ICONS.play },
};

const isLocalVideo = (url) => /^\/video\//.test(url);

/** Markdown body with headings shifted one level down (they sit under a card/modal title). */
function renderBody(source) {
  const tokens = md.parse(source, {});
  for (const t of tokens) {
    if ((t.type === 'heading_open' || t.type === 'heading_close') && /^h[1-5]$/.test(t.tag)) {
      t.tag = `h${Math.min(6, Number(t.tag[1]) + 1)}`;
    }
  }
  return raw(md.renderer.render(tokens, md.options, {}));
}

/** Only non-empty, allowlisted links; external ones open in a new tab with noopener noreferrer. */
function projectLinks(project, className = 'pill-link') {
  return Object.entries(LINKS)
    .filter(([key]) => {
      const url = project.links[key];
      return url && isSafeUrl(url) && !(key === 'video' && isLocalVideo(url));
    })
    .map(([key, { label, icon }]) => {
      const url = project.links[key];
      return html`<a class="${className}" href="${url}"${externalAttrs(url)}>${icon}<span>${label}</span>${isExternal(url) ? html`<span class="sr-only"> (opens in a new tab)</span>` : ''}</a>`;
    });
}

/** Reusable player markup; src/ui/video.js replaces the native controls with accessible custom ones. */
export function renderPlayer({ src, poster = null, size = null, title, noAudio = false, preload = 'metadata', tracks = [] }) {
  return html`<figure class="player" data-player${noAudio ? raw(' data-no-audio') : ''}>
            <div class="player__frame">
              <video class="player__video" src="${src}"${poster ? html` poster="${poster}"` : ''}${size ? html` width="${size.width}" height="${size.height}"` : ''} preload="${preload}" playsinline${noAudio ? raw(' muted') : ''} controls>${tracks.map(
                (t) => html`<track kind="captions" src="${t.src}" srclang="${t.lang}" label="${t.label}" />`,
              )}</video>
            </div>
            <figcaption class="player__caption">${noAudio ? html`<span class="chip chip--kind" data-hue="brass">No audio</span>` : ''}<span>${title}</span></figcaption>
          </figure>`;
}

function cover(project, root) {
  const image = project.images[0];
  if (image && existsSync(join(root, 'public', image))) {
    const size = imageSize(join(root, 'public', image));
    return html`<img class="project-card__img" src="${image}" width="${size.width}" height="${size.height}" alt="" loading="lazy" decoding="async" />`;
  }
  return renderCover(project);
}

function projectDetail(project, root) {
  const video = project.links.video && isLocalVideo(project.links.video) ? project.links.video : null;
  const poster = project.images[0] && existsSync(join(root, 'public', project.images[0])) ? project.images[0] : null;
  const links = projectLinks(project);
  return html`<div class="project-detail" data-project-detail>
              ${video ? renderPlayer({ src: video, poster, size: poster ? imageSize(join(root, 'public', poster)) : null, title: project.title, noAudio: true, preload: 'none' }) : ''}
              <div class="project-detail__grid">
                <div class="project-detail__body prose">${renderBody(project.body)}</div>
                <div class="project-detail__aside">
                  <p class="hud-label">Stack</p>
                  ${chips(project.stack)}
                  <p class="hud-label">Highlights</p>
                  <ul class="project-detail__highlights">${project.highlights.map((h) => html`<li>${h}</li>`)}</ul>
                  ${links.length ? html`<p class="hud-label">Links</p><div class="project-detail__links">${links}</div>` : ''}
                </div>
              </div>
            </div>`;
}

/**
 * The "Reward: …" line is an existing fact, never an invented one: the first highlight that already
 * contains a number (a result such as "10+ businesses" or "1st of 70+ teams"), shown verbatim.
 * No such highlight, no line.
 */
export const rewardOf = (project) => project.highlights.find((h) => /\d/.test(h)) ?? null;

function projectCard(project, root) {
  const hero = project.featured && project.order === 1;
  const shown = project.stack.slice(0, 4);
  const more = project.stack.length - shown.length;
  const hasVideo = Boolean(project.links.video);
  const reward = rewardOf(project);
  const bullets = project.highlights.filter((h) => h !== reward).slice(0, 2);
  return html`<li class="gallery__item${hero ? ' gallery__item--hero' : ''}" data-project="${project.slug}">
          <article class="project-card paper" id="${project.anchor}" aria-labelledby="${project.anchor}-title">
            <div class="project-card__cover" data-project-cover>${cover(project, root)}</div>
            <div class="project-card__body">
              <p class="project-card__meta"><span class="project-card__bounty">Bounty · ${project.categories[0]}</span><span class="status status--${project.status}"><span class="status__dot" aria-hidden="true"></span>${STATUS[project.status]}</span><span class="project-card__context">${project.context} · ${project.year}</span></p>
              <h3 class="project-card__title" id="${project.anchor}-title" data-searchable>${project.title}</h3>
              <p class="project-card__tagline" data-searchable>${project.tagline}</p>
              <ul class="chips chips--stack">${shown.map((s) => html`<li class="chip" data-searchable>${s}</li>`)}${
                more > 0 ? html`<li class="chip chip--more"><span aria-hidden="true">+${more}</span><span class="sr-only">and ${more} more</span></li>` : ''
              }</ul>
              <ul class="project-card__highlights">${bullets.map((h) => html`<li data-searchable>${h}</li>`)}</ul>
              ${reward ? html`<p class="project-card__reward"><span class="project-card__reward-label">Reward:</span> <span data-searchable>${reward}</span></p>` : ''}
              <div class="project-card__actions">
                <details class="project-card__more" data-project-details>
                  <summary class="btn btn--sm" data-project-open="${project.slug}" aria-haspopup="dialog" data-cursor>Open case ${ICONS.arrow}<span class="sr-only">${hasVideo ? ' (with video)' : ''}: ${project.title}</span></summary>
                  ${projectDetail(project, root)}
                </details>
                ${projectLinks(project)}
              </div>
            </div>
          </article>
        </li>`;
}

/** Projects section: controls (revealed by JS), pre-rendered cards, empty state. */
export function renderProjects({ projects }, { root }) {
  const visible = projects.filter((p) => !p.draft);
  const categories = PROJECT_CATEGORIES.map((c) => [c, visible.filter((p) => p.categories.includes(c)).length]).filter(([, n]) => n > 0);
  const stackCounts = new Map();
  for (const p of visible) for (const s of p.stack) stackCounts.set(s, (stackCounts.get(s) ?? 0) + 1);
  const stacks = [...stackCounts].sort((a, b) => a[0].localeCompare(b[0], 'en', { sensitivity: 'base' }));

  return html`<div class="gallery" data-gallery>
          <div class="gallery__controls" data-gallery-controls hidden>
            <div class="gallery__cats" role="group" aria-label="Filter by category">
              <button type="button" class="filter-chip" aria-pressed="true" data-cat="">All <span class="filter-chip__count">${visible.length}</span></button>
              ${categories.map(([c, n]) => html`<button type="button" class="filter-chip" aria-pressed="false" data-cat="${c}">${c} <span class="filter-chip__count">${n}</span></button>`)}
            </div>
            <div class="gallery__tools">
              <div class="search-field">
                <label class="sr-only" for="project-search">Search projects</label>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>
                <input id="project-search" type="search" placeholder="Search projects" maxlength="60" autocomplete="off" spellcheck="false" data-gallery-search />
              </div>
              <div class="stack-select" data-stack-select>
                <button type="button" class="tool-btn" id="stack-button" aria-haspopup="listbox" aria-expanded="false" aria-controls="stack-listbox" data-stack-button>
                  Stack<span class="tool-btn__badge" data-stack-badge hidden></span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg>
                </button>
                <div class="stack-select__popover paper" data-stack-popover hidden>
                  <ul class="stack-select__list" id="stack-listbox" role="listbox" aria-multiselectable="true" aria-labelledby="stack-button" tabindex="-1" data-stack-listbox>
                    ${stacks.map(([s, n], i) => html`<li class="stack-option" role="option" id="stack-opt-${i}" aria-selected="false" data-stack="${s}"><span class="stack-option__check" aria-hidden="true"></span><span class="stack-option__label">${s}</span><span class="stack-option__count">${n}</span></li>`)}
                  </ul>
                </div>
              </div>
              <label class="sort-field">
                <span class="sort-field__label">Sort</span>
                <select data-gallery-sort>
                  <option value="featured">Featured</option>
                  <option value="newest">Newest</option>
                  <option value="az">A–Z</option>
                </select>
              </label>
            </div>
            <div class="gallery__status">
              <p class="gallery__count" aria-live="polite" data-gallery-count>${visible.length} projects</p>
              <button type="button" class="text-link gallery__clear" data-gallery-clear hidden>Clear filters</button>
            </div>
          </div>
          <ul class="gallery__grid" data-gallery-grid>
            ${visible.map((p) => projectCard(p, root))}
          </ul>
          <div class="gallery__empty paper case-frame" data-gallery-empty hidden>
            <span class="gallery__empty-icon" aria-hidden="true">${ICONS.spark}</span>
            <p class="gallery__empty-title">No projects match</p>
            <p class="gallery__empty-text">Try another category, fewer stack filters or a shorter search.</p>
            <button type="button" class="btn btn--sm btn--ink" data-gallery-clear>Clear filters</button>
          </div>
        </div>`;
}

/* ────────────────────────── Achievements ────────────────────────── */

const ORDINAL = /^(\d+(?:st|nd|rd|th)?)\s+(.+)$/i;

export function renderAchievements({ achievements }, { root }) {
  const items = achievements.items;
  const features = items.filter((i) => i.image);
  const creds = items.filter((i) => !i.image && i.type === 'certification');
  const stats = items.filter((i) => !i.image && i.type !== 'certification');

  const feature = (item) => {
    const size = imageSize(join(root, 'public', item.image));
    const caption = `${item.image_alt} — ${item.title}`;
    return html`<article class="award-feature paper" id="${item.anchor}">
              <a class="award-feature__media" href="${item.image}" data-lightbox data-caption="${caption}" aria-label="View photo larger: ${item.title}" data-cursor>
                <img src="${item.image}" width="${size.width}" height="${size.height}" alt="${item.image_alt}" loading="lazy" decoding="async" />
                <span class="award-feature__zoom" aria-hidden="true">${ICONS.expand}</span>
              </a>
              <div class="award-feature__body">
                <p class="award__kind"><span class="chip chip--kind" data-hue="brass">${ICONS.trophy}Award</span>${item.date ? html`<span class="award__date">${timeEl(item.date)}</span>` : ''}</p>
                <h3 class="award__title">${item.title}</h3>
                <p class="award__event">${item.event}</p>
                ${item.detail ? html`<p class="award__detail">${item.detail}</p>` : ''}
              </div>
            </article>`;
  };

  const stat = (item) => {
    const m = item.title.match(ORDINAL);
    return html`<article class="award-stat paper" id="${item.anchor}">
              <h3 class="award-stat__title">${m ? html`<span class="award-stat__big text-rust">${m[1]}</span> <span class="award-stat__rest">${m[2]}</span>` : item.title}</h3>
              <p class="award__event">${item.event}</p>
              ${item.date ? html`<p class="award__date">${timeEl(item.date)}</p>` : ''}
              ${item.detail ? html`<p class="award__detail">${item.detail}</p>` : ''}
            </article>`;
  };

  // Credentials: issuer, year and type only; no "verified" claim without a verification link.
  const cred = (item) => html`<li class="cred paper" id="${item.anchor}">
                <span class="cred__icon" aria-hidden="true">${ICONS.badge}</span>
                <h3 class="cred__title">${item.title}</h3>
                <p class="cred__issuer">${item.event}</p>
                <p class="cred__meta">${item.date ? html`${timeEl(item.date)} · ` : ''}Certification</p>
              </li>`;

  return html`<div class="awards">
            <div class="awards__top">
              ${features.map(feature)}
              ${stats.map(stat)}
            </div>
            ${creds.length ? html`<div class="awards__creds"><p class="hud-label">Certifications</p><ul class="creds">${creds.map(cred)}</ul></div>` : ''}
          </div>`;
}

/* ────────────────────────── Video section ────────────────────────── */

export const PROMO = { video: '/video/promo.mp4', poster: '/video/promo-poster.webp', tracks: [['en', 'English'], ['ur', 'اردو']] };

export function renderVideoSection({ root }) {
  if (existsSync(join(root, 'public', PROMO.video))) {
    const poster = existsSync(join(root, 'public', PROMO.poster)) ? PROMO.poster : null;
    const tracks = PROMO.tracks
      .map(([lang, label]) => ({ src: `/video/promo.${lang}.vtt`, lang, label }))
      .filter((t) => existsSync(join(root, 'public', t.src)));
    return html`<div class="video-stage">
            ${renderPlayer({ src: PROMO.video, poster, title: 'Promo film', tracks })}
            <div class="video-stage__transcript" data-slot="video-transcript"></div>
          </div>`;
  }
  return html`<div class="video-stage">
            <div class="video-soon paper case-frame">
              <span class="video-soon__icon" aria-hidden="true">${ICONS.film}</span>
              <p class="hud-label">Promo film · arrives in P9</p>
              <p class="video-soon__title">A 45-second film about my work</p>
              <p class="video-soon__text">Made in After Effects, with English and Urdu captions and a full transcript.</p>
            </div>
            <div class="video-stage__captions" data-slot="video-captions"></div>
            <div class="video-stage__transcript" data-slot="video-transcript"></div>
          </div>`;
}

/* ────────────────────────── Intro sting ────────────────────────── */

export const INTRO_VIDEO = '/video/intro.mp4';

/**
 * Inner stage of the first-visit intro (src/ui/start.js). If public/video/intro.mp4 exists at
 * build time it plays instead of the placeholder sting (muted, playsinline, like promo.mp4).
 * The visible word is profile.short_name; the tagline is fixed case-file copy.
 */
export const INTRO_TAGLINE = 'A new sheriff arrives in town';

export function renderIntroStage({ profile }, { root }) {
  if (existsSync(join(root, 'public', INTRO_VIDEO))) {
    return html`<video class="intro__video" data-intro-video src="${INTRO_VIDEO}" muted playsinline preload="auto" aria-hidden="true"></video>`;
  }
  const word = profile.short_name.toUpperCase();
  return html`<div class="intro__stage" aria-hidden="true">
            <span class="intro__sweep"></span>
            <p class="intro__word">${[...word].map((ch) => html`<span class="intro__letter">${ch}</span>`)}</p>
            <p class="intro__tagline">${INTRO_TAGLINE}</p>
          </div>`;
}
