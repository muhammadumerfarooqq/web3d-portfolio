// P10 Urdu UI: the two dictionaries, the translator, <html lang dir> switching, the pre-paint theme-init.js, and the
// bundle: nothing from i18n (or analytics, or the accessibility menu) in the Explore chunk, and no dictionary in
// Classic's entry. The strings are checked against the real page and the real JS messages they translate.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../src/i18n/en.json';
import ur from '../src/i18n/ur.json';
import { currentLang, setDocumentLang, setTranslator, tr } from '../src/i18n/index.js';
import { buildIndex, translate } from '../src/i18n/translate.js';
import { buildSite } from './helpers/build-site.js';

const ROOT = join(import.meta.dirname, '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const URDU = /[؀-ۿ]/;
const placeholders = (s) => [...s.matchAll(/\{([a-z]+)\}/g)].map((m) => m[1]).sort();

describe('P10 dictionaries', () => {
  it('en.json and ur.json have identical keys; no value is empty', () => {
    expect(Object.keys(ur).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(en).length).toBeGreaterThan(150);
    for (const [k, v] of Object.entries(en)) expect(v.trim(), `en ${k}`).not.toBe('');
    for (const [k, v] of Object.entries(ur)) expect(v.trim(), `ur ${k}`).not.toBe('');
  });
  it('every Urdu value is written in Urdu script, differs from the English, and keeps the same {placeholders}', () => {
    for (const [k, v] of Object.entries(ur)) {
      expect(v, k).toMatch(URDU);
      expect(v, k).not.toBe(en[k]);
      expect(placeholders(v), k).toEqual(placeholders(en[k]));
    }
  });
  it('one English text has one key (a text can be found again from the text alone)', () => {
    const texts = Object.values(en).map((s) => s.replace(/\s+/g, ' ').trim());
    expect(new Set(texts).size).toBe(texts.length);
  });
  it('keys are flat dotted names', () => {
    for (const k of Object.keys(en)) expect(k).toMatch(/^[a-z0-9]+(?:\.[A-Za-z0-9]+)+$/);
  });
  it('the Urdu has no Latin-only translation of an English sentence (names like TALEEM360 are fine, whole sentences are not)', () => {
    for (const [k, v] of Object.entries(ur)) {
      const letters = v.match(/[A-Za-z؀-ۿ]/g) ?? [];
      const latin = letters.filter((c) => /[A-Za-z]/.test(c)).length;
      expect(latin / letters.length, k).toBeLessThan(0.55);
    }
  });
});

describe('P10 every English string is a real string of the page or of the JS messages', () => {
  const sources = ['index.html', 'src/ui/chat.js', 'src/ui/voice.js', 'src/ui/contact.js', 'src/shared/contact-schema.js', 'src/shared/chat-schema.js', 'scripts/content/render.mjs'].map(read).join('\n');
  const flat = sources.replace(/\s+/g, ' ');
  // Templates and messages the JS builds from pieces: the longest literal piece (or, for the few built with a conditional, its first words).
  const BUILT = new Set(['contact.summary1', 'contact.summaryN', 'chat.rate1', 'chat.rateN', 'voice.rate1', 'voice.rateN', 'contact.rate1', 'contact.rateN', 'contact.rateH', 'voice.recording1', 'voice.recordingN']);
  const needles = (s, key) => {
    const pieces = s.replace(/\s+/g, ' ').trim().split(/\{[a-z]+\}/).map((p) => p.trim());
    const longest = pieces.reduce((a, b) => (b.length > a.length ? b : a), '');
    return BUILT.has(key) ? pieces[0].slice(0, 10).trim() : longest;
  };
  it.each(Object.entries(en))('%s', (key, text) => {
    // exact text for plain strings; the text before the first {placeholder} for templates (the JS builds the rest)
    const head = needles(text, key);
    expect(head.length, key).toBeGreaterThan(1);
    expect(flat.includes(head) || flat.includes(head.replace(/’/g, "'")) || flat.includes(head.replace(/…/g, '...')), `${key}: "${head}"`).toBe(true);
  });
  const contentStrings = new Set(['nav.office', 'nav.workshop', 'nav.bounties', 'nav.vault', 'nav.railway', 'nav.telegraph']);
  it('the navigation links, section titles and contact form labels of the built page are all in the dictionary (text node by text node)', async () => {
    const { indexHtml } = await buildSite();
    const index = buildIndex(en);
    const must = ['Office', 'Workshop', 'Bounties', 'Vault', 'Railway', 'Video', 'Ask my AI', 'Telegraph', 'Know your sheriff', 'Tools of the trade', 'Trophies in the vault', 'Stations so far', 'Now showing', 'Send a telegram', 'Name', 'Email', 'Subject', 'Message', 'Send telegram', 'Clear form', 'Your question', 'Ask', 'Back to top', 'Privacy', 'Accessibility', 'Reduce motion', 'Larger text', 'High contrast', 'Readable spacing', 'Underline links', 'Reset all'];
    for (const text of must) {
      expect(index.exact.has(text), text).toBe(true);
      expect(indexHtml.includes(`>${text}<`) || indexHtml.includes(`>${text} `) || indexHtml.includes(`> ${text}`) || text === 'Ask' || text === 'Video', text).toBe(true);
    }
    void contentStrings;
  });
});

describe('P10 translator', () => {
  const index = buildIndex(en);
  it('translates exact strings, keeps surrounding spaces, ignores whitespace differences and unknown text', () => {
    expect(translate('Send a telegram', index, ur)).toBe(ur['contact.title']);
    expect(translate('  Send   a\n telegram ', index, ur)).toBe(` ${ur['contact.title']} `);
    expect(translate('Nothing like this', index, ur)).toBeNull();
    expect(translate('', index, ur)).toBeNull();
    expect(translate('   ', index, ur)).toBeNull();
  });
  it('fills {n} templates: minutes, seconds, hours, validation counts', () => {
    expect(translate('You are asking quickly, partner. Please wait 3 minutes and try again.', index, ur)).toBe(ur['chat.rateN'].replace('{n}', '3'));
    expect(translate('You are asking quickly, partner. Please wait 1 minute and try again.', index, ur)).toBe(ur['chat.rate1'].replace('{n}', '1'));
    expect(translate('You have sent several telegrams already. Please try again in 2 hours, or email me directly.', index, ur)).toBe(ur['contact.rateH'].replace('{n}', '2'));
    expect(translate('Please enter your name (at least 2 characters).', index, ur)).toBe(ur['contact.e.nameMin'].replace('{n}', '2'));
    expect(translate('Please fix these 3 problems before sending:', index, ur)).toBe(ur['contact.summaryN'].replace('{n}', '3'));
    expect(translate('No Urdu voice is installed on this device, so I cannot read this answer aloud.', index, ur)).toBe(ur['voice.noVoice'].replace('{name}', 'Urdu'));
  });
  it('every real message produced by the JS is translatable', async () => {
    const { CHAT_MESSAGES } = await import('../src/ui/chat.js');
    const { MESSAGES } = await import('../src/ui/contact.js');
    const { VOICE_MESSAGES } = await import('../src/ui/voice.js');
    const texts = [];
    for (const group of [CHAT_MESSAGES, MESSAGES, VOICE_MESSAGES]) {
      for (const [k, v] of Object.entries(group)) {
        if (typeof v === 'string') texts.push([k, v]);
        else if (k === 'rateLimited') texts.push([k, v(60)], [k, v(180)], [k, v(7200)]);
        else if (k === 'summary') texts.push([k, v(1)], [k, v(4)]);
        else if (k === 'recording') texts.push([k, v(1)], [k, v(25)]);
        else if (k === 'almost') texts.push([k, v(5)]);
        else if (k === 'noVoice') texts.push([k, v('Urdu')]);
      }
    }
    const missing = texts.filter(([, t]) => translate(t, index, ur) === null).map(([k, t]) => `${k}: ${t}`);
    expect(missing).toEqual([]);
    expect(texts.length).toBeGreaterThan(30);
  });
  it('the contact form\'s validation messages are all translatable', async () => {
    const { validateContact } = await import('../src/shared/contact-schema.js');
    const bad = [{ name: '', email: '', subject: '', message: '' }, { name: 'A', email: 'x', subject: 'Other', message: 'short' }, { name: 'A'.repeat(90), email: `${'a'.repeat(130)}@example.com`, subject: 'General', message: 'x'.repeat(4100) }, { name: 'Ada Lovelace', email: 'ada@example.com', subject: 'General', message: 'http://a.b http://c.d http://e.f http://g.h and more words here' }];
    const found = [];
    for (const input of bad) {
      const r = validateContact(input);
      for (const m of Object.values(r.errors ?? r.fields ?? {})) found.push(String(m));
    }
    expect(found.length).toBeGreaterThan(5);
    for (const m of found) expect(translate(m, index, ur), m).not.toBeNull();
  });
  it('tr() returns the text unchanged until a translator is installed, never throws, and falls back to English for unknown text', () => {
    expect(tr('Send a telegram')).toBe('Send a telegram');
    expect(tr(undefined)).toBe(undefined);
    setTranslator((t) => translate(t, index, ur) ?? t);
    try {
      expect(tr('Send a telegram')).toBe(ur['contact.title']);
      expect(tr('A sentence nobody translated')).toBe('A sentence nobody translated');
      expect(tr('')).toBe('');
    } finally {
      setTranslator(null);
    }
    setTranslator(() => {
      throw new Error('boom');
    });
    try {
      expect(tr('Send a telegram')).toBe('Send a telegram');
    } finally {
      setTranslator(null);
    }
  });
});

describe('P10 <html lang dir>', () => {
  const fakeHtml = () => {
    const attrs = {};
    return { attrs, setAttribute: (k, v) => (attrs[k] = String(v)), getAttribute: (k) => attrs[k] ?? null };
  };
  it('Urdu is lang="ur" dir="rtl"; English (and anything else) is lang="en" dir="ltr"; currentLang reads it back', () => {
    const html = fakeHtml();
    expect(setDocumentLang(html, 'ur')).toBe('ur');
    expect(html.attrs).toEqual({ lang: 'ur', dir: 'rtl' });
    expect(currentLang(html)).toBe('ur');
    expect(setDocumentLang(html, 'en')).toBe('en');
    expect(html.attrs).toEqual({ lang: 'en', dir: 'ltr' });
    expect(currentLang(html)).toBe('en');
    expect(setDocumentLang(html, '<script>')).toBe('en');
    expect(html.attrs.dir).toBe('ltr');
  });
});

describe('P10 theme-init.js applies the language and the accessibility settings before the first paint', () => {
  function run({ search = '', stored = {}, throws = false, reduced = false } = {}) {
    const attrs = {};
    const classes = new Set();
    const root = { setAttribute: (k, v) => (attrs[k] = String(v)), getAttribute: (k) => attrs[k] ?? null, classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } };
    const win = {
      localStorage: { getItem: (k) => (throws ? (() => { throw new Error('blocked'); })() : stored[k] ?? null), setItem: () => { throw new Error('theme-init must not write'); } },
      sessionStorage: { getItem: () => null },
      location: { search },
      matchMedia: (q) => ({ matches: reduced && /reduced-motion/.test(q) }),
      setTimeout: () => 0,
    };
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', read('public/theme-init.js'))(win, { documentElement: root });
    return { attrs, classes };
  }
  it('a stored language "ur" or ?lang=ur sets lang="ur" dir="rtl"; ?lang=en wins over a stored "ur"; junk is ignored', () => {
    expect(run({ stored: { lang: 'ur' } }).attrs).toMatchObject({ lang: 'ur', dir: 'rtl' });
    expect(run({ search: '?lang=ur' }).attrs).toMatchObject({ lang: 'ur', dir: 'rtl' });
    expect(run({ search: '?x=1&lang=ur' }).attrs).toMatchObject({ lang: 'ur', dir: 'rtl' });
    expect(run({ search: '?lang=en', stored: { lang: 'ur' } }).attrs.lang).toBeUndefined();
    for (const junk of ['UR', 'fr', '<script>', 'ur,en', '']) expect(run({ stored: { lang: junk } }).attrs.lang, junk).toBeUndefined();
    expect(run({ search: '?lang=xx' }).attrs.lang).toBeUndefined();
    expect(run({ throws: true }).attrs.lang).toBeUndefined();
  });
  it('stored accessibility settings become data-a11y-* attributes; unknown names are ignored; storage errors change nothing', () => {
    const a = run({ stored: { a11y: 'motion,text,contrast,spacing,links' } }).attrs;
    expect(a).toMatchObject({ 'data-a11y-motion': 'reduce', 'data-a11y-text': 'large', 'data-a11y-contrast': 'high', 'data-a11y-spacing': 'readable', 'data-a11y-links': 'underline' });
    const b = run({ stored: { a11y: 'text,evil,__proto__,constructor,toString' } }).attrs;
    expect(Object.keys(b).filter((k) => k.startsWith('data-a11y'))).toEqual(['data-a11y-text']);
    expect(Object.keys(run({ throws: true }).attrs).filter((k) => k.startsWith('data-a11y'))).toEqual([]);
  });
  it('"Reduce motion" behaves like prefers-reduced-motion: no hidden reveals (no js class) and the start screen first', () => {
    const on = run({ stored: { a11y: 'motion' } });
    expect(on.classes.has('js')).toBe(false);
    expect(on.attrs['data-boot']).toBe('start');
    const off = run({});
    expect(off.classes.has('js')).toBe(true);
    expect(off.attrs['data-boot']).toBe('intro');
    expect(run({ reduced: true }).classes.has('js')).toBe(false);
  });
});

