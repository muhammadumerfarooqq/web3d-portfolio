// P3.2: star badges (persistence, whitelist, the ceremony fires exactly once at 8/8), the station
// train's state machine, the case-file overlay's accessibility contract, content parity with Classic
// (the overlay shows the Classic DOM itself) and no phone number anywhere in Explore.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BADGES_EMPTY, BADGES_KEY, BADGES_VALUES, ZONE_IDS, createBadges, decodeBadges, encodeBadges } from '../src/explore/badges.js';
import { createTrainMachine, easeOutCubic } from '../src/explore/train-machine.js';
import { ZONE_ANCHORS } from '../src/explore/zones.js';
import { readPref, writePref } from '../src/ui/prefs.js';
import { planBursts } from '../src/explore/fireworks.js';
import { scanText } from '../scripts/content/guard.mjs';
import { buildSite, ROOT } from './helpers/build-site.js';

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const src = (f) => strip(readFileSync(join(ROOT, 'src', 'explore', f), 'utf8'));

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data };
}

describe('star badges', () => {
  it('cover exactly the eight zones, in the Classic order', () => {
    expect(ZONE_IDS).toEqual(Object.keys(ZONE_ANCHORS));
    expect(ZONE_IDS).toHaveLength(8);
  });

  it('encode canonically (order and duplicates do not matter) and round-trip', () => {
    expect(encodeBadges([])).toBe(BADGES_EMPTY);
    expect(encodeBadges(['chat', 'about', 'about'])).toBe('about,chat');
    expect(encodeBadges(['nope'])).toBe(BADGES_EMPTY);
    for (const v of BADGES_VALUES) expect(encodeBadges(decodeBadges(v))).toBe(v);
  });

  it('persist through readPref / writePref and survive a reload', () => {
    const store = memoryStorage();
    const save = (v) => writePref(BADGES_KEY, v, BADGES_VALUES, store);
    const a = createBadges(readPref(BADGES_KEY, BADGES_VALUES, BADGES_EMPTY, store), { onChange: save });
    a.award('skills');
    a.award('about');
    expect(store.data.get('explore.badges')).toBe('about,skills');
    const b = createBadges(readPref(BADGES_KEY, BADGES_VALUES, BADGES_EMPTY, store));
    expect(b.count).toBe(2);
    expect(b.has('about') && b.has('skills')).toBe(true);
    b.reset();
    expect(b.count).toBe(0);
  });

  it('ignore unknown ids and repeated awards', () => {
    const b = createBadges();
    expect(b.award('admin').awarded).toBe(false);
    expect(b.award('about').awarded).toBe(true);
    expect(b.award('about').awarded).toBe(false);
    expect(b.count).toBe(1);
  });

  it('the ceremony triggers exactly once, on the award that completes 8/8', () => {
    const b = createBadges();
    const completions = [];
    for (const id of [...ZONE_IDS, ...ZONE_IDS]) completions.push(b.award(id).completedNow);
    expect(completions.filter(Boolean)).toHaveLength(1);
    expect(completions.indexOf(true)).toBe(ZONE_IDS.length - 1);
    expect(b.complete).toBe(true);
  });

  it('a visitor who already has 8/8 stored never re-triggers it; after a reset the next full set does', () => {
    const full = createBadges(encodeBadges(ZONE_IDS));
    expect(full.complete).toBe(true);
    expect(ZONE_IDS.map((id) => full.award(id).completedNow).some(Boolean)).toBe(false);
    full.reset();
    expect(ZONE_IDS.map((id) => full.award(id).completedNow).filter(Boolean)).toHaveLength(1);
  });

  it('index.js starts the ceremony only from a completing award', () => {
    const c = src('index.js');
    expect(c).toMatch(/if \(r\.completedNow\) ceremonyPending = true;/);
    // runCeremony runs when the case file closes with a completion pending (and from the debug hook)
    expect(c).toMatch(/if \(!open && ceremonyPending\) runCeremony\(\);/);
    expect([...c.matchAll(/(?<!function )runCeremony\(\)/g)].length).toBe(2);
    expect(c).toMatch(/ceremonyPending = false;\s*ceremony = true;/);
  });
});

