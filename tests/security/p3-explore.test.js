// Control C9 (P3.1): Explore mode, the lazy 3D chunk. Same rules as Classic plus the 3D specifics:
// no remote URLs or CDNs, no eval / new Function, no HTML-string sinks, Draco self-hosted, the
// localStorage values whitelisted, debug hooks gated, and the DOM layer built with createElement /
// textContent only.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARRIVAL_KEY, ARRIVAL_VALUES, AVATAR_URL, DRACO_PATH, HORSE_JSON_URL, HORSE_URL, MUSIC_KEY, MUSIC_VALUES, QUALITY_VALUES, TIERS, TIME_VALUES, TOWN_JSON_URL, TOWN_URL, TRAIN_JSON_URL, TRAIN_URL, TUTORIAL_VALUES } from '../../src/explore/config.js';
import { readPref, writePref } from '../../src/ui/prefs.js';
import { BADGES_EMPTY, BADGES_KEY, BADGES_VALUES, ZONE_IDS, decodeBadges } from '../../src/explore/badges.js';

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
    for (const url of [TOWN_URL, TOWN_JSON_URL, AVATAR_URL, TRAIN_URL, TRAIN_JSON_URL, DRACO_PATH]) expect(url).toMatch(/^\/[a-z]/);
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
    for (const call of calls) expect(call, call).toMatch(/^(?:readPref|writePref)\((QUALITY|TUTORIAL|TIME|BADGES|ARRIVAL|MUSIC)_KEY, .*\1_VALUES/);
    // no other Explore module touches storage or prefs at all (the case files report back to index.js)
    for (const f of files.filter((x) => x.endsWith('.js') && x !== 'index.js')) expect(code(f), f).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|readPref|writePref/);
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

  it('P3.2 explore.badges is whitelisted against the eight zone ids; hostile values are ignored', () => {
    expect(BADGES_KEY).toBe('explore.badges');
    expect(ZONE_IDS).toEqual(['about', 'projects', 'skills', 'achievements', 'contact', 'promo', 'journey', 'chat']);
    expect(BADGES_VALUES).toHaveLength(256);
    expect(new Set(BADGES_VALUES).size).toBe(256);
    for (const v of BADGES_VALUES) expect(v === BADGES_EMPTY || v.split(',').every((id) => ZONE_IDS.includes(id)), v).toBe(true);
    const hostile = ['<img src=x onerror=alert(1)>', 'about,about', 'skills,about', 'about,admin', 'ABOUT', ' about', 'about,', '', 'null', '__proto__'];
    for (const bad of hostile) {
      const store = memoryStorage({ 'explore.badges': bad });
      expect(readPref('explore.badges', BADGES_VALUES, BADGES_EMPTY, store), bad).toBe(BADGES_EMPTY);
      expect(writePref('explore.badges', bad, BADGES_VALUES, store), bad).toBe(false);
      expect(decodeBadges(bad).size, bad).toBe(0);
    }
    const store = memoryStorage();
    expect(writePref('explore.badges', 'about,skills', BADGES_VALUES, store)).toBe(true);
    expect(readPref('explore.badges', BADGES_VALUES, BADGES_EMPTY, store)).toBe('about,skills');
  });

  it('P3.3 explore.arrival and audio.music are whitelisted; hostile values are ignored', () => {
    expect(ARRIVAL_KEY).toBe('explore.arrival');
    expect(ARRIVAL_VALUES).toEqual(['seen']);
    expect(MUSIC_KEY).toBe('audio.music');
    expect(MUSIC_VALUES).toEqual(['on', 'off']);
    const store = memoryStorage({ 'explore.arrival': 'yes', 'audio.music': '<script>' });
    expect(readPref('explore.arrival', ARRIVAL_VALUES, null, store)).toBeNull();
    expect(readPref('audio.music', MUSIC_VALUES, 'on', store)).toBe('on');
    expect(writePref('explore.arrival', 'seen', ARRIVAL_VALUES, store)).toBe(true);
    expect(writePref('audio.music', 'loud', MUSIC_VALUES, store)).toBe(false);
    expect(writePref('audio.music', 'off', MUSIC_VALUES, store)).toBe(true);
    // index.js reads both through readPref with the whitelist (checked by the storage regex above)
    expect(code('index.js')).toMatch(/readPref\(ARRIVAL_KEY, ARRIVAL_VALUES, null\)/);
    expect(code('index.js')).toMatch(/readPref\(MUSIC_KEY, MUSIC_VALUES, 'on'\)/);
  });

  it('P3.3 horse, music and arrival load only from same-origin paths; no audio files, no fetch of remote sound', () => {
    for (const url of [HORSE_URL, HORSE_JSON_URL]) expect(url).toMatch(/^\/models\//);
    for (const f of ['music.js', 'music-core.js', 'audio.js']) {
      expect(code(f), f).not.toMatch(/\bfetch\(|new Audio\(|decodeAudioData|\.(?:mp3|ogg|wav|m4a)\b/);
    }
  });

  it.each(['hud.js', 'case-files.js', 'train.js', 'fireworks.js', 'horse.js', 'arrival.js', 'music.js'])('%s builds DOM with createElement / textContent only (no markup strings)', (f) => {
    const c = code(f);
    if (f === 'hud.js') expect(c).toMatch(/document\.createElement\(/);
    if (f === 'case-files.js') expect(c).toMatch(/\bel\('dialog'/);
    expect(c).not.toMatch(/['"`]\s*<[a-z]/i);
    expect(c).not.toMatch(/\.innerHTML|\.outerHTML|insertAdjacentHTML|createContextualFragment|DOMParser|document\.write/);
  });

  it('case files move the Classic section (never copy or re-parse it) and restore it on close', () => {
    const c = code('case-files.js');
    expect(c).not.toMatch(/cloneNode|importNode/);
    expect(c).toMatch(/container\.before\(marker\)/);
    expect(c).toMatch(/marker\.replaceWith\(mounted\.container\)/);
  });

  it('certificate links come only from strictly validated page attributes (https booking, same-origin .pdf, mailto)', () => {
    const c = code('case-files.js');
    expect(c).toContain(String.raw`/^https:\/\/[^\s"'<>]+$/`);
    expect(c).toContain(String.raw`/^\/[\w/.-]+\.pdf$/`);
    expect(c).toContain(String.raw`/^mailto:[^\s"'<>?]+$/`);
    expect(c).toContain("window.open(links.booking, '_blank', 'noopener,noreferrer')");
    expect(c).not.toMatch(/location\s*=|location\.href\s*=/);
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
