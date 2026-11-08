// Shared build-time HTML helpers: escaping, the auto-escaping html`` template, safe markdown,
// presentation formatting, image sizes and the hand-written icon set.
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

export const isExternal = (url) => /^https?:\/\//i.test(url);
export const externalAttrs = (url) => (isExternal(url) ? raw(' target="_blank" rel="noopener noreferrer"') : '');

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

export const md = createMarkdown();

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

export const renderMarkdown = (source, instance = md) => raw(instance.render(source));
export const renderInline = (source, instance = md) => raw(instance.renderInline(source));
export const paragraphs = (source) => markdownBlocks(source).filter((b) => b.type === 'paragraph');

/** Plain text of a markdown body (for search): markup and link targets removed. */
export function markdownText(source) {
  const out = [];
  const walk = (tokens) => {
    for (const t of tokens) {
      if (t.type === 'text' || t.type === 'code_inline') out.push(t.content);
      else if (t.type === 'softbreak' || t.type === 'hardbreak') out.push(' ');
      if (t.children) walk(t.children);
    }
    if (tokens.length) out.push(' ');
  };
  walk(md.parse(source, {}));
  return out.join('').replace(/\s+/g, ' ').trim();
}

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

export function timeEl(value) {
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

export function chips(items, className = 'chip') {
  return html`<ul class="chips">${items.map((item) => html`<li class="${className}">${item}</li>`)}</ul>`;
}

/* ────────────────────────── Icons (hand-written, static) ────────────────────────── */

export const svg = (body, viewBox = '0 0 24 24') =>
  raw(
    `<svg viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`,
  );

export const ICONS = {
  pin: svg('<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21Z"/><circle cx="12" cy="10" r="2.4"/>'),
  linkedin: raw(
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.56V9h3.56v11.45Z"/></svg>',
  ),
  github: raw(
    '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>',
  ),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  external: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  code: svg('<path d="m8 7-5 5 5 5M16 7l5 5-5 5"/>'),
  chart: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  play: svg('<path d="M8 5.5v13l11-6.5Z"/>'),
  expand: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  film: svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>'),
  badge: svg('<circle cx="12" cy="9" r="5.5"/><path d="m8.5 13.5-1.5 7 5-2.5 5 2.5-1.5-7"/><path d="m10 9 1.5 1.5L14.5 7.5"/>'),
  trophy: svg('<path d="M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v3M8.5 20h7M10 17h4"/>'),
  spark: svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>'),
  chat: svg('<path d="M4 5h16v11H9l-5 4z"/><path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>'),
  // Skill categories
  neural: svg('<circle cx="5" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="m6.7 7.1 3.6 3.8M6.7 16.9l3.6-3.8M13.7 10.9l3.6-3.8M13.7 13.1l3.6 3.8"/>'),
  eye: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/><path d="M12 2v1.5M12 20.5V22M4 4l1 1M19 19l1 1"/>'),
  cube: svg('<path d="m12 2.8 8 4.6v9.2l-8 4.6-8-4.6V7.4Z"/><path d="m4 7.4 8 4.6 8-4.6M12 12v9.2"/>'),
  window: svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 8.5h18M6 6.3h.01M8.5 6.3h.01"/><path d="m9.5 12.5-2 2 2 2M14.5 12.5l2 2-2 2"/>'),
  database: svg('<ellipse cx="12" cy="5.5" rx="7" ry="2.8"/><path d="M5 5.5v13c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-13"/><path d="M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8"/>'),
  cycle: svg('<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.7"/><path d="M20 4v4.7h-4.7"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.3"/><path d="M4 20v-4.7h4.7"/>'),
  brackets: svg('<path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 4.5l-3 15"/>'),
};

/** Social links from profile.links (one source of truth). */
export const SOCIAL = {
  linkedin: { label: 'LinkedIn', icon: ICONS.linkedin },
  github: { label: 'GitHub', icon: ICONS.github },
};
