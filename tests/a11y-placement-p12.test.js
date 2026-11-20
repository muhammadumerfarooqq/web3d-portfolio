// P12-UX task 2: the Accessibility button overlapped section headings (Classic) and the hotspot chips + controls hint
// (Explore) because it was `position: fixed` bottom-left. It is now an icon button in normal layout: in the Classic
// header's control row, and in Explore in the HUD's top-right cluster. The real-browser overlap check at 320–1280 px
// is scripts/qa/responsive-check.mjs; these tests pin the markup, the CSS rules and the placement logic.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { placeA11y } from '../src/ui/a11y-loader.js';

const ROOT = join(import.meta.dirname, '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const css = read('src', 'styles', 'a11y.css');
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '');

/** The CSS rule bodies for a selector (outside and inside media queries), comments removed. */
const rules = (source, selector) => [...strip(source).matchAll(new RegExp(`(^|\\n)\\s*${selector.replace(/[.[\]()*+?^$|\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[2]);

describe('P12-UX a11y button: markup', () => {
  const html = read('index.html');
  it('is in the header control row, after the language, sound and theme buttons and before the menu button — not at the top of <body>', () => {
    const row = html.slice(html.indexOf('<div class="header-actions">'), html.indexOf('</header>'));
    const at = (needle) => row.indexOf(needle);
    expect(at('data-lang="ur"')).toBeGreaterThan(-1);
    expect(at('data-sound-toggle')).toBeGreaterThan(at('data-lang="ur"'));
    expect(at('data-theme-toggle')).toBeGreaterThan(at('data-sound-toggle'));
    expect(at('<div class="a11y" data-a11y>')).toBeGreaterThan(at('data-theme-toggle'));
    expect(at('data-menu-toggle')).toBeGreaterThan(at('<div class="a11y" data-a11y>'));
    expect(html.indexOf('<div class="a11y" data-a11y>')).toBeGreaterThan(html.indexOf('<header class="site-header"'));
    expect(html.match(/data-a11y>/g)).toHaveLength(1); // one box, moved (never duplicated)
  });
  it('keeps the disclosure contract, the five switches, Reload now, Reset all and the "skip 3D" link', () => {
    expect(html).toMatch(/class="icon-btn a11y__toggle" aria-label="Accessibility" aria-expanded="false" aria-controls="a11y-panel" data-a11y-toggle/);
    expect(html.match(/data-a11y-option="/g)).toHaveLength(5);
    for (const marker of ['data-a11y-reload', 'data-a11y-reset', 'data-a11y-classic', 'Open plain Classic site (skip 3D)']) expect(html, marker).toContain(marker);
    expect(read('src', 'ui', 'a11y-menu.js')).toMatch(/event\.key === 'Escape' && !panel\.hidden[\s\S]{0,160}setOpen\(false, \{ focus: true \}\)/);
  });
});

describe('P12-UX a11y button: CSS (normal layout, nothing fixed over the content)', () => {
  it('.a11y is relative (the anchor), never fixed; the toggle is a 44 px button', () => {
    const body = rules(css, '.a11y').join('\n');
    expect(body).toMatch(/position: relative;/);
    expect(body).not.toMatch(/position: fixed|inset-block-end|inset-inline-start/);
    expect(rules(css, '.a11y__toggle').join('\n')).toMatch(/min-block-size: 44px;/);
  });

  it('the panel opens under the button, scrolls inside itself and is never taller than the viewport', () => {
    const base = rules(css, '.a11y__panel')[0];
    expect(base).toMatch(/position: absolute;/);
    expect(base).toMatch(/inset-block-start: calc\(100% \+ 10px\);/);
    expect(base).toMatch(/inset-inline-end: 0;/);
    expect(base).toMatch(/max-block-size: calc\(100svh - var\(--header-h, 72px\) - 24px\);/);
    expect(base).toMatch(/overflow-y: auto;/);
    expect(base).toMatch(/touch-action: pan-y;/); // Explore sets touch-action: none on its root
    expect(base).toMatch(/inline-size: min\(22rem, calc\(100vw - 32px\)\);/);
  });

  it('on phones (below 48rem) the panel is a full-width bottom sheet; only the panel is ever fixed', () => {
    const media = /@media \(max-width: 47\.99rem\) \{\s*\.a11y__panel \{([^}]*)\}/.exec(strip(css));
    expect(media).toBeTruthy();
    expect(media[1]).toMatch(/position: fixed;/);
    expect(media[1]).toMatch(/inset-block: auto 0;/);
    expect(media[1]).toMatch(/inset-inline: 0;/);
    expect(media[1]).toMatch(/max-block-size: min\(82svh, 36rem\);/);
    const fixedSelectors = [...strip(css).matchAll(/([^{}]+)\{([^{}]*position: fixed[^{}]*)\}/g)].map((m) => m[1].trim());
    expect(fixedSelectors).toEqual(['.a11y__panel']);
  });

  it('in Explore the toggle takes the HUD look (dark paper) and sits in the top-right cluster', () => {
    expect(css).toMatch(/\.xp-top__right \.a11y__toggle \{[^}]*background: rgba\(20, 16, 12, 0\.82\);/);
    expect(read('src', 'explore', 'hud.js')).toMatch(/class: 'xp-top__right'/);
  });
});

// A minimal DOM: just enough for placeA11y (parentElement, nextElementSibling, insertBefore, append, querySelector).
function fakeDom({ mode = 'classic' } = {}) {
  const doc = { documentElement: { dataset: { mode } }, body: {}, hud: null };
  const header = { name: 'header', children: [] };
  const menuBtn = { name: 'menu', parentElement: header };
  const box = { name: 'box', parentElement: header, get nextElementSibling() { const i = this.parentElement?.children.indexOf(this); return this.parentElement?.children[i + 1] ?? null; } };
  header.children.push(box, menuBtn);
  header.insertBefore = (node, ref) => {
    node.parentElement?.children.splice(node.parentElement.children.indexOf(node), 1);
    const i = ref ? header.children.indexOf(ref) : header.children.length;
    header.children.splice(i < 0 ? header.children.length : i, 0, node);
    node.parentElement = header;
  };
  const makeHud = () => {
    const slot = { name: 'hud', children: [], append(node) { node.parentElement?.children.splice(node.parentElement.children.indexOf(node), 1); this.children.push(node); node.parentElement = this; } };
    return slot;
  };
  doc.querySelector = (sel) => (sel === '.xp-top__right' ? doc.hud : null);
  const listeners = {};
  const observers = [];
  const win = {
    addEventListener: (type, fn) => (listeners[type] = fn),
    MutationObserver: class {
      constructor(fn) { this.fn = fn; this.on = false; observers.push(this); }
      observe() { this.on = true; }
      disconnect() { this.on = false; }
    },
  };
  return { doc, win, header, box, menuBtn, listeners, observers, makeHud };
}

describe('P12-UX a11y button: placement logic (header ⇄ Explore HUD)', () => {
  it('Classic: the box stays in the header, before the menu button', () => {
    const t = fakeDom();
    placeA11y(t.box, t.doc, t.win);
    expect(t.box.parentElement).toBe(t.header);
    expect(t.header.children.map((c) => c.name)).toEqual(['box', 'menu']);
  });

  it('Explore: the same box moves into the HUD cluster as soon as it exists, and returns to its place in the header on the way back', () => {
    const t = fakeDom();
    placeA11y(t.box, t.doc, t.win);
    t.doc.documentElement.dataset.mode = 'explore';
    t.listeners.modechange(); // the HUD is not built yet: an observer waits
    expect(t.observers.filter((o) => o.on)).toHaveLength(1);
    expect(t.box.parentElement).toBe(t.header);
    t.doc.hud = t.makeHud(); // Explore builds its HUD
    t.observers[0].fn();
    expect(t.box.parentElement).toBe(t.doc.hud);
    expect(t.observers.filter((o) => o.on)).toHaveLength(0); // done waiting
    t.doc.documentElement.dataset.mode = 'classic';
    t.doc.hud = null; // dispose removed the HUD
    t.listeners.modechange();
    expect(t.header.children.map((c) => c.name)).toEqual(['box', 'menu']);
  });

  it('leaving Explore before the HUD exists stops the waiting; with the HUD already there the box moves at once', () => {
    const t = fakeDom();
    placeA11y(t.box, t.doc, t.win);
    t.doc.documentElement.dataset.mode = 'explore';
    t.listeners.modechange();
    t.doc.documentElement.dataset.mode = 'classic';
    t.listeners.modechange();
    expect(t.observers.filter((o) => o.on)).toHaveLength(0);
    const u = fakeDom({ mode: 'explore' });
    u.doc.hud = u.makeHud();
    placeA11y(u.box, u.doc, u.win);
    expect(u.box.parentElement).toBe(u.doc.hud);
  });

  it('the placement code is in the small Classic loader, not in the Explore chunk (budget)', () => {
    expect(read('src', 'ui', 'a11y-loader.js')).toMatch(/export function placeA11y/);
    expect(read('src', 'explore', 'hud.js')).not.toMatch(/a11y/i);
    expect(read('src', 'explore', 'index.js')).not.toMatch(/a11y/i);
  });
});
