// P9.3 promo footage driver. Starts the Vite DEV server (capture mode exists only there), drives the
// installed Google Chrome through playwright-core (channel "chrome"; no browser download) and writes
// frame-perfect PNG sequences:
//   node scripts/capture/capture.mjs --preview [F1 F3 …]   960×540, every frame, + an MP4 preview in
//        aftereffects/footage/previews/ and a contact sheet in docs/promo/contact/<ID>.jpg
//   node scripts/capture/capture.mjs --final [F1 …]        3840×2160 PNG sequences in aftereffects/footage/<ID>/
//   node scripts/capture/capture.mjs --verify F4 [--frames 12]   the same shot twice at preview size; per-frame
//        SHA-256 must match (docs/promo/determinism.json)
//   node scripts/capture/capture.mjs --probe views.json    authoring aid: still frames from given cameras
// Explore shots (F1–F4, F6–F8, F10) use ?capture=<ID> (src/explore/capture-mode.js); the browser
// shots (F5, F9) script the Classic page under Playwright's fake clock (scripts/capture/browser-shots.mjs).
// Footage, previews and timings: docs/promo/capture-report.json (small, committed); frames are not.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { BROWSER_SHOTS, runBrowserShot } from './browser-shots.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const SPEC = JSON.parse(readFileSync(join(ROOT, 'docs', 'promo', 'shots.json'), 'utf8'));
const FOOTAGE = join(ROOT, 'aftereffects', 'footage');
const REPORT = join(ROOT, 'docs', 'promo', 'capture-report.json');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const mode = flag('final') ? 'final' : flag('verify') ? 'verify' : flag('probe') ? 'probe' : 'preview';
const ids = args.filter((a) => /^F\d{1,2}$/.test(a));
const ALL = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10'];
const size = mode === 'final' ? SPEC.final : SPEC.preview;

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const pad = (n) => String(n).padStart(4, '0');
const dirSize = (dir) => (existsSync(dir) ? readdirSync(dir).reduce((s, f) => s + statSync(join(dir, f)).size, 0) : 0);

/** Chrome with WebGPU on the discrete GPU (hybrid laptops pick per run otherwise). */
async function launch() {
  return chromium.launch({
    channel: 'chrome',
    headless: !flag('headed'),
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--force_high_performance_gpu', '--hide-scrollbars', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--mute-audio'],
  });
}

async function startVite() {
  const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.js'), logLevel: 'error', server: { port: Number(value('port', 5181)), strictPort: false, host: '127.0.0.1' } });
  await server.listen();
  const url = server.resolvedUrls.local[0].replace(/\/$/, '');
  return { server, url };
}

/** Storage a returning visitor in this session would have: no intro, no arrival, no tutorial, no sound. */
const INIT_STORAGE = () => {
  try {
    sessionStorage.setItem('intro', 'seen');
    sessionStorage.setItem('explore.arrival', 'seen');
    localStorage.setItem('intro', 'seen');
    localStorage.setItem('mode', 'explore');
    localStorage.setItem('sound', 'off');
    localStorage.setItem('explore.tutorial', 'done');
  } catch {
    /* storage blocked: capture mode writes its own prefs */
  }
};

async function openExploreShot(browser, url, id, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'no-preference', colorScheme: 'dark' });
  await context.addInitScript(INIT_STORAGE);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (flag('verbose')) console.log(`  [page] ${m.text()}`);
  });
  await page.goto(`${url}/?capture=${id}`, { waitUntil: 'domcontentloaded' });
  // The start screen (returning visitor): Continue enters Explore.
  const cont = page.locator('[data-start-continue]');
  try {
    await cont.waitFor({ state: 'visible', timeout: 15000 });
    await cont.click();
  } catch {
    /* no start screen */
  }
  await page.waitForFunction(() => window.__capture !== undefined, null, { timeout: 120000 });
  const ready = await page.evaluate(() => window.__capture.ready);
  return { context, page, ready, errors };
}