describe('P10 bundle: nothing from i18n, analytics or the menu in Explore; no dictionary in Classic\'s entry', () => {
  let outputs;
  beforeAll(async () => {
    ({ outputs } = await buildSite());
  }, 180_000);
  const chunk = (re) => outputs.find((o) => re.test(o.fileName));
  const code = (o) => String(o.code ?? '');
  /** A chunk plus everything it imports statically. */
  function closure(entry) {
    const seen = new Set();
    const walk = (name) => {
      if (seen.has(name)) return;
      seen.add(name);
      const o = outputs.find((x) => x.fileName === name);
      for (const imp of o?.imports ?? []) walk(imp);
    };
    walk(entry.fileName);
    return seen;
  }
  it('the Explore chunk and its static imports hold no Urdu, no translator, no analytics call and no accessibility-menu code', () => {
    const explore = chunk(/^assets\/explore-.*\.js$/);
    for (const name of closure(explore)) {
      const text = code(outputs.find((o) => o.fileName === name));
      expect(text, name).not.toMatch(URDU);
      expect(text, name).not.toMatch(/i18nrevert|langchange|setTranslator|api\/collect|data-a11y|a11y_menu_used|pageview_classic/);
    }
  });
  it('Classic\'s entry (main + static imports) carries no dictionary and no Urdu text; the Urdu text is its own chunk loaded on demand', () => {
    const main = chunk(/^assets\/main-.*\.js$/);
    const names = closure(main);
    for (const name of names) {
      const text = code(outputs.find((o) => o.fileName === name));
      expect(text, name).not.toMatch(URDU);
      expect(text, name).not.toContain('nav.office');
    }
    const urChunk = outputs.find((o) => /^assets\/ur-.*\.js$/.test(o.fileName));
    expect(urChunk).toBeTruthy();
    expect(code(urChunk)).toMatch(URDU);
    expect(names.has(urChunk.fileName)).toBe(false);
    const apply = chunk(/^assets\/apply-.*\.js$/);
    expect(apply).toBeTruthy();
    expect(names.has(apply.fileName)).toBe(false);
    expect(apply.dynamicImports?.some((d) => d === urChunk.fileName) ?? true).toBe(true);
  });
  it('the accessibility-menu chunk is lazy too (not in the static entry) and analytics is its own chunk', () => {
    const main = chunk(/^assets\/main-.*\.js$/);
    const names = closure(main);
    const menu = chunk(/^assets\/a11y-menu-.*\.js$/);
    expect(menu).toBeTruthy();
    expect(names.has(menu.fileName)).toBe(false);
    const analytics = outputs.filter((o) => /^assets\/analytics-.*\.js$/.test(o.fileName));
    expect(analytics.length).toBeGreaterThan(0);
    for (const a of analytics) expect(names.has(a.fileName)).toBe(false);
  });
  it('only system fonts for Urdu: no new font file, no @font-face and no url() in the language / accessibility CSS', () => {
    const css = read('src/styles/a11y.css');
    expect(css).not.toMatch(/@font-face|url\(|@import/);
    expect(css).toMatch(/Noto Nastaliq Urdu/);
    expect(css).toMatch(/Jameel Noori Nastaleeq/);
    expect(css).toMatch(/Noto Naskh Arabic/);
    const fonts = outputs.filter((o) => /\.(woff2?|ttf|otf)$/.test(o.fileName)).map((o) => o.fileName);
    expect(fonts.filter((f) => /urdu|nastaliq|naskh|noto/i.test(f))).toEqual([]);
    expect(readdirSync(join(ROOT, 'public')).filter((f) => /font/i.test(f))).toEqual([]);
  });
  it('the header and the mobile menu both have the EN | اردو switch with aria-pressed and lang attributes', async () => {
    const { indexHtml } = await buildSite();
    const groups = [...indexHtml.matchAll(/<div class="lang-switch" role="group" aria-label="Language">([\s\S]*?)<\/div>/g)];
    expect(groups).toHaveLength(2);
    for (const [, inner] of groups) {
      expect(inner).toMatch(/aria-pressed="true" data-lang="en" lang="en">EN</);
      expect(inner).toMatch(/aria-pressed="false" data-lang="ur" lang="ur">اردو</);
    }
  });
});
