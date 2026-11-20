// P7 final: a REAL end-to-end run of every admin route against the real Supabase project (not mocks).
//   node --env-file=.env scripts/qa/admin-e2e.mjs
// It creates a temporary confirmed user (random @e2e.invalid address and password, memory only) and an `admins` row,
// signs in through the real handler code (only Cloudflare Turnstile is mocked), enrols and verifies TOTP (RFC 6238,
// computed here) and then calls: GET/POST projects-order, GET /api/project-order, GET/PATCH messages, GET stats,
// POST /api/collect. In a finally block it restores project_order, the contact message status and the analytics
// counter to what they were, and deletes the temporary user, its admins row and its rate-limit rows.
// It prints statuses and short error codes only: never a key, token, password, TOTP secret or message text.
// It never touches the real admin user (it only reads it to confirm that).
import { createHmac, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';

const ROOT = new URL('../../', import.meta.url);
const imp = (f) => import(new URL(f, ROOT).href);
const { createAdminHandler } = await imp('api/admin/[...path].js');
const { createCollectHandler } = await imp('api/collect.js');
const { createProjectOrderHandler } = await imp('api/project-order.js');
const { hashIp } = await imp('api/_lib/security.js');
const { PROJECT_SLUGS } = await imp('src/shared/project-slugs.js');
const env = process.env;
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_ANON_KEY', 'TURNSTILE_SECRET_KEY', 'IP_HASH_SALT']) if (!env[k]) throw new Error(`missing ${k}`);
const BASE = env.SUPABASE_URL.replace(/\/+$/, '');
const SK = env.SUPABASE_SERVICE_ROLE_KEY;
const ORIGIN = 'https://umerfarooq-ai.vercel.app';
const TEST_IP = '198.51.100.78';
const REAL_ADMIN = process.env.REAL_ADMIN_ID ?? ''; // optional: the real admin's id, only READ at the end to confirm it was not touched
const label = process.argv[2] ?? 'RUN';
const code = (d) => (typeof (d?.error_code ?? d?.code) === 'string' ? String(d.error_code ?? d.code).replace(/[^A-Za-z0-9_]/g, '').slice(0, 24) : 'none');

async function admin(method, path, body) {
  const res = await fetch(`${BASE}/auth/v1/admin${path}`, { method, headers: { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, data, code: code(data) };
}
async function rest(method, path, body, prefer = 'return=representation') {
  const res = await fetch(`${BASE}/rest/v1${path}`, { method, headers: { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json', Prefer: prefer }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* none */ }
  return { status: res.status, data, code: code(data) };
}
function base32(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, '0');
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totp(secret) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac('sha1', base32(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0');
}

const logs = [];
const fetchWithMock = (url, init) => (String(url).includes('siteverify') ? Promise.resolve(new Response(JSON.stringify({ success: true, hostname: 'umerfarooq-ai.vercel.app', action: 'admin' }), { status: 200 })) : fetch(url, init));
const sink = (e, f) => logs.push({ e, ...f });
const adminHandler = createAdminHandler({ env, fetch: fetchWithMock, sleep: async () => {}, log: sink });
const collectHandler = createCollectHandler({ env, fetch, log: sink });
const orderHandler = createProjectOrderHandler({ env, fetch, log: sink });
const makeRes = () => ({ statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = String(v); }, end(b = '') { this.body = String(b); } });
async function run(handler, url, { method = 'POST', body, token, type = 'application/json', origin = ORIGIN } = {}) {
  const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
  const req = Readable.from(payload === undefined || method === 'GET' ? [] : [Buffer.from(payload)]);
  req.method = method;
  req.url = url;
  req.headers = { origin, 'x-real-ip': TEST_IP, ...(payload !== undefined && method !== 'GET' ? { 'content-type': type } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const res = makeRes();
  const before = logs.length;
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(res.body); } catch { /* none */ }
  return { status: res.statusCode, json, logs: logs.slice(before).map((l) => `${l.status ?? ''} ${l.reason ?? ''}`.trim()) };
}
const callAdmin = (path, o) => run(adminHandler, `/api/admin/${path}`, o);
const claims = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());

const results = [];
const record = (name, r, ok, note = '') => {
  results.push([name, r.status, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(40)} status=${r.status}${r.json?.error ? ' error=' + r.json.error : ''} logs=[${r.logs.join(' | ')}] ${note}`.trim());
};

let tmpId = null;
let origOrder = null;
let origMsg = null;
let tmpMsgId = null;
let origStat = null; // { existed, count }
const TODAY = new Date().toISOString().slice(0, 10);
const EVENT = 'a11y_menu_used';
try {
  // ── originals, in memory ──
  const o = await rest('GET', '/project_order?select=slug,position,updated_at&order=position.asc');
  if (o.status !== 200) throw new Error(`read project_order ${o.status} ${o.code}`);
  origOrder = o.data;
  console.log(`original project_order rows: ${origOrder.length}`);
  const m = await rest('GET', '/contact_messages?select=id,status&order=created_at.desc&limit=1');
  if (m.status === 200 && m.data?.length) origMsg = m.data[0];
  console.log(`a real contact message: ${origMsg ? 'found (status ' + origMsg.status + ')' : 'none'}`);
  const s = await rest('GET', `/analytics_daily?select=count&day=eq.${TODAY}&event=eq.${EVENT}`);
  console.log(`analytics_daily read: status=${s.status} code=${s.code}`);
  origStat = { existed: Array.isArray(s.data) && s.data.length === 1, count: s.data?.[0]?.count ?? 0 };

  // ── temp admin, login, enrol, verify → aal2 ──
  const email = `p7final-${randomBytes(6).toString('hex')}@e2e.invalid`;
  const password = `${randomBytes(18).toString('base64url')}Aa1!`;
  const made = await admin('POST', '/users', { email, password, email_confirm: true });
  if (made.status !== 200 && made.status !== 201) throw new Error(`temp user ${made.status}`);
  tmpId = made.data.id;
  await rest('POST', '/admins', { user_id: tmpId });
  const login = await callAdmin('login', { body: { email, password, token: 'mock' } });
  const t1 = login.json?.accessToken;
  if (!t1) throw new Error(`login ${login.status}`);
  const enrol = await callAdmin('mfa-enroll', { body: {}, token: t1 });
  if (enrol.status !== 200) throw new Error(`enrol ${enrol.status} ${enrol.logs.join('|')}`);
  while (Date.now() % 30000 < 7000 || Date.now() % 30000 > 23000) await new Promise((r) => setTimeout(r, 500)); // stay clear of the step edges (the server clock may differ)
  const ver = await callAdmin('mfa-verify', { body: { code: totp(enrol.json.secret), factorId: enrol.json.factorId }, token: t1 });
  const t2 = ver.json?.accessToken;
  if (!t2) throw new Error(`verify ${ver.status} ${ver.logs.join('|')}`);
  console.log(`aal2 session ready (aal=${claims(t2).aal})`);

  // ── 1 projects-order GET ──
  const g1 = await callAdmin('projects-order', { method: 'GET', token: t2 });
  record('GET  /api/admin/projects-order', g1, g1.status === 200 && Array.isArray(g1.json?.projects) && g1.json.projects.length === PROJECT_SLUGS.length);
  // ── 2 projects-order POST (rotate by one) ──
  const rotated = [...PROJECT_SLUGS.slice(1), PROJECT_SLUGS[0]];
  const p1 = await callAdmin('projects-order', { body: { order: rotated }, token: t2 });
  record('POST /api/admin/projects-order', p1, p1.status === 200 && p1.json?.ok === true);
  const g2 = await callAdmin('projects-order', { method: 'GET', token: t2 });
  record('GET  projects-order shows the saved order', g2, g2.status === 200 && JSON.stringify(g2.json?.projects?.map((p) => p.slug)) === JSON.stringify(rotated) && g2.json?.saved === true);
  // ── 3 public ──
  const pub = await run(orderHandler, '/api/project-order', { method: 'GET' });
  record('GET  /api/project-order (public)', pub, pub.status === 200 && pub.json?.ok === true && JSON.stringify(pub.json?.order) === JSON.stringify(rotated));
  // ── 4 messages ──
  const mg = await callAdmin('messages', { method: 'GET', token: t2 });
  record('GET  /api/admin/messages', mg, mg.status === 200 && Array.isArray(mg.json?.messages) && !JSON.stringify(mg.json).includes('ip_hash'));
  let target = origMsg;
  if (!target) {
    const ins = await rest('POST', '/contact_messages', { name: 'e2e', email: 'e2e@e2e.invalid', subject: 'General', message: 'temporary e2e message', ip_hash: 'a'.repeat(64) });
    console.log(`temp message insert: status=${ins.status} code=${ins.code}`);
    if (ins.status === 201 && ins.data?.[0]?.id) { tmpMsgId = ins.data[0].id; target = { id: tmpMsgId, status: 'new' }; }
  }
  if (target) {
    const a = await callAdmin('messages', { method: 'PATCH', body: { id: target.id, status: 'reading' }, token: t2 });
    record('PATCH messages new→reading', a, a.status === 200 && a.json?.status === 'reading');
    const chk = await rest('GET', `/contact_messages?select=status&id=eq.${target.id}`);
    console.log(`  db status after reading: ${chk.data?.[0]?.status}`);
    const b = await callAdmin('messages', { method: 'PATCH', body: { id: target.id, status: 'new' }, token: t2 });
    record('PATCH messages reading→new', b, b.status === 200 && b.json?.status === 'new');
  } else record('PATCH messages', { status: 0, json: null, logs: [] }, false, 'no message to patch');
  // ── 5 stats + collect ──
  const st = await callAdmin('stats', { method: 'GET', token: t2 });
  const countOf = (r) => (r.json?.stats ?? []).filter((x) => x.day === TODAY && x.event === EVENT).reduce((n, x) => n + x.count, 0);
  record('GET  /api/admin/stats', st, st.status === 200 && Array.isArray(st.json?.stats));
  const before = countOf(st);
  const col = await run(collectHandler, '/api/collect', { body: { e: EVENT } });
  record('POST /api/collect', col, col.status === 204);
  const st2 = await callAdmin('stats', { method: 'GET', token: t2 });
  record('GET  stats shows the new count', st2, st2.status === 200 && countOf(st2) === before + 1, `(count ${before} -> ${countOf(st2)})`);
} catch (error) {
  console.log(`ERROR: ${String(error.message).slice(0, 160)}`);
  results.push(['setup', 0, false]);
} finally {
  // ── restore everything, then prove it ──
  const out = [];
  if (origOrder) {
    const d = await rest('DELETE', '/project_order?position=gte.0', undefined, 'return=minimal');
    let i = { status: 0 };
    if (origOrder.length) i = await rest('POST', '/project_order', origOrder, 'return=minimal');
    const chk = await rest('GET', '/project_order?select=slug,position,updated_at&order=position.asc');
    out.push(`project_order restored: delete=${d.status} insert=${origOrder.length ? i.status : 'n/a'} identical=${JSON.stringify(chk.data) === JSON.stringify(origOrder)} (${chk.data?.length ?? '?'} rows)`);
  }
  if (origMsg) {
    const r = await rest('PATCH', `/contact_messages?id=eq.${origMsg.id}`, { status: origMsg.status }, 'return=minimal');
    const chk = await rest('GET', `/contact_messages?select=status&id=eq.${origMsg.id}`);
    out.push(`message status restored: patch=${r.status} status=${chk.data?.[0]?.status === origMsg.status ? 'identical' : 'DIFFERENT'}`);
  }
  if (tmpMsgId) {
    const r = await rest('DELETE', `/contact_messages?id=eq.${tmpMsgId}`, undefined, 'return=minimal');
    out.push(`temp message deleted: ${r.status}`);
  }
  if (origStat) {
    const r = origStat.existed ? await rest('PATCH', `/analytics_daily?day=eq.${TODAY}&event=eq.${EVENT}`, { count: origStat.count }, 'return=minimal') : await rest('DELETE', `/analytics_daily?day=eq.${TODAY}&event=eq.${EVENT}`, undefined, 'return=minimal');
    const chk = await rest('GET', `/analytics_daily?select=count&day=eq.${TODAY}&event=eq.${EVENT}`);
    const now = chk.data?.[0]?.count ?? 0;
    out.push(`analytics counter restored: status=${r.status} ${now === origStat.count ? 'identical' : 'DIFFERENT'} (row ${chk.data?.length ? 'present' : 'absent'}, was ${origStat.existed ? 'present' : 'absent'})`);
  }
  if (tmpId) {
    const a = await rest('DELETE', `/admins?user_id=eq.${tmpId}`, undefined, 'return=minimal');
    const u = await admin('DELETE', `/users/${tmpId}`);
    const h = await rest('DELETE', `/admin_login_hits?ip_hash=eq.${hashIp(TEST_IP, env.IP_HASH_SALT)}`, undefined, 'return=minimal');
    const gone = await admin('GET', `/users/${tmpId}`);
    const row = await rest('GET', `/admins?user_id=eq.${tmpId}&select=user_id`);
    const hit = await rest('GET', `/admin_login_hits?ip_hash=eq.${hashIp(TEST_IP, env.IP_HASH_SALT)}&select=id`);
    out.push(`temp user: admins delete=${a.status} user delete=${u.status} hits delete=${h.status}; user lookup ${gone.status}; admins rows left=${row.data?.length}; hit rows left=${hit.data?.length}`);
  }
  if (REAL_ADMIN) out.push(`real admin untouched: GET ${(await admin('GET', `/users/${REAL_ADMIN}`)).status}`);
  console.log('CLEANUP:\n  ' + out.join('\n  '));
}
const failed = results.filter((r) => !r[2]).length;
console.log(`${label}: ${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
