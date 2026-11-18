// P5 knowledge base: /content → documents and chunks for the RAG index (pure, no network; used by
// scripts/rag/ingest.mjs and the tests). Sources: every content/*.md and content/projects/*.md that the
// site itself renders (loadContent: UPPERCASE files such as README.md / OPEN_QUESTIONS.md are skipped,
// drafts are dropped). content/cv/ is empty, so no CV text is indexed yet (LIMITATIONS L118).
//
// Each document becomes "sections": its front matter as readable key facts, then each markdown heading
// section. Sections are packed into chunks of ~350–600 tokens (never across a citation-anchor change),
// long sections are split, and consecutive chunks of a document overlap by ~15%. Every chunk starts with
// "Muhammad Umer Farooq — <title> — <heading>" so the model always knows who "I" is (content/README.md).
// The PII guard aborts if any chunk holds a phone number or an email other than the public one.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadContent } from '../content/load.mjs';
import { scanText } from '../content/guard.mjs';

export const PUBLIC_EMAIL = 'mumerfarooq.ned@gmail.com';
export const CHARS_PER_TOKEN = 4;
export const MAX_TOKENS = 600;
export const MIN_TOKENS = 350;
export const OVERLAP = 0.15;
const MAX_CHARS = MAX_TOKENS * CHARS_PER_TOKEN;
// Body budget per chunk: room for the ~15% overlap carried in and the one-line prefix.
const PACK = Math.floor(MAX_CHARS * (1 - OVERLAP)) - 160;
export const PERSON = 'Muhammad Umer Farooq';

export const tokenEstimate = (text) => Math.ceil(text.length / CHARS_PER_TOKEN);
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// Front-matter keys that are presentation, not facts.
const SKIP_KEYS = new Set(['anchor', 'photo', 'photo_alt', 'images', 'image', 'image_alt', 'order', 'featured', 'draft', 'slug', 'body', 'bodyStartLine', 'file', 'short_name']);
const LABELS = { open_to: 'Open to', work_mode: 'Work mode', links: 'Links', tagline: 'Tagline', categories: 'Categories', stack: 'Stack', role: 'Role', context: 'Context', year: 'Year', status: 'Status', highlights: 'Highlights', headline: 'Headline', location: 'Location', languages: 'Languages', name: 'Name', title: 'Title', roles: 'Roles', entries: 'Entries', items: 'Items' };
const label = (k) => LABELS[k] ?? k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Plain value → readable text (lists joined, nested objects as "field: value; …"). */
function plain(value) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== 'object' || v === null || v instanceof Date)) {
      const parts = value.map(plain).filter(Boolean);
      return parts.join(parts.some((x) => x.includes(',')) ? '; ' : ', ');
    }
    return value.map((v) => `- ${plain(v)}`).join('\n');
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([k, v]) => !SKIP_KEYS.has(k) && plain(v) !== '')
      .map(([k, v]) => `${label(k)}: ${plain(v)}`)
      .join('; ');
  }
  return String(value);
}

/** Front matter → "Key: value" lines (facts the body may not repeat: stack, status, highlights, links…). */
export function factsText(data) {
  return Object.entries(data)
    .filter(([k, v]) => !SKIP_KEYS.has(k) && plain(v) !== '')
    .map(([k, v]) => {
      const text = plain(v);
      return text.includes('\n') ? `${label(k)}:\n${text}` : `${label(k)}: ${text}`;
    })
    .join('\n');
}

/** Markdown → plain text with the link targets kept in brackets (the model can cite real URLs). */
export function mdToText(md) {
  return md
    .replace(/\r\n/g, '\n')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Split markdown at headings: [{ heading, text }]; text before the first heading has heading ''. */
export function splitSections(md) {
  const out = [];
  let current = { heading: '', lines: [] };
  for (const line of md.replace(/\r\n/g, '\n').split('\n')) {
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      out.push(current);
      current = { heading: h[1].trim(), lines: [] };
    } else current.lines.push(line);
  }
  out.push(current);
  return out.map((s) => ({ heading: s.heading, text: mdToText(s.lines.join('\n')) })).filter((s) => s.text);
}

