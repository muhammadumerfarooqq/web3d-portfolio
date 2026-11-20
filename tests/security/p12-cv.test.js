// P12-CV: the CV in the site and in the chatbot. The public PDF may carry the phone number (Umer allows it in that one
// file); the knowledge base, the prompts, the replies and every page must never. These tests pin: the PDF (served from
// /cv/…, small, metadata limited to title and author), the Download CV link (download attribute, the allow-listed
// analytics event, 44 px button, EN + UR label), the redaction (every phone format, ID numbers, addresses; the email and
// links stay), and a scan of the KB source and every chunk for phone-number patterns.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../scripts/content/load.mjs';
import { renderProfileCard } from '../../scripts/content/render.mjs';
import { CV_PATH } from '../../scripts/content/plugin.mjs';
import { buildKnowledgeBase } from '../../scripts/rag/chunk.mjs';
import { cvToMarkdown, redactCv } from '../../scripts/rag/cv-redact.mjs';
import { ANALYTICS_EVENTS } from '../../src/shared/analytics-events.js';
import en from '../../src/i18n/en.json';
import ur from '../../src/i18n/ur.json';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

// Every way the number is written (+92 315 1210038), plus any run of 10 or more digits (spaces, dashes, dots, brackets allowed).
const PHONE_PATTERNS = [/\+\s?92/, /\b0092/, /\b0?315[\s-]?\d/, /315[\s-]?1210038/, /1210038/, /\d{10,}/, /(?:\d[\s().-]*){10,}/];
const phoneHits = (text) => PHONE_PATTERNS.filter((re) => re.test(text)).map(String);

describe('P12-CV: the public PDF', () => {
  const file = join(ROOT, 'public', CV_PATH.slice(1));
  it('is where the site code looks for it (/cv/Muhammad_Umer_Farooq_CV_web.pdf), is a PDF and is under 2 MB', () => {
    expect(CV_PATH).toBe('/cv/Muhammad_Umer_Farooq_CV_web.pdf');
    expect(existsSync(file)).toBe(true);
    const bytes = readFileSync(file);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(statSync(file).size).toBeLessThan(2 * 1024 * 1024);
  });
  it('carries no metadata beyond title and author (no creator, producer, dates, subject, keywords, XMP)', () => {
    const text = readFileSync(file).toString('latin1');
    const info = [...text.matchAll(/\/(Author|Title|Subject|Keywords|Creator|Producer|CreationDate|ModDate)\s*\(([^)]*)\)/g)].map((m) => [m[1], m[2]]);
    expect(info.map(([k]) => k).sort()).toEqual(['Author', 'Title']);
    expect(Object.fromEntries(info)).toEqual({ Author: 'Muhammad Umer Farooq', Title: 'Muhammad Umer Farooq - CV' });
    expect(text).not.toMatch(/xmpmeta|PyMuPDF|ReportLab/);
  });
  it('is a tracked-by-git public asset: not ignored, and the raw CV in content-inbox/ stays ignored', () => {
    const ignore = read('.gitignore');
    expect(ignore).toMatch(/^content-inbox\/$/m);
    expect(ignore).not.toMatch(/^\/?public\/cv|\.pdf$/m);
  });
});

