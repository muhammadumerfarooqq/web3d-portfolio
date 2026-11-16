// P3.4b: the opening and the boat arrival play once per browser SESSION (sessionStorage) and ?replay=1
// forces them; neither can be silently skipped by a load-order race or a stale flag; the system cursor
// is always visible in Explore (a centre dot while pointer-locked).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootPlan, introSeenThisSession, readIntroSession, replayRequested, writeIntro, writeIntroSession } from '../src/ui/boot-rules.js';

const ROOT = join(import.meta.dirname, '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
}

describe('the opening: once per session, ?replay=1 forces it', () => {
  it('a new session plays it, the same session skips it, and the old localStorage flag never blocks it', () => {
    const local = memoryStorage({ intro: 'seen' }); // seen in an earlier session
    const session = memoryStorage();
    expect(bootPlan({ introSeen: introSeenThisSession({ session, replay: false }) }).showIntro).toBe(true);
    writeIntroSession('seen', session);
    writeIntro('seen', local); // still written and whitelisted
    expect(readIntroSession(session)).toBe('seen');
    expect(bootPlan({ introSeen: introSeenThisSession({ session, replay: false }) }).showIntro).toBe(false);
    expect(bootPlan({ introSeen: introSeenThisSession({ session: memoryStorage(), replay: false }) }).showIntro).toBe(true);
  });

  it('?replay=1 (only that exact value) forces it; hostile session values count as unseen', () => {
    const session = memoryStorage({ intro: 'seen' });
    expect(introSeenThisSession({ session, replay: true })).toBe(false);
    expect(replayRequested('?replay=1')).toBe(true);
    expect(replayRequested('?debug=1&replay=1')).toBe(true);
    for (const bad of ['', '?replay=0', '?replay=true', '?replay=1x', '?REPLAY=1']) expect(replayRequested(bad), bad).toBe(false);
    for (const bad of ['SEEN', 'yes', '<img src=x onerror=alert(1)>']) expect(introSeenThisSession({ session: memoryStorage({ intro: bad }), replay: false })).toBe(false);
    expect(introSeenThisSession({ session: null, replay: false })).toBe(false); // storage blocked: a new session
  });

  it('start.js owns the boot layer, waits for a visible tab and the fonts, pauses while hidden, and marks it seen only when done', () => {
    const start = strip(read('src', 'ui', 'start.js'));
    expect(start).toMatch(/bootPlan\(\{ introSeen: introSeenThisSession\(\)/);
    expect(start).toMatch(/root\.dataset\.boot = plan\.showIntro \? 'intro' : 'start';/);
    expect(start).toMatch(/gsap\.timeline\(\{ onComplete: onDone, paused: true \}\)/);
    expect(start).toMatch(/whenReady\(\)\.then\(\(\) => \{\s*if \(!finished && document\.visibilityState !== 'hidden'\) player\.play\(\);/);
    expect(start).toMatch(/if \(document\.visibilityState === 'hidden'\) player\.pause\(\);/);
    expect(start).toMatch(/document\.fonts\?\.ready \?\? Promise\.resolve\(\), new Promise\(\(r\) => setTimeout\(r, 1500\)\)/);
    const done = start.slice(start.indexOf('const done = () =>'), start.indexOf('const onKey'));
    expect(done).toMatch(/writeIntroSession\('seen'\);\s*writeIntro\('seen'\);/);
    // the only other write is the reduced-motion static card, shown at once
    expect((start.match(/writeIntroSession\('seen'\)/g) ?? []).length).toBe(2);
  });

  it('theme-init.js mirrors the rule before first paint (sessionStorage + ?replay=1)', () => {
    const init = read('public', 'theme-init.js');
    expect(init).toMatch(/introSeen = !replay && window\.sessionStorage\.getItem\('intro'\) === 'seen';/);
    expect(init).toMatch(/\/\(\?:\^\\\?\|&\)replay=1\(\?:&\|\$\)\/\.test\(window\.location\.search\)/);
    expect(init).not.toMatch(/localStorage\.getItem\('intro'\)/);
  });
});

describe('the boat arrival: once per session, ?replay=1 forces it, no stale flag', () => {
  const index = strip(read('src', 'explore', 'index.js'));

  it('reads the session flag (and REPLAY), writes it only when the arrival finished or was skipped', () => {
    expect(index).toMatch(/import \{ REPLAY \} from '\.\.\/ui\/boot-rules\.js';/);
    expect(index).toMatch(/const arrivalSeenThisSession = \(\) => !REPLAY && readPref\(ARRIVAL_KEY, ARRIVAL_VALUES, null, session\) === 'seen';/);
    expect(index).toMatch(/if \(!arrivalSeenThisSession\(\)\) runArrival\(true\);/);
    const markers = index.match(/markArrivalSeen\(\)/g) ?? [];
    expect(markers.length).toBe(1); // onDone only
    const failure = index.slice(index.indexOf("console.warn('[explore] arrival'"), index.indexOf("console.warn('[explore] arrival'") + 200);
    expect(failure).not.toMatch(/writePref|markArrivalSeen/); // a failed load is not "seen"
  });

  it('a key still held from loading (auto-repeat) cannot skip it', () => {
    expect(strip(read('src', 'explore', 'arrival.js'))).toMatch(/if \(SKIP_IGNORE\.includes\(e\.key\) \|\| e\.repeat\) return;/);
  });
});

describe('the cursor in Explore', () => {
  it('the Classic ring stands down in Explore (system cursor visible), with a CSS safety net', () => {
    const cursor = strip(read('src', 'ui', 'cursor.js'));
    expect(cursor).toMatch(/const inExplore = \(\) => root\.dataset\.mode === 'explore';/);
    expect(cursor).toMatch(/if \(inExplore\(\)\) \{\s*standDown\(\);\s*return;/);
    expect(cursor).toMatch(/if \(event\.detail\?\.mode === 'explore'\) standDown\(\);/);
    const css = read('src', 'styles', 'main.css');
    expect(css).toMatch(/html\.has-cursor\[data-mode='explore'\] \*\s*\{\s*cursor: auto !important;/);
  });

  it('pointer-lock look shows a small centre dot, hidden otherwise; Explore itself never hides the cursor', () => {
    const hud = strip(read('src', 'explore', 'hud.js'));
    expect(hud).toMatch(/const crosshair = el\('span', \{ class: 'xp-crosshair', 'aria-hidden': 'true' \}\);\s*crosshair\.hidden = true;/);
    expect(hud).toMatch(/setPointerLock\(on\) \{\s*crosshair\.hidden = !on;/);
    expect(read('src', 'explore', 'index.js')).toMatch(/onPointerLock: \(on\) => \{\s*hud\.setPointerLock\(on\);/);
    const css = strip(read('src', 'explore', 'explore.css'));
    expect(css).toMatch(/\.xp-crosshair\[hidden\]\s*\{\s*display: none;/);
    expect(css).not.toMatch(/cursor:\s*none/);
  });
});