async function captureExplore(browser, url, id, outDir, { frames = null } = {}) {
  const t0 = Date.now();
  const { context, page, ready, errors } = await openExploreShot(browser, url, id, { width: size.width, height: size.height });
  if (ready.width !== size.width || ready.height !== size.height) throw new Error(`${id}: canvas ${ready.width}×${ready.height}, expected ${size.width}×${size.height}`);
  const tReady = Date.now();
  if (outDir) mkdirSync(outDir, { recursive: true });
  const n = frames ?? ready.frames;
  const hashes = [];
  // Screenshots straight from the compositor surface over the DevTools protocol (a 4K frame through
  // page.screenshot() can time out under memory pressure); one retry per frame.
  const cdp = await context.newCDPSession(page);
  const grab = async () => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })).data, 'base64');
  for (let i = 0; i < n; i += 1) {
    await page.evaluate(() => window.__capture.step());
    const file = outDir ? join(outDir, `${id}_${pad(i)}.png`) : null;
    if (file && flag('resume') && existsSync(file)) {
      hashes.push(sha(readFileSync(file)));
      continue;
    }
    let png;
    try {
      png = await grab();
    } catch (error) {
      console.warn(`  ${id} frame ${i}: ${error.message}; retrying`);
      png = await grab();
    }
    hashes.push(sha(png));
    if (file) writeFileSync(file, png);
    if (i % 24 === 0) process.stdout.write(`  ${id} ${i}/${n}\r`);
  }
  const info = await page.evaluate(() => window.__capture.info());
  await context.close();
  return { id, frames: n, width: size.width, height: size.height, loadSeconds: +((tReady - t0) / 1000).toFixed(1), renderSeconds: +((Date.now() - tReady) / 1000).toFixed(1), hashes, info, errors };
}

function ffmpeg(argv) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...argv], { stdio: 'inherit' });
}

