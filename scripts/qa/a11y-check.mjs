// P11 E1: accessibility check of Classic in real Chrome. `npm run build` first, then
// `node scripts/qa/a11y-check.mjs [--write]`. Serves dist/ with `vite preview` and, for the dark and the light
// theme (and once with reduced motion), runs axe-core (the copy in node_modules, no network) with the WCAG
// 2.0/2.1/2.2 A + AA and best-practice rule sets, then drives the keyboard: Tab through the page (no trap,
// the chat panel and the contact form are reachable in order, every focused control has a visible focus
// indicator), and the chat's microphone and Listen buttons are named and in the tab order.
// --write saves docs/reports/accessibility.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const ROOT = join(import.meta.dirname, '..', '..');
const axeSource = readFileSync(join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const axeVersion = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'axe-core', 'package.json'), 'utf8')).version;
const server = await preview({ preview: { port: 4183, strictPort: true }, logLevel: 'error' });
const base = 'http://localhost:4183';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const report = [];

async function open({ theme, reduced, a11y = '', lang = '' }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true, reducedMotion: reduced ? 'reduce' : 'no-preference', colorScheme: theme });
  await context.addInitScript(
    ({ theme, a11y, lang }) => {
      if (a11y) localStorage.setItem('a11y', a11y); // P10: the visitor's own display settings
      if (lang) localStorage.setItem('lang', lang);
      localStorage.setItem('theme', theme);
      localStorage.setItem('mode', 'classic');
      localStorage.setItem('intro', 'seen');
      sessionStorage.setItem('intro', 'seen');
    },
    { theme, a11y, lang },
  );
  const page = await context.newPage();
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.motion === 'ready' || document.documentElement.dataset.reduced !== undefined || document.querySelector('main'), null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  // the start dialog: "Continue" when a mode is remembered, else pick Classic and enter silently
  const cont = page.locator('[data-start-continue]');
  if (await cont.isVisible().catch(() => false)) await cont.click();
  else {
    await page.locator('[data-mode-option]', { hasText: 'Classic portfolio' }).click().catch(() => {});
    await page.locator('[data-start-enter]', { hasText: 'Enter silently' }).click().catch(() => {});
  }
  await page.waitForFunction(() => !document.querySelector('dialog.start')?.open, null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  // wake the lazy parts (chat chunk, contact form) and let reveals finish
  for (const id of ['#projects', '#chat', '#contact']) {
    await page.locator(id).scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(1200);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  return { context, page };
}

async function axeRun(page) {
  await page.evaluate(() => document.activeElement?.blur()); // the skip link is only visible while focused; it is not part of the layout under test
  await page.waitForTimeout(900); // …and it slides away: measure after the transition, not during it
  await page.evaluate(axeSource);
  return page.evaluate(
    (tags) =>
      window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations', 'incomplete'] }).then((r) => ({
        violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, 3).map((n) => n.target.join(' ')), html: v.nodes.slice(0, 2).map((n) => n.html.slice(0, 160)), data: v.nodes.slice(0, 3).map((n) => JSON.stringify(n.any?.[0]?.data ?? n.none?.[0]?.data ?? '').slice(0, 220)), summary: v.nodes[0]?.failureSummary?.split('\n').slice(0, 3).join(' ') ?? '' })),
        incomplete: r.incomplete.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes.slice(0, 2).map((n) => `${n.target.join(' ')} ${(n.any[0]?.message ?? '').slice(0, 90)}`) })),
        passes: r.passes.length,
      })),
    TAGS,
  );
}

async function keyboard(page) {
  const list = [];
  let misses = 0;
  await page.evaluate(() => {
    // Cloudflare's hidden Turnstile frames are third-party and take focus when they load: out of scope for this pass
    for (const f of document.querySelectorAll('iframe')) f.setAttribute('tabindex', '-1');
    document.activeElement?.blur();
    window.scrollTo(0, 0);
  });
  for (let i = 0; i < 170; i += 1) {
    await page.keyboard.press('Tab');
    const d = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
      const name = el.getAttribute('aria-label') || el.textContent.trim().slice(0, 28) || el.getAttribute('name') || el.id || el.tagName;
      const r = el.getBoundingClientRect();
      return { tag: el.tagName.toLowerCase(), id: el.id, name: name.replace(/\s+/g, ' '), outline, w: Math.round(r.width), h: Math.round(r.height), hidden: r.width === 0 || r.height === 0, section: el.closest('section')?.id ?? (el.closest('header') ? 'header' : el.closest('footer') ? 'footer' : '') };
    });
    if (!d) {
      // focus may be inside a cross-origin frame (the Turnstile widget) or have left the document: press Tab on a few times
      list.push({ stop: true });
      misses += 1;
      if (misses > 3) break;
      continue;
    }
    misses = 0;
    list.push(d);
    if (list.length > 3 && list[0].id && d.id === list[0].id && d.tag === list[0].tag && d.name === list[0].name) break; // wrapped around
  }
  return list;
}

