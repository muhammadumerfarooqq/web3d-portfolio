// P11 F1: `npm run test:security` runs EVERY tests/security/*.test.js and prints a clear summary: one line per
// file (what it proves, tests passed / failed), the totals and the control IDs covered. Exit code 1 on any failure.
// Extra arguments are passed on to vitest (for example `-- --maxWorkers=2`).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const DIR = join(ROOT, 'tests', 'security');
const files = readdirSync(DIR).filter((f) => f.endsWith('.test.js')).sort();
const WHAT = {
  'p0-baseline.test.js': 'C1-C3: secrets are git-ignored, headers, pinned dependencies, install-script policy',
  'p1-mcp.test.js': 'C4-C5: local MCP tooling (Blender retired, After Effects pinned and local)',
  'p2-foundation.test.js': 'C6: CSP-ready Classic front end (no inline scripts, no CDN)',
  'p2-exit.test.js': 'C6: P2 exit checks',
  'p2-content.test.js': 'C7: content pipeline, no phone number or private email anywhere',
  'p2-gallery.test.js': 'C8: gallery, modal and URL-state hygiene (no HTML sinks)',
  'p3-explore.test.js': 'C9: Explore lazy chunk, case files, budgets and hygiene',
  'p4-contact.test.js': 'C10: contact endpoint, rate limit, header injection, CSP',
  'p5-chat.test.js': 'C11: chat endpoints, sessions, injection and private-data screens, output filter',
  'p6-screen.test.js': 'C11: private-data screen regression set (harmless vs attack prompts)',
  'p6-voice.test.js': 'C12: voice endpoint, audio checks, transcript screens, Permissions-Policy',
  'p7-admin.test.js': 'C14: admin API (login, TOTP, aal2 gate, messages, order), cron secret, no data in the bundle',
  'p10-analytics.test.js': 'C15: privacy-friendly analytics (no IP, no cookies, DNT / GPC, allow-list, daily cap) and the admin Stats gate',
  'p11-hardening.test.js': 'C13: secret scanner, supply chain, live-check and DB audit tooling, crash guard, ReDoS, SSRF, front-end hygiene, SEO',
};

const out = mkdtempSync(join(tmpdir(), 'sec-'));
const json = join(out, 'result.json');
const vitest = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const run = spawnSync(process.execPath, [vitest, 'run', 'tests/security', '--reporter=json', `--outputFile=${json}`, '--maxWorkers=2', ...process.argv.slice(2)], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
let result;
try {
  result = JSON.parse(readFileSync(json, 'utf8'));
} catch {
  console.error('test:security: vitest produced no result (run `npx vitest run tests/security` to see why)');
  process.exit(1);
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log('\nSECURITY TEST SUMMARY\n');
let passed = 0;
let failed = 0;
for (const f of result.testResults.sort((a, b) => a.name.localeCompare(b.name))) {
  const name = relative(DIR, f.name).replace(/\\/g, '/');
  const p = f.assertionResults.filter((t) => t.status === 'passed').length;
  const x = f.assertionResults.filter((t) => t.status === 'failed').length;
  passed += p;
  failed += x;
  console.log(`${x ? 'FAIL' : 'PASS'}  ${name.padEnd(26)} ${String(p).padStart(3)} passed${x ? `, ${x} FAILED` : ''}   ${WHAT[name] ?? ''}`);
  for (const t of f.assertionResults.filter((t) => t.status === 'failed')) console.log(`        x ${t.fullName}`);
}
const missing = files.filter((f) => !result.testResults.some((r) => r.name.endsWith(f)));
if (missing.length) {
  failed += missing.length;
  console.log(`FAIL  not run: ${missing.join(', ')}`);
}
console.log(`\n${result.testResults.length} test files, ${passed + failed} tests: ${passed} passed, ${failed} failed (${((Date.now() - result.startTime) / 1000).toFixed(1)} s)`);
console.log(failed || run.status ? 'RESULT: FAILED' : 'RESULT: every security test passed');
process.exitCode = failed || run.status ? 1 : 0;
