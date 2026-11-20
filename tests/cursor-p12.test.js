// P12-UX: "when I hover I cannot see the cursor". The causes were the custom dot + ring (`cursor: none` on the whole
// page, drawn inside the page, so it vanished behind <dialog> overlays, video controls and third-party frames, and
// after Tab or a blur) — now removed. These tests keep it that way: nothing may hide the cursor, and the solid SVG
// cursors (same origin, so the CSP is unchanged) are the page default.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const sources = [...walk(join(ROOT, 'src')), join(ROOT, 'index.html'), join(ROOT, 'admin', 'index.html'), ...walk(join(ROOT, 'public')).filter((f) => /\.(css|js|html)$/.test(f))];
const rel = (f) => relative(ROOT, f).replaceAll('\\', '/');
// Comments may talk about it ("cursor: none"): only code counts.
const code = (f) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/<!--[\s\S]*?-->/g, '');

// The ONLY file that may hide the cursor: the dev-server-only promo capture mode (src/explore/capture.css is imported by
// capture-mode.js, which mode.js / explore/index.js load only behind import.meta.env.DEV, so it is never in a production bundle).
const ALLOWED = ['src/explore/capture.css'];

describe('P12-UX cursor: nothing may hide it', () => {
  it('no CSS or JS sets `cursor: none` (or style.cursor = "none"), except the dev-only capture mode', () => {
    const offenders = [];
    for (const f of sources) {
      const text = code(f);
      if (/cursor\s*:\s*none|cursor\s*=\s*['"`]none|setProperty\(\s*['"]cursor['"]\s*,\s*['"]none|cursor-hidden|has-cursor/.test(text)) offenders.push(rel(f));
    }
    expect(offenders.filter((f) => !ALLOWED.includes(f))).toEqual([]);
  });

  it('the capture exception is dev only: capture.css is imported by capture-mode.js alone, which is behind import.meta.env.DEV', () => {
    const importers = sources.filter((f) => f.endsWith('.js') && /capture\.css/.test(code(f))).map(rel);
    expect(importers).toEqual(['src/explore/capture-mode.js']);
    expect(read('src', 'explore', 'index.js')).toMatch(/import\.meta\.env\.DEV && options\.devCapture \? await import\('\.\/capture-mode\.js'\)/);
  });

  it('no custom drawn cursor is left (no .cursor element, no blend-mode / z-index trick standing in for the pointer)', () => {
    expect(existsSync(join(ROOT, 'src', 'ui', 'cursor.js'))).toBe(false);
    expect(read('src', 'main.js')).not.toMatch(/initCursor|ui\/cursor/);
    const css = sources.filter((f) => f.endsWith('.css') && !ALLOWED.includes(rel(f))).map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(css).not.toMatch(/\.cursor(--|\s|,|\{)|\.cursor\b[^-]/);
  });
});

describe('P12-UX cursor: solid, self-hosted, visible on any background', () => {
  const svg = (name) => read('public', 'cursors', name);

  it('arrow.svg and pointer.svg: ≥ 24 px, a solid dark fill with a light outline, hotspot inside the image, no script, no external reference', () => {
    for (const name of ['arrow.svg', 'pointer.svg']) {
      const s = svg(name);
      const w = Number(/width="(\d+)"/.exec(s)?.[1]);
      const h = Number(/height="(\d+)"/.exec(s)?.[1]);
      expect(w, name).toBeGreaterThanOrEqual(24);
      expect(h, name).toBeGreaterThanOrEqual(24);
      expect(w, name).toBeLessThanOrEqual(128); // browsers ignore larger cursor images
      expect(s, name).toMatch(/fill="#111111"/);
      expect(s, name).toMatch(/stroke="#ffffff"/);
      expect(s, name).not.toMatch(/<script|onload|href=|url\(|<image|<style|data:/i);
    }
  });

  it('cursor.css: the arrow is the page default and the hand is the interactive one, each with the native keyword as fallback, hotspots inside the image', () => {
    const css = read('src', 'styles', 'cursor.css');
    const m = [...css.matchAll(/cursor:\s*url\('(\/cursors\/[a-z]+\.svg)'\)\s+(\d+)\s+(\d+),\s*([a-z-]+);/g)];
    expect(m.length).toBeGreaterThanOrEqual(3);
    for (const [, path, x, y, fallback] of m) {
      expect(existsSync(join(ROOT, 'public', path.slice(1))), path).toBe(true);
      expect(Number(x)).toBeLessThan(32);
      expect(Number(y)).toBeLessThan(32);
      expect(['auto', 'pointer', 'not-allowed']).toContain(fallback);
    }
    expect(css).toMatch(/html \{\s*cursor: url\('\/cursors\/arrow\.svg'\) 5 3, auto;/);
    expect(css).toMatch(/a\[href\], button, \[role='button'\]/);
    expect(css).toMatch(/cursor: url\('\/cursors\/pointer\.svg'\) 14 2, pointer;/);
    expect(css).toMatch(/cursor: text;/); // text fields keep the native I-beam
    expect(css).not.toMatch(/data:/); // no data: URI (the CSP allows data: images, but the files are self-hosted)
    expect(read('src', 'styles', 'main.css')).toMatch(/@import "\.\/cursor\.css";/);
  });

  it('the hotspots sit on the tips of the drawings (arrow tip at 5,3; fingertip at 14,2)', () => {
    expect(svg('arrow.svg')).toMatch(/d="M5 3v/); // the path starts at the tip
    expect(svg('pointer.svg')).toMatch(/M12\.5 3\.2c0-1\.1\.9-2 2-2/); // fingertip: x 12.5…16.5, top y 1.2
  });

  it('the CSP is unchanged by the cursor images (img-src \'self\' already covers them)', () => {
    const csp = JSON.parse(read('vercel.json')).headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value;
    expect(csp).toMatch(/img-src 'self' data: blob:/);
  });

  it('Explore: the cursor is visible whenever the pointer is not locked; pointer lock shows a solid reticle', () => {
    const css = read('src', 'explore', 'explore.css');
    expect(css).toMatch(/\.xp-crosshair \{[^}]*inline-size: 10px;[^}]*background: #f4ead8;[^}]*box-shadow: 0 0 0 2px/);
    expect(css).not.toMatch(/pointer-events:\s*none[^}]*\n[^}]*\.xp-canvas/);
  });
});
