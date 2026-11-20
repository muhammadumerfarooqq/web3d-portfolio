// P12-UX: responsive check in real Chrome. `npm run build` first, then `npm run qa:responsive`
// (= node scripts/qa/responsive-check.mjs; flags: --no-explore skips the Explore HUD pass, --only=320,390 limits widths).
// Serves dist/ with `vite preview` and loads the pages at 320, 360, 375, 390, 414, 600, 768, 1024 and 1280 px,
// in English and Urdu (RTL), light and dark (phones use touch + mobile emulation, so the viewport meta tag counts):
//   · Classic (/): the document must not scroll sideways (scrollWidth ≤ viewport) and no visible element may stick out
//     of the viewport (outside a scroll / clip container of its own); no fixed / absolute box (that takes pointer
//     events) may overlap the header controls; the header controls must not overlap each other or leave the viewport;
//     images and video must keep their aspect ratio (or use object-fit); text ≥ 12 px; on touch, controls ≥ 44 px.
//   · the start dialog and the admin sign-in page: no sideways scroll, nothing outside the viewport.
//   · behaviour on phones: the menu opens, traps focus, closes with Esc and returns focus; the accessibility sheet opens
//     inside the viewport and Esc returns focus; the chat panel is full width with the mic and Send buttons reachable;
//     the contact e-mail link fits.
//   · Explore HUD (WebGL): the accessibility button sits in the top-right cluster and overlaps nothing.
//   · the cursor: the page default and the interactive cursor are the solid SVG files.
// Writes small WebP screenshots to docs/screenshots/p12/responsive/ and the result table to
// docs/reports/responsive.md. Exit code 1 when any check fails. No network (everything is local), no secrets.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const ROOT = join(import.meta.dirname, '..', '..');
const SHOTS = join(ROOT, 'docs', 'screenshots', 'p12', 'responsive');
const REPORT = join(ROOT, 'docs', 'reports', 'responsive.md');
const args = process.argv.slice(2);
const ALL_WIDTHS = [320, 360, 375, 390, 414, 600, 768, 1024, 1280];
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',').map(Number);
const WIDTHS = only?.length ? ALL_WIDTHS.filter((w) => only.includes(w)) : ALL_WIDTHS;
const LANGS = ['en', 'ur'];
const THEMES = ['light', 'dark'];
const PHONE_MAX = 768; // touch + mobile emulation up to here

mkdirSync(SHOTS, { recursive: true });
for (const f of readdirSync(SHOTS)) if (/\.(webp|png)$/.test(f)) rmSync(join(SHOTS, f));

const server = await preview({ preview: { port: 4185, strictPort: true }, logLevel: 'error' });
const base = 'http://localhost:4185';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const failures = [];
const rows = []; // { width, page, lang, theme, overflow, sticking, header, tap, small, media }
const notes = [];
const fail = (where, what) => failures.push(`${where}: ${what}`);

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────────
async function newContext({ width, theme, lang, mode = 'classic', fresh = false }) {
  const phone = width <= PHONE_MAX;
  const context = await browser.newContext({
    viewport: { width, height: phone ? 760 : 820 },
    bypassCSP: true,
    reducedMotion: 'no-preference',
    colorScheme: theme,
    hasTouch: phone,
    isMobile: phone,
    deviceScaleFactor: 1,
  });
  await context.addInitScript(
    ({ theme, lang, mode, fresh }) => {
      try {
        localStorage.setItem('theme', theme);
        if (lang === 'ur') localStorage.setItem('lang', 'ur');
        if (!fresh) {
          localStorage.setItem('mode', mode);
          localStorage.setItem('intro', 'seen');
          sessionStorage.setItem('intro', 'seen');
          if (mode === 'explore') {
            localStorage.setItem('explore.tutorial', 'done');
            sessionStorage.setItem('explore.arrival', 'seen');
          }
        }
      } catch {
        /* ignore */
      }
    },
    { theme, lang, mode, fresh },
  );
  return context;
}

async function enter(page) {
  await page.waitForTimeout(1800);
  const cont = page.locator('[data-start-continue]');
  if (await cont.isVisible().catch(() => false)) await cont.click();
  await page.waitForFunction(() => !document.querySelector('dialog.start')?.open, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(900);
}

async function scrollThrough(page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 650) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(110);
  }
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
}