describe('station train state machine (enter → stop → overlay → depart)', () => {
  const cfg = { enterX: -75, stopX: 0, exitX: 75 };
  const run = (m, seconds, dt = 1 / 60) => {
    const events = [];
    for (let t = 0; t < seconds; t += dt) events.push(...m.step(dt).events);
    return events;
  };

  it('arrives from the west with an ease-out, stops at the platform and asks for the overlay once', () => {
    const m = createTrainMachine(cfg);
    expect(m.state).toBe('idle');
    expect(m.enterStation()).toBe(true);
    expect(m.state).toBe('arriving');
    expect(m.enterStation()).toBe(false); // one train at a time
    m.step(3);
    expect(m.x).toBeCloseTo(-75 + 75 * easeOutCubic(0.5), 5);
    expect(m.x).toBeGreaterThan(-37.5); // ease-out: past halfway at half time
    const events = run(m, 3.5);
    expect(m.state).toBe('stopped');
    expect(m.x).toBe(0);
    expect(events.filter((e) => e === 'openOverlay')).toHaveLength(1);
    expect(run(m, 5)).toEqual([]); // waits at the platform while the case file is open
  });

  it('departs east when the overlay closes, then despawns and can come again', () => {
    const m = createTrainMachine(cfg);
    m.enterStation();
    run(m, 6.5);
    m.overlayOpened();
    m.overlayClosed();
    expect(m.state).toBe('departing');
    const events = run(m, 6.5);
    expect(events[0]).toBe('departing');
    expect(events).toContain('despawn');
    expect(events.filter((e) => e === 'departing')).toHaveLength(1);
    expect(m.state).toBe('idle');
    expect(m.visible).toBe(false);
    expect(m.enterStation()).toBe(true);
  });

  it('wheels advance with dx (positive while arriving and departing, zero when stopped)', () => {
    const m = createTrainMachine(cfg);
    m.enterStation();
    expect(m.step(0.5).dx).toBeGreaterThan(0);
    run(m, 6);
    expect(m.step(0.5).dx).toBe(0);
  });

  it('opened early by the visitor: no second overlay on stop; closed early: pulls out after a dwell', () => {
    const m = createTrainMachine(cfg);
    m.enterStation();
    m.overlayOpened();
    expect(run(m, 6.5)).not.toContain('openOverlay');
    const n = createTrainMachine(cfg);
    n.enterStation();
    n.overlayOpened();
    n.overlayClosed();
    const events = run(n, 6.5 + 1.5);
    expect(events).not.toContain('openOverlay');
    expect(events).toContain('departing');
  });

  it('reduced motion: appears at the platform at once and leaves at once', () => {
    const m = createTrainMachine({ ...cfg, reducedMotion: true });
    m.enterStation();
    expect(m.x).toBe(0);
    expect(m.step(1 / 60).events).toEqual(['stopped', 'openOverlay']);
    m.overlayOpened();
    m.overlayClosed();
    expect(m.step(1 / 60).events).toEqual(['departing', 'despawn']);
  });
});

describe('fireworks plan', () => {
  it('bursts in sequence above the town, inside the camera-facing show area', () => {
    const plan = planBursts();
    expect(plan.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < plan.length; i += 1) expect(plan[i].t).toBeGreaterThan(plan[i - 1].t);
    for (const b of plan) {
      // low enough to sit inside a level camera's frame ~42 m away (16–26 m was above the top edge)
      expect(b.offset[1]).toBeGreaterThanOrEqual(8);
      expect(b.offset[1]).toBeLessThanOrEqual(14);
      expect(Math.abs(b.offset[0])).toBeLessThanOrEqual(14);
    }
  });
});

