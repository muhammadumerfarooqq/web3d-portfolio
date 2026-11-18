// P11 E3: performance budget numbers from the production build. `npm run build` first, then
// `node scripts/qa/budget.mjs [--write]`. Reports (gzip sizes, as a browser downloads them):
//   - Classic entry = main script + its static imports (budget: at most +5 KB over the P3.2 baseline of 79,170 B)
//   - Explore = the lazy chunk and its static imports (budget: 350 KB gz in total, three.js included)
//   - the chat chunk (voice included) and the shared Turnstile chunk (both lazy)
//   - the CSS and the fonts the first Classic view downloads, image and media weights
//   - the TOTAL a first visit to Classic transfers, measured in real Chrome (vite preview, every response gzip-sized)
// --write saves docs/reports/performance-budget.md. Exit code 1 when a budget is exceeded.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const ROOT = join(import.meta.dirname, '..', '..');
const DIST = join(ROOT, 'dist');
const BASELINE = 79170;
const gz = (file) => gzipSync(readFileSync(file)).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const assets = readdirSync(join(DIST, 'assets'));
const find = (prefix, ext = '.js') => assets.find((f) => f.startsWith(`${prefix}-`) && f.endsWith(ext));

/** A chunk plus everything it imports statically (dynamic import() is not followed: it is lazy). */
function closure(entry) {
  const seen = new Set();
  const walk = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const code = readFileSync(join(DIST, 'assets', name), 'utf8');
    for (const m of code.matchAll(/(?:^|[;}\s])(?:import|export)\s*(?:[^'"()]*?from\s*)?["']\.\/([^"']+\.js)["']/g)) walk(m[1]);
  };
  walk(entry);
  return [...seen];
}
const total = (names) => names.reduce((n, f) => n + gz(join(DIST, 'assets', f)), 0);

const main = find('main');
const mainSet = closure(main);
const explore = find('explore');
const exploreSet = closure(explore);
const chat = find('chat');
const turnstile = find('turnstile');
const css = assets.filter((f) => f.endsWith('.css'));
const rows = [
  ['Classic entry (main + static imports)', total(mainSet), `${mainSet.length} file(s); baseline ${BASELINE} B, growth ${total(mainSet) - BASELINE} B, budget +5,120 B`],
  ['Explore (lazy; chunk + static imports incl. three.js)', total(exploreSet), `${exploreSet.length} file(s); budget 350 KB (${kb(350 * 1024)})`],
  ['Explore chunk alone', gz(join(DIST, 'assets', explore)), 'the app code without three.js'],
  ['Chat chunk (lazy: chat + voice + schema)', gz(join(DIST, 'assets', chat)), 'loads when the Ask my AI section nears the viewport'],
  ['Turnstile chunk (lazy, shared by contact and chat)', gz(join(DIST, 'assets', turnstile)), ''],
  ...css.map((f) => [`CSS ${f.replace(/-[\w-]{8}\.css$/, '.css')}`, gz(join(DIST, 'assets', f)), '']),
];

const dirSize = (dir, filter = () => true) => {
  let n = 0;
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (filter(p)) {
        n += statSync(p).size;
        files.push([p.slice(ROOT.length + 1).replace(/\\/g, '/'), statSync(p).size]);
      }
    }
  };
  walk(dir);
  return { n, files: files.sort((a, b) => b[1] - a[1]) };
};
const images = dirSize(join(DIST, 'images'));
const models = dirSize(join(DIST, 'models'));
const media = dirSize(join(DIST, 'media'));
const videos = dirSize(join(DIST, 'video'));

// First visit to Classic in real Chrome: every response, sized as gzip for text and raw for binary.
const server = await preview({ preview: { port: 4185, strictPort: true }, logLevel: 'error' });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1366, height: 800 } });
await context.addInitScript(() => {
  localStorage.setItem('mode', 'classic');
  localStorage.setItem('theme', 'dark');
  localStorage.setItem('intro', 'seen');
  sessionStorage.setItem('intro', 'seen');
});
const page = await context.newPage();
const seen = new Map();
page.on('response', async (res) => {
  const url = new URL(res.url());
  if (url.origin !== 'http://localhost:4185') return;
  try {
    const body = await res.body();
    const text = /\.(js|css|html|svg|json|vtt|xml|txt)$/.test(url.pathname) || url.pathname === '/';
    seen.set(url.pathname, [(text ? gzipSync(body).length : body.length), res.request().resourceType()]);
  } catch {
    /* redirect or aborted */
  }
});
await page.goto('http://localhost:4185/', { waitUntil: 'load' });
await page.waitForTimeout(2500);
const cont = page.locator('[data-start-continue]');
if (await cont.isVisible().catch(() => false)) await cont.click();
await page.waitForTimeout(2500);
const firstViewBytes = [...seen.values()].reduce((n, [b]) => n + b, 0);
const firstViewCount = seen.size;
const beforeScroll = new Set(seen.keys());
// scroll the whole page once (lazy images, chat chunk, contact form, Turnstile)
await page.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += 700) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 120));
  }
});
await page.waitForTimeout(4000);
const afterBytes = [...seen.values()].reduce((n, [b]) => n + b, 0);
const exploreLoaded = [...seen.keys()].some((k) => /explore-|three\./.test(k));
await browser.close();
await server.close();

