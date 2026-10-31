import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import viteConfig from '../../vite.config.js';
import { readSound, writeSound, SOUND_VALUES } from '../../src/ui/sound.js';
import { readTheme, writeTheme } from '../../src/ui/theme.js';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const PAGES = ['index.html', 'admin/index.html'];

// Minimal in-memory Storage; `throws` simulates blocked storage (privacy mode).
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

describe('C6 no inline scripts, handlers or third-party assets in the HTML', () => {
  it.each(PAGES)('%s has no inline <script> bodies', (page) => {
    const html = read(page);
    for (const [tag, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      expect(body.trim(), `inline script in ${page}: ${tag.slice(0, 80)}`).toBe('');
      expect(attrs, `script without src in ${page}`).toMatch(/\ssrc=/i);
    }
  });

  it.each(PAGES)('%s has no on*= event handler attributes', (page) => {
    const html = read(page);
    // Any attribute named on<something>= inside a tag.
    expect(html).not.toMatch(/<[^>]+\son[a-z]+\s*=/i);
  });

  it.each(PAGES)('%s loads no script, stylesheet or font from another origin', (page) => {
    const html = read(page);
    const external = [
      ...html.matchAll(/<script\b[^>]*\ssrc=["']?(https?:)?\/\//gi),
      ...html.matchAll(/<link\b[^>]*\shref=["']?(https?:)?\/\/[^"'\s>]*/gi),
    ].map((m) => m[0]);
    expect(external).toEqual([]);
    expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/i);
  });
});

describe('C6 localStorage holds only whitelisted values', () => {
  function runThemeInit({ stored, throws = false, prefersLight = false }) {
    const attrs = {};
    const storage = memoryStorage(stored === undefined ? {} : { theme: stored }, { throws });
    const context = {
      window: {
        localStorage: storage,
        matchMedia: (q) => ({ matches: q.includes('light') ? prefersLight : false }),
        setTimeout: () => 0,
      },
      document: {
        documentElement: {
          setAttribute: (k, v) => {
            attrs[k] = v;
          },
          getAttribute: (k) => attrs[k] ?? null,
          classList: { add() {}, remove() {} },
        },
      },
    };
    runInNewContext(read('public/theme-init.js'), context);
    return attrs['data-theme'];
  }

  it.each([
    ['light', false, 'light'],
    ['dark', true, 'dark'],
  ])('theme-init.js accepts stored "%s"', (stored, prefersLight, expected) => {
    expect(runThemeInit({ stored, prefersLight })).toBe(expected);
  });

  it.each(['evil', 'LIGHT', '', '"><script>alert(1)</script>', 'light ', 'javascript:alert(1)'])(
    'theme-init.js rejects stored %j and falls back to the system preference',
    (stored) => {
      expect(runThemeInit({ stored, prefersLight: false })).toBe('dark');
      expect(runThemeInit({ stored, prefersLight: true })).toBe('light');
    },
  );

  it('theme-init.js survives blocked storage', () => {
    expect(runThemeInit({ throws: true, prefersLight: true })).toBe('light');
    expect(runThemeInit({ throws: true, prefersLight: false })).toBe('dark');
  });

  it('the sound preference only accepts "on"/"off"', () => {
    expect(SOUND_VALUES).toEqual(['on', 'off']);
    expect(readSound(memoryStorage({ sound: 'on' }))).toBe('on');
    expect(readSound(memoryStorage({ sound: 'off' }))).toBe('off');
    for (const bad of ['yes', 'ON', '1', '<img src=x>', '']) {
      expect(readSound(memoryStorage({ sound: bad }))).toBe('off');
    }
    expect(readSound(memoryStorage({}, { throws: true }))).toBe('off');

    const store = memoryStorage();
    expect(writeSound('on', store)).toBe(true);
    expect(writeSound('loud', store)).toBe(false);
    expect(writeSound('<script>', store)).toBe(false);
    expect([...store.data.values()]).toEqual(['on']);
  });

  it('the theme module only stores "light"/"dark"', () => {
    const store = memoryStorage();
    expect(writeTheme('light', store)).toBe(true);
    expect(writeTheme('sepia', store)).toBe(false);
    expect([...store.data.values()]).toEqual(['light']);
    expect(readTheme(memoryStorage({ theme: 'sepia' }))).toBeNull();
  });
});

describe('C6 no data: URIs in CSS', () => {
  it('source stylesheets contain no data: URIs', () => {
    const dir = new URL('../../src/styles/', import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith('.css'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const code = readFileSync(new URL(file, dir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(code, file).not.toMatch(/data:/i);
    }
  });

  it('the build never inlines assets as data: URIs', () => {
    expect(viteConfig.build.assetsInlineLimit).toBe(0);
  });
});
