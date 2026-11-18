// P4 step D: real content images. Every public project and certificate image exists as an optimised
// 1600 px WebP with an 800 px sibling, has alt text, is wired into the card / vault markup, and the
// raw inbox and the phone-bearing CV never reach public/.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../scripts/content/load.mjs';
import { imageSize } from '../scripts/content/html.mjs';
import { buildSite } from './helpers/build-site.js';

const ROOT = join(import.meta.dirname, '..');
const pub = (url) => join(ROOT, 'public', url.replace(/^\//, ''));
const { content } = loadContent(ROOT);
const WITH_IMAGES = ['taleem360', 'knodesk-rag', 'knodesk-voice-agent', 'sales-pipeline', 'face-recognition-attendance', 'ned-rag-assistant', 'tiny-village'];
const CERTS = ['cert-ai-fluency', 'cert-kaggle-python', 'cert-google-data'];

describe('P4 content images', () => {
  let html;
  beforeAll(async () => {
    ({ indexHtml: html } = await buildSite());
  }, 180_000);

  it.each(WITH_IMAGES)('%s: 1600 + 800 WebP cover with alt text, wired into its card', (slug) => {
    const p = content.projects.find((x) => x.slug === slug);
    expect(p.images[0]).toBe(`/images/projects/${slug}-1600.webp`);
    expect(p.image_alt?.length).toBeGreaterThan(30);
    for (const size of [1600, 800]) {
      const file = pub(`/images/projects/${slug}-${size}.webp`);
      expect(existsSync(file), file).toBe(true);
      const { width, height } = imageSize(file);
      expect(Math.max(width, height)).toBeLessThanOrEqual(size);
      expect(statSync(file).size).toBeLessThan(300 * 1024);
    }
    const card = html.slice(html.indexOf(`data-project="${slug}"`), html.indexOf('</li>', html.indexOf(`data-project="${slug}"`)));
    expect(card).toContain(`src="/images/projects/${slug}-800.webp" srcset="/images/projects/${slug}-800.webp 800w, /images/projects/${slug}-1600.webp 1600w"`);
    expect(card).toMatch(/alt="[^"]{30,}" loading="lazy"/);
  });

  it.each(CERTS)('%s: certificate scan in the credentials row (lightbox), not an award feature', (anchor) => {
    const item = content.achievements.items.find((i) => i.anchor === anchor);
    expect(item.type).toBe('certification');
    expect(item.image).toBe(`/images/achievements/${anchor}-1600.webp`);
    expect(existsSync(pub(`/images/achievements/${anchor}-800.webp`))).toBe(true);
    const li = html.slice(html.indexOf(`id="${anchor}"`), html.indexOf('</li>', html.indexOf(`id="${anchor}"`)));
    expect(li).toContain('class="cred__media"');
    expect(li).toContain('data-lightbox');
    expect(li).toContain(`alt="${item.image_alt.replace(/&/g, '&amp;')}"`);
    expect(html).not.toMatch(new RegExp(`award-feature paper" id="${anchor}"`));
  });

  it('WebP files carry no metadata chunks (EXIF / XMP stripped)', () => {
    const dirs = ['images/projects', 'images/achievements'].map((d) => join(ROOT, 'public', d));
    for (const dir of dirs) {
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.webp'))) {
        const buf = readFileSync(join(dir, f));
        expect(buf.includes(Buffer.from('EXIF')) || buf.includes(Buffer.from('XMP ')), f).toBe(false);
      }
    }
  });

  it('the inbox is git-ignored and no CV was published (the supplied one shows a phone number)', () => {
    expect(readFileSync(join(ROOT, '.gitignore'), 'utf8')).toMatch(/^content-inbox\/$/m);
    expect(existsSync(join(ROOT, 'public', 'cv.pdf'))).toBe(false);
    expect(readdirSync(join(ROOT, 'public')).filter((f) => /\.pdf$/i.test(f))).toEqual([]);
  });
});