describe('P12-CV: the Download CV link', () => {
  const { content } = loadContent(ROOT);
  const card = renderProfileCard(content, { photoSize: { width: 300, height: 300 }, cvHref: CV_PATH }).toString();
  const link = /<a class="btn btn--sm btn--ink" href="\/cv\/Muhammad_Umer_Farooq_CV_web\.pdf"[^>]*>/.exec(card)?.[0] ?? '';
  it('has a download attribute, a same-origin href, the Explore hook, and the allow-listed analytics event', () => {
    expect(link).toBeTruthy();
    expect(link).toMatch(/\sdownload[\s>]/);
    expect(link).toContain('type="application/pdf"');
    expect(link).toContain('data-cv-download');
    expect(link).toContain('data-event="cv_download"');
    expect(card).toMatch(/<span>Download CV<\/span>/); // the accessible name is its visible text
    expect(card).not.toMatch(/target="_blank"/.exec(link)?.[0] ?? '@@none@@');
  });
  it('is a 44 px button (btn--sm), and no new analytics event was added (nine allow-listed names, cv_download among them)', () => {
    expect(read('src/styles/main.css')).toMatch(/\.btn--sm \{\s*min-block-size: 44px;/);
    expect(ANALYTICS_EVENTS).toHaveLength(9);
    expect(ANALYTICS_EVENTS).toContain('cv_download');
  });
  it('without the PDF no button is rendered (the old behaviour)', () => {
    expect(renderProfileCard(content, { photoSize: { width: 300, height: 300 }, cvHref: null }).toString()).not.toContain('Download CV');
  });
  it('the label is translated for Urdu: one key, in both dictionaries', () => {
    expect(en['cv.download']).toBe('Download CV');
    expect(ur['cv.download']).toMatch(/[؀-ۿ]/);
  });
  it('Explore reads the same link (data-cv-download) and only for a same-origin .pdf', () => {
    const code = read('src/explore/case-files.js');
    expect(code).toContain("a[data-cv-download]");
    expect(code).toContain('/^\\/[\\w/.-]+\\.pdf$/');
  });
  it('headers and CSP are unchanged by the PDF (it is a same-origin static file; nothing in vercel.json mentions it)', () => {
    const vercel = read('vercel.json');
    expect(vercel).not.toMatch(/\/cv\b|\.pdf/);
    expect(vercel).toMatch(/default-src 'self'/);
  });
});

describe('P12-CV: redaction (phone numbers in any format, ID numbers, addresses)', () => {
  const PHONES = ['+92 315 1210038', '+923151210038', '0315 1210038', '0315-1210038', '03151210038', '00923151210038', '(+92) 315 121 0038', '+92-315-1210038', '315 1210038', '0092 315 1210038', '+92 (315) 121-0038'];
  it('removes every spelling of the number, wherever it stands in a line', () => {
    for (const phone of PHONES) {
      const r = redactCv(`Karachi, Pakistan • ${phone} • mumerfarooq.ned@gmail.com`);
      expect(phoneHits(r.text), phone).toEqual([]);
      expect(r.removed.phones, phone).toBeGreaterThanOrEqual(1);
      expect(r.text, phone).toContain('mumerfarooq.ned@gmail.com');
    }
    expect(phoneHits(redactCv('Phone: 0315 1210038\nTel +92 315 1210038\nWhatsApp: 0315-1210038').text)).toEqual([]);
  });
  it('removes national ID numbers and street-address lines; keeps the city', () => {
    const r = redactCv('CNIC: 42101-1234567-1\nAddress: House 12, Block 4, Gulshan\nKarachi, Pakistan');
    expect(r.text).not.toMatch(/42101|1234567|House 12|Gulshan/);
    expect(r.text).toContain('Karachi, Pakistan');
    expect(r.removed).toMatchObject({ ids: 1, addresses: 1 });
  });
  it('keeps what must stay: email, links, years, CGPA, counts and percentages', () => {
    const keep = 'linkedin.com/in/mumerfarooq04 github.com/muhammadumerfarooqq mumerfarooq.ned@gmail.com August 2023 - Present CGPA: 3.65 GPA 3.83 serving 10+ businesses 100% pass rate 25+ employees 500+ diagrams 512-dim 160x (~0.8) 2026 tracker.axisero.com';
    const r = redactCv(keep);
    expect(r.text).toBe(keep);
    expect(r.removed).toEqual({ phones: 0, ids: 0, addresses: 0 });
  });
  it('is idempotent, handles empty / odd input, and the markdown step keeps list bullets', () => {
    for (const v of ['', null, undefined, 42]) expect(redactCv(v).text).toBe(v === 42 ? '42' : '');
    const once = redactCv('+92 315 1210038 • a@b.co').text;
    expect(redactCv(once).text).toBe(once);
    expect(cvToMarkdown('PROFESSIONAL SUMMARY\n\n • One thing done well\n     that wraps\n')).toBe('## Professional Summary\n\n- One thing done well that wraps\n');
  });
});

describe('P12-CV: the phone number is nowhere in the knowledge base, the prompts or the replies', () => {
  const kb = buildKnowledgeBase(ROOT);
  const walk = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));

  it('the CV text is in the index: a "cv" document with chunks that cite an existing anchor', () => {
    expect(kb.cvFiles).toEqual(['cv.md']);
    const chunks = kb.chunks.filter((c) => c.slug === 'cv');
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    const text = chunks.map((c) => c.content).join('\n');
    for (const fact of ['NED University of Engineering and Technology', '3.65', 'Axisero', 'TALEEM360', 'Python, SQL, C++', 'mumerfarooq.ned@gmail.com']) expect(text, fact).toContain(fact);
    for (const c of chunks) expect(c.anchor).toBe('about');
  });
  it('KB source files (content/**, the CV markdown) hold no phone pattern', () => {
    const files = walk('content').filter((f) => /\.(md|json|txt)$/.test(f));
    expect(files).toContain('content/cv/cv.md');
    for (const f of files) expect(phoneHits(read(f)), f).toEqual([]);
  });
  it('every chunk of the index holds no phone pattern (+92, 0315, 315 1210038, any 10+ digit run)', () => {
    expect(kb.chunks.length).toBeGreaterThan(20);
    for (const c of kb.chunks) expect(phoneHits(c.content), `${c.slug}#${c.ord}`).toEqual([]);
  });
  it('the prompts and fixed replies hold no phone pattern', () => {
    for (const f of ['api/_lib/chat-prompt.js']) expect(phoneHits(read(f)), f).toEqual([]);
  });
  it('the guard in the chunker still refuses a phone (defence in depth)', async () => {
    const { assertChunksClean } = await import('../../scripts/rag/chunk.mjs');
    expect(() => assertChunksClean([{ slug: 'cv', ord: 0, content: 'Reach me on +92 315 1210038' }])).toThrow(/PII guard/);
  });
  it('a CV that still had the number is redacted AT INGEST: the chunker redacts content/cv/cv.md again', () => {
    expect(read('scripts/rag/chunk.mjs')).toMatch(/redactCv\(readFileSync\(cvPath, 'utf8'\)\)/);
  });
});