const byType = {};
for (const [, [b, t]] of seen) byType[t] = (byType[t] ?? 0) + b;
const sizeOfPrefix = (p) => [...seen.entries()].filter(([k]) => k.startsWith(p)).reduce((n, [, [b]]) => n + b, 0);

const budgets = [
  ['Classic entry growth ≤ 5 KB over the P3.2 baseline', total(mainSet) - BASELINE <= 5120],
  ['Explore + three.js ≤ 350 KB gz', total(exploreSet) <= 350 * 1024],
  ['Explore code is NOT downloaded by a Classic visit', !exploreLoaded],
];
console.log('\nBUNDLES (gzip)');
for (const [name, bytes, note] of rows) console.log(`  ${kb(bytes).padStart(9)}  ${name}${note ? `  (${note})` : ''}`);
console.log(`\nIMAGES / MEDIA (as stored)\n  images ${kb(images.n)} in ${images.files.length} files, largest: ${images.files.slice(0, 3).map(([f, s]) => `${f.split('/').pop()} ${kb(s)}`).join(', ')}\n  models ${kb(models.n)} (Explore only), media ${kb(media.n)}, project videos ${kb(videos.n)}`);
console.log(`\nFIRST VISIT TO CLASSIC (real Chrome, gzip text): first view ${kb(firstViewBytes)} in ${firstViewCount} requests; after scrolling the whole page ${kb(afterBytes)} in ${seen.size} requests`);
console.log(`  by type: ${Object.entries(byType).map(([t, b]) => `${t} ${kb(b)}`).join(', ')}; fonts (woff2 + woff) ${kb(sizeOfPrefix('/assets/') && [...seen.entries()].filter(([k]) => /\.woff2?$/.test(k)).reduce((n, [, [b]]) => n + b, 0))}`);
for (const [name, ok] of budgets) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);

if (process.argv.includes('--write')) {
  const date = new Date().toISOString().slice(0, 10);
  const L = [
    '# Performance budget (P11 E3)',
    '',
    `Measured on ${date} by \`node scripts/qa/budget.mjs --write\` on the production build (\`vite build\`), gzip sizes as a browser downloads them. The first-visit numbers come from real Chrome against \`vite preview\` (which does not compress, so text is gzip-sized afterwards; Vercel serves brotli/gzip, so real transfer is the same or smaller).`,
    '',
    '## Bundles',
    '',
    '| Item | Size (gzip) | Note |',
    '|---|---|---|',
    ...rows.map(([n, b, note]) => `| ${n} | ${kb(b)} (${b.toLocaleString('en')} B) | ${note} |`),
    '',
    '## Budgets',
    '',
    '| Budget | Result |',
    '|---|---|',
    ...budgets.map(([n, ok]) => `| ${n} | ${ok ? 'PASS' : '**FAIL**'} |`),
    '',
    '## Images and media (stored size, not gzip: they are already compressed)',
    '',
    `- Images in \`public/images\`: ${kb(images.n)} in ${images.files.length} files. Largest: ${images.files.slice(0, 5).map(([f, s]) => `\`${f.split('/').pop()}\` ${kb(s)}`).join(', ')}. Cards use 800 px WebP with a 1600 px \`srcset\` and \`loading="lazy"\`.`,
    `- 3D models (Explore only, never loaded by Classic): ${kb(models.n)}. Promo film + poster + captions: ${kb(media.n)} (\`preload="none"\`). Project videos: ${kb(videos.n)} (\`preload="none"\`).`,
    '',
    '## What a first visit to Classic transfers',
    '',
    `- First view (page load + opening dismissed): **${kb(firstViewBytes)}** in ${firstViewCount} requests.`,
    `- After scrolling the whole page once (lazy images, the chat chunk, the contact form and Turnstile's local chunk): **${kb(afterBytes)}** in ${seen.size} requests.`,
    `- By type: ${Object.entries(byType).map(([t, b]) => `${t} ${kb(b)}`).join(', ')}.`,
    `- Explore, three.js and the models are ${exploreLoaded ? '**downloaded (unexpected)**' : 'not downloaded by a Classic visit'}.`,
    '- Third-party requests are not counted here: the only one is Cloudflare Turnstile (~40 KB), loaded only when the contact form or the chat panel is on screen.',
    '',
    'Not measured here: Lighthouse scores (see `docs/reports/lighthouse.md`).',
  ];
  writeFileSync(join(ROOT, 'docs', 'reports', 'performance-budget.md'), L.join('\n') + '\n');
  console.log('wrote docs/reports/performance-budget.md');
}
process.exitCode = budgets.every(([, ok]) => ok) ? 0 : 1;
