// P9.5: the promo film embed (Classic #video section, reused by the Explore Picture House) and its
// captions file, built from the cue sheet.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROMO, renderVideoSection } from '../scripts/content/gallery.mjs';
import { buildVtt } from '../scripts/promo/build-vtt.mjs';

const ROOT = join(import.meta.dirname, '..');

describe('P9.5 promo player markup and captions', () => {
  it('embeds promo-1080.mp4 lazily with the poster and English captions; the VTT matches cues.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'promo-'));
    try {
      mkdirSync(join(root, 'public', 'media'), { recursive: true });
      for (const f of ['promo-1080.mp4', 'promo-poster.jpg', 'promo.en.vtt']) writeFileSync(join(root, 'public', 'media', f), f);
      const out = renderVideoSection({ root }).toString();
      expect(PROMO.video).toBe('/media/promo-1080.mp4');
      expect(out).toMatch(/<figure class="player" data-player data-lazy>/);
      expect(out).toMatch(/<video[^>]*src="\/media\/promo-1080\.mp4\?v=[0-9a-f]{10}"[^>]*poster="\/media\/promo-poster\.jpg\?v=[0-9a-f]{10}"[^>]*preload="none"/);
      expect(out).toMatch(/<track kind="captions" src="\/media\/promo\.en\.vtt\?v=[0-9a-f]{10}" srclang="en" label="English" \/>/);
      expect(out).not.toMatch(/autoplay|download|promo-4k/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    // no media yet: the existing placeholder
    const empty = mkdtempSync(join(tmpdir(), 'promo-'));
    try {
      expect(renderVideoSection({ root: empty }).toString()).toContain('video-soon');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
    // the player keeps lazy videos at preload="none"
    expect(readFileSync(join(ROOT, 'src', 'ui', 'video.js'), 'utf8')).toContain("!('lazy' in figure.dataset)");

    const cues = JSON.parse(readFileSync(join(ROOT, 'docs', 'promo', 'cues.json'), 'utf8'));
    const vtt = readFileSync(join(ROOT, 'public', 'media', 'promo.en.vtt'), 'utf8');
    expect(vtt).toBe(buildVtt(cues)); // regenerated from the cue sheet, not hand-edited
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    const blocks = vtt.trim().split(/\n\n/).slice(1);
    const sec = (t) => t.split(':').reduce((a, b) => a * 60 + Number(b), 0);
    for (const b of blocks) {
      const [, timing, ...text] = b.split('\n');
      const m = /^(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})$/.exec(timing);
      expect(m, b).not.toBeNull();
      expect(sec(m[2])).toBeGreaterThan(sec(m[1]));
      expect(sec(m[2])).toBeLessThanOrEqual(cues.duration);
      expect(text.join(' ').trim()).not.toBe('');
    }
    for (const t of cues.text) expect(vtt).toContain(t.text.replaceAll('{liveUrl}', cues.liveUrl));
    expect(vtt).toContain('umerfarooq-ai.vercel.app');
    expect(vtt).toMatch(/\[music: /);
    expect(vtt).toMatch(/\[sound: /);
  });
});