describe('case-file overlay: accessibility contract', () => {
  const c = src('case-files.js');
  const css = readFileSync(join(ROOT, 'src', 'explore', 'explore.css'), 'utf8');

  it('is one native <dialog>, opened modally, with aria-modal and a label from the Classic heading', () => {
    expect(c.match(/el\('dialog'/g)).toHaveLength(1);
    expect(c).toMatch(/'aria-modal': 'true'/);
    expect(c).toMatch(/dialog\.showModal\(\)/);
    expect(c).toMatch(/setAttribute\('aria-labelledby', labelId\)/);
    expect(c).toMatch(/show\('zone', mounted\?\.title\?\.id\)/);
  });

  it('Esc closes (cancel → our close path), and Tab is trapped inside', () => {
    expect(c).toMatch(/addEventListener\('cancel', \(e\) => \{\s*e\.preventDefault\(\);\s*close\(\);/);
    expect(c).toMatch(/if \(e\.key !== 'Tab'\) return;/);
    expect(c).toMatch(/last\.focus\(\)/);
    expect(c).toMatch(/first\.focus\(\)/);
  });

  it('focus returns to the 3D view on close, and input is paused while it is open', () => {
    expect(c).toMatch(/canvasHost\.focus\(\{ preventScroll: true \}\)/);
    const index = src('index.js');
    expect(index).toMatch(/input\.setPaused\(open \|\| ceremony\)/);
    expect(index).toMatch(/const blocked = overlayOpen \|\| ceremony;/);
    expect(src('input.js')).toMatch(/if \(paused \|\| !action \|\| typing\(e\)\) return;/);
  });

  it('is a full-screen sheet on phones', () => {
    const phone = css.slice(css.lastIndexOf('@media (max-width: 720px)'));
    expect(phone).toMatch(/\.xp-case \{[^}]*inline-size: 100vw;[^}]*block-size: 100dvh;/);
  });

  it('a star is earned after 3 s open or on interaction (never by the close button alone)', () => {
    expect(c).toMatch(/export const ENGAGE_MS = 3000;/);
    expect(c).toMatch(/engageTimer = setTimeout\(engage, ENGAGE_MS\)/);
    expect(c).toMatch(/closest\('\.xp-case__close'\)\) return;/);
    expect(c).toMatch(/'aria-live'|announce/);
  });

  it('the star flight and the stamp animate transform and opacity only', () => {
    for (const [, frames] of c.matchAll(/\.animate\(\s*(\[[\s\S]*?\])\s*,/g)) {
      const props = [...frames.matchAll(/(\w+):/g)].map((m) => m[1]).filter((p) => p !== 'offset');
      for (const p of props) expect(['transform', 'opacity'], `${p} in ${frames.slice(0, 60)}`).toContain(p);
    }
  });
});

describe('content parity with Classic (the overlay shows the Classic DOM itself)', () => {
  let html;
  beforeAll(async () => {
    ({ indexHtml: html } = await buildSite());
  }, 180_000);

  it('every zone maps to a built Classic section with one .container and a titled case-file heading', () => {
    for (const [zone, anchor] of Object.entries(ZONE_ANCHORS)) {
      const id = anchor.slice(1);
      const start = html.indexOf(`<section id="${id}"`);
      expect(start, zone).toBeGreaterThan(-1);
      const section = html.slice(start, html.indexOf('</section>', start));
      expect(section.match(/<div class="container">/g)?.length, zone).toBeGreaterThanOrEqual(1);
      expect(section, zone).toMatch(new RegExp(`<h2 id="${id}-title" class="section__title"`));
    }
  });

  it('Explore holds no copy of Classic text (headings, bios, project or journey copy)', () => {
    const explore = readdirSync(join(ROOT, 'src', 'explore'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(join(ROOT, 'src', 'explore', f), 'utf8'))
      .join('\n');
    const headings = [...html.matchAll(/<h2 id="[a-z]+-title" class="section__title"[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1].trim());
    expect(headings.length).toBeGreaterThanOrEqual(8);
    for (const h of headings) expect(explore, h).not.toContain(h);
    const bio = html.match(/<div class="about__bio prose"><p[^>]*>([^<]{40,})/)?.[1];
    expect(bio).toBeTruthy();
    expect(explore).not.toContain(bio.slice(0, 40));
  });
});

// Code is full of number runs (SVG paths, float arrays) that the content guard's generic digit-run
// rule would flag, so sources and bundles are checked with the specific phone shapes (Pakistani mobile
// formats, international prefix) and the email pattern; human-readable copy gets the full guard.
const PHONE = [/(?:\+92|0092)[\s.-]?3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}\b/, /(?<![\d+.])03\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/, /\+\d{1,3}[\s-]\(?\d{2,4}\)?[\s-]\d{3}[\s-]?\d{3,4}\b/];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.(?:com|net|org|io|dev|pk|edu)\b/;
const clean = (text, label) => {
  for (const re of [...PHONE, EMAIL]) expect(text, `${label} ${re}`).not.toMatch(re);
};

describe('no phone number anywhere in Explore', () => {
  it('the patterns catch the shapes they guard (and not coordinates)', () => {
    for (const bad of ['+92 300 1234567', '0092-321-555-0199', '0300-1234567', '0312 345 6789', '+1 (555) 010-0199', 'someone@example.com']) {
      expect([...PHONE, EMAIL].some((re) => re.test(bad)), bad).toBe(true);
    }
    for (const ok of ['[3, 0.62, 43]', '-0.72, 0.2, 0.42', 'M12 1.5l2.6 6.1 6.6.5-5 4.3', '2023 → 2026']) {
      expect([...PHONE, EMAIL].some((re) => re.test(ok)), ok).toBe(false);
    }
  });

  it('Explore sources, the town / train data and the certificate copy are clean', async () => {
    const dir = join(ROOT, 'src', 'explore');
    for (const f of readdirSync(dir)) clean(readFileSync(join(dir, f), 'utf8'), f);
    for (const f of ['town.json', 'train.json']) clean(readFileSync(join(ROOT, 'public', 'models', f), 'utf8'), f);
    const { CERTIFICATE_TEXT, BARKEEP_TEXT, INTERVIEW_DRAFT } = await import('../src/explore/case-files.js');
    expect(CERTIFICATE_TEXT).toBe("Every case on Byte Island is closed, deputy. Umer's ready to ride with your team.");
    for (const t of [CERTIFICATE_TEXT, BARKEEP_TEXT, INTERVIEW_DRAFT]) expect(scanText(t)).toEqual([]);
  });

  it('the built Explore chunks carry no phone number or email address', async () => {
    const { outputs } = await buildSite();
    const chunks = outputs.filter((o) => o.type === 'chunk' && /^assets\/(explore|case-files|train|fireworks|hud|config)-/.test(o.fileName));
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    for (const ch of chunks) clean(ch.code, ch.fileName);
  }, 180_000);
});