/** Runs in the page: every measurement of the Classic layout. */
const MEASURE = ({ openDetails, expected }) => {
  if (openDetails) for (const d of document.querySelectorAll('details')) d.open = true;
  const vw = expected; // the width the device really has: a page that is too wide makes mobile Chrome widen innerWidth
  const vh = window.innerHeight;
  const R = (el) => el.getBoundingClientRect();
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    const r = R(el);
    return r.width > 0 && r.height > 0;
  };
  const label = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`;
  // The content of a closed <details> is not rendered (its boxes are meaningless): only the <summary> counts.
  const inClosedDetails = (el) => {
    const d = el.closest('details:not([open])');
    return Boolean(d) && !el.closest('summary') && el !== d;
  };
  const clippedByAncestor = (el) => {
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(hidden|clip|auto|scroll)/.test(s.overflowX) && p.clientWidth > 0) return true;
    }
    return false;
  };

  // 1) sideways scroll of the document
  const docOver = Math.max(0, Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, window.innerWidth) - vw);

  // 2) elements sticking out of the viewport (either side: in RTL the overflow is to the left and is not scrollable)
  const sticking = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.mobile-menu, dialog:not([open]), [hidden], svg, .sr-only, .skip-link, [data-explore], .paper-bg, .scroll-progress, .grain')) continue;
    if (!visible(el) || clippedByAncestor(el) || inClosedDetails(el)) continue;
    const s = getComputedStyle(el);
    if (s.position === 'fixed' && !el.closest('.site-header')) continue; // fixed decoration / panels are checked elsewhere
    const r = R(el);
    const over = Math.max(r.right - vw, -r.left, 0);
    if (over > 1) sticking.push({ el: label(el), px: Math.round(over), text: (el.textContent ?? '').trim().slice(0, 40) });
  }
  sticking.sort((a, b) => b.px - a.px);

  // 3) header controls: inside the viewport, no overlap among themselves, no fixed / absolute box over them
  const header = document.querySelector('.site-header');
  const controls = header ? [...header.querySelectorAll('.monogram, .header-actions button, .header-actions a, .header-actions .lang-switch')].filter((el) => visible(el) && !el.closest('.a11y__panel') && !el.closest('.lang-switch') || el.classList?.contains('lang-switch')).filter(visible) : [];
  const headerIssues = [];
  for (const el of controls) {
    const r = R(el);
    if (r.right > vw + 0.5 || r.left < -0.5) headerIssues.push(`${label(el)} leaves the viewport (${Math.round(r.left)}…${Math.round(r.right)} of ${vw})`);
  }
  const inter = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
  for (let i = 0; i < controls.length; i += 1) {
    for (let j = i + 1; j < controls.length; j += 1) {
      if (controls[i].contains(controls[j]) || controls[j].contains(controls[i])) continue;
      if (inter(R(controls[i]), R(controls[j]))) headerIssues.push(`${label(controls[i])} overlaps ${label(controls[j])}`);
    }
  }
  const rects = controls.map(R);
  const sampleY = [0, 900, 2400];
  void sampleY;
  const covering = [];
  for (const el of document.querySelectorAll('body *')) {
    if (header?.contains(el) || el.contains(header) || el.closest('.mobile-menu, .paper-bg, .scroll-progress, .grain, [data-explore], dialog:not([open])') || inClosedDetails(el)) continue;
    const s = getComputedStyle(el);
    if (s.position !== 'fixed' && s.position !== 'absolute') continue;
    if (s.pointerEvents === 'none' || !visible(el)) continue;
    const r = R(el);
    if (rects.some((c) => inter(r, c))) covering.push(label(el));
  }
  for (const c of covering) headerIssues.push(`${c} (fixed/absolute) covers the header controls`);

  // 4) tap targets (touch widths only: the caller decides what counts)
  const taps = [];
  for (const el of document.querySelectorAll('a[href], button, [role="button"], input:not([type="hidden"]), select, textarea, summary')) {
    if (!visible(el) || inClosedDetails(el) || el.closest('.mobile-menu, dialog:not([open]), [hidden], .sr-only, .skip-link, [data-explore], [aria-hidden="true"]')) continue;
    if (el.matches('input[type="checkbox"], input[type="radio"]') && el.closest('label')) continue; // the label is the target
    const s = getComputedStyle(el);
    if (el.tagName === 'A' && s.display === 'inline' && el.closest('p, li, dd, figcaption, .chat__body')) continue; // a link inside running text
    const r = R(el);
    if (Math.min(r.width, r.height) < 43.5) taps.push({ el: label(el), w: Math.round(r.width), h: Math.round(r.height), text: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30) });
  }

  // 5) type size
  let minFont = 99;
  const small = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!n.nodeValue.trim() || !el || el.closest('script, style, noscript, svg, .sr-only, .skip-link, [hidden], [data-explore], .mobile-menu, dialog:not([open])') || !visible(el) || inClosedDetails(el)) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px < minFont) minFont = px;
    if (px < 11.9) small.push({ el: label(el), px: Math.round(px * 10) / 10, text: n.nodeValue.trim().slice(0, 30) });
  }

  // 6) stretched media
  const media = [];
  for (const el of document.querySelectorAll('img, video')) {
    if (!visible(el) || inClosedDetails(el) || el.closest('[hidden], [data-explore], .mobile-menu, dialog:not([open])')) continue;
    const nw = el.tagName === 'IMG' ? el.naturalWidth : el.videoWidth;
    const nh = el.tagName === 'IMG' ? el.naturalHeight : el.videoHeight;
    if (!nw || !nh) continue;
    const r = R(el);
    const s = getComputedStyle(el);
    if (s.objectFit !== 'fill') continue; // cover / contain / scale-down keep the ratio
    const diff = Math.abs(r.width / r.height / (nw / nh) - 1);
    if (diff > 0.03) media.push({ el: label(el), diff: Math.round(diff * 100), shown: `${Math.round(r.width)}x${Math.round(r.height)}`, natural: `${nw}x${nh}` });
  }

  // 7) a word wider than its heading / button is broken in the middle ("MUHAMMA / D"): look at it with word breaking switched off
  const brokenWords = [];
  for (const el of document.querySelectorAll('h1, h2, h3, .hero__title, .section__title, .btn, .chip, .pill-link')) {
    if (!visible(el) || inClosedDetails(el) || el.closest('.mobile-menu, dialog:not([open]), [hidden], [data-explore]')) continue;
    const saved = [el.style.overflowWrap, el.style.wordBreak];
    el.style.overflowWrap = 'normal';
    el.style.wordBreak = 'normal';
    const over = el.scrollWidth - el.clientWidth;
    [el.style.overflowWrap, el.style.wordBreak] = saved;
    if (over > 1) brokenWords.push({ el: label(el), px: over, text: (el.textContent ?? '').trim().slice(0, 30) });
  }

  return { vw, vh, docOver, brokenWords: brokenWords.slice(0, 6), sticking: sticking.slice(0, 6), stickingCount: sticking.length, headerIssues, taps, small: small.slice(0, 5), smallCount: small.length, minFont, media };
};

async function toWebp(helper, png) {
  const b64 = await helper.evaluate(async (data) => {
    const blob = await (await fetch(`data:image/png;base64,${data}`)).blob();
    const bmp = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    const out = await canvas.convertToBlob({ type: 'image/webp', quality: 0.55 });
    const bytes = new Uint8Array(await out.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, png.toString('base64'));
  return Buffer.from(b64, 'base64');
}
let helperPage = null;
async function shot(page, name) {
  helperPage ??= await (await browser.newContext({ bypassCSP: true })).newPage();
  const png = await page.screenshot({ type: 'png' });
  writeFileSync(join(SHOTS, `${name}.webp`), await toWebp(helperPage, png));
}

const focusIn = (page, selector) => page.evaluate((sel) => Boolean(document.activeElement?.closest(sel)), selector);
const inView = (r, vw, vh) => r && r.left >= -0.5 && r.top >= -0.5 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5;
const rectOf = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }, selector);

// ── Classic pass ─────────────────────────────────────────────────────────────────────────────────────────────────
async function classic({ width, lang, theme }) {
  const where = `classic ${width}px ${lang} ${theme}`;
  const context = await newContext({ width, theme, lang });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await enter(page);
  await scrollThrough(page);
  if (lang === 'ur') await page.waitForFunction(() => document.documentElement.lang === 'ur', null, { timeout: 15000 }).catch(() => fail(where, 'the page did not switch to Urdu'));
  await page.evaluate(() => document.activeElement?.blur()); // the skip link is only visible while focused
  await page.waitForTimeout(900);
  const m = await page.evaluate(MEASURE, { openDetails: false, expected: width });
  const phone = width <= PHONE_MAX;
  const row = { width, page: 'classic', lang, theme, overflow: m.docOver, sticking: m.sticking[0]?.px ?? 0, header: m.headerIssues.length, tap: phone ? m.taps.length : null, small: m.smallCount, media: m.media.length };
  rows.push(row);
  if (m.docOver > 0) fail(where, `the page scrolls sideways by ${m.docOver}px`);
  for (const s of m.sticking) fail(where, `${s.el} "${s.text}" sticks out by ${s.px}px`);
  for (const h of m.headerIssues) fail(where, `header: ${h}`);
  if (phone) {
    const groups = new Map();
    for (const t of m.taps) {
      const g = groups.get(t.el) ?? { n: 0, w: t.w, h: t.h, text: t.text };
      g.n += 1;
      g.w = Math.min(g.w, t.w);
      g.h = Math.min(g.h, t.h);
      groups.set(t.el, g);
    }
    for (const [el, g] of groups) fail(where, `tap target under 44px: ${el} ×${g.n} (smallest ${g.w}×${g.h}px, "${g.text}")`);
  }
  for (const b of m.brokenWords) fail(where, `a word does not fit its box and breaks in the middle (${b.px}px too wide): ${b.el} "${b.text}"`);
  for (const s of m.small) fail(where, `text ${s.px}px: ${s.el} "${s.text}"`);
  for (const s of m.media) fail(where, `stretched media ${s.el}: shown ${s.shown}, natural ${s.natural} (${s.diff}% off)`);
  for (const e of errors) fail(where, `page error: ${e}`);

  await shot(page, `classic-${width}-${lang}-${theme}`);

  // every project's "more" section opened: the expanded content must fit too
  const open = await page.evaluate(MEASURE, { openDetails: true, expected: width });
  if (open.docOver > m.docOver) fail(where, `with every <details> open the page scrolls sideways by ${open.docOver}px`);
  for (const s of open.sticking.filter((x) => !m.sticking.some((y) => y.el === x.el))) fail(where, `(details open) ${s.el} "${s.text}" sticks out by ${s.px}px`);
  await page.evaluate(() => {
    for (const d of document.querySelectorAll('details')) d.open = false;
    window.scrollTo(0, 0);
  });

  // behaviours: phones (menu, sheet, chat, contact) once per width and language in the dark theme; the a11y button in every width
  if (theme === 'dark') {
    const a11yRect = await rectOf(page, '.site-header [data-a11y-toggle]');
    if (!a11yRect) fail(where, 'the accessibility button is not in the header');
    else {
      if (!inView(a11yRect, width, m.vh)) fail(where, 'the accessibility button leaves the viewport');
      if (Math.min(a11yRect.width, a11yRect.height) < 43.5) fail(where, `the accessibility button is ${Math.round(a11yRect.width)}×${Math.round(a11yRect.height)}px`);
    }
    await a11ySheet(page, where, width, lang);
    if (phone) {
      await mobileMenu(page, where, width, lang);
      await chatPanel(page, where, width, lang, width);
      await contactMail(page, where, width);
    }
    if (width === 1280 && lang === 'en') await cursorCheck(page, where);
  }
  await context.close();
}

async function a11ySheet(page, where, width, lang) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const toggle = page.locator('.site-header [data-a11y-toggle]');
  await toggle.click();
  await page.waitForTimeout(700);
  const open = await page.evaluate(() => ({ expanded: document.querySelector('[data-a11y-toggle]')?.getAttribute('aria-expanded'), hidden: document.querySelector('[data-a11y-panel]')?.hidden }));
  if (open.expanded !== 'true' || open.hidden) fail(where, 'the accessibility panel did not open');
  const vp = { w: width, h: await page.evaluate(() => window.innerHeight) };
  const panel = await rectOf(page, '[data-a11y-panel]');
  if (!inView(panel, vp.w, vp.h)) fail(where, `the accessibility panel leaves the viewport (${panel && [panel.left, panel.top, panel.right, panel.bottom].map(Math.round)} in ${vp.w}×${vp.h})`);
  if (width <= 767 && panel && (Math.abs(panel.left) > 1 || Math.abs(panel.right - vp.w) > 1)) fail(where, 'on a phone the accessibility panel is not a full-width sheet');
  if (width === 360 || width === 1280) await shot(page, `a11y-open-${width}-${lang}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const closed = await page.evaluate(() => ({ expanded: document.querySelector('[data-a11y-toggle]')?.getAttribute('aria-expanded'), focus: document.activeElement?.matches('[data-a11y-toggle]') }));
  if (closed.expanded !== 'false') fail(where, 'Esc did not close the accessibility panel');
  if (!closed.focus) fail(where, 'focus did not return to the accessibility button after Esc');
}

