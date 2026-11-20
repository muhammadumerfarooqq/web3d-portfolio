// P10 accessibility menu: the controller and the DOM glue with a minimal fake DOM (no browser): switches set the
// data- attributes, aria-pressed / aria-expanded stay correct, Escape closes and returns focus, a failing storage
// breaks nothing, reset restores the defaults; plus the contrast of the high-contrast palettes and the size of the
// controls, read from src/styles/a11y.css.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { A11Y_KEY, OPTIONS, createA11y, initA11yMenu, parseStored } from '../src/ui/a11y-menu.js';

const ROOT = join(import.meta.dirname, '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

class El {
  constructor(attrs = {}, dataset = {}) {
    this.attrs = { ...attrs };
    this.dataset = { ...dataset };
    this.listeners = {};
    this.hidden = false;
    this.children = [];
    this.clicked = 0;
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return k in this.attrs ? this.attrs[k] : null;
  }
  removeAttribute(k) {
    delete this.attrs[k];
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  fire(type, event = {}) {
    for (const fn of this.listeners[type] ?? []) fn({ preventDefault() {}, stopPropagation() {}, target: this, ...event });
  }
  click() {
    this.clicked += 1;
    this.fire('click');
  }
  focus() {
    El.focused = this;
  }
  contains(other) {
    return other === this || this.children.includes(other);
  }
}

function memoryStorage({ throws = false } = {}) {
  const data = new Map();
  const boom = () => {
    throw new Error('storage blocked');
  };
  return { data, getItem: (k) => (throws ? boom() : data.get(k) ?? null), setItem: (k, v) => (throws ? boom() : data.set(k, String(v))), removeItem: (k) => (throws ? boom() : data.delete(k)) };
}

/** The menu markup as fake elements, and the globals the module reads. */
function setup({ storage = memoryStorage(), attrs = {} } = {}) {
  const html = new El(attrs);
  const toggle = new El({ 'aria-expanded': 'false', 'aria-controls': 'a11y-panel' });
  const panel = new El();
  panel.hidden = true;
  const switches = Object.keys(OPTIONS).map((name) => new El({ 'aria-pressed': 'false' }, { a11yOption: name }));
  const reset = new El();
  const note = new El();
  note.hidden = true;
  const reload = new El();
  reload.hidden = true;
  const classic = new El();
  const box = new El({}, {});
  box.children = [toggle, panel, ...switches, reset, note, reload, classic];
  const table = { '[data-a11y-toggle]': toggle, '[data-a11y-panel]': panel, '[data-a11y-reset]': reset, '[data-a11y-note]': note, '[data-a11y-reload]': reload, '[data-a11y-classic]': classic };
  box.querySelector = (sel) => table[sel] ?? null;
  box.querySelectorAll = (sel) => (sel === '[data-a11y-option]' ? switches : []);
  const header = new El();
  const docListeners = {};
  const reloadSpy = vi.fn();
  vi.stubGlobal('document', { documentElement: html, querySelector: (sel) => (sel === '.site-header [data-mode-toggle]' ? header : null), addEventListener: (t, f) => (docListeners[t] ??= []).push(f) });
  vi.stubGlobal('window', { localStorage: storage, location: { reload: reloadSpy } });
  vi.stubGlobal('navigator', { sendBeacon: vi.fn(() => true) });
  const menu = initA11yMenu(box);
  const by = (name) => switches.find((s) => s.dataset.a11yOption === name);
  return { html, toggle, panel, switches, by, reset, note, reload, classic, box, header, storage, menu, reloadSpy, docListeners };
}

beforeEach(() => {
  El.focused = null;
});
afterEach(() => vi.unstubAllGlobals());

describe('P10 accessibility menu: the controller', () => {
  it('five options map to data- attributes on <html>; the stored value lists only known names', () => {
    expect(OPTIONS).toEqual({ motion: ['data-a11y-motion', 'reduce'], text: ['data-a11y-text', 'large'], contrast: ['data-a11y-contrast', 'high'], spacing: ['data-a11y-spacing', 'readable'], links: ['data-a11y-links', 'underline'] });
    expect(A11Y_KEY).toBe('a11y');
    expect(parseStored('motion,text')).toEqual(['motion', 'text']);
    expect(parseStored('text,evil,__proto__,constructor,motion,text')).toEqual(['text', 'motion']);
    expect(parseStored(undefined)).toEqual([]);
    expect(parseStored('')).toEqual([]);
    expect(parseStored('none')).toEqual([]);
  });
  it('set() turns an option on or off, remembers the canonical list, and refuses unknown names', () => {
    const html = new El();
    const storage = memoryStorage();
    const a = createA11y({ html, storage });
    expect(a.set('links', true)).toBe(true);
    expect(a.set('motion', true)).toBe(true);
    expect(html.attrs).toEqual({ 'data-a11y-links': 'underline', 'data-a11y-motion': 'reduce' });
    expect(storage.data.get('a11y')).toBe('motion,links'); // declared order, not click order
    expect(a.active()).toEqual(['motion', 'links']);
    a.set('links', false);
    expect(html.attrs).toEqual({ 'data-a11y-motion': 'reduce' });
    expect(storage.data.get('a11y')).toBe('motion');
    a.set('motion', false);
    expect(storage.data.get('a11y')).toBe('none'); // nothing on: a known marker, ignored when read back
    for (const bad of ['__proto__', 'constructor', 'toString', 'zoom', '']) expect(a.set(bad, true), bad).toBe(false);
    expect(Object.keys(html.attrs)).toEqual([]);
  });
  it('a storage that throws (or is null) never breaks anything: the setting still applies to the page', () => {
    for (const storage of [memoryStorage({ throws: true }), null]) {
      const html = new El();
      const a = createA11y({ html, storage });
      expect(() => a.set('contrast', true)).not.toThrow();
      expect(a.isOn('contrast')).toBe(true);
      expect(() => a.reset()).not.toThrow();
      expect(a.isOn('contrast')).toBe(false);
    }
  });
  it('reset() removes every attribute and the stored value', () => {
    const html = new El({ 'data-a11y-text': 'large', 'data-a11y-links': 'underline' });
    const storage = memoryStorage();
    storage.data.set('a11y', 'text,links');
    createA11y({ html, storage }).reset();
    expect(html.attrs).toEqual({});
    expect(storage.data.get('a11y')).toBe('none');
  });
});

describe('P10 accessibility menu: the disclosure and the switches', () => {
  it('starts closed with aria-expanded="false"; the button opens and closes it and keeps aria-expanded in step', () => {
    const t = setup();
    expect(t.panel.hidden).toBe(true);
    expect(t.toggle.getAttribute('aria-expanded')).toBe('false');
    t.toggle.click();
    expect(t.panel.hidden).toBe(false);
    expect(t.toggle.getAttribute('aria-expanded')).toBe('true');
    t.toggle.click();
    expect(t.panel.hidden).toBe(true);
    expect(t.toggle.getAttribute('aria-expanded')).toBe('false');
  });
  it('the first click that loaded the chunk can open it directly', () => {
    const html = new El();
    const toggle = new El({ 'aria-expanded': 'false' });
    const panel = new El();
    panel.hidden = true;
    const box = new El();
    box.querySelector = (sel) => (sel === '[data-a11y-toggle]' ? toggle : sel === '[data-a11y-panel]' ? panel : null);
    box.querySelectorAll = () => [];
    vi.stubGlobal('document', { documentElement: html, querySelector: () => null, addEventListener() {} });
    vi.stubGlobal('window', { localStorage: memoryStorage(), location: { reload() {} } });
    vi.stubGlobal('navigator', {});
    initA11yMenu(box, { open: true });
    expect(panel.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });
  it('each switch toggles its data- attribute and its aria-pressed, and is remembered', () => {
    const t = setup();
    for (const [name, [attr, value]] of Object.entries(OPTIONS)) {
      t.by(name).click();
      expect(t.html.getAttribute(attr), name).toBe(value);
      expect(t.by(name).getAttribute('aria-pressed'), name).toBe('true');
    }
    expect(t.storage.data.get('a11y')).toBe('motion,text,contrast,spacing,links');
    t.by('text').click();
    expect(t.html.getAttribute('data-a11y-text')).toBeNull();
    expect(t.by('text').getAttribute('aria-pressed')).toBe('false');
    expect(t.storage.data.get('a11y')).toBe('motion,contrast,spacing,links');
  });
  it('the switches start in the state theme-init.js already applied to <html>', () => {
    const t = setup({ attrs: { 'data-a11y-contrast': 'high', 'data-a11y-links': 'underline' } });
    expect(t.by('contrast').getAttribute('aria-pressed')).toBe('true');
    expect(t.by('links').getAttribute('aria-pressed')).toBe('true');
    expect(t.by('motion').getAttribute('aria-pressed')).toBe('false');
  });
  it('Escape closes the panel and puts focus back on the button; with the panel closed it does nothing', () => {
    const t = setup();
    t.box.fire('keydown', { key: 'Escape' });
    expect(El.focused).toBeNull();
    t.toggle.click();
    expect(t.panel.hidden).toBe(false);
    let prevented = 0;
    t.box.fire('keydown', { key: 'a', preventDefault: () => (prevented += 1) });
    expect(t.panel.hidden).toBe(false);
    t.box.fire('keydown', { key: 'Escape', preventDefault: () => (prevented += 1) });
    expect(t.panel.hidden).toBe(true);
    expect(t.toggle.getAttribute('aria-expanded')).toBe('false');
    expect(El.focused).toBe(t.toggle);
    expect(prevented).toBe(1);
  });
  it('a click outside closes the panel (without stealing focus); a click inside does not', () => {
    const t = setup();
    t.toggle.click();
    const down = t.docListeners.pointerdown[0];
    down({ target: t.by('text') });
    expect(t.panel.hidden).toBe(false);
    down({ target: new El() });
    expect(t.panel.hidden).toBe(true);
    expect(El.focused).toBeNull();
  });
  it('Reset all restores the defaults: attributes gone, every switch un-pressed, storage cleared', () => {
    const t = setup();
    t.by('motion').click();
    t.by('contrast').click();
    t.reset.click();
    expect(t.html.attrs).toEqual({});
    expect(t.switches.map((s) => s.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false', 'false', 'false']);
    expect(t.storage.data.get('a11y')).toBe('none');
  });
  it('Reduce motion explains that scripted motion stops after a reload, and offers a reload button', () => {
    const t = setup();
    expect(t.note.hidden).toBe(true);
    t.by('text').click();
    expect(t.note.hidden).toBe(true);
    t.by('motion').click();
    expect(t.note.hidden).toBe(false);
    expect(t.reload.hidden).toBe(false);
    t.reload.click();
    expect(t.reloadSpy).toHaveBeenCalledTimes(1);
  });
  it('"Open plain Classic site" closes the panel and uses the header\'s own mode button (nothing is imported from the 3D code)', () => {
    const t = setup();
    t.toggle.click();
    t.classic.click();
    expect(t.panel.hidden).toBe(true);
    expect(t.header.clicked).toBe(1);
    expect(read('src/ui/a11y-menu.js')).not.toMatch(/from '\.\/mode\.js'/);
  });
  it('a blocked storage does not stop the menu from working', () => {
    const t = setup({ storage: memoryStorage({ throws: true }) });
    expect(() => t.by('links').click()).not.toThrow();
    expect(t.html.getAttribute('data-a11y-links')).toBe('underline');
    expect(t.by('links').getAttribute('aria-pressed')).toBe('true');
    expect(() => t.reset.click()).not.toThrow();
    expect(t.html.attrs).toEqual({});
  });
  it('initialising twice does nothing the second time', () => {
    const t = setup();
    expect(t.menu).toBeTruthy();
    expect(initA11yMenu(t.box)).toBeNull();
  });
});

describe('P10 accessibility menu: markup, loader and CSS', () => {
  it('the button is in the tab order from the start (a plain button, aria-expanded + aria-controls) and the panel holds five real switches', () => {
    const html = read('index.html');
    expect(html).toMatch(/<button type="button" class="btn btn--sm a11y__toggle" aria-expanded="false" aria-controls="a11y-panel" data-a11y-toggle>/);
    expect(html).toMatch(/<div class="a11y__panel" id="a11y-panel" role="group" aria-labelledby="a11y-title" data-a11y-panel hidden>/);
    expect(html.match(/<button type="button" class="a11y__switch" aria-pressed="false" data-a11y-option="(motion|text|contrast|spacing|links)">/g)).toHaveLength(5);
    expect(html).not.toMatch(/data-a11y[^>]*tabindex="-1"/);
    // outside the Classic containers that go inert under Explore, so it stays usable there
    const menu = html.slice(html.indexOf('<div class="a11y" data-a11y>'), html.indexOf('<div class="paper-bg"'));
    expect(menu).not.toContain('data-inert-when-menu');
  });
  it('the logic loads on first focus or click (lazy chunk), never at start-up', () => {
    const code = read('src/ui/a11y-loader.js');
    expect(code).toMatch(/import\('\.\/a11y-menu\.js'\)/);
    expect(code).toMatch(/addEventListener\('focus'/);
    expect(code).toMatch(/addEventListener\(\s*'click'/);
    expect(read('src/main.js')).not.toMatch(/from '\.\/ui\/a11y-menu\.js'/);
  });
  it('"Reduce motion" is honoured by main.js, mode.js (Explore is not offered) and the CSS', () => {
    expect(read('src/main.js')).toMatch(/dataset\.a11yMotion === 'reduce'/);
    expect(read('src/ui/mode.js')).toMatch(/dataset\?\.a11yMotion === 'reduce'/);
    const css = read('src/styles/a11y.css');
    expect(css).toMatch(/html\[data-a11y-motion='reduce'\] \*,[\s\S]*?animation-duration: 0\.001ms !important;[\s\S]*?transition-duration: 0\.001ms !important;[\s\S]*?scroll-behavior: auto !important;/);
  });
  it('the other four modes are CSS on <html>: 125% text, underlined links, readable spacing (WCAG 1.4.12 values, system fonts), high contrast', () => {
    const css = read('src/styles/a11y.css');
    expect(css).toMatch(/html\[data-a11y-text='large'\] \{\s*font-size: 125%;/);
    expect(css).toMatch(/html\[data-a11y-links='underline'\] a \{\s*text-decoration: underline !important;/);
    expect(css).toMatch(/html\[data-a11y-spacing='readable'\] body \*:not\(svg\):not\(svg \*\) \{\s*letter-spacing: 0\.12em !important;\s*word-spacing: 0\.16em !important;\s*line-height: 1\.6 !important;/);
    expect(css).toMatch(/html\[data-a11y-spacing='readable'\] \{\s*--font-display: system-ui/);
    expect(css).toMatch(/html\[data-a11y-contrast='high'\]\[data-theme='dark'\]/);
    expect(css).toMatch(/html\[data-a11y-contrast='high'\]\[data-theme='light'\]/);
  });
  it('the controls are at least 24 px (the switches and buttons are 44 px, the check box 24 px)', () => {
    const css = read('src/styles/a11y.css');
    expect(css).toMatch(/\.a11y__toggle \{\s*min-block-size: 44px;/);
    expect(css).toMatch(/\.a11y__switch \{[\s\S]*?min-block-size: 44px;/);
    expect(css).toMatch(/\.a11y__box \{[\s\S]*?inline-size: 24px;\s*block-size: 24px;/);
  });
  it('every text / background pair of both high-contrast palettes is at least 4.5:1', () => {
    const css = read('src/styles/a11y.css');
    const lum = (hex) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a, b) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    for (const theme of ['dark', 'light']) {
      const block = new RegExp(`html\\[data-a11y-contrast='high'\\]\\[data-theme='${theme}'\\] \\{([\\s\\S]*?)\\n\\}`).exec(css)[1];
      const t = Object.fromEntries([...block.matchAll(/--([a-z0-9-]+): (#[0-9a-f]{6});/gi)].map((m) => [m[1], m[2]]));
      const pairs = [['text', 'bg'], ['text', 'surface'], ['text', 'surface-2'], ['text-muted', 'bg'], ['text-muted', 'surface'], ['text-muted', 'surface-2'], ['rust-text', 'bg'], ['rust-text', 'surface'], ['accent-text', 'bg'], ['accent-text', 'surface'], ['strip-text', 'strip-bg'], ['strip-num', 'strip-bg'], ['stamp-ink', 'stamp-bg'], ['on-ink', 'ink'], ['bg', 'ink']];
      for (const [fg, bg] of pairs) expect(ratio(t[fg], t[bg]), `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t.focus, t.bg), `${theme}: focus ring on the page`).toBeGreaterThanOrEqual(3);
    }
  });
  it('the menu and the language switch are labelled for both languages (the dictionary translates every visible string)', () => {
    const en = JSON.parse(read('src/i18n/en.json'));
    for (const key of ['a11y.button', 'a11y.title', 'a11y.motion', 'a11y.text', 'a11y.contrast', 'a11y.spacing', 'a11y.links', 'a11y.reset', 'a11y.classic', 'a11y.note', 'a11y.reload', 'a11y.saved', 'lang.group']) expect(en[key], key).toBeTruthy();
    expect(read('index.html')).toContain(`>${en['a11y.button']}</span>`);
  });
});
