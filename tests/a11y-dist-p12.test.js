// P12-UX2: the accessibility button on the BUILT site. In production the button showed as an old text button in the
// top-left corner, outside the header, and a click did nothing: the deployed index.html was the pre-P12 markup (it had not
// been committed) while the CSS and JS were new, so the box sat under the fixed header. Source-level tests could not see it.
// This test builds the site for production into a temporary folder, serves it with `vite preview` and drives real Chrome
// (as scripts/csp-check.mjs does): the button must be inside the header, nothing may cover it, and a click, Enter and
// Space must open the panel (aria-expanded="true"); Esc closes it and returns focus. Run it from PowerShell (not Git Bash).
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright-core';
import { build, preview } from 'vite';
import { ROOT, buildSite } from './helpers/build-site.js';

const read = (f) => readFileSync(join(ROOT, f), 'utf8');
let outDir;
let server;
let browser;
let base;

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'a11y-dist-'));
  await build({ root: ROOT, configFile: join(ROOT, 'vite.config.js'), logLevel: 'silent', mode: 'production', build: { outDir, emptyOutDir: true } });
  server = await preview({ root: ROOT, configFile: join(ROOT, 'vite.config.js'), build: { outDir }, preview: { port: 4211, strictPort: false }, logLevel: 'error' });
  base = server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

async function open(width) {
  const phone = width < 768;
  const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: phone, isMobile: phone });
  await context.addInitScript(() => {
    localStorage.setItem('theme', 'dark');
    localStorage.setItem('mode', 'classic');
    localStorage.setItem('intro', 'seen');
    sessionStorage.setItem('intro', 'seen');
  });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 160)}`));
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url().slice(-70)}`));
  page.on('console', (m) => /Content.Security.Policy|Refused to/i.test(m.text()) && problems.push(m.text().slice(0, 160)));
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  const cont = page.locator('[data-start-continue]');
  if (await cont.isVisible().catch(() => false)) await cont.click();
  await page.waitForFunction(() => !document.querySelector('dialog.start')?.open, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
  return { context, page, problems };
}

const state = (page) =>
  page.evaluate(() => {
    const toggle = document.querySelector('[data-a11y-toggle]');
    const panel = document.querySelector('[data-a11y-panel]');
    const r = toggle.getBoundingClientRect();
    const header = document.querySelector('.site-header').getBoundingClientRect();
    const r2 = panel.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      inHeader: Boolean(toggle.closest('.site-header .header-actions')),
      insideHeaderBox: r.top >= header.top && r.bottom <= header.bottom && r.left >= 0 && r.right <= window.innerWidth,
      iconOnly: toggle.classList.contains('icon-btn') && !toggle.textContent.trim(),
      name: toggle.getAttribute('aria-label'),
      size: [Math.round(r.width), Math.round(r.height)],
      reachable: top === toggle || toggle.contains(top), // nothing (the header, an overlay) sits on top of it
      expanded: toggle.getAttribute('aria-expanded'),
      panelHidden: panel.hidden,
      panel: { left: r2.left, top: r2.top, right: r2.right, bottom: r2.bottom },
      vw: window.innerWidth,
      vh: window.innerHeight,
      focusOnToggle: document.activeElement === toggle,
    };
  });

