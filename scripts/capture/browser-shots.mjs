// P9.3 browser captures of the Classic site (day theme) for the promo film, used by capture.mjs:
//   F5  projects gallery: two filter-chip clicks (GSAP Flip reflow), then a case modal opening (3.0 s)
//   F9  the hero (the WANTED case file) and a slow scroll down the page (2.5 s)
// Deterministic time: Playwright's fake clock drives Date / performance.now / timers /
// requestAnimationFrame (so GSAP, Flip, ScrollTrigger and Lenis advance exactly 1/24 s per frame), and
// every CSS animation or transition (the dialog's "dialog-in", the marquee) is paused and seeked to
// the same clock through the Web Animations API before each screenshot. Viewport 1920×1080 at
// deviceScaleFactor 2 (= 3840×2160 frames) for --final, 0.5 (= 960×540) for --preview. The custom
// cursor is hidden; each click shows a clean expanding ring instead (drawn by this driver, not the
// site). Nothing here ships: it runs against the dev server only.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FRAME_MS = 1000 / 24;
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const pad = (n) => String(n).padStart(4, '0');
const easeInOut = (k) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, k)));

/** Let work queued outside the fake clock (message-channel tasks, image decodes) finish in real time. */
async function settle(page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 4; i += 1) {
      await new Promise((r) => {
        const c = new MessageChannel();
        c.port1.onmessage = () => r();
        c.port2.postMessage(0);
      });
    }
    await Promise.all([...document.images].filter((img) => !img.complete).map((img) => img.decode().catch(() => {})));
  });
  await new Promise((r) => setTimeout(r, 150));
}

/** Per-shot script: actions keyed by frame. */
export const BROWSER_SHOTS = {
  F5: {
    frames: 72,
    async setup(page) {
      await page.evaluate(() => {
        const controls = document.querySelector('[data-gallery-controls]');
        window.scrollTo(0, Math.max(0, controls.getBoundingClientRect().top + window.scrollY - 120));
        window.dispatchEvent(new Event('scroll'));
      });
    },
    actions: {
      4: { click: '[data-gallery-controls] [data-cat="AI & RAG"]' },
      26: { click: '[data-gallery-controls] [data-cat="Games & 3D"]' },
      46: { click: '[data-gallery-grid] [data-project]:not([hidden]) [data-project-open]', waitFor: 'dialog[open]' },
    },
  },
  F9: {
    frames: 60,
    async setup(page) {
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        window.dispatchEvent(new Event('scroll'));
      });
    },
    scroll: { from: 0, to: 0.85, start: 8, end: 58 }, // viewport heights, eased
  },
};

const STYLE = `
.cursor, .cursor--dot, .cursor--ring { display: none !important; }
html, html * { cursor: none !important; }
.promo-click { position: fixed; z-index: 2147483647; left: 0; top: 0; width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%;
  border: 3px solid #7E2F1A; background: rgba(217, 164, 65, 0.22); pointer-events: none; opacity: 0; }
`;

/** Pause every CSS animation / transition and seek it to the fake clock (called once per frame). */
function seekCssAnimations() {
  const now = Date.now();
  window.__promoAnims ??= new WeakMap();
  for (const a of document.getAnimations()) {
    if (!(a instanceof CSSAnimation || a instanceof CSSTransition)) continue;
    if (!window.__promoAnims.has(a)) window.__promoAnims.set(a, now);
    if (a.playState !== 'paused') a.pause();
    a.currentTime = now - window.__promoAnims.get(a);
  }
}

/** The click ring: 9 frames, expanding and fading (driver-drawn, deterministic). */
function drawClick(state) {
  let ring = document.querySelector('.promo-click');
  if (!ring) {
    ring = document.createElement('div');
    ring.className = 'promo-click';
    document.body.append(ring);
  }
  if (!state) {
    ring.style.opacity = '0';
    return;
  }
  const k = state.age / 9;
  ring.style.transform = `translate(${state.x}px, ${state.y}px) scale(${0.55 + 0.75 * k})`;
  ring.style.opacity = String(Math.max(0, 1 - k) * 0.95);
}