/** Split a long text into pieces ≤ max chars on paragraph / sentence boundaries. */
function splitLong(text, max) {
  if (text.length <= max) return [text];
  const units = text.split(/(?<=\n\n)|(?<=[.!?])\s+/).filter(Boolean);
  const out = [];
  let cur = '';
  for (const u of units) {
    if (cur && (cur + ' ' + u).length > max) {
      out.push(cur.trim());
      cur = u;
    } else cur = cur ? `${cur} ${u}` : u;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.flatMap((p) => (p.length > max ? p.match(new RegExp(`[\\s\\S]{1,${max}}`, 'g')) : [p]));
}

/** The last ~15% of a text, starting at a word boundary (the overlap carried into the next chunk). */
export function tail(text, share = OVERLAP) {
  const n = Math.floor(text.length * share);
  if (n < 20) return '';
  const cut = text.slice(text.length - n);
  const space = cut.indexOf(' ');
  return (space >= 0 ? cut.slice(space + 1) : cut).trim();
}

/** Every indexable document of the site, with its citation anchor and sections. */
export function buildDocuments(root) {
  const { content } = loadContent(root);
  const items = content.achievements?.items ?? [];
  const docs = [];
  const add = (slug, title, anchor, sourcePath, data, body, anchorFor = () => anchor) => {
    const sections = [];
    const facts = factsText(data);
    if (facts) sections.push({ heading: 'Key facts', text: facts, anchor });
    for (const s of splitSections(body ?? '')) sections.push({ ...s, anchor: anchorFor(s.heading) });
    docs.push({ slug, title, anchor, source_path: sourcePath, sections });
  };
  const single = [
    ['profile', 'Profile', 'content/profile.md'],
    ['about', 'About', 'content/about.md'],
    ['skills', 'Skills', 'content/skills.md'],
    ['experience', 'Experience', 'content/experience.md'],
    ['education', 'Education', 'content/education.md'],
    ['achievements', 'Achievements and certifications', 'content/achievements.md'],
    ['faq', 'Frequently asked questions', 'content/faq.md'],
  ];
  for (const [key, title, path] of single) {
    const d = content[key];
    if (!d) continue;
    let anchor = d.anchor;
    let anchorFor;
    if (key === 'faq') {
      // The FAQ is not a section of the page: cite About, and the contact answer cites the Telegraph.
      anchor = 'about';
      anchorFor = (h) => (/contact|reach|email|hire/i.test(h) ? 'contact' : 'about');
    }
    if (key === 'achievements') {
      // Each award / certificate heading cites its own card on the page.
      anchorFor = (h) => items.find((i) => h && (i.title === h || h.startsWith(i.title)))?.anchor ?? d.anchor;
    }
    const data = key === 'achievements' ? { items: items.map(({ title: t, event, date, detail, type }) => ({ title: t, event, date, detail, type })) } : d;
    add(key, key === 'profile' ? title : (d.title ?? title), anchor, path, data, d.body, anchorFor);
  }
  for (const p of content.projects.filter((x) => !x.draft)) {
    add(`project-${p.slug}`, p.title, p.anchor, `content/projects/${p.slug}.md`, p, p.body);
  }
  return docs;
}

/** Pack a document's sections into chunks (≤ MAX_TOKENS, no anchor crossing, ~15% overlap). */
export function chunkDocument(doc) {
  const pieces = doc.sections.flatMap((s) => splitLong(s.text, PACK - s.heading.length - 4).map((text) => ({ ...s, text })));
  const groups = [];
  for (const p of pieces) {
    const last = groups.at(-1);
    const size = last ? last.parts.reduce((n, x) => n + x.text.length + x.heading.length + 4, 0) : 0;
    if (last && last.anchor === p.anchor && size + p.text.length + p.heading.length + 4 <= PACK) last.parts.push(p);
    else groups.push({ anchor: p.anchor, parts: [p] });
  }
  const chunks = [];
  let previous = '';
  groups.forEach((g, ord) => {
    const headings = [...new Set(g.parts.map((p) => p.heading).filter(Boolean))];
    const heading = headings.join(' · ').slice(0, 200);
    const body = g.parts.map((p) => (p.heading ? `${p.heading}\n${p.text}` : p.text)).join('\n\n');
    const overlap = previous ? `(continued) ${tail(previous)}\n\n` : '';
    const prefix = `${PERSON} — ${doc.title}${headings[0] && headings[0] !== doc.title ? ` — ${headings[0]}` : ''}`;
    const content = `${prefix}\n${overlap}${body}`;
    previous = body;
    chunks.push({ ord, heading, anchor: g.anchor, content, token_estimate: tokenEstimate(content) });
  });
  return chunks;
}

/** PII guard over chunks: throws (with positions, never the values) on a phone or a non-public email. */
export function assertChunksClean(chunks) {
  const problems = [];
  for (const c of chunks) {
    for (const f of scanText(c.content, { allowEmails: [PUBLIC_EMAIL] })) problems.push(`${c.slug}#${c.ord}: looks like a ${f.kind} (line ${f.line})`);
  }
  if (problems.length) throw new Error(`RAG PII guard: refusing to index personal data.\n${problems.join('\n')}`);
}

/** Everything the ingest needs: documents with hashes, and their chunks with content hashes. */
export function buildKnowledgeBase(root, { model = 'gemini-embedding-001', dim = 768 } = {}) {
  const cvDir = join(root, 'content', 'cv');
  const cvFiles = existsSync(cvDir) ? readdirSync(cvDir).filter((f) => !f.startsWith('.')) : [];
  const docs = buildDocuments(root);
  const chunks = [];
  for (const doc of docs) {
    const list = chunkDocument(doc);
    doc.content_hash = sha256(list.map((c) => c.content).join('\n'));
    for (const c of list) chunks.push({ ...c, slug: doc.slug, title: doc.title, content_hash: sha256(`${model}|${dim}|${doc.slug}|${c.anchor}|${c.heading}|${c.content}`) });
  }
  assertChunksClean(chunks);
  return { docs, chunks, cvFiles };
}