describe.each([1280, 390])('P12-UX2: the built site at %i px', (width) => {
  it('the button is an icon INSIDE the header cluster, reachable (nothing covers it) and 44 px', async () => {
    const { context, page, problems } = await open(width);
    const s = await state(page);
    expect(s.inHeader, 'inside .site-header .header-actions').toBe(true);
    expect(s.insideHeaderBox, 'inside the header box').toBe(true);
    expect(s.iconOnly).toBe(true);
    expect(s.name).toBe('Accessibility');
    expect(Math.min(...s.size)).toBeGreaterThanOrEqual(44);
    expect(s.reachable, 'elementFromPoint at its centre is the button').toBe(true);
    expect(problems).toEqual([]);
    await context.close();
  }, 90_000);

  it('a click opens the panel (aria-expanded="true", visible, inside the viewport); Esc closes it and returns focus', async () => {
    const { context, page, problems } = await open(width);
    await page.locator('.site-header [data-a11y-toggle]').click(); // a real click: it fails if something covers the button
    await page.waitForFunction(() => document.querySelector('[data-a11y-toggle]').getAttribute('aria-expanded') === 'true', null, { timeout: 8000 });
    const shown = await state(page);
    expect(shown.expanded).toBe('true');
    expect(shown.panelHidden).toBe(false);
    expect(shown.panel.left).toBeGreaterThanOrEqual(-0.5);
    expect(shown.panel.right).toBeLessThanOrEqual(shown.vw + 0.5);
    expect(shown.panel.top).toBeGreaterThanOrEqual(-0.5);
    expect(shown.panel.bottom).toBeLessThanOrEqual(shown.vh + 0.5);
    // the five switches, Reload now / Reset all are real controls in it
    expect(await page.locator('[data-a11y-panel] [data-a11y-option]').count()).toBe(5);
    await page.locator('[data-a11y-panel] [data-a11y-option="links"]').click();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-a11y-links'))).toBe('underline');
    await page.locator('[data-a11y-panel] [data-a11y-reset]').click();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-a11y-links'))).toBeNull();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const closed = await state(page);
    expect(closed.expanded).toBe('false');
    expect(closed.focusOnToggle).toBe(true);
    expect(problems).toEqual([]);
    await context.close();
  }, 90_000);

  it('the keyboard works too: Enter and Space on the focused button open it', async () => {
    const { context, page } = await open(width);
    for (const key of ['Enter', 'Space']) {
      await page.locator('.site-header [data-a11y-toggle]').focus();
      await page.keyboard.press(key);
      await page.waitForFunction(() => document.querySelector('[data-a11y-toggle]').getAttribute('aria-expanded') === 'true', null, { timeout: 8000 });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('[data-a11y-toggle]').getAttribute('aria-expanded') === 'false', null, { timeout: 4000 });
    }
    await context.close();
  }, 90_000);
});

describe('P12-UX2: the built files (no stale markup, hashed assets, no long-lived HTML cache)', () => {
  it('index.html has ONE accessibility box, inside the header, and none of the old pre-P12 button markup', async () => {
    const { indexHtml } = await buildSite();
    expect(indexHtml.match(/data-a11y>/g)).toHaveLength(1);
    const header = indexHtml.slice(indexHtml.indexOf('<header class="site-header"'), indexHtml.indexOf('</header>'));
    expect(header).toContain('<div class="a11y" data-a11y>');
    expect(indexHtml).not.toContain('class="btn btn--sm a11y__toggle"');
    expect(indexHtml).not.toMatch(/<span>Accessibility<\/span>/);
    expect(indexHtml.indexOf('<div class="a11y" data-a11y>')).toBeGreaterThan(indexHtml.indexOf('<header class="site-header"'));
  });
  it('the working-tree index.html is the file that is built (guards a stale or reverted copy)', () => {
    const html = read('index.html');
    expect(html).toContain('class="icon-btn a11y__toggle" aria-label="Accessibility"');
    expect(html).not.toContain('class="btn btn--sm a11y__toggle"');
  });
  it('the lazy menu chunk and every JS / CSS asset have a content hash in the name', () => {
    const files = readdirSync(join(outDir, 'assets'));
    expect(files.some((f) => /^a11y-menu-[\w-]{8}\.js$/.test(f))).toBe(true);
    for (const f of files.filter((x) => /\.(js|css)$/.test(x))) expect(f, f).toMatch(/-[\w-]{8}\.(js|css)$/);
    const html = readFileSync(join(outDir, 'index.html'), 'utf8');
    for (const m of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) expect(m[1]).toMatch(/-[\w-]{8}\.(js|css|woff2?)$/);
  });
  it('vercel.json caches only /media long-term; HTML and the other files keep the default revalidating cache', () => {
    const rules = JSON.parse(read('vercel.json')).headers;
    for (const rule of rules) {
      const cache = rule.headers.find((h) => h.key.toLowerCase() === 'cache-control');
      if (cache && /max-age=\d{4,}|immutable/.test(cache.value)) expect(rule.source).toBe('/media/(.*)');
    }
    expect(JSON.stringify(rules)).not.toMatch(/"source":"\/(\(\.\*\))?"[^}]*Cache-Control/);
  });
});