export async function runBrowserShot(browser, url, id, outDir, { size, final }) {
  const shot = BROWSER_SHOTS[id];
  const t0 = Date.now();
  const scale = final ? 2 : 0.5;
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale, colorScheme: 'light', reducedMotion: 'no-preference', bypassCSP: true });
  // Seeded Math.random (mulberry32), installed before any site script runs.
  await context.addInitScript(() => {
    let a = 20261117;
    Math.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('theme', 'light');
      localStorage.setItem('mode', 'classic');
      localStorage.setItem('intro', 'seen');
      localStorage.setItem('sound', 'off');
      sessionStorage.setItem('intro', 'seen');
    } catch {
      /* ignore */
    }
  });
  await context.clock.install({ time: new Date('2026-11-17T09:00:00Z') });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${url}/`, { waitUntil: 'load' });
  // CSS animations and transitions never advance on real time: the timeline is frozen and each one is
  // seeked to the fake clock before every frame (seekCssAnimations).
  const cdp = await context.newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });
  await page.addStyleTag({ content: STYLE });
  await page.evaluate(() => document.fonts.ready);
  // Let the shell boot on the fake clock, enter through the start card, let the hero settle.
  for (let i = 0; i < 40; i += 1) await page.clock.runFor(100);
  const cont = page.locator('[data-start-continue]');
  if (await cont.isVisible().catch(() => false)) await cont.click();
  for (let i = 0; i < 60; i += 1) await page.clock.runFor(100);
  await page.waitForFunction(() => document.documentElement.dataset.motion === 'ready', null, { timeout: 30000 });
  await shot.setup(page);
  await page.evaluate(() => document.activeElement?.blur?.()); // no focus ring (the skip link) in the shot
  await page.evaluate(() => {
    for (const img of document.images) img.loading = 'eager';
  });
  await settle(page);
  for (let i = 0; i < 30; i += 1) await page.clock.runFor(100); // reveals in view finish
  await settle(page);
  const tReady = Date.now();

  mkdirSync(outDir, { recursive: true });
  const hashes = [];
  let click = null;
  const vh = 1080;
  for (let f = 0; f < shot.frames; f += 1) {
    const action = shot.actions?.[f];
    if (action?.click) {
      const box = await page.locator(action.click).first().boundingBox();
      if (!box) throw new Error(`${id}: nothing to click at frame ${f} (${action.click})`);
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.click(x, y);
      if (action.waitFor) await page.waitForSelector(action.waitFor, { state: 'attached', timeout: 15000 });
      await settle(page);
      click = { x, y, age: 0 };
    }
    if (shot.scroll && f >= shot.scroll.start && f <= shot.scroll.end) {
      const k = easeInOut((f - shot.scroll.start) / (shot.scroll.end - shot.scroll.start));
      const y = (shot.scroll.from + (shot.scroll.to - shot.scroll.from) * k) * vh;
      await page.evaluate((top) => {
        window.scrollTo(0, top);
        window.dispatchEvent(new Event('scroll'));
      }, y);
    }
    // exactly 1/24 s per frame (integer ms steps that sum to f · 1000/24)
    await page.clock.runFor(Math.round((f + 1) * FRAME_MS) - Math.round(f * FRAME_MS));
    await page.evaluate(seekCssAnimations);
    await page.evaluate(drawClick, click && click.age <= 9 ? click : null);
    if (click) click.age += 1;
    const png = await page.screenshot({ type: 'png', scale: 'device', animations: 'allow', caret: 'hide', timeout: 120000 });
    hashes.push(sha(png));
    writeFileSync(join(outDir, `${id}_${pad(f)}.png`), png);
  }
  await context.close();
  return { id, frames: shot.frames, width: size.width, height: size.height, loadSeconds: +((tReady - t0) / 1000).toFixed(1), renderSeconds: +((Date.now() - tReady) / 1000).toFixed(1), hashes, errors };
}