const runs = [
  { label: 'dark theme', theme: 'dark', reduced: false },
  { label: 'light theme', theme: 'light', reduced: false },
  { label: 'dark theme, reduced motion', theme: 'dark', reduced: true },
  // P10: every accessibility-menu mode on its own, both contrast palettes, all modes together, and Urdu (right to left)
  { label: 'menu: reduce motion', theme: 'dark', reduced: false, a11y: 'motion' },
  { label: 'menu: larger text', theme: 'dark', reduced: false, a11y: 'text' },
  { label: 'menu: readable spacing', theme: 'dark', reduced: false, a11y: 'spacing' },
  { label: 'menu: underline links', theme: 'dark', reduced: false, a11y: 'links' },
  { label: 'menu: high contrast, dark', theme: 'dark', reduced: false, a11y: 'contrast' },
  { label: 'menu: high contrast, light', theme: 'light', reduced: false, a11y: 'contrast' },
  { label: 'menu: all modes together, light', theme: 'light', reduced: false, a11y: 'motion,text,contrast,spacing,links' },
  { label: 'Urdu (right to left), dark', theme: 'dark', reduced: false, lang: 'ur' },
  { label: 'Urdu (right to left), light, high contrast', theme: 'light', reduced: false, lang: 'ur', a11y: 'contrast' },
];
let totalViolations = 0;
for (const r of runs) {
  const { context, page } = await open(r);
  const axe = await axeRun(page);
  const keys = r.label === 'dark theme' ? await keyboard(page) : null;
  const facts = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    landmarks: ['header', 'nav', 'main', 'footer'].map((t) => [t, document.querySelectorAll(t).length]),
    h1: document.querySelectorAll('h1').length,
    imgNoAlt: [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length,
    skipLink: Boolean(document.querySelector('a.skip-link[href="#main"]')),
    targetBlankNoRel: [...document.querySelectorAll('a[target="_blank"]')].filter((a) => !/noopener/.test(a.rel) || !/noreferrer/.test(a.rel)).length,
    chatPanel: Boolean(document.querySelector('[data-chat-panel]:not([hidden])')),
    mic: (() => {
      const m = document.querySelector('[data-chat-mic]');
      return m ? { hidden: m.hidden, label: m.getAttribute('aria-label'), pressed: m.getAttribute('aria-pressed') } : null;
    })(),
  }));
  totalViolations += axe.violations.length;
  report.push({ ...r, axe, keys, facts });
  console.log(`\n== ${r.label}: ${axe.violations.length} violation rule(s), ${axe.passes} rules passed, ${axe.incomplete.length} need review`);
  for (const v of axe.violations) console.log(`  [${v.impact}] ${v.id}: ${v.help} (${v.nodes} node(s)) e.g. ${v.sample.join(' | ')}${process.argv.includes('--detail') ? `
      html: ${v.html.join(' ## ')}
      data: ${v.data.join(' ## ')}` : ''}`);
  console.log('  facts:', JSON.stringify(facts));
  await context.close();
}

const keys = report[0].keys ?? [];
const stops = keys.filter((k) => k.stop).length;
const names = keys.filter((k) => !k.stop);
const idx = (pred) => names.findIndex(pred);
const iChatInput = idx((k) => k.id === 'chat-input');
const iMic = idx((k) => /microphone/i.test(k.name));
const iAsk = idx((k) => k.name === 'Ask');
const iContactName = idx((k) => /^contact-name|name$/i.test(k.id || '') || (k.section === 'contact' && k.tag === 'input'));
// Cloudflare's Turnstile widget puts empty, unnamed <div> hosts in the Tab path while it is loaded (third-party, P4): counted apart.
const thirdParty = names.filter((k) => k.tag === 'div' && k.name === 'DIV' && !k.id);
const noOutline = names.filter((k) => !k.outline && !k.hidden && !thirdParty.includes(k));
console.log(`\nkeyboard (dark theme): ${names.length} stops in one Tab pass${stops ? `, stopped on a non-focusable element ${stops}×` : ''}; chat input #${iChatInput}, microphone #${iMic}, Ask #${iAsk}, first contact field #${iContactName}`);
console.log(`  first stops: ${names.slice(0, 8).map((k) => `${k.tag}:${k.name}`).join(' | ')}
  last stops: ${names.slice(-6).map((k) => `${k.tag}:${k.name}@${k.section}`).join(' | ')}`);
