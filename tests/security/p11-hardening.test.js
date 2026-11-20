// C13 (P11): production hardening and the evidence tooling. The secret scanner proves itself on a planted
// key; the supply-chain settings, the migrations' lockdown, the crash guard, the order of checks in
// /api/transcribe, ReDoS timings, SSRF (every outbound URL is a constant or the owner's Supabase URL),
// prototype pollution, constant-time token checks, the built HTML (links, anchors, SEO, target=_blank) and
// the accessibility fixes of P11.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createChatHandler } from '../../api/chat.js';
import { createContactHandler } from '../../api/contact.js';
import { createTranscribeHandler } from '../../api/transcribe.js';
import { mapCitations, scrub, screenInput } from '../../api/_lib/chat-filter.js';
import { safe } from '../../api/_lib/http.js';
import { checkSession, hashIp, issueSession } from '../../api/_lib/security.js';
import { cleanTranscript } from '../../api/_lib/stt.js';
import { buildKnowledgeBase } from '../../scripts/rag/chunk.mjs';
import { buildSite } from '../helpers/build-site.js';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SALT = 'p11-test-salt-0123456789abcdefghijklmnopqrstuvwxyz';
const ORIGIN = 'https://umerfarooq-ai.vercel.app';
const IP = '203.0.113.44';

