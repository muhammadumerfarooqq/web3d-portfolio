// P2 exit (P2.4): C6 extended to the intro/start screen and the mode shell.
//  - still no inline scripts, inline handlers or HTML-string DOM sinks (built page + new modules)
//  - localStorage is only ever theme / sound / intro / mode, each with whitelisted values
//  - no external origins are loaded by anything in dist/
//  - without JS there is no intro and no start screen: the Classic page shows
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { renderIntroStage } from '../../scripts/content/gallery.mjs';
import { buildSite, ROOT } from '../helpers/build-site.js';

const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? jsFiles(path) : path.endsWith('.js') ? [path] : [];
  });
}

/** Run public/theme-init.js in a sandbox; returns the attributes it set and its failsafe. */
function runThemeInit({ storage = {}, reduce = false, throws = false } = {}) {
  const attrs = {};
  const classes = new Set();
  let failsafe = null;
  const reads = [];
  const context = {
    window: {
      localStorage: {
        getItem: (k) => {
          reads.push(k);
          if (throws) throw new Error('SecurityError');
          return k in storage ? storage[k] : null;
        },
        setItem: () => {
          throw new Error('theme-init.js must never write storage');
        },
      },
      matchMedia: (q) => ({ matches: q.includes('reduced-motion') ? reduce : false }),
      setTimeout: (fn) => {
        failsafe = fn;
        return 1;
      },
    },
    document: {
      documentElement: {
        setAttribute: (k, v) => {
          attrs[k] = v;
        },
        getAttribute: (k) => attrs[k] ?? null,
        removeAttribute: (k) => {
          delete attrs[k];
        },
        classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
      },
    },
  };
  runInNewContext(read('public/theme-init.js'), context);
  return { attrs, classes, failsafe, reads };
}

describe('C6 boot layer before first paint (theme-init.js)', () => {
  it('first visit with motion → intro', () => {
    expect(runThemeInit().attrs['data-boot']).toBe('intro');
  });

  it('intro already seen → straight to the start screen', () => {
    expect(runThemeInit({ storage: { intro: 'seen' } }).attrs['data-boot']).toBe('start');
  });

  it('reduced motion → no sting, start screen', () => {
    const { attrs, classes } = runThemeInit({ reduce: true });
    expect(attrs['data-boot']).toBe('start');
    expect(classes.has('js')).toBe(false);
  });

  it.each(['SEEN', 'seen ', 'true', '<img src=x onerror=alert(1)>', 'javascript:alert(1)', ''])(
    'a hostile stored intro value %j is ignored (treated as a first visit)',
    (bad) => {
      expect(runThemeInit({ storage: { intro: bad } }).attrs['data-boot']).toBe('intro');
    },
  );

  it('blocked storage still boots (system theme, intro)', () => {
    const { attrs } = runThemeInit({ throws: true });
    expect(attrs['data-theme']).toMatch(/^(light|dark)$/);
    expect(attrs['data-boot']).toBe('intro');
  });

  it('reads only the theme and intro keys, and never writes', () => {
    expect(new Set(runThemeInit().reads)).toEqual(new Set(['theme', 'intro']));
  });

  it('failsafe: if the app never takes over, the boot layer and hidden reveals are dropped', () => {
    const run = runThemeInit();
    run.failsafe();
    expect(run.attrs['data-boot']).toBeUndefined();
    expect(run.classes.has('js')).toBe(false);
  });

  it('failsafe: once start.js owns the boot layer it is left alone', () => {
    const run = runThemeInit();
    run.attrs['data-shell'] = 'ready';
    run.attrs['data-motion'] = 'ready';
    run.failsafe();
    expect(run.attrs['data-boot']).toBe('intro');
    expect(run.classes.has('js')).toBe(true);
  });
});

