// P2.4: intro / start screen / mode rules. Pure functions only (no DOM).
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { bootPlan, INTRO_KEY, INTRO_VALUES, isSkipKey, readIntro, writeIntro } from '../src/ui/boot-rules.js';
import { canOfferExplore, EXPLORE_READY, exploreUnavailableReason, launchParams, MODE_KEY, MODE_VALUES, readMode, resolveMode, urlMode, writeMode } from '../src/ui/mode.js';
import { readSound, SOUND_VALUES, writeSound } from '../src/ui/sound.js';

function memoryStorage(initial = {}, { throws = false } = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => {
      if (throws) throw new Error('SecurityError');
      return data.has(k) ? data.get(k) : null;
    },
    setItem: (k, v) => {
      if (throws) throw new Error('SecurityError');
      data.set(k, String(v));
    },
    data,
  };
}

const HOSTILE = ['', 'SEEN', 'seen ', 'true', '1', 'null', 'undefined', '<img src=x onerror=alert(1)>', 'javascript:alert(1)', '"><script>alert(1)</script>', 'x'.repeat(10000)];

describe('whitelists', () => {
  it('uses exactly the documented keys and values', () => {
    expect([INTRO_KEY, MODE_KEY]).toEqual(['intro', 'mode']);
    expect(INTRO_VALUES).toEqual(['seen']);
    expect(MODE_VALUES).toEqual(['classic', 'explore']);
    expect(SOUND_VALUES).toEqual(['on', 'off']);
  });

  it('reads back only whitelisted intro values', () => {
    expect(readIntro(memoryStorage({ intro: 'seen' }))).toBe('seen');
    expect(readIntro(memoryStorage({}))).toBeNull();
    for (const bad of HOSTILE) expect(readIntro(memoryStorage({ intro: bad })), bad.slice(0, 30)).toBeNull();
    expect(readIntro(memoryStorage({}, { throws: true }))).toBeNull();
  });

  it('reads back only whitelisted mode values', () => {
    expect(readMode(memoryStorage({ mode: 'classic' }))).toBe('classic');
    expect(readMode(memoryStorage({ mode: 'explore' }))).toBe('explore');
    for (const bad of [...HOSTILE, 'Classic', 'EXPLORE', '3d']) expect(readMode(memoryStorage({ mode: bad }))).toBeNull();
    expect(readMode(memoryStorage({}, { throws: true }))).toBeNull();
  });

  it('reads back only whitelisted sound values (default off)', () => {
    for (const bad of [...HOSTILE, 'ON', 'loud']) expect(readSound(memoryStorage({ sound: bad }))).toBe('off');
  });

  it('never writes a value outside the whitelist', () => {
    const store = memoryStorage();
    expect(writeIntro('seen', store)).toBe(true);
    expect(writeMode('classic', store)).toBe(true);
    expect(writeSound('on', store)).toBe(true);
    for (const bad of HOSTILE) {
      expect(writeIntro(bad, store)).toBe(false);
      expect(writeMode(bad, store)).toBe(false);
      expect(writeSound(bad, store)).toBe(false);
    }
    expect(Object.fromEntries(store.data)).toEqual({ intro: 'seen', mode: 'classic', sound: 'on' });
  });

  it('survives blocked storage on write', () => {
    expect(writeIntro('seen', memoryStorage({}, { throws: true }))).toBe(false);
    expect(writeMode('explore', memoryStorage({}, { throws: true }))).toBe(false);
  });
});

