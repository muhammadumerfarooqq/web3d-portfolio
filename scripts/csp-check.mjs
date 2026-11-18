// P4: verify the production CSP locally. Serves dist/ with `vite preview` (which sends the vercel.json
// headers, see scripts/dev-api.mjs) and drives the installed Google Chrome (playwright-core, channel
// "chrome"; nothing is downloaded) through: Classic with the first-visit opening, sound on, a project
// video playing, the contact form with Turnstile, then Explore on WebGPU and on WebGL2 (Draco/WASM in a
// Blob worker, audio). Every `securitypolicyviolation` and CSP console error is collected.
//   npm run build   then   node scripts/csp-check.mjs
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const server = await preview({ preview: { port: 4179, strictPort: true }, logLevel: 'error' });
const base = 'http://localhost:4179';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const results = [];

async function session(name, { storage = {}, session: sess = {} } = {}, run) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 800 } });
  await context.addInitScript(
    ({ storage, sess }) => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.effectiveDirective} ← ${e.blockedURI || 'inline'} (${e.sourceFile ?? ''}:${e.lineNumber ?? ''})`));
      try {
        for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
        for (const [k, v] of Object.entries(sess)) sessionStorage.setItem(k, v);
      } catch {
        /* ignore */
      }
    },
    { storage, sess },
  );
  const page = await context.newPage();
  const console_ = [];
  // Only OUR policy counts: the Turnstile iframe is Cloudflare's document with Cloudflare's own CSP, and
  // its internal console messages are not violations of this site's policy.
  page.on('console', (m) => {
    const text = m.text();
    const ours = !/hagen\.challenges|brunhild\.challenges/.test(text);
    if (ours && /Content.Security.Policy|Refused to/i.test(text) && !m.location()?.url?.startsWith('https://challenges.cloudflare.com')) console_.push(text.slice(0, 240));
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  const notes = {};
  try {
    await run(page, notes);
  } catch (error) {
    notes.error = String(error).slice(0, 200);
  }
  const violations = await page.evaluate(() => window.__csp).catch(() => ['(page gone)']);
  results.push({ name, violations, console: console_, pageErrors: errors, ...notes });
  await context.close();
}

const res = await fetch(`${base}/`);
const csp = res.headers.get('content-security-policy');
console.log('CSP header served:', Boolean(csp), '| COOP:', res.headers.get('cross-origin-opener-policy'));

await session('classic: opening + sound + video + contact form', {}, async (page, notes) => {
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForTimeout(5000); // the opening plays
  const cont = page.locator('[data-start-continue]');
  if (await cont.isVisible().catch(() => false)) await cont.click();
  await page.waitForFunction(() => document.documentElement.dataset.motion === 'ready', null, { timeout: 20000 });
  notes.soundOn = await page.evaluate(() => {
    const b = document.querySelector('[data-sound-toggle]');
    b?.click();
    return Boolean(b);
  });
  // a project video (media-src): open the APEX case and play its clip
  const open = page.locator('[data-project="ae-car-edit"] [data-project-open]');
  if (await open.count()) {
    await open.scrollIntoViewIfNeeded();
    await open.evaluate((el) => el.click());
    await page.waitForSelector('dialog[open] video', { timeout: 10000 });
    notes.videoPlayed = await page.evaluate(async () => {
      const v = document.querySelector('dialog[open] video');
      v.muted = true;
      await v.play();
      await new Promise((r) => setTimeout(r, 1500));
      const t = v.currentTime;
      v.pause();
      return t > 0.2;
    });
    await page.keyboard.press('Escape');
  }
  // the contact form: lazy chunk, then Turnstile
  await page.locator('#contact').scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await page.locator('[data-contact-form]').scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(6000);
  notes.formVisible = await page.locator('[data-contact-form]').isVisible();
  notes.turnstileFrame = page.frames().some((f) => f.url().startsWith('https://challenges.cloudflare.com/'));
  notes.tokenEndpoint = await page.evaluate(async () => (await fetch('/api/contact-token')).status);
  // P5: the Ask my AI panel (lazy chat chunk + its Turnstile widget)
  await page.locator('#chat').scrollIntoViewIfNeeded();
  await page.waitForTimeout(4000);
  notes.chatPanelVisible = await page.locator('[data-chat-panel]').isVisible();
  notes.chatEndpoint = await page.evaluate(async () => (await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"message":"hi there","session":""}' })).status);
});

for (const backend of process.argv.includes('--classic-only') ? [] : ['webgpu', 'webgl']) {
  await session(`explore: ${backend}`, { storage: { intro: 'seen', mode: 'explore', sound: 'on', 'explore.tutorial': 'done' }, session: { intro: 'seen', 'explore.arrival': 'seen' } }, async (page, notes) => {
    await page.goto(`${base}/?debug=1${backend === 'webgl' ? '&backend=webgl' : ''}`, { waitUntil: 'load' });
    const cont = page.locator('[data-start-continue]');
    await page.waitForTimeout(1500);
    if (await cont.isVisible().catch(() => false)) await cont.click();
    await page.waitForFunction(() => window.__explore?.ready, null, { timeout: 90000 });
    await page.waitForTimeout(4000);
    notes.backend = await page.evaluate(() => window.__explore.backend);
    // P5: the Saloon case file shows the same chat
    await page.evaluate(() => window.__exploreDebug?.open('chat'));
    await page.waitForTimeout(4000);
    notes.saloonChatVisible = await page.locator('dialog[open] [data-chat-panel]').isVisible().catch(() => false);
  });
}

await browser.close();
await server.close();
console.log(JSON.stringify(results, null, 1));
const bad = results.filter((r) => r.violations.length || r.console.length);
console.log(bad.length ? `CSP VIOLATIONS in ${bad.length} session(s)` : 'zero CSP violations');
process.exitCode = bad.length ? 1 : 0;