function previewOutputs(id, dir, frames) {
  const previews = join(FOOTAGE, 'previews');
  mkdirSync(previews, { recursive: true });
  ffmpeg(['-framerate', '24', '-i', join(dir, `${id}_%04d.png`), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', join(previews, `${id}.mp4`)]);
  // contact sheet: 12 evenly spaced frames, 4 × 3 tiles of 320 × 180, small JPG (committed)
  const contact = join(ROOT, 'docs', 'promo', 'contact');
  mkdirSync(contact, { recursive: true });
  const every = Math.max(1, Math.floor(frames / 12));
  ffmpeg(['-i', join(dir, `${id}_%04d.png`), '-vf', `select='not(mod(n\\,${every}))',scale=320:180,tile=4x3:padding=4:color=0x231C15`, '-frames:v', '1', '-q:v', '5', join(contact, `${id}.jpg`)]);
}

function readReport() {
  try {
    return JSON.parse(readFileSync(REPORT, 'utf8'));
  } catch {
    return { note: 'Written by scripts/capture/capture.mjs. Frames themselves are not committed (aftereffects/footage/ is git-ignored).', preview: {}, final: {} };
  }
}

async function main() {
  const { server, url } = await startVite();
  const browser = await launch();
  try {
    if (mode === 'probe') {
      const views = JSON.parse(readFileSync(value('probe'), 'utf8'));
      const out = value('out', join(ROOT, 'aftereffects', 'footage', 'probe'));
      mkdirSync(out, { recursive: true });
      const { context, page } = await openExploreShot(browser, url, 'probe', { width: Number(value('w', 960)), height: Number(value('h', 540)) });
      for (const v of views) {
        await page.evaluate((x) => {
          if (x.teleport) window.__capture.teleport(...x.teleport);
          window.__capture.look(x.position, x.lookAt, x.fov ?? 40, x.t);
        }, v);
        for (let i = 0; i < (v.steps ?? 3); i += 1) await page.evaluate(() => window.__capture.step());
        await page.screenshot({ path: join(out, `${v.name}.png`), type: 'png' });
        console.log(v.name, JSON.stringify(await page.evaluate(() => window.__capture.info())));
      }
      await context.close();
      return;
    }
    if (mode === 'verify') {
      const id = ids[0] ?? 'F4';
      const n = Number(value('frames', 12));
      const runs = [];
      for (let r = 0; r < 2; r += 1) {
        if (BROWSER_SHOTS[id]) {
          // browser shots run their whole script; every frame is compared
          const dir = join(FOOTAGE, 'verify', `${id}-${r}`);
          rmSync(dir, { recursive: true, force: true });
          runs.push(await runBrowserShot(browser, url, id, dir, { size, final: false }));
        } else runs.push(await captureExplore(browser, url, id, null, { frames: n }));
      }
      const frames = runs[0].hashes.length;
      const same = runs[0].hashes.map((h, i) => h === runs[1].hashes[i]);
      const result = { shot: id, frames, size: `${size.width}x${size.height}`, identical: same.every(Boolean), matchingFrames: same.filter(Boolean).length, runA: runs[0].hashes, runB: runs[1].hashes, date: new Date().toISOString().slice(0, 10) };
      if (BROWSER_SHOTS[id]) {
        // Browser shots: per-frame PSNR between the runs (ffmpeg), the measured tolerance.
        const a = join(FOOTAGE, 'verify', `${id}-0`);
        const b = join(FOOTAGE, 'verify', `${id}-1`);
        const stats = join(FOOTAGE, 'verify', 'psnr.txt');
        execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', join(a, `${id}_%04d.png`), '-i', join(b, `${id}_%04d.png`), '-lavfi', `[0]format=gbrp[x];[1]format=gbrp[y];[x][y]psnr=stats_file=${stats.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\\\:')}`, '-f', 'null', '-']);
        const values = readFileSync(stats, 'utf8').trim().split('\n').map((l) => /psnr_avg:(\S+)/.exec(l)[1]).map((v) => (v === 'inf' ? Infinity : Number(v)));
        const finite = values.filter(Number.isFinite);
        result.psnrDb = { min: +Math.min(...finite, 99).toFixed(2), worstFrame: values.indexOf(Math.min(...finite, 99)), framesBelow40: finite.filter((v) => v < 40).length };
        rmSync(join(FOOTAGE, 'verify'), { recursive: true, force: true });
      }
      const file = join(ROOT, 'docs', 'promo', 'determinism.json');
      let all;
      try {
        all = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        all = {};
      }
      if (!all.shots) all = { note: 'scripts/capture/capture.mjs --verify <ID>: the same shot captured twice at preview size; per-frame SHA-256 of the PNGs.', shots: {} };
      all.shots[id] = result;
      writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`);
      console.log(`verify ${id}: ${result.matchingFrames}/${frames} frames identical`);
      return;
    }
    const report = readReport();
    for (const id of ids.length ? ids : ALL) {
      const outDir = mode === 'final' ? join(FOOTAGE, id) : join(FOOTAGE, 'previews', id);
      if (!flag('resume')) rmSync(outDir, { recursive: true, force: true });
      console.log(`${id} (${mode} ${size.width}×${size.height})`);
      const r = BROWSER_SHOTS[id] ? await runBrowserShot(browser, url, id, outDir, { size, final: mode === 'final' }) : await captureExplore(browser, url, id, outDir);
      if (mode === 'preview') previewOutputs(id, outDir, r.frames);
      const bytes = dirSize(outDir);
      report[mode][id] = { frames: r.frames, size: `${r.width}x${r.height}`, loadSeconds: r.loadSeconds, renderSeconds: r.renderSeconds, secondsPerFrame: +(r.renderSeconds / r.frames).toFixed(2), megabytes: +(bytes / 1e6).toFixed(1), firstFrameSha256: r.hashes[0], lastFrameSha256: r.hashes.at(-1), errors: r.errors.length, date: new Date().toISOString().slice(0, 10) };
      console.log(`  ${id}: ${r.frames} frames in ${r.renderSeconds}s (+${r.loadSeconds}s load), ${(bytes / 1e6).toFixed(1)} MB${r.errors.length ? `, ${r.errors.length} page errors: ${r.errors.slice(0, 3).join(' | ')}` : ''}`);
      writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
