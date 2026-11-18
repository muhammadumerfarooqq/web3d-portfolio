// P11 A1: secret scan of the working tree AND the full git history, with the same kinds of patterns gitleaks
// uses. `node scripts/security/scan-secrets.mjs [--tree-only] [--history-only]`. Prints COUNTS and locations
// (file:line or commit:file), never a matched value. Two layers:
//   1. shape patterns (Supabase / Google / Groq keys, JWTs, Cloudflare secrets, private keys, GitHub / AWS /
//      Stripe tokens, assignments like `password = "…"`);
//   2. the real values from the local .env (every value of 12+ characters): if one appears anywhere in the tree
//      (outside .env itself) or in any commit, its NAME is reported. These are the leaks that matter most.
// Exit code 1 when anything is found. Run it before every release; gitleaks, if installed, is a second opinion.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.env.SCAN_ROOT ?? join(import.meta.dirname, '..', '..'); // SCAN_ROOT: tests point it at a throwaway repo
const argv = new Set(process.argv.slice(2));
const doTree = !argv.has('--history-only');
const doHistory = !argv.has('--tree-only');

export const PATTERNS = [
  ['jwt (Supabase anon / service role, other JWTs)', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['supabase secret key (sb_secret_)', /\bsb_secret_[A-Za-z0-9_-]{20,}/],
  ['groq key (gsk_)', /\bgsk_[A-Za-z0-9]{20,}/],
  ['google api key (AIza)', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['google ai key (AQ.)', /\bAQ\.[A-Za-z0-9_-]{30,}/],
  ['cloudflare turnstile SECRET (0x4AAAA…, 35+ chars; the 25-char site key is public)', /\b0x4AAAA[A-Za-z0-9_-]{28,}\b/],
  ['private key block', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/],
  ['github token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['aws access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['stripe live key', /\b[sr]k_live_[A-Za-z0-9]{20,}\b/],
  ['slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['smtp app password near a mail keyword', /(?:smtp|app[_ -]?pass(?:word)?|gmail)[^\n]{0,40}[=:]\s*["']?[a-z]{4}(?: ?[a-z]{4}){3}\b/i],
  ['credential assignment with a long literal', /\b(?:secret|passwd|password|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)\w*["']?\s*[:=]\s*["'][A-Za-z0-9/+_=.-]{24,}["']/i],
];

// Lines that are documented placeholders or test fixtures, not secrets.
const ALLOW = [/example\.com/i, /\byour[-_ ]/i, /<[^>]*(?:key|secret|password|token)[^>]*>/i, /\bxxxx+/i, /\.{3}/];
const skipFile = (f) => /(^|\/)(node_modules|dist|\.git|content-inbox)\//.test(f) || /\.(png|jpe?g|webp|gif|ico|glb|gltf|bin|woff2?|ttf|mp4|mp3|wav|ogg|webm|avi|aep|pdf|zip|exr|hdr|blend\d*|lock)$/i.test(f) || /(^|\/)package-lock\.json$/.test(f);

/** Real secret values from .env (names only are ever printed). */
function envValues() {
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return [];
  const out = [];
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    // Only secret-named variables: CONTACT_TO and SMTP_USER are the public address and a login name, not secrets.
    if (!m || m[1].startsWith('VITE_') || !/KEY|SECRET|PASSWORD|SALT|TOKEN|CRON/.test(m[1])) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, '');
    if (value.length >= 12) out.push([m[1], value]);
  }
  return out;
}

function scanText(label, text, hits, values, counts) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length > 4000) continue;
    for (const [name, rx] of PATTERNS) {
      if (rx.test(line) && !ALLOW.some((a) => a.test(line))) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
        hits.push(`${name} @ ${label}:${i + 1}`);
      }
    }
    for (const [name, value] of values) {
      if (line.includes(value)) {
        counts.set(`.env value ${name}`, (counts.get(`.env value ${name}`) ?? 0) + 1);
        hits.push(`.env value ${name} @ ${label}:${i + 1}`);
      }
    }
  }
}

function scanTree(values) {
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString('utf8').split('\0').filter(Boolean);
  const hits = [];
  const counts = new Map();
  let scanned = 0;
  for (const f of files) {
    if (skipFile(f)) continue;
    const abs = join(ROOT, f);
    try {
      if (!statSync(abs).isFile() || statSync(abs).size > 5 * 1024 * 1024) continue;
      scanText(f, readFileSync(abs, 'utf8'), hits, values, counts);
      scanned += 1;
    } catch {
      /* unreadable: skip */
    }
  }
  return { scanned, hits, counts };
}