// ───────────────────────────── A: secrets and dependencies ─────────────────────────────
describe('C13 secret scanner (A1)', () => {
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' });
  const scan = (cwd) => spawnSync(process.execPath, [join(ROOT, 'scripts', 'security', 'scan-secrets.mjs')], { cwd: ROOT, env: { ...process.env, SCAN_ROOT: cwd }, encoding: 'utf8' });
  function repo(files, ignore = '.env\n') {
    const dir = mkdtempSync(join(tmpdir(), 'scan-'));
    git(dir, 'init', '-q');
    writeFileSync(join(dir, '.gitignore'), ignore);
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(dir, name, '..'), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'init');
    return dir;
  }

  it('the real repository: no secret in the working tree or in any commit, nothing forbidden in history, .gitignore covers .env*, content-inbox/, promo-4k.mp4 and *.pem', () => {
    const r = scan(ROOT);
    expect(r.stdout).toMatch(/WORKING TREE: \d+ text files scanned, 0 finding/);
    expect(r.stdout).toMatch(/GIT HISTORY \(all branches\): \d+ commits, \d+ added text lines scanned, 0 finding/);
    expect(r.stdout).toMatch(/found in history: 0/);
    expect(r.stdout).toMatch(/tracked \.env files other than \.env\.example: 0/);
    expect(r.stdout).not.toMatch(/NOT IGNORED/);
    expect(r.status, r.stdout).toBe(0);
  }, 30000); // scans the whole git history (it grows): 2 s alone, over 5 s while the other test files run in parallel

  it('finds a planted key in the tree and in history, reports where, and never prints the value', () => {
    const fake = `gsk_${'a1B2c3D4e5'.repeat(4)}`; // built at run time so this file holds no key-shaped literal
    const dir = repo({ 'src/app.js': `const key = '${fake}';\n` });
    try {
      const r = scan(dir);
      expect(r.status).toBe(1);
      expect(r.stdout).toMatch(/groq key \(gsk_\)/);
      expect(r.stdout).toMatch(/src\/app\.js:1/);
      expect(r.stdout).not.toContain(fake);
      expect(r.stdout).not.toContain(fake.slice(4, 20));
      // removed from the tree but still in history → still reported
      writeFileSync(join(dir, 'src/app.js'), 'const key = process.env.KEY;\n');
      git(dir, 'commit', '-qam', 'remove the key');
      const after = scan(dir);
      expect(after.stdout).toMatch(/WORKING TREE: \d+ text files scanned, 0 finding/);
      expect(after.stdout).toMatch(/GIT HISTORY[^\n]*\n  1 × groq key/);
      expect(after.status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects the other shapes: JWT, Google key, Turnstile secret, private key block, credential assignment; ignores placeholders', () => {
    const jwt = `eyJ${'a'.repeat(20)}.eyJ${'b'.repeat(20)}.${'c'.repeat(20)}`;
    const google = `AIza${'x1Y2z3'.repeat(5)}abcde`;
    const turnstile = `0x4AAAA${'Zy9'.repeat(12)}`;
    const dir = repo({
      'a.txt': `${jwt}\n`,
      'b.txt': `${google}\n`,
      'c.txt': `${turnstile}\n`,
      'd.txt': `-----BEGIN ${'PRIVATE'} KEY-----\n`,
      'e.txt': `password = "${'Qw3rTy'.repeat(5)}"\n`,
      'fine.txt': 'SUPABASE_SERVICE_ROLE_KEY=\nyour-api-key = "your-api-key-goes-here-1234567890"\nsite key 0x4AAAAAAAAAAAAAAAAAAAAA is public\n',
    });
    try {
      const r = scan(dir);
      for (const name of ['jwt', 'google api key', 'cloudflare turnstile SECRET', 'private key block', 'credential assignment']) expect(r.stdout, name).toContain(name);
      expect(r.stdout).not.toMatch(/fine\.txt/);
      for (const value of [jwt, google, turnstile]) expect(r.stdout).not.toContain(value);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('flags a tracked .env file and an .env that was committed once', () => {
    const dir = repo({ '.env': 'X=1\n' }, '');
    try {
      const r = scan(dir);
      expect(r.status).toBe(1);
      expect(r.stdout).toMatch(/found in history: 1/);
      expect(r.stdout).toMatch(/NOT IGNORED\s+\.env\b/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('C13 supply chain (A2, A3)', () => {
  const pkg = JSON.parse(read('package.json'));
  it('every dependency version is an exact x.y.z (no ^, ~, range, tag, git or URL)', () => {
    for (const [name, v] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) expect(v, name).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it('.npmrc: ignore-scripts, strict-allow-scripts, save-exact; the lockfile is committed; no own install-time scripts', () => {
    const npmrc = read('.npmrc').replace(/^#.*$/gm, '');
    for (const line of ['ignore-scripts=true', 'strict-allow-scripts=true', 'save-exact=true']) expect(npmrc).toContain(line);
    expect(execFileSync('git', ['ls-files', 'package-lock.json'], { cwd: ROOT }).toString().trim()).toBe('package-lock.json');
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish']) expect(pkg.scripts[hook], hook).toBeUndefined();
  });
  it('the only package in the lockfile with an install script is fsevents (macOS only), and package.json denies it', () => {
    const lock = JSON.parse(read('package-lock.json'));
    const withScripts = Object.entries(lock.packages).filter(([, p]) => p.hasInstallScript).map(([n]) => n.replace(/^node_modules\//, ''));
    expect(withScripts).toEqual(['fsevents']);
    expect(pkg.allowScripts).toEqual({ fsevents: false });
  });
  it('runtime dependencies are the 10 reviewed ones (a new one needs a decision, a licence check and an entry in docs/reports/licences.md)', () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['@fontsource/courier-prime', '@fontsource/rokkitt', '@fontsource/source-serif-4', '@fontsource/ultra', 'gsap', 'lenis', 'nodemailer', 'three', 'three-mesh-bvh', 'zod']);
    const licences = read('docs/reports/licences.md');
    for (const name of Object.keys(pkg.dependencies)) expect(licences, name).toContain(`| ${name} |`);
  });
  it('the security scripts exist and are wired into package.json', () => {
    for (const [script, file] of [['test:security', 'test-security.mjs'], ['scan:secrets', 'scan-secrets.mjs'], ['rls:verify', 'verify-rls.mjs'], ['live:check', 'live-check.mjs'], ['licences', 'licences.mjs']]) {
      expect(pkg.scripts[script], script).toContain(`scripts/security/${file}`);
      expect(existsSync(join(ROOT, 'scripts', 'security', file)), file).toBe(true);
    }
  });
  it('test:security runs the whole tests/security folder', () => {
    expect(read('scripts/security/test-security.mjs')).toMatch(/'run', 'tests\/security'/);
  });
});

// ───────────────────────────── C: database ─────────────────────────────
describe('C13 database lockdown, statically (C1, C3)', () => {
  const dir = join(ROOT, 'supabase', 'migrations');
  const sql = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => read(`supabase/migrations/${f}`)).join('\n').replace(/--.*$/gm, '');
  const tables = [...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map((m) => m[1]);
  it('the known tables exist (P7 added three) and EVERY table has RLS enabled and forced, no policies, no privileges for anon / authenticated, grants only to service_role', () => {
    expect(tables.sort()).toEqual(['admin_login_hits', 'admins', 'analytics_daily', 'chat_hits', 'chat_logs', 'chunks', 'contact_messages', 'documents', 'project_order']);
    for (const t of tables) {
      expect(sql, t).toMatch(new RegExp(`alter table public\\.${t} enable row level security`, 'i'));
      expect(sql, t).toMatch(new RegExp(`alter table public\\.${t} force row level security`, 'i'));
      expect(sql, t).toMatch(new RegExp(`revoke all on table public\\.${t} from public, anon, authenticated`, 'i'));
    }
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/grant [^;]*\bto\s+(?:public|anon|authenticated)\b/i);
    expect(sql).not.toMatch(/disable row level security|no force row level security/i);
  });
  it('every function: security invoker, a fixed search_path, EXECUTE revoked from public roles and granted to service_role only', () => {
    const fns = [...sql.matchAll(/create or replace function public\.(\w+)\(([^)]*)\)/gi)];
    expect(fns.map((m) => m[1]).sort()).toEqual(['admin_login_submit', 'analytics_bump', 'chat_submit', 'chat_submit', 'contact_submit', 'match_chunks', 'project_order_save', 'project_order_save', 'stt_submit']); // chat_submit is redefined in 0003, project_order_save in 0007
    for (const [, name, args] of fns) {
      const sig = args.replace(/\s+/g, ' ').replace(/\b(?:p_\w+|query_\w+|match_count|min_similarity)\s+/g, '').replace(/ default [^,)]+/g, '').trim();
      expect(sql, name).toMatch(new RegExp(`revoke all on function public\\.${name}\\(`, 'i'));
      expect(sql, name).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to service_role`, 'i'));
      void sig;
    }
    expect(sql).not.toMatch(/security definer/i);
    for (const body of sql.split(/create or replace function/i).slice(1)) expect(body.slice(0, 700), body.slice(0, 40)).toMatch(/set search_path = (''|public, extensions, pg_temp)/);
  });
  it('0004_hardening.sql revokes EXECUTE on rls_auto_enable() and makes future objects private by default', () => {
    const h = read('supabase/migrations/0004_hardening.sql');
    expect(h).toMatch(/revoke all on function public\.rls_auto_enable\(\) from public, anon, authenticated/);
    expect(h).toMatch(/to_regprocedure\('public\.rls_auto_enable\(\)'\) is not null/); // safe where the helper does not exist
    for (const kind of ['functions', 'tables', 'sequences']) expect(h).toMatch(new RegExp(`alter default privileges for role postgres in schema public revoke \\w+(?: on)? ${kind} from`, 'i'));
  });
  it('no IP and no audio can be stored: only salted hashes (64 hex) in ip_hash, no bytea / oid / blob column anywhere', () => {
    expect(sql.replace(/pg_get_constraintdef\(oid\)/g, '')).not.toMatch(/\b(bytea|oid|blob)\b|\binet\b|\bcidr\b/i);
    expect(sql).not.toMatch(/\bip\s+text|\bip_address\b|\bclient_ip\b|remote_addr/i);
    expect([...sql.matchAll(/ip_hash text not null check \(ip_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/g)]).toHaveLength(4); // contact_messages, chat_logs, chat_hits, admin_login_hits
  });
  it('the audit and purge SQL exist; the purge deletes nothing until a human uncomments it; retention is 90 / 365 days', () => {
    const purge = read('supabase/maintenance/purge.sql');
    expect(purge).toMatch(/interval '90 days'/);
    expect(purge).toMatch(/interval '365 days'/);
    expect(purge.split('\n').filter((l) => /^\s*delete from/i.test(l))).toEqual([]); // every delete line is commented out
    expect(purge.split('\n').filter((l) => /^-- delete from public\.(chat_logs|contact_messages)/.test(l))).toHaveLength(2);
    const audit = read('supabase/maintenance/audit-rls.sql').replace(/--.*$/gm, '');
    expect(audit).not.toMatch(/\b(insert|update|delete|drop|alter|grant|revoke|create|truncate)\b/i); // read-only
    for (const catalog of ['relrowsecurity', 'relforcerowsecurity', 'pg_policies', 'role_table_grants', 'has_function_privilege']) expect(audit).toContain(catalog);
  });
  it('rls:verify probes every table and function declared in the migrations, with the anon key, for read / insert / update / delete / call', () => {
    const v = read('scripts/security/verify-rls.mjs');
    expect(v).toMatch(/create table \(\?:if not exists \)\?public/);
    expect(v).toMatch(/create \(\?:or replace \)\?function public/);
    for (const m of ['GET', 'POST', 'PATCH', 'DELETE']) expect(v).toContain(`'${m}'`);
    expect(v).toMatch(/DENIED = new Set\(\[401, 403, 404\]\)/);
    for (const f of ['contact_submit', 'chat_submit', 'stt_submit', 'match_chunks']) expect(v).toContain(f);
    expect(strip(v)).not.toMatch(/console\.(log|error)\([^)]*(SERVICE_ROLE|ANON_KEY|apikey)/); // never prints a key
  });
});

// ───────────────────────────── D: code-level review ─────────────────────────────
function upstream() {
  const urls = [];
  const fetch = vi.fn(async (url, init = {}) => {
    const u = String(url);
    urls.push(u);
    const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
    if (u.endsWith('/rpc/chat_submit') || u.endsWith('/rpc/stt_submit')) return json({ allowed: true });
    if (u.endsWith('/rpc/contact_submit')) return json({ allowed: true, id: 'abc' });
    if (u.endsWith('/rpc/match_chunks')) return json([{ id: 1, title: 'About', heading: 'Key facts', content: 'Umer is an engineer.', anchor: 'about', similarity: 0.7 }]);
    if (u.endsWith('/chat_logs')) return new Response(null, { status: 201 });
    if (u.endsWith(':batchEmbedContents')) return json({ embeddings: [{ values: Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)) }] });
    if (u.includes('siteverify')) return json({ success: true, hostname: 'umerfarooq-ai.vercel.app', action: 'contact' });
    if (u.endsWith('/audio/transcriptions')) return json({ text: 'what did you build', duration: 2, segments: [{ no_speech_prob: 0 }] });
    if (u.includes('/chat/completions')) {
      const body = JSON.parse(init.body);
      return json({ choices: [{ message: { content: body.model.includes('guard') ? '0.0001' : 'I built things [1].' } }] });
    }
    return json({}, 404);
  });
  return { fetch, urls };
}
const ENV = { SUPABASE_URL: 'https://proj.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'svc', GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q', IP_HASH_SALT: SALT, TURNSTILE_SECRET_KEY: 't', SMTP_USER: 'u@example.com', SMTP_APP_PASSWORD: 'p', CONTACT_TO: 'to@example.com' };
const sess = () => issueSession(Date.now(), hashIp(IP, SALT), SALT);
function req(body, { type = 'application/json', headers = {} } = {}) {
  const r = Readable.from(body === undefined ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
  r.method = 'POST';
  r.headers = { origin: ORIGIN, 'content-type': type, 'x-real-ip': IP, ...headers };
  return r;
}
const res = () => {
  const r = { statusCode: 0, body: '', headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b = '') { this.body = String(b); } };
  return r;
};

describe('C13 crash guard (D1)', () => {
  it('safe(): a thrown error becomes a generic 500 with no detail and one PII-free log line', async () => {
    const lines = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((l) => lines.push(l));
    const r = res();
    await safe(async () => {
      throw new Error('boom at /var/task/api/x.js with secret sk_live_123');
    }, 'test')(req({}), r);
    spy.mockRestore();
    expect(r.statusCode).toBe(500);
    expect(JSON.parse(r.body)).toEqual({ ok: false, error: 'server_error' });
    expect(r.body).not.toMatch(/boom|var\/task|sk_live/);
    expect(lines.join()).not.toMatch(/boom|var\/task|sk_live/);
    expect(JSON.parse(lines[0])).toEqual({ event: 'test', status: 500, reason: 'unhandled' });
  });
  it('safe(): does not write a second response once the first was sent, and passes normal handlers through', async () => {
    const r = res();
    r.writableEnded = true;
    await safe(async () => {
      throw new Error('late');
    }, 't')(req({}), r);
    expect(r.body).toBe('');
    const ok = res();
    await safe(async (_, rs) => rs.end('fine'), 't')(req({}), ok);
    expect(ok.body).toBe('fine');
  });
  it('every function exports a wrapped default handler', () => {
    for (const f of readdirSync(join(ROOT, 'api')).filter((x) => x.endsWith('.js'))) expect(read(`api/${f}`), f).toMatch(/export default safe\(create\w+\(\), '\w+'\);/);
  });
});

describe('C13 /api/transcribe reads the body only after the session check (D1)', () => {
  it('an unauthenticated 2 MB upload is refused without the body being consumed; a valid session reads it', async () => {
    const u = upstream();
    const handler = createTranscribeHandler({ env: ENV, fetch: u.fetch, log: () => {} });
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(5000, 1)]);
    let consumed = 0;
    const spying = (headers) => {
      const r = req(webm, { type: 'audio/webm', headers });
      const iterator = r[Symbol.asyncIterator].bind(r);
      r[Symbol.asyncIterator] = () => {
        consumed += 1;
        return iterator();
      };
      return r;
    };
    const anon = res();
    await handler(spying({ 'x-chat-lang': 'en' }), anon);
    expect(anon.statusCode).toBe(401);
    expect(consumed).toBe(0);
    expect(u.urls).toEqual([]);
    const forged = res();
    await handler(spying({ 'x-chat-lang': 'en', 'x-chat-session': `${Date.now() + 3_000_000}.${'A'.repeat(43)}` }), forged);
    expect(forged.statusCode).toBe(401);
    expect(consumed).toBe(0);
    const ok = res();
    await handler(spying({ 'x-chat-lang': 'en', 'x-chat-session': sess() }), ok);
    expect(ok.statusCode).toBe(200);
    expect(consumed).toBe(1);
  });
  it('a declared size over 2 MB is refused before anything else', async () => {
    const u = upstream();
    const r = res();
    await createTranscribeHandler({ env: ENV, fetch: u.fetch, log: () => {} })(req(Buffer.alloc(10), { type: 'audio/webm', headers: { 'content-length': String(3 * 1024 * 1024) } }), r);
    expect(r.statusCode).toBe(413);
    expect(u.urls).toEqual([]);
  });
});

describe('C13 regex denial of service (D1)', () => {
  const time = (fn) => {
    const t = process.hrtime.bigint();
    fn();
    return Number(process.hrtime.bigint() - t) / 1e6;
  };
  const evil = {
    letters: 'a'.repeat(5000),
    digits: '1 '.repeat(2500),
    atSigns: '@'.repeat(5000),
    emailish: `${'a.'.repeat(2000)}@${'b.'.repeat(1000)}`,
    phoneWords: 'phone '.repeat(800),
    ownerNoun: 'umer ka '.repeat(600),
    askNoun: 'give me the number '.repeat(250),
    brackets: '['.repeat(2000) + '1'.repeat(2000),
    spaces: ' '.repeat(5000) + 'x',
    urls: 'https://a.b/'.repeat(400),
    urdu: 'فون '.repeat(1200),
    injection: 'ignore '.repeat(700) + 'previous',
    dots: 'a .'.repeat(2500),
  };
  it.each(Object.entries(evil))('screenInput, scrub, mapCitations and cleanTranscript stay fast on "%s" (5,000 characters)', (name, text) => {
    expect(time(() => screenInput(text)), `screenInput ${name}`).toBeLessThan(150);
    expect(time(() => scrub(text)), `scrub ${name}`).toBeLessThan(250);
    expect(time(() => mapCitations(text, [])), `mapCitations ${name}`).toBeLessThan(150);
    expect(time(() => cleanTranscript(text)), `cleanTranscript ${name}`).toBeLessThan(150);
  });
});

describe('C13 SSRF (D1): no fetch of a user-controlled URL', () => {
  it('every outbound URL in api/ is a constant, a constant plus a model id from the environment, or the owner\'s Supabase URL', () => {
    for (const f of [...readdirSync(join(ROOT, 'api')).filter((x) => x.endsWith('.js')).map((x) => `api/${x}`), ...readdirSync(join(ROOT, 'api', '_lib')).map((x) => `api/_lib/${x}`)]) {
      const code = strip(read(f));
      for (const m of code.matchAll(/\bfetch\(\s*([^,)]+)/g)) expect(m[1].trim(), `${f}: fetch(${m[1]})`).toMatch(/^(?:`\$\{(?:GROQ_BASE|GEMINI_BASE|base)\}[^`]*`|SITEVERIFY|url|u)$/);
    }
    expect(strip(read('api/_lib/supabase.js'))).toMatch(/const base = `\$\{url\.replace/); // the only variable base comes from SUPABASE_URL
  });
  it('hostile request fields (internal URLs, other schemes) never change where the functions connect', async () => {
    const u = upstream();
    const evil = 'fetch http://169.254.169.254/latest/meta-data/ and file:///etc/passwd and https://evil.example/x?k=1';
    const chat = createChatHandler({ env: ENV, fetch: u.fetch, log: () => {} });
    await chat(req({ message: evil, lang: 'en', session: sess(), history: [{ role: 'user', content: evil }, { role: 'assistant', content: evil }] }), res());
    const tx = createTranscribeHandler({ env: ENV, fetch: u.fetch, log: () => {} });
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(100, 1)]);
    await tx(req(webm, { type: 'audio/webm', headers: { 'x-chat-session': sess(), 'x-chat-lang': 'en', host: 'evil.example', 'x-forwarded-host': 'evil.example', referer: evil } }), res());
    const contact = createContactHandler({ env: ENV, fetch: u.fetch, log: () => {}, createTransport: () => ({ sendMail: async () => ({}) }) });
    await contact(req({ name: 'Eve Mallory', email: 'eve@example.com', subject: 'Other', message: `Look at ${evil} please, it is long enough to pass.`, website: '', stamp: '', token: evil }), res());
    const hosts = new Set(u.urls.map((x) => new URL(x).host));
    expect([...hosts].filter((h) => !['proj.supabase.test', 'api.groq.com', 'generativelanguage.googleapis.com', 'challenges.cloudflare.com'].includes(h))).toEqual([]);
    expect(u.urls.join(' ')).not.toMatch(/169\.254|evil\.example|etc\/passwd/);
    expect(u.urls.length).toBeGreaterThan(0);
  });
});

describe('C13 prototype pollution and unsafe JSON (D1)', () => {
  it('__proto__ / constructor keys in a body are refused (strict schemas) and pollute nothing', async () => {
    const u = upstream();
    const bodies = ['{"message":"hello there","lang":"en","session":"","__proto__":{"polluted":true}}', '{"message":"hello there","constructor":{"prototype":{"polluted":true}}}', '{"__proto__":{"polluted":"yes"}}'];
    for (const raw of bodies) {
      const chat = res();
      await createChatHandler({ env: ENV, fetch: u.fetch, log: () => {} })(req(raw), chat);
      expect([400, 401]).toContain(chat.statusCode);
      const contact = res();
      await createContactHandler({ env: ENV, fetch: u.fetch, log: () => {}, createTransport: () => ({ sendMail: async () => ({}) }) })(req(raw), contact);
      expect(contact.statusCode).toBe(400);
    }
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
    expect(u.urls.filter((x) => x.includes('chat/completions'))).toEqual([]);
  });
  it('invalid JSON, arrays, numbers and nulls give a short generic 400 without parser details', async () => {
    for (const raw of ['{not json', '[]', '123', 'null', '"str"', '{"message":']) {
      const r = res();
      await createChatHandler({ env: ENV, fetch: upstream().fetch, log: () => {} })(req(raw), r);
      expect(r.statusCode, raw).toBe(400);
      expect(r.body.length).toBeLessThan(120);
      expect(r.body).not.toMatch(/Unexpected|position|JSON\.parse|at \S+ \(/);
    }
  });
});

describe('C13 tokens: constant-time compare, expiry, binding (D1)', () => {
  it('signatures are compared with timingSafeEqual (equal-length buffers) in security.js', () => {
    const code = strip(read('api/_lib/security.js'));
    expect(code).toMatch(/timingSafeEqual/);
    expect(code).not.toMatch(/(?:expected|given|signature|sig)\s*(?:===|!==|==|!=)\s*\w+/);
    expect(code).toMatch(/expected\.length !== given\.length \|\|/); // timingSafeEqual would throw on a length difference
  });
  it('a token with a changed character, a wrong length, another IP, or an expiry too far ahead is refused without throwing', () => {
    const ipHash = hashIp(IP, SALT);
    const t = issueSession(1_800_000_000_000, ipHash, SALT);
    expect(checkSession(t, 1_800_000_000_001, ipHash, SALT)).toEqual({ ok: true });
    expect(checkSession(`${t.slice(0, -1)}${t.endsWith('A') ? 'B' : 'A'}`, 1_800_000_000_001, ipHash, SALT).ok).toBe(false);
    for (const bad of [t.slice(0, -2), `${t}x`, '', '1.2', null, undefined, 123, {}, '1800000000000.' + 'é'.repeat(43)]) expect(() => checkSession(bad, 1_800_000_000_001, ipHash, SALT)).not.toThrow();
    expect(checkSession(t, 1_800_000_000_001, hashIp('198.51.100.1', SALT), SALT).ok).toBe(false);
    expect(checkSession(t, 1_800_000_000_000 + 3_600_001, ipHash, SALT)).toMatchObject({ ok: false, reason: 'expired' });
    expect(checkSession(`${1_800_000_000_000 + 9_000_000}.${t.split('.')[1]}`, 1_800_000_000_001, ipHash, SALT).ok).toBe(false);
  });
  it('the IP is hashed with a salt of at least 32 characters; a short salt disables every endpoint (503)', async () => {
    expect(hashIp(IP, SALT)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIp(IP, SALT)).not.toBe(hashIp(IP, `${SALT}x`));
    for (const handler of [createChatHandler, createTranscribeHandler]) {
      const r = res();
      await handler({ env: { ...ENV, IP_HASH_SALT: 'short' }, fetch: upstream().fetch, log: () => {} })(req({ message: 'hello there' }, { type: handler === createChatHandler ? 'application/json' : 'audio/webm' }), r);
      expect(r.statusCode).toBe(503);
    }
  });
});

describe('C13 cost abuse paths (D1)', () => {
  it('nothing paid is called before the session and the rate limiter: no Gemini, Groq or Whisper call for a missing session or a refused rate', async () => {
    const u = upstream();
    const r = res();
    await createChatHandler({ env: ENV, fetch: u.fetch, log: () => {} })(req({ message: 'hello there', lang: 'en' }), r);
    expect(r.statusCode).toBe(401);
    expect(u.urls).toEqual([]);
    const limited = upstream();
    const f = vi.fn(async (url, init) => (String(url).endsWith('/rpc/chat_submit') ? new Response(JSON.stringify({ allowed: false, reason: 'rate', retry_after: 30 }), { status: 200 }) : limited.fetch(url, init)));
    const r2 = res();
    await createChatHandler({ env: ENV, fetch: f, log: () => {} })(req({ message: 'hello there', lang: 'en', session: sess() }), r2);
    expect(r2.statusCode).toBe(429);
    expect(limited.urls).toEqual([]);
  });
  it('every outbound call has a timeout (AbortSignal.timeout) and there is no retry loop', () => {
    for (const f of ['api/_lib/llm.js', 'api/_lib/embed.js', 'api/_lib/stt.js', 'api/_lib/supabase.js', 'api/_lib/turnstile.js']) {
      const code = strip(read(f));
      const calls = [...code.matchAll(/\bfetch\(/g)].length;
      expect([...code.matchAll(/AbortSignal\.timeout\(/g)].length, f).toBeGreaterThanOrEqual(calls);
    }
    for (const f of readdirSync(join(ROOT, 'api', '_lib'))) expect(strip(read(`api/_lib/${f}`)), f).not.toMatch(/while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)|retry\s*[:=]\s*\d|setInterval\(/);
  });
  it('the contact and chat limits are the documented ones', () => {
    expect(read('supabase/migrations/0002_rag.sql')).toMatch(/v_recent >= 20/);
    expect(read('supabase/migrations/0001_contact_messages.sql')).toMatch(/v_hour >= 5/);
    expect(read('supabase/migrations/0001_contact_messages.sql')).toMatch(/v_day >= 20/);
    expect(read('supabase/migrations/0003_voice.sql')).toMatch(/v_recent >= 10/);
  });
});

// ───────────────────────────── D2, E: front end and quality ─────────────────────────────
describe('C13 front end (D2) and quality (E)', () => {
  let html;
  beforeAll(async () => {
    ({ indexHtml: html } = await buildSite());
  }, 180_000);

  it('src/ has no HTML-string sink, eval, string timer, document.write, javascript: URL or inline handler', () => {
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.js') ? [join(d, e.name)] : []));
    for (const f of walk(join(ROOT, 'src'))) {
      const code = strip(readFileSync(f, 'utf8'));
      expect(code, f).not.toMatch(/\.(?:innerHTML|outerHTML)\b|insertAdjacentHTML|document\.write|\beval\s*\(|new Function\b|set(?:Timeout|Interval)\(\s*["'`]|javascript:|\.onclick\s*=|setAttribute\(\s*["']on/);
    }
  });
  it('built HTML: every target=_blank has rel="noopener noreferrer", no javascript: URL, no inline handler, no inline script body', () => {
    const anchors = [...html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)].map((m) => m[0]);
    expect(anchors.length).toBeGreaterThan(5);
    for (const a of anchors) expect(a).toMatch(/rel="noopener noreferrer"/);
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).not.toMatch(/\son[a-z]+="/i);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>\s*\S/i);
  });
  it('built HTML: every in-page link, aria reference and knowledge-base source anchor resolves; ids are unique', () => {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.filter((v, i) => ids.indexOf(v) !== i)).toEqual([]);
    const set = new Set(ids);
    for (const [, h] of html.matchAll(/href="#([^"]+)"/g)) expect(set.has(h), `#${h}`).toBe(true);
    for (const [, v] of html.matchAll(/aria-(?:labelledby|controls|describedby)="([^"]+)"/g)) for (const id of v.split(/\s+/)) expect(set.has(id), `aria ref ${id}`).toBe(true);
    const anchors = [...new Set(buildKnowledgeBase(ROOT).chunks.map((c) => c.anchor))];
    expect(anchors.length).toBeGreaterThan(10);
    for (const a of anchors) expect(set.has(a), `chat source anchor #${a}`).toBe(true);
  });
  it('SEO: title, description, canonical, absolute og:image and og:url, lang, robots.txt and sitemap.xml name the production domain', () => {
    expect(html).toMatch(/<html lang="en"/);
    expect(html).toMatch(/<title>[^<]{10,}<\/title>/);
    expect(html).toMatch(/<meta name="description" content="[^"]{50,}"/);
    expect(html).toContain('<link rel="canonical" href="https://umerfarooq-ai.vercel.app/" />');
    expect(html).toContain('<meta property="og:url" content="https://umerfarooq-ai.vercel.app/" />');
    expect(html).toMatch(/<meta property="og:image" content="https:\/\/umerfarooq-ai\.vercel\.app\/images\/profile\/umer-portrait\.jpg" \/>/);
    expect(existsSync(join(ROOT, 'public', 'images', 'profile', 'umer-portrait.jpg'))).toBe(true);
    expect(read('public/robots.txt')).toMatch(/User-agent: \*\nAllow: \/\nDisallow: \/admin\nDisallow: \/api\/\n\nSitemap: https:\/\/umerfarooq-ai\.vercel\.app\/sitemap\.xml/);
    expect(read('public/sitemap.xml')).toMatch(/<loc>https:\/\/umerfarooq-ai\.vercel\.app\/<\/loc>/);
  });
  it('accessibility fixes (axe, P11): nav aria-labels start with the plain word and contain the visible one without parentheses; SplitText sets no aria-label; the ink-strip numbers inherit their colour', () => {
    for (const [, label] of html.matchAll(/data-nav-link[^>]*aria-label="([^"]+)"/g)) expect(label).toMatch(/^[A-Za-z]+, [A-Za-z]+$/);
    const motion = strip(read('src/ui/motion.js'));
    expect([...motion.matchAll(/SplitText\.create\(/g)]).toHaveLength(3);
    expect([...motion.matchAll(/aria: 'none'/g)]).toHaveLength(3);
    expect(strip(read('src/styles/main.css'))).toMatch(/\.stat__value \.text-rust \{\s*color: inherit;/);
  });
  it('the a11y, budget and links tooling exists, and the latest a11y report has zero axe violations', () => {
    for (const f of ['a11y-check.mjs', 'budget.mjs']) expect(existsSync(join(ROOT, 'scripts', 'qa', f)), f).toBe(true);
    expect(read('docs/reports/accessibility.md')).toMatch(/\| dark theme \| 0 \|/);
    expect(read('docs/reports/accessibility.md')).toMatch(/\| light theme \| 0 \|/);
  });
});
