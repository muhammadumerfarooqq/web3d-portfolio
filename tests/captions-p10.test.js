// P10 promo captions (English + Urdu): the WebVTT files parse, cues are in order without overlap inside the film's
// 45 seconds, both languages share the timing, the files are valid UTF-8, the Urdu is Urdu script with the
// "review needed" note, no phone number anywhere, and the player carries both tracks (English default) and a
// plain-text transcript.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildVtt } from '../scripts/promo/build-vtt.mjs';
import { buildSite } from './helpers/build-site.js';

const ROOT = join(import.meta.dirname, '..');
const bytes = (f) => readFileSync(join(ROOT, f));
const decode = (f) => new TextDecoder('utf-8', { fatal: true }).decode(bytes(f));
const captions = JSON.parse(readFileSync(join(ROOT, 'docs', 'promo', 'captions.json'), 'utf8'));
const PHONE = /(?:\+|00)\s?\d{2}[\s.-]?\d{3}|\b0\d{2,3}[\s.-]?\d{3}[\s.-]?\d{4}\b|\b\d{4}[\s.-]\d{7}\b|\b\d{10,}\b/;
const sec = (t) => {
  const [h, m, s] = t.split(':');
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
};
function parse(text) {
  const blocks = text.trim().split(/\n\n+/);
  const header = blocks.shift();
  const note = blocks[0]?.startsWith('NOTE') ? blocks.shift() : null;
  const cues = blocks.map((b) => {
    const [id, timing, ...lines] = b.split('\n');
    const m = /^(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})$/.exec(timing);
    return { id, from: m ? sec(m[1]) : NaN, to: m ? sec(m[2]) : NaN, timing, text: lines.join('\n') };
  });
  return { header, note, cues };
}

describe.each([['en', 'public/captions/promo.en.vtt'], ['ur', 'public/captions/promo.ur.vtt']])('P10 captions (%s)', (lang, file) => {
  const raw = decode(file);
  const vtt = parse(raw);
  it('is valid UTF-8 (no BOM, no replacement character) that starts with WEBVTT', () => {
    expect(bytes(file).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    expect(raw).not.toContain('\uFFFD');
    expect(raw.startsWith('WEBVTT')).toBe(true);
    expect(raw).not.toContain('\r');
  });
  it('every cue has an id, a valid timing line and text; ids run 1..n', () => {
    expect(vtt.cues.length).toBeGreaterThanOrEqual(15);
    vtt.cues.forEach((c, i) => {
      expect(c.id).toBe(String(i + 1));
      expect(c.timing, c.id).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}$/);
      expect(c.text.trim(), c.id).not.toBe('');
      expect(c.text, c.id).not.toMatch(/-->/);
    });
  });
  it('cues are in order, never overlap, are at least a second long and stay inside the 45 s film', () => {
    let last = 0;
    for (const c of vtt.cues) {
      expect(c.from, c.id).toBeGreaterThanOrEqual(last);
      expect(c.to, c.id).toBeGreaterThanOrEqual(c.from + 1);
      expect(c.to, c.id).toBeLessThanOrEqual(45);
      last = c.to;
    }
    expect(vtt.cues[0].from).toBe(0);
    expect(last).toBe(45);
  });
  it('is exactly what captions.json builds (nothing hand-edited), with no phone number or private data', () => {
    expect(raw).toBe(buildVtt(captions, lang));
    expect(PHONE.test(raw.replace(/\d\d:\d\d:\d\d\.\d{3}/g, ''))).toBe(false);
    expect(raw).not.toMatch(/\bphone\b|whatsapp|cnic|\+92/i);
  });
  it('carries the facts of the film (live URL, public email, the four projects, the dates)', () => {
    for (const must of ['umerfarooq-ai.vercel.app', 'mumerfarooq.ned@gmail.com', 'TALEEM360', 'KnoDesk', '3.83', '2023', '2026']) expect(raw, must).toContain(must);
  });
});

describe('P10 captions: the two languages', () => {
  const en = parse(decode('public/captions/promo.en.vtt'));
  const ur = parse(decode('public/captions/promo.ur.vtt'));
  it('share the same cue count and the same timing', () => {
    expect(ur.cues.map((c) => c.timing)).toEqual(en.cues.map((c) => c.timing));
  });
  it('the Urdu file leads with the review note for a native speaker, and every cue is real Urdu script (names and numbers stay Latin)', () => {
    expect(ur.header).toContain('Urdu');
    expect(ur.note).toContain('REVIEW NEEDED by native speaker');
    for (const c of ur.cues) {
      const letters = c.text.match(/[A-Za-z\u0600-\u06FF]/g) ?? [];
      const urdu = letters.filter((ch) => /[\u0600-\u06FF]/.test(ch)).length;
      expect(urdu / letters.length, `cue ${c.id}: ${c.text}`).toBeGreaterThan(0.45);
      expect(c.text, c.id).toMatch(/[\u0600-\u06FF]/);
    }
  });
  it('the English file has no Urdu and the note is only in the Urdu file', () => {
    expect(en.cues.some((c) => /[\u0600-\u06FF]/.test(c.text))).toBe(false);
    expect(en.note).toBeNull();
  });
  it('captions.json has an English and an Urdu text for every cue, and says the Urdu needs review', () => {
    for (const c of captions.cues) {
      expect(c.en.trim()).not.toBe('');
      expect(c.ur.trim()).not.toBe('');
    }
    expect(captions.note).toMatch(/NEEDS A NATIVE SPEAKER/);
  });
});

describe('P10 captions on the page', () => {
  it('the promo player has an English (default) and an Urdu captions track and a plain-text transcript in both languages', async () => {
    const { indexHtml } = await buildSite();
    const at = indexHtml.indexOf('src="/media/promo-1080.mp4');
    const video = indexHtml.slice(indexHtml.lastIndexOf('<video', at), indexHtml.indexOf('</video>', at));
    expect(video).toMatch(/<track kind="captions" src="\/captions\/promo\.en\.vtt\?v=[0-9a-f]{10}" srclang="en" label="English" default \/>/);
    expect(video).toMatch(/<track kind="captions" src="\/captions\/promo\.ur\.vtt\?v=[0-9a-f]{10}" srclang="ur" label="اردو" \/>/);
    expect(video).toMatch(/\scontrols[\s>]/); // native controls: keyboard operable
    expect(video).not.toMatch(/autoplay/);
    const transcript = indexHtml.slice(indexHtml.indexOf('<details class="video-transcript"'), indexHtml.indexOf('</details>', indexHtml.indexOf('<details class="video-transcript"')));
    expect(transcript).toMatch(/<div lang="en" dir="ltr">/);
    expect(transcript).toMatch(/<div lang="ur" dir="rtl">/);
    expect((transcript.match(/<li>/g) ?? []).length).toBe(captions.cues.length * 2);
    expect(PHONE.test(transcript)).toBe(false);
  });
});
