// P9.5: the promo film embed (Classic #video section, reused by the Explore Picture House) and its
// captions (P10: English + Urdu, built from docs/promo/captions.json).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROMO, renderVideoSection } from '../scripts/content/gallery.mjs';
import { buildVtt } from '../scripts/promo/build-vtt.mjs';

const ROOT = join(import.meta.dirname, '..');

describe('P9.5 promo player markup and captions', () => {
  it('embeds promo-1080.mp4 lazily with the poster and English + Urdu captions; the English VTT is built from captions.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'promo-'));
    try {
      mkdirSync(join(root, 'public', 'media'), { recursive: true });
      mkdirSync(join(root, 'public', 'captions'), { recursive: true });
      for (const f of ['promo-1080.mp4', 'promo-poster.jpg']) writeFileSync(join(root, 'public', 'media', f), f);
      for (const f of ['promo.en.vtt', 'promo.ur.vtt']) writeFileSync(join(root, 'public', 'captions', f), f);
      const out = renderVideoSection({ root }).toString();
      expect(PROMO.video).toBe('/media/promo-1080.mp4');
      expect(out).toMatch(/<figure class="player" data-player data-lazy>/);
      expect(out).toMatch(/<video[^>]*src="\/media\/promo-1080\.mp4\?v=[0-9a-f]{10}"[^>]*poster="\/media\/promo-poster\.jpg\?v=[0-9a-f]{10}"[^>]*preload="none"/);
      expect(out).toMatch(/<track kind="captions" src="\/captions\/promo\.en\.vtt\?v=[0-9a-f]{10}" srclang="en" label="English" default \/>/);
      expect(out).toMatch(/<track kind="captions" src="\/captions\/promo\.ur\.vtt\?v=[0-9a-f]{10}" srclang="ur" label="اردو" \/>/);
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

    // P10: the captions (English + Urdu) are built from docs/promo/captions.json; see tests/captions-p10.test.js
    expect(readFileSync(join(ROOT, 'public', 'captions', 'promo.en.vtt'), 'utf8')).toBe(buildVtt(JSON.parse(readFileSync(join(ROOT, 'docs', 'promo', 'captions.json'), 'utf8')), 'en'));
  });
});