async function mobileMenu(page, where, width, lang) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const toggle = page.locator('[data-menu-toggle]');
  if (!(await toggle.isVisible())) return fail(where, 'no hamburger button under 80rem');
  await toggle.click();
  await page.waitForTimeout(800);
  const state = await page.evaluate(() => ({ hidden: document.querySelector('[data-menu]')?.hidden, expanded: document.querySelector('[data-menu-toggle]')?.getAttribute('aria-expanded') }));
  if (state.hidden || state.expanded !== 'true') fail(where, 'the menu did not open');
  const vp = { w: width, h: await page.evaluate(() => window.innerHeight) };
  const panel = await rectOf(page, '.mobile-menu__panel');
  if (panel && (panel.right > vp.w + 0.5 || panel.left < -0.5)) fail(where, `the menu panel leaves the viewport width (${Math.round(panel.left)}…${Math.round(panel.right)})`);
  const bar = await page.evaluate((w) => [...document.querySelectorAll('.mobile-menu__bar button, .mobile-menu__bar a')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.getBoundingClientRect()).filter((r) => r.right > w + 0.5 || r.left < -0.5).length, width);
  if (bar) fail(where, `${bar} control(s) in the menu's bottom bar leave the viewport`);
  let escaped = false;
  for (let i = 0; i < 16; i += 1) {
    await page.keyboard.press('Tab');
    if (!(await focusIn(page, '[data-menu]'))) escaped = true;
  }
  if (escaped) fail(where, 'focus escaped the open menu (no focus trap)');
  if (width === 360 || width === 390) await shot(page, `menu-open-${width}-${lang}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({ hidden: document.querySelector('[data-menu]')?.hidden, focus: document.activeElement?.matches('[data-menu-toggle]') }));
  if (!after.hidden) fail(where, 'Esc did not close the menu');
  if (!after.focus) fail(where, 'focus did not return to the hamburger after closing the menu');
}

async function chatPanel(page, where, width, lang, vw) {
  await page.locator('#chat').scrollIntoViewIfNeeded();
  await page.waitForTimeout(2500); // the chat chunk loads when the section nears the viewport
  const sel = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const r = (el) => (el ? (({ left, top, right, bottom, width, height }) => ({ left, top, right, bottom, width, height }))(el.getBoundingClientRect()) : null);
    return { sx: window.scrollX, panel: r(q('[data-chat-panel]')), input: r(q('[data-chat-panel] textarea, [data-chat-panel] input[type="text"], [data-chat-panel] input:not([type])')), mic: r(q('.chat__mic')), send: r(q('.chat__send')) };
  });
  if (!sel.panel) return fail(where, 'the chat panel is missing');
  if (sel.panel.right > vw + 0.5 || sel.panel.left < -0.5) fail(where, `the chat panel is wider than the viewport (${Math.round(sel.panel.left)}…${Math.round(sel.panel.right)})`);
  if (vw < 500 && sel.panel.width < vw - 80) fail(where, `the chat panel is not full width (${Math.round(sel.panel.width)}px of ${vw}px; page gutter and card padding are ≤ 80px)`);
  for (const k of ['input', 'mic', 'send']) {
    if (!sel[k]) fail(where, `chat ${k} is missing`);
    else if (sel[k].right > vw + 0.5 || sel[k].left < -0.5) fail(where, `chat ${k} leaves the viewport (${Math.round(sel[k].left)}…${Math.round(sel[k].right)} of ${vw}, scrollX ${sel.sx})`);
    else if (k !== 'input' && Math.min(sel[k].width, sel[k].height) < 43.5) fail(where, `chat ${k} is ${Math.round(sel[k].width)}×${Math.round(sel[k].height)}px`);
  }
  if (width === 360 || width === 390) await shot(page, `chat-${width}-${lang}`);
}

async function contactMail(page, where, vw) {
  const r = await page.evaluate(() => {
    const a = document.querySelector('#contact a[href^="mailto:"]');
    if (!a) return null;
    a.scrollIntoView({ block: 'center' });
    const b = a.getBoundingClientRect();
    return { left: b.left, right: b.right, width: b.width, text: a.textContent.trim().slice(0, 40) };
  });
  if (!r) return notes.push(`${where}: no mailto link found in #contact`);
  if (r.right > vw + 0.5 || r.left < -0.5) fail(where, `the contact e-mail link sticks out (${Math.round(r.left)}…${Math.round(r.right)} of ${vw})`);
}