describe('C6 localStorage keys are theme, sound, intro and mode only', () => {
  const sources = [...jsFiles(join(ROOT, 'src')), join(ROOT, 'public', 'theme-init.js')];

  it('only prefs.js (and the pre-paint theme-init.js) touch localStorage directly', () => {
    const direct = sources.filter((f) => /localStorage|sessionStorage|indexedDB|document\.cookie/.test(stripComments(readFileSync(f, 'utf8'))));
    expect(direct.map((f) => f.replace(ROOT, '').replaceAll('\\', '/')).sort()).toEqual(['public/theme-init.js', 'src/ui/prefs.js']);
  });

  it('every key read or written goes through a whitelisted constant', () => {
    const keys = new Set();
    for (const f of sources) {
      const code = stripComments(readFileSync(f, 'utf8'));
      for (const [, key] of code.matchAll(/_KEY\s*=\s*'([^']+)'/g)) keys.add(key);
      for (const [, key] of code.matchAll(/(?:getItem|setItem|removeItem)\(\s*'([^']+)'/g)) keys.add(key);
      // readPref/writePref must be called with a *_KEY constant, never a literal or a variable from input
      if (f.endsWith('prefs.js')) continue; // the definitions themselves
      for (const [call] of code.matchAll(/(?:readPref|writePref)\(\s*[^,)]+/g)) {
        expect(call, f).toMatch(/\(\s*[A-Z_]+_KEY$/);
      }
    }
    expect([...keys].sort()).toEqual(['intro', 'mode', 'sound', 'theme']);
  });
});

describe('C6 the built page (P2 exit)', () => {
  let site;
  beforeAll(async () => {
    site = await buildSite();
  }, 120_000);

  it('has no inline <script> bodies, inline handlers or javascript: URLs', () => {
    for (const [, attrs, body] of site.indexHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      expect(attrs).toMatch(/\bsrc=/);
      expect(body.trim()).toBe('');
    }
    expect(site.indexHtml).not.toMatch(/\son[a-z]+\s*=/i);
    expect(site.indexHtml).not.toMatch(/javascript:/i);
  });

  it('loads nothing from another origin (HTML resources, CSS url()/@import, JS imports/fetch)', () => {
    // Resource-loading attributes in HTML (plain <a href> links to profiles are fine)
    for (const [tag] of site.indexHtml.matchAll(/<(?:script|link|img|source|video|audio|track|iframe|embed|object)\b[^>]*>/gi)) {
      expect(tag, tag).not.toMatch(/\s(?:src|href|poster|srcset|data)\s*=\s*["']?(?:https?:)?\/\//i);
    }
    for (const out of site.outputs) {
      const text = typeof out.source === 'string' ? out.source : out.code;
      if (typeof text !== 'string') continue;
      if (out.fileName.endsWith('.css')) {
        expect(text, out.fileName).not.toMatch(/url\(\s*["']?(?:https?:)?\/\//i);
        expect(text, out.fileName).not.toMatch(/@import/i);
      }
      if (out.fileName.endsWith('.js')) {
        expect(text, out.fileName).not.toMatch(/(?:import\s*\(|fetch\s*\(|new\s+(?:WebSocket|EventSource|Worker)\s*\()\s*["'`](?:https?:|wss?:)?\/\//i);
      }
    }
  });

  it('without JS there is no intro and no start screen (Classic shows directly)', () => {
    const html = site.indexHtml;
    expect(html).toMatch(/<div class="intro"[^>]*\bdata-intro\b[^>]*\bhidden\b/);
    const start = html.match(/<dialog class="start"[^>]*>/)?.[0];
    expect(start).toBeTruthy();
    expect(start).not.toMatch(/\bopen\b/);
    // The pre-paint attribute only ever comes from the external theme-init.js
    expect(html.match(/<html[^>]*>/)[0]).not.toMatch(/data-boot/);
  });

  it('the intro and start screen are labelled modal dialogs with a focusable Skip', () => {
    expect(site.indexHtml).toMatch(/<div class="intro" role="dialog" aria-modal="true" aria-label="Intro"/);
    expect(site.indexHtml).toMatch(/<dialog class="start" aria-labelledby="start-title"/);
    expect(site.indexHtml).toMatch(/<button type="button"[^>]*data-intro-skip/);
  });

  it('the font preloads are same-origin', () => {
    const preloads = [...site.indexHtml.matchAll(/<link rel="preload"[^>]*>/g)].map((m) => m[0]);
    expect(preloads.length).toBe(2);
    for (const tag of preloads) expect(tag).toMatch(/href="\/assets\/[\w-]+\.woff2"/);
  });
});

describe('C6 / C8 new P2.4 modules stay sink-free', () => {
  it.each(['src/ui/start.js', 'src/ui/mode.js', 'src/ui/boot-rules.js', 'src/ui/sound.js', 'scripts/font-preload.mjs'])('%s', (file) => {
    const code = stripComments(read(file));
    expect(code).not.toMatch(/\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write|(?<![\w.])eval\s*\(|new\s+Function\s*\(/);
  });

  it('mode.js keeps no WebGL context (feature detection only)', () => {
    const code = stripComments(read('src/ui/mode.js'));
    expect(code).toMatch(/loseContext\(\)/);
    expect(code).not.toMatch(/three|WebGLRenderer/i);
  });
});

describe('C7 intro video marker', () => {
  const profile = { short_name: 'Umer', title: 'Associate AI Engineer' };

  it('renders the placeholder sting (escaped text) when public/video/intro.mp4 is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'intro-'));
    try {
      const out = renderIntroStage({ profile: { ...profile, title: '<b>x</b>' } }, { root }).toString();
      expect(out).toContain('class="intro__stage"');
      expect(out.match(/intro__letter/g)).toHaveLength(4);
      expect(out).toContain('&lt;b&gt;x&lt;/b&gt;');
      expect(out).not.toContain('<video');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('plays intro.mp4 muted and inline when it exists at build time', () => {
    const root = mkdtempSync(join(tmpdir(), 'intro-'));
    try {
      mkdirSync(join(root, 'public', 'video'), { recursive: true });
      writeFileSync(join(root, 'public', 'video', 'intro.mp4'), '');
      const out = renderIntroStage({ profile }, { root }).toString();
      expect(out).toMatch(/<video[^>]*src="\/video\/intro\.mp4"[^>]*\bmuted\b[^>]*\bplaysinline\b/);
      expect(out).not.toMatch(/autoplay|controls/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
