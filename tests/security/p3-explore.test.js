// Control C9 (P3.1): Explore mode, the lazy 3D chunk. Same rules as Classic plus the 3D specifics:
// no remote URLs or CDNs, no eval / new Function, no HTML-string sinks, Draco self-hosted, the
// localStorage values whitelisted, debug hooks gated, and the DOM layer built with createElement /
// textContent only.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AVATAR_URL, DRACO_PATH, QUALITY_VALUES, TIERS, TIME_VALUES, TOWN_JSON_URL, TOWN_URL, TUTORIAL_VALUES } from '../../src/explore/config.js';
import { readPref, writePref } from '../../src/ui/prefs.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EXPLORE = join(ROOT, 'src', 'explore');
const files = readdirSync(EXPLORE).filter((f) => /\.(js|css)$/.test(f));
const read = (f) => readFileSync(join(EXPLORE, f), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const code = (f) => strip(read(f));

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data };
}

describe('C9 Explore source hygiene', () => {
  it('scans every Explore module', () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it.each(files)('%s has no remote URL (only the SVG namespace) and no CDN', (f) => {
    const urls = code(f).match(/(?:https?:)?\/\/[a-z0-9-]+\.[a-z0-9.-]+[^\s'"`)]*/gi) ?? [];
    expect(urls.filter((u) => u !== 'http://www.w3.org/2000/svg')).toEqual([]);
  });

  it.each(files.filter((f) => f.endsWith('.js')))('%s has no eval, new Function, string timers, HTML-string sinks or on* properties', (f) => {
    const c = code(f);
    const patterns = [/(?<![\w.])eval\s*\(/, /new\s+Function\s*\(/, /set(?:Timeout|Interval)\s*\(\s*['"`]/, /\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/, /document\.write/, /\.on[a-z]+\s*=(?!=)/];
    for (const pattern of patterns) expect(c, `${f} ${pattern}`).not.toMatch(pattern);
  });

  it('assets load from same-origin paths only', () => {
    for (const url of [TOWN_URL, TOWN_JSON_URL, AVATAR_URL, DRACO_PATH]) expect(url).toMatch(/^\/[a-z]/);
  });

  it('the Draco decoder is self-hosted in public/draco and the loader points there', () => {
    expect(DRACO_PATH).toBe('/draco/');
    for (const f of ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']) expect(existsSync(join(ROOT, 'public', 'draco', f)), f).toBe(true);
    expect(code('world.js')).toMatch(/setDecoderPath\(DRACO_PATH\)/);
    // the build plugin rewrites DRACOLoader's import.meta.url defaults to the same place
    expect(readFileSync(join(ROOT, 'scripts', 'draco-path.mjs'), 'utf8')).toContain('/draco/${file}');
  });

  it('every storage access goes through readPref / writePref with a *_KEY constant and its whitelist', () => {
    const c = code('index.js');
    expect(c).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    const calls = [...c.matchAll(/(?:readPref|writePref)\([^)]*\)/g)].map((m) => m[0]);
    expect(calls.length).toBeGreaterThanOrEqual(6);
    for (const call of calls) expect(call, call).toMatch(/^(?:readPref|writePref)\((QUALITY|TUTORIAL|TIME)_KEY, .*\1_VALUES/);
  });

  it('the three Explore values are whitelisted; hostile stored values are ignored', () => {
    expect(QUALITY_VALUES).toEqual(['auto', ...TIERS]);
    expect(TIME_VALUES).toEqual(['day', 'night']);
    expect(TUTORIAL_VALUES).toEqual(['done']);
    const store = memoryStorage({ 'explore.quality': '<img src=x onerror=alert(1)>', 'explore.time': 'noon', 'explore.tutorial': 'yes' });
    expect(readPref('explore.quality', QUALITY_VALUES, 'auto', store)).toBe('auto');
    expect(readPref('explore.time', TIME_VALUES, null, store)).toBeNull();
    expect(readPref('explore.tutorial', TUTORIAL_VALUES, null, store)).toBeNull();
    expect(writePref('explore.quality', 'ULTRA', QUALITY_VALUES, store)).toBe(true);
    expect(writePref('explore.quality', 'INSANE', QUALITY_VALUES, store)).toBe(false);
  });

  it('the HUD is built with createElement / textContent (no markup strings)', () => {
    const c = code('hud.js');
    expect(c).toMatch(/document\.createElement\(/);
    expect(c).not.toMatch(/['"`]\s*<[a-z]/i);
  });

  it('debug hooks exist only behind ?debug=1', () => {
    const c = code('index.js');
    const i = c.indexOf('window.__exploreDebug =');
    expect(i).toBeGreaterThan(-1);
    expect(c.slice(Math.max(0, i - 160), i)).toMatch(/if \(debug\)/);
  });
});

describe('C9 Explore stays out of Classic until asked for', () => {
  function jsFiles(d) {
    return readdirSync(d).flatMap((name) => {
      const p = join(d, name);
      return statSync(p).isDirectory() ? (name === 'explore' ? [] : jsFiles(p)) : p.endsWith('.js') ? [p] : [];
    });
  }

  it('src/ui/mode.js is the only Classic module that imports Explore, and only dynamically', () => {
    const importers = jsFiles(join(ROOT, 'src')).filter((p) => /from\s+['"][^'"]*explore\/|import\(\s*['"][^'"]*explore\//.test(readFileSync(p, 'utf8')));
    expect(importers.map((p) => p.replaceAll('\\', '/').replace(/.*\/src\//, 'src/'))).toEqual(['src/ui/mode.js']);
    const mode = readFileSync(join(ROOT, 'src', 'ui', 'mode.js'), 'utf8');
    expect(mode).toMatch(/import\('\.\.\/explore\/index\.js'\)/);
    expect(mode).not.toMatch(/from\s+['"]\.\.\/explore/);
  });
});