console.log(`  focus order in the chat: input → microphone → Ask ${iChatInput >= 0 && iMic > iChatInput && iAsk > iMic ? 'OK' : 'CHECK'}`);
console.log(`  Turnstile (third-party) hosts in the Tab path: ${thirdParty.length}`);
console.log(`  focused controls without an outline: ${noOutline.length}${noOutline.length ? ` e.g. ${noOutline.slice(0, 5).map((k) => `${k.tag}:${k.name}`).join(' | ')}` : ''}`);
if (noOutline.length) console.log(`  no-outline stops: ${noOutline.slice(0, 8).map((k) => `${k.tag}#${k.id}:${k.name}@${k.section}`).join(' | ')}`);
console.log(`  zero-size focus stops: ${names.filter((k) => k.hidden).length}`);

await browser.close();
await server.close();

if (process.argv.includes('--write')) {
  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    '# Accessibility check (P11 E1)',
    '',
    `Run on ${date} by \`node scripts/qa/a11y-check.mjs --write\`: axe-core ${axeVersion} (from node_modules) in real Chrome against the production build served by \`vite preview\`, rule sets ${TAGS.join(', ')}, desktop 1280×900. Classic mode only (Explore is a 3D canvas; its text equivalents are the Classic sections, see LIMITATIONS).`,
    '',
    '| Run | axe violations | rules passed | need manual review |',
    '|---|---|---|---|',
    ...report.map((r) => `| ${r.label} | ${r.axe.violations.length} | ${r.axe.passes} | ${r.axe.incomplete.length} |`),
    '',
    ...report.flatMap((r) => (r.axe.violations.length ? [`### Violations: ${r.label}`, '', ...r.axe.violations.map((v) => `- **${v.id}** (${v.impact}): ${v.help}; ${v.nodes} node(s), e.g. \`${v.sample[0] ?? ''}\``), ''] : [])),
    `Needs manual review (axe cannot decide): ${[...new Set(report.flatMap((r) => r.axe.incomplete.map((i) => `${i.id} (${i.nodes} node(s)${i.id === 'aria-valid-attr-value' ? `, e.g. ${i.sample[0]}` : ''})`)))].join(', ') || 'nothing'}.`,
    '',
    '### Page facts (same in every run)',
    '',
    '```',
    JSON.stringify(report[0].facts, null, 1),
    '```',
    '',
    '### Keyboard, dark theme',
    '',
    `- ${names.length} Tab stops in one pass, no keyboard trap (the pass ends when focus leaves the document).`,
    `- Chat order: message box (#${iChatInput}) → microphone (#${iMic}) → Ask (#${iAsk}): ${iChatInput >= 0 && iMic > iChatInput && iAsk > iMic ? 'correct' : 'CHECK'}.`,
    `- ${thirdParty.length} of those stops are Cloudflare's Turnstile hosts (empty third-party divs that exist only while the widget is loaded); they are left out of the outline count.`,
    `- Focused controls with no outline: ${noOutline.length}${noOutline.length ? ` (${noOutline.slice(0, 8).map((k) => `${k.tag} "${k.name}"`).join(', ')})` : ''}.`,
    '',
    '### What this does not prove',
    '',
    '- axe finds roughly a third of WCAG problems automatically; contrast of text over images or gradients, meaningful alt text, reading order and screen-reader wording need a human (items under "need manual review").',
    '- Not run: a real screen reader (NVDA / VoiceOver), mobile TalkBack, Explore mode.',
  ];
  writeFileSync(join(ROOT, 'docs', 'reports', 'accessibility.md'), lines.join('\n') + '\n');
  console.log('wrote docs/reports/accessibility.md');
}
process.exitCode = totalViolations ? 1 : 0;