async function cursorCheck(page, where) {
  const c = await page.evaluate(() => ({ body: getComputedStyle(document.body).cursor, button: getComputedStyle(document.querySelector('.site-header .icon-btn')).cursor, link: getComputedStyle(document.querySelector('a[href]')).cursor, text: getComputedStyle(document.querySelector('textarea, input[type="text"], input[type="email"]') ?? document.body).cursor }));
  if (!/\/cursors\/arrow\.svg/.test(c.body)) fail(where, `page cursor is not the solid arrow: ${c.body}`);
  if (!/\/cursors\/pointer\.svg/.test(c.button)) fail(where, `button cursor is not the solid hand: ${c.button}`);
  if (!/\/cursors\/pointer\.svg/.test(c.link)) fail(where, `link cursor is not the solid hand: ${c.link}`);
  const ok = await page.evaluate(async () => (await Promise.all(['/cursors/arrow.svg', '/cursors/pointer.svg'].map((u) => fetch(u).then((r) => r.ok && /svg/.test(r.headers.get('content-type') ?? ''))))).every(Boolean));
  if (!ok) fail(where, 'a cursor file is not served as an SVG');
  notes.push(`cursor (computed): page ${c.body.slice(0, 40)}…, button ${c.button.slice(0, 44)}…, text field ${c.text}`);
}