describe('bootPlan (first visit, returning visit, reduced motion)', () => {
  it('first visit: intro, then the full start screen', () => {
    expect(bootPlan({ introSeen: false, storedMode: null, reducedMotion: false })).toEqual({ showIntro: true, staticCard: false, startVariant: 'first' });
  });

  it('intro seen but no mode chosen yet: no intro, full start screen', () => {
    expect(bootPlan({ introSeen: true, storedMode: null })).toEqual({ showIntro: false, staticCard: false, startVariant: 'first' });
  });

  it('returning visitor: no intro, one-tap Continue', () => {
    expect(bootPlan({ introSeen: true, storedMode: 'classic' })).toEqual({ showIntro: false, staticCard: false, startVariant: 'returning' });
    expect(bootPlan({ introSeen: true, storedMode: 'explore' }).startVariant).toBe('returning');
  });

  it('reduced motion never plays the intro', () => {
    expect(bootPlan({ introSeen: false, storedMode: null, reducedMotion: true }).showIntro).toBe(false);
    expect(bootPlan({ introSeen: false, storedMode: 'classic', reducedMotion: true })).toEqual({ showIntro: false, staticCard: true, startVariant: 'returning' });
  });

  it('P3.3 reduced motion, first visit only: a static title card instead of the opening', () => {
    expect(bootPlan({ introSeen: false, reducedMotion: true }).staticCard).toBe(true);
    expect(bootPlan({ introSeen: true, reducedMotion: true }).staticCard).toBe(false);
    expect(bootPlan({ introSeen: false, reducedMotion: false }).staticCard).toBe(false);
  });

  it('P3.3 the opening is skipped by any key except Tab and bare modifiers', () => {
    for (const k of ['Escape', 'Enter', ' ', 'a', 'ArrowDown']) expect(isSkipKey(k), k).toBe(true);
    for (const k of ['Tab', 'Shift', 'Control', 'Alt', 'Meta']) expect(isSkipKey(k), k).toBe(false);
  });

  it('P3.3 once only: after the opening (or the static card) the intro key is "seen" and the next visit skips it', () => {
    const store = memoryStorage();
    expect(bootPlan({ introSeen: readIntro(store) === 'seen' }).showIntro).toBe(true);
    writeIntro('seen', store);
    expect(bootPlan({ introSeen: readIntro(store) === 'seen' }).showIntro).toBe(false);
    expect(bootPlan({ introSeen: readIntro(store) === 'seen', reducedMotion: true }).staticCard).toBe(false);
  });

  it('P3.3 the opening is pure HTML/SVG + Canvas 2D (no three.js) and animates transform / opacity only', () => {
    const src = readFileSync(new URL('../src/ui/start.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).not.toMatch(/from '[^']*three|WebGLRenderer|WebGPURenderer|import\(/);
    expect(src).toMatch(/getContext\?\.\('2d'\)/);
    const opening = src.slice(src.indexOf('function playOpening'), src.indexOf('function playVideo'));
    const props = [...opening.matchAll(/(\w+):\s*(?:[-\d'.]|'\d)/g)].map((m) => m[1]);
    for (const p of props) expect(['x', 'y', 'scale', 'rotation', 'yPercent', 'opacity', 'duration', 'stagger'], p).toContain(p);
  });

  it('hostile stored values behave like a first visit (they are filtered before and inside bootPlan)', () => {
    const introSeen = readIntro(memoryStorage({ intro: '<img src=x onerror=alert(1)>' })) === 'seen';
    const storedMode = readMode(memoryStorage({ mode: 'javascript:alert(1)' }));
    expect(bootPlan({ introSeen, storedMode })).toEqual({ showIntro: true, staticCard: false, startVariant: 'first' });
    expect(bootPlan({ storedMode: 'evil' }).startVariant).toBe('first');
    expect(bootPlan()).toEqual({ showIntro: true, staticCard: false, startVariant: 'first' });
  });
});

describe('mode rules (src/ui/mode.js)', () => {
  const full = { webgl2: true, reducedMotion: false, saveData: false };

  it('Explore is offered only with WebGL2, full motion and no Save-Data', () => {
    expect(canOfferExplore(full)).toBe(true);
    expect(canOfferExplore({ ...full, webgl2: false })).toBe(false);
    expect(canOfferExplore({ ...full, reducedMotion: true })).toBe(false);
    expect(canOfferExplore({ ...full, saveData: true })).toBe(false);
    expect(canOfferExplore()).toBe(false);
  });

  // P3.1: the island exists, so the default `ready` flag is now true (before P3 this asserted false).
  it('Explore is ready in P3: a stored "explore" resolves to Explore where it is offered', () => {
    expect(EXPLORE_READY).toBe(true);
    expect(resolveMode('explore', full)).toBe('explore');
    expect(resolveMode('classic', full)).toBe('classic');
    expect(resolveMode(null, full)).toBe('classic');
    expect(resolveMode('explore', full, false)).toBe('classic'); // the flag still gates it
  });

  it('a clear reason is shown when Explore is not offered', () => {
    expect(exploreUnavailableReason(full)).toBeNull();
    expect(exploreUnavailableReason({ ...full, webgl2: false })).toMatch(/WebGL2/);
    expect(exploreUnavailableReason({ ...full, reducedMotion: true })).toMatch(/reduced motion/);
    expect(exploreUnavailableReason({ ...full, saveData: true })).toMatch(/Data Saver/);
  });

  it('launch parameters are whitelisted (?mode, ?debug=1, ?backend=webgl)', () => {
    expect(launchParams('?mode=explore&debug=1&backend=webgl')).toEqual({ mode: 'explore', debug: true, forceWebGL: true });
    expect(launchParams('?mode=<script>&debug=true&backend=webgpu')).toEqual({ mode: null, debug: false, forceWebGL: false });
    expect(launchParams('')).toEqual({ mode: null, debug: false, forceWebGL: false });
    expect(urlMode('?mode=classic')).toBe('classic');
    expect(urlMode('?mode=EXPLORE')).toBeNull();
  });

  it('once ready (P3), Explore resolves only where it is offered', () => {
    expect(resolveMode('explore', full, true)).toBe('explore');
    expect(resolveMode('explore', { ...full, webgl2: false }, true)).toBe('classic');
    expect(resolveMode('explore', { ...full, reducedMotion: true }, true)).toBe('classic');
    expect(resolveMode('explore', { ...full, saveData: true }, true)).toBe('classic');
    expect(resolveMode('classic', full, true)).toBe('classic');
    expect(resolveMode('<script>', full, true)).toBe('classic');
  });
});