function scanHistory(values) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['log', '--all', '-p', '-U0', '--no-color', '--no-ext-diff', '--format=@@COMMIT %h'], { cwd: ROOT });
    const hits = [];
    const counts = new Map();
    let commit = '';
    let file = '';
    let skip = false;
    let commits = 0;
    let rest = '';
    let added = 0;
    const lineHandler = (line) => {
      if (line.startsWith('@@COMMIT ')) {
        commit = line.slice(9).trim();
        commits += 1;
      } else if (line.startsWith('+++ ')) {
        file = line.slice(4).replace(/^b\//, '');
        skip = file === '/dev/null' ? false : skipFile(file);
      } else if (line.startsWith('+') && !skip && line.length < 4000) {
        added += 1;
        scanText(`${commit}:${file}`, line.slice(1), hits, values, counts);
      }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      const parts = (rest + chunk).split('\n');
      rest = parts.pop();
      for (const l of parts) lineHandler(l);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (rest) lineHandler(rest);
      if (code !== 0) return reject(new Error(`git log exited ${code}`));
      resolve({ commits, added, hits, counts });
    });
    child.stderr.on('data', () => {});
  });
}

/** Files that must never have been committed (any commit, any branch). */
function forbiddenInHistory() {
  const out = execFileSync('git', ['log', '--all', '--name-only', '--no-color', '--format='], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 }).toString('utf8').split('\n').filter(Boolean);
  const bad = [...new Set(out)].filter((f) => /(^|\/)\.env(\.(?!example$)[^/]*)?$/.test(f) || /\.pem$/i.test(f) || /(^|\/)content-inbox\//.test(f) || /promo-4k\.mp4$/.test(f) || /(^|\/)id_(rsa|ed25519)/.test(f));
  return bad;
}

const report = { tree: null, history: null, forbidden: [], ignored: [] };
const values = envValues();
console.log(`.env values checked by exact match: ${values.length} (names are printed only if one leaks)`);

if (doTree) {
  report.tree = scanTree(values);
  console.log(`\nWORKING TREE: ${report.tree.scanned} text files scanned, ${report.tree.hits.length} finding(s)`);
  for (const [k, v] of report.tree.counts) console.log(`  ${v} × ${k}`);
  for (const h of report.tree.hits.slice(0, 40)) console.log(`   - ${h}`);
}
if (doHistory) {
  report.history = await scanHistory(values);
  console.log(`\nGIT HISTORY (all branches): ${report.history.commits} commits, ${report.history.added} added text lines scanned, ${report.history.hits.length} finding(s)`);
  for (const [k, v] of report.history.counts) console.log(`  ${v} × ${k}`);
  for (const h of report.history.hits.slice(0, 40)) console.log(`   - ${h}`);
  report.forbidden = forbiddenInHistory();
  console.log(`\nFILES THAT MUST NEVER BE COMMITTED (.env*, *.pem, content-inbox/, promo-4k.mp4, ssh keys) found in history: ${report.forbidden.length}`);
  for (const f of report.forbidden.slice(0, 20)) console.log(`   - ${f}`);
}

// .gitignore coverage: git itself says what it would ignore.
for (const probe of ['.env', '.env.local', '.env.production', '.env.development.local', 'content-inbox/x.png', 'aftereffects/promo-4k.mp4', 'server.pem', 'keys/private.pem']) {
  let ignored = false;
  try {
    execFileSync('git', ['check-ignore', '-q', probe], { cwd: ROOT });
    ignored = true;
  } catch {
    ignored = false;
  }
  report.ignored.push([probe, ignored]);
}
console.log('\n.gitignore coverage (git check-ignore):');
for (const [p, ok] of report.ignored) console.log(`  ${ok ? 'ignored    ' : 'NOT IGNORED'} ${p}`);
const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT }).toString('utf8').split('\n').filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.env.example'));
console.log(`tracked .env files other than .env.example: ${tracked.length}`);

const total = (report.tree?.hits.length ?? 0) + (report.history?.hits.length ?? 0) + report.forbidden.length + tracked.length + report.ignored.filter(([, ok]) => !ok).length;
console.log(total ? `\nRESULT: ${total} problem(s). If a real value leaked, ROTATE that key now (removing it from git is not enough).` : '\nRESULT: clean (no findings, nothing forbidden in history, .gitignore covers the probes).');
process.exitCode = total ? 1 : 0;
void relative;