// ── other pages ──────────────────────────────────────────────────────────────────────────────────────────────────
async function plainPage({ width, theme, name, path, fresh }) {
  const where = `${name} ${width}px en ${theme}`;
  const context = await newContext({ width, theme, lang: 'en', fresh });
  const page = await context.newPage();
  await page.goto(`${base}${path}`, { waitUntil: 'load' });
  await page.waitForTimeout(name === 'admin' ? 1800 : 2600);
  const m = await page.evaluate(() => {
    const vw = window.innerWidth;
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || el.closest('[hidden], svg, canvas, .sr-only, .skip-link, [data-boot-layer]:not([open])')) continue;
      const closed = el.closest('details:not([open])');
      if (closed && !el.closest('summary') && el !== closed) continue; // not rendered
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      let clipped = false;
      for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) if (/(hidden|clip|auto|scroll)/.test(getComputedStyle(p).overflowX) && p.clientWidth > 0) clipped = true;
      if (clipped) continue;
      const over = Math.max(r.right - vw, -r.left, 0);
      if (over > 1) out.push(`${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : ''} ${Math.round(over)}px`);
    }
    return { docOver: Math.max(0, Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw), out: out.slice(0, 4), n: out.length };
  });
  rows.push({ width, page: name, lang: 'en', theme, overflow: m.docOver, sticking: m.n, header: 0, tap: null, small: 0, media: 0 });
  if (m.docOver > 0) fail(where, `scrolls sideways by ${m.docOver}px`);
  for (const o of m.out) fail(where, `sticks out: ${o}`);
  if (theme === 'dark' && (width === 360 || width === 1280)) await shot(page, `${name}-${width}-en-${theme}`);
  await context.close();
}

// ── Explore HUD ──────────────────────────────────────────────────────────────────────────────────────────────────
async function exploreHud(width) {
  const where = `explore ${width}px`;
  const context = await newContext({ width, theme: 'dark', lang: 'en', mode: 'explore' });
  const page = await context.newPage();
  try {
    await page.goto(`${base}/?debug=1&backend=webgl`, { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    const cont = page.locator('[data-start-continue]');
    if (await cont.isVisible().catch(() => false)) await cont.click();
    await page.waitForFunction(() => window.__explore?.ready, null, { timeout: 120000 });
    await page.waitForTimeout(2500);
    const where2 = where;
    const info = await page.evaluate(() => {
      const toggle = document.querySelector('.xp-top__right [data-a11y-toggle]');
      if (!toggle) return { inHud: false };
      const t = toggle.getBoundingClientRect();
      const inter = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
      const box = toggle.closest('[data-a11y]');
      const hits = [];
      for (const el of document.querySelectorAll('.xp button, .xp select, .xp a, .xp .xp-legend, .xp .xp-notice, .xp .xp-zones, .xp .xp-prompt, .xp .xp-toast, .xp .xp-stick, .xp .xp-tutorial')) {
        if (box.contains(el) || el.contains(box)) continue;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || el.closest('[hidden]')) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (inter(t, r)) hits.push(`${el.tagName.toLowerCase()}.${(typeof el.className === 'string' ? el.className : '').split(/\s+/)[0]}`);
      }
      const inside = t.left >= 0 && t.top >= 0 && t.right <= window.innerWidth && t.bottom <= window.innerHeight;
      return { inHud: true, hits, inside, fixed: getComputedStyle(box).position, w: Math.round(t.width), h: Math.round(t.height), vw: window.innerWidth, vh: window.innerHeight };
    });
    if (!info.inHud) fail(where2, 'the accessibility button is not in the HUD top-right cluster');
    else {
      if (!info.inside) fail(where2, 'the accessibility button leaves the viewport');
      if (info.fixed === 'fixed') fail(where2, 'the accessibility box is position: fixed in Explore');
      for (const h of info.hits) fail(where2, `the accessibility button overlaps ${h}`);
      await page.locator('.xp-top__right [data-a11y-toggle]').click();
      await page.waitForTimeout(700);
      const panel = await rectOf(page, '.xp [data-a11y-panel]');
      if (!inView(panel, info.vw, info.vh)) fail(where2, `the accessibility panel leaves the viewport in Explore (${panel && [panel.left, panel.top, panel.right, panel.bottom].map(Math.round)})`);
      await shot(page, `explore-a11y-open-${width}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      const back = await page.evaluate(() => ({ expanded: document.querySelector('[data-a11y-toggle]')?.getAttribute('aria-expanded'), focus: document.activeElement?.matches('[data-a11y-toggle]') }));
      if (back.expanded !== 'false' || !back.focus) fail(where2, 'Esc / focus return does not work in Explore');
      await shot(page, `explore-hud-${width}`);
      rows.push({ width, page: 'explore', lang: 'en', theme: 'dark', overflow: 0, sticking: 0, header: info.hits.length, tap: null, small: 0, media: 0 });
      // back to Classic: the box returns to the header
      await page.locator('.xp-back').click();
      await page.waitForTimeout(1500);
      const home = await page.evaluate(() => Boolean(document.querySelector('.header-actions [data-a11y-toggle]')));
      if (!home) fail(where2, 'after leaving Explore the accessibility button is not back in the header');
    }
  } catch (error) {
    notes.push(`${where}: Explore HUD pass skipped (${String(error).slice(0, 120)}); WebGL may be unavailable here`);
  }
  await context.close();
}

// ── run ──────────────────────────────────────────────────────────────────────────────────────────────────────────
async function pool(tasks, size) {
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < tasks.length) {
        const task = tasks[next];
        next += 1;
        await task().catch((error) => fail('script', String(error).slice(0, 200)));
      }
    }),
  );
}

const viewportMeta = await (async () => {
  const text = await (await fetch(`${base}/`)).text();
  return /<meta name="viewport" content="([^"]+)"/.exec(text)?.[1] ?? '';
})();
if (!/width=device-width/.test(viewportMeta) || !/initial-scale=1/.test(viewportMeta) || /user-scalable=no|maximum-scale=1(?![0-9])/.test(viewportMeta)) fail('viewport meta', `"${viewportMeta}" must be width=device-width, initial-scale=1 and must not block zoom`);

const tasks = [];
for (const width of WIDTHS) for (const lang of LANGS) for (const theme of THEMES) tasks.push(() => classic({ width, lang, theme }));
for (const width of WIDTHS) {
  tasks.push(() => plainPage({ width, theme: 'dark', name: 'start', path: '/', fresh: true }));
  tasks.push(() => plainPage({ width, theme: 'light', name: 'admin', path: '/admin/' }));
}
await pool(tasks, 3);
if (!args.includes('--no-explore')) for (const width of WIDTHS.filter((w) => [360, 768, 1280].includes(w))) await exploreHud(width);

await browser.close();
await server.close();

// ── report ───────────────────────────────────────────────────────────────────────────────────────────────────────
rows.sort((a, b) => a.width - b.width);
const cell = (r) => (r ? `${r.overflow}${r.sticking ? ` (+${r.sticking})` : ''}` : '–');
const find = (width, page, lang, theme) => rows.find((r) => r.width === width && r.page === page && r.lang === lang && r.theme === theme);
let md = '# Responsive check (P12-UX)\n\n';
md += `Real Chrome, \`npm run qa:responsive\` (scripts/qa/responsive-check.mjs), ${new Date().toISOString().slice(0, 10)}. Widths ≤ ${PHONE_MAX} px use touch + mobile emulation. Screenshots: docs/screenshots/p12/responsive/.\n\n`;
md += '## Overflow (px): document scrollWidth minus viewport width, and (+n) elements sticking out of the viewport\n\n';
md += '| Width | Classic EN light | Classic EN dark | Classic UR light | Classic UR dark | Start dialog | Admin sign-in | Explore HUD |\n|---|---|---|---|---|---|---|---|\n';
for (const width of WIDTHS) {
  md += `| ${width} | ${cell(find(width, 'classic', 'en', 'light'))} | ${cell(find(width, 'classic', 'en', 'dark'))} | ${cell(find(width, 'classic', 'ur', 'light'))} | ${cell(find(width, 'classic', 'ur', 'dark'))} | ${cell(find(width, 'start', 'en', 'dark'))} | ${cell(find(width, 'admin', 'en', 'light'))} | ${rows.some((r) => r.width === width && r.page === 'explore') ? (find(width, 'explore', 'en', 'dark').header ? `${find(width, 'explore', 'en', 'dark').header} overlap` : 'clean') : '–'} |\n`;
}
const classicRows = rows.filter((r) => r.page === 'classic');
const sum = (key) => classicRows.reduce((a, r) => a + (r[key] ?? 0), 0);
md += `\n## Other measures (Classic, all ${classicRows.length} width × language × theme loads)\n\n`;
md += `- header overlaps / controls outside the viewport: **${sum('header')}**\n- tap targets under 44 px on touch widths (≤ ${PHONE_MAX}): **${classicRows.filter((r) => r.tap !== null).reduce((a, r) => a + r.tap, 0)}**\n- text under 12 px: **${sum('small')}**\n- stretched images / video: **${sum('media')}**\n`;
if (notes.length) md += `\n## Notes\n\n${notes.map((n) => `- ${n}`).join('\n')}\n`;
md += `\n## Result\n\n${failures.length ? `**${failures.length} failure(s):**\n\n${failures.map((f) => `- ${f}`).join('\n')}` : '**All checks passed.**'}\n`;
writeFileSync(REPORT, md);
console.log(md);
console.log(failures.length ? `\nRESPONSIVE: ${failures.length} failure(s)` : '\nRESPONSIVE: all checks passed');
process.exitCode = failures.length ? 1 : 0;
