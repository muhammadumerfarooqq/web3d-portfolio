// P11 C1: prove the database lockdown against the LIVE Supabase project. `npm run rls:verify` (reads .env;
// prints statuses, counts and names only, never keys or row content).
// 1. Discover every table and function exposed in the public schema (service role OpenAPI document, merged
//    with the ones declared in supabase/migrations/*.sql, so a new table cannot be forgotten).
// 2. Try the ANON key on ALL of them: read, insert, update and delete on every table, and a call to every
//    function (with arguments that would be rejected by a CHECK constraint if the call were ever allowed, so
//    a mistake in the grants cannot create or change a row). Only HTTP 401 / 403 / 404 count as denied; a
//    200 with an empty list is accepted for reads only (RLS filtering), never for writes or functions.
// 3. Look at the exposed surface the anon key gets: the OpenAPI document, storage buckets, auth settings.
// 4. Privacy: every ip_hash column holds only 64-hex hashes (no raw IP), no column can hold audio, and the
//    age of the oldest rows (for the retention notes and supabase/maintenance/purge.sql).
// The catalog checks that REST cannot show (relrowsecurity, relforcerowsecurity, pg_policies, grants) are in
// supabase/maintenance/audit-rls.sql, read-only, for the Supabase SQL editor.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));
const env = (n) => process.env[n]?.trim() ?? '';
const url = env('SUPABASE_URL').replace(/\/+$/, '');
const need = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_ANON_KEY'].filter((n) => !env(n));
if (need.length) {
  console.error(`rls:verify: missing env vars: ${need.join(', ')}`);
  process.exit(1);
}
const svc = { apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}` };
const anon = { apikey: env('VITE_SUPABASE_ANON_KEY'), Authorization: `Bearer ${env('VITE_SUPABASE_ANON_KEY')}`, 'Content-Type': 'application/json' };
let failures = 0;
let warnings = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
};
const warn = (label) => {
  console.log(`WARN  ${label}`);
  warnings += 1;
};
const DENIED = new Set([401, 403, 404]);
const req = (method, path, headers, body) => fetch(`${url}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });

// ── 1. what exists ──
const sql = readdirSync(join(ROOT, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql')).map((f) => readFileSync(join(ROOT, 'supabase', 'migrations', f), 'utf8')).join('\n');
const declaredTables = [...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map((m) => m[1]);
const declaredFns = [...sql.matchAll(/create (?:or replace )?function public\.(\w+)\(/gi)].map((m) => m[1]);
const tables = new Set(declaredTables);
const fns = new Set(declaredFns);
const open = await req('GET', '/rest/v1/', svc).then((r) => (r.ok ? r.json() : null)).catch(() => null);
if (open?.paths) {
  for (const p of Object.keys(open.paths)) {
    if (p.startsWith('/rpc/')) fns.add(p.slice(5));
    else if (p !== '/') tables.add(p.slice(1));
  }
  console.log(`service role OpenAPI lists ${[...Object.keys(open.paths)].filter((p) => p !== '/').length} paths`);
} else warn('could not read the service-role OpenAPI document; using the tables and functions declared in supabase/migrations');
if (open?.paths) {
  // A table declared in a migration but missing in the database would be "denied" with a 404 for the wrong reason.
  for (const t of declaredTables) if (!open.paths[`/${t}`]) warn(`table ${t} is declared in supabase/migrations but is NOT in the database: run the latest migration, then run this check again`);
  for (const f of declaredFns) if (!open.paths[`/rpc/${f}`]) warn(`function ${f}() is declared in supabase/migrations but is NOT in the database: run the latest migration, then run this check again`);
}
console.log(`tables to probe (${tables.size}): ${[...tables].sort().join(', ')}`);
console.log(`functions to probe (${fns.size}): ${[...fns].sort().join(', ')}\n`);
check(tables.size >= 5, 'at least the five known tables are covered (contact_messages, documents, chunks, chat_logs, chat_hits)');

// ── 2. anon against everything ──
// A filter and a body that are valid for the table's id type but match no row (a 400 would only prove the
// request was malformed, before any privilege check).
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const idType = (t) => (new RegExp(String.raw`create table (?:if not exists )?public\.${t}\s*\(\s*id (uuid|bigint)`, 'i').exec(sql)?.[1] ?? 'bigint').toLowerCase();
// A plain column to "update" where id is GENERATED ALWAYS (setting it is rejected while the query is analysed, before any privilege check).
const PATCH_COL = { documents: 'title', chunks: 'heading', chat_hits: 'ip_hash', admin_login_hits: 'ip_hash' };
// P7: tables whose key is not "id". The filter must match no row; the patch must be a plain, valid column.
const KEYED = { admins: { filter: `user_id=eq.${ZERO_UUID}`, patch: { created_at: '1970-01-01T00:00:00Z' } }, project_order: { filter: 'slug=eq.zz-no-such-slug', patch: { position: 0 } }, analytics_daily: { filter: 'day=eq.1970-01-01&event=eq.zz', patch: { count: 0 } } };
const noRow = (t) => (idType(t) === 'uuid' ? ZERO_UUID : -1);
const rowFilter = (t) => KEYED[t]?.filter ?? `id=eq.${noRow(t)}`;
const patchBody = (t) => KEYED[t]?.patch ?? (t in PATCH_COL ? { [PATCH_COL[t]]: 'x' } : { id: noRow(t) });
for (const t of [...tables].sort()) {
  const read = await req('GET', `/rest/v1/${t}?select=*&limit=1`, anon);
  const rows = read.ok ? await read.json().catch(() => null) : null;
  check(DENIED.has(read.status) || (read.ok && Array.isArray(rows) && rows.length === 0), `anon cannot read ${t} (HTTP ${read.status}${read.ok ? `, ${rows?.length} rows` : ''})`);
  const ins = await req('POST', `/rest/v1/${t}`, { ...anon, Prefer: 'return=minimal' }, {});
  check(DENIED.has(ins.status), `anon cannot insert into ${t} (HTTP ${ins.status})`);
  const upd = await req('PATCH', `/rest/v1/${t}?${rowFilter(t)}`, { ...anon, Prefer: 'return=minimal' }, patchBody(t));
  check(DENIED.has(upd.status), `anon cannot update ${t} (HTTP ${upd.status})`);
  const del = await req('DELETE', `/rest/v1/${t}?${rowFilter(t)}`, { ...anon, Prefer: 'return=minimal' });
  check(DENIED.has(del.status), `anon cannot delete from ${t} (HTTP ${del.status})`);
}
// Arguments that a CHECK constraint or a type error would reject, so even a wrongly granted function changes nothing.
const BAD_HASH = 'not-a-hash';
const zeroVector = `[${Array.from({ length: 768 }, () => 0).join(',')}]`;
const ARGS = {
  contact_submit: { p_ip_hash: BAD_HASH, p_name: 'x', p_email: 'x', p_subject: 'x', p_message: 'x', p_user_agent: 'x' },
  chat_submit: { p_ip_hash: BAD_HASH, p_daily_cap: 0 },
  stt_submit: { p_ip_hash: BAD_HASH, p_daily_cap: 0 },
  admin_login_submit: { p_ip_hash: BAD_HASH, p_kind: 'login' },
  analytics_bump: { p_event: 'not-an-event', p_cap: 0 }, // P10: an event the CHECK constraint rejects
  project_order_save: { p_slugs: ['BAD SLUG'] }, // rejected by the function's own validation before anything is deleted
  match_chunks: { query_embedding: zeroVector, query_text: 'x', match_count: 1, min_similarity: 0 },
};
for (const f of [...fns].sort()) {
  const res = await req('POST', `/rest/v1/rpc/${f}`, anon, ARGS[f] ?? {});
  check(DENIED.has(res.status), `anon cannot call ${f}() (HTTP ${res.status})${ARGS[f] ? '' : ' [no sample arguments: only a missing-function answer proves nothing]'}`);
}

// ── 3. what the anon key can see ──
const anonOpen = await req('GET', '/rest/v1/', anon);
if (anonOpen.ok) {
  const doc = await anonOpen.json().catch(() => ({}));
  const exposed = Object.keys(doc.paths ?? {}).filter((p) => p !== '/');
  check(exposed.length === 0, `the anon OpenAPI document exposes no table or function (${exposed.length} paths${exposed.length ? `: ${exposed.join(', ')}` : ''})`);
} else check(DENIED.has(anonOpen.status), `the anon OpenAPI document is refused (HTTP ${anonOpen.status})`);
const buckets = await req('GET', '/storage/v1/bucket', anon);
const bucketList = buckets.ok ? await buckets.json().catch(() => null) : null;
check(DENIED.has(buckets.status) || (Array.isArray(bucketList) && bucketList.length === 0), `anon sees no storage buckets (HTTP ${buckets.status}${Array.isArray(bucketList) ? `, ${bucketList.length} buckets` : ''})`);
const settings = await req('GET', '/auth/v1/settings', { apikey: env('VITE_SUPABASE_ANON_KEY') });
if (settings.ok) {
  const s = await settings.json().catch(() => ({}));
  console.log(`INFO  auth settings: disable_signup=${s.disable_signup} mailer_autoconfirm=${s.mailer_autoconfirm} external providers enabled=${Object.entries(s.external ?? {}).filter(([k, v]) => v === true && k !== 'email').map(([k]) => k).join(',') || 'none'}`);
  if (s.disable_signup !== true) warn('email signups are ENABLED: anyone can create an "authenticated" user. They would still be denied everywhere (no grants), but disable signups in Authentication → Sign In / Providers until the P7 admin login needs them');
}

// ── 4. privacy and retention ──
const count = async (t) => {
  const r = await req('GET', `/rest/v1/${t}?select=id&limit=1`, { ...svc, Prefer: 'count=exact' });
  const range = r.headers.get('content-range') ?? '';
  return r.ok ? Number(range.split('/')[1]) : null;
};
for (const [t, col] of [['contact_messages', 'ip_hash'], ['chat_logs', 'ip_hash'], ['chat_hits', 'ip_hash']]) {
  const n = await count(t);
  const r = await req('GET', `/rest/v1/${t}?select=${col}&limit=1000`, svc);
  const rows = r.ok ? await r.json() : [];
  check(r.ok && rows.every((x) => /^[0-9a-f]{64}$/.test(String(x[col]))), `${t}: ${n} rows, every ${col} is a 64-hex salted hash (no raw IP)`);
}
for (const [t, days] of [['chat_logs', 90], ['contact_messages', 365]]) {
  const r = await req('GET', `/rest/v1/${t}?select=created_at&order=created_at.asc&limit=1`, svc);
  const [oldest] = r.ok ? await r.json() : [];
  if (oldest) {
    const age = Math.floor((Date.now() - new Date(oldest.created_at).getTime()) / 86_400_000);
    console.log(`INFO  ${t}: oldest row is ${age} day(s) old (purge.sql removes rows older than ${days} days${age > days ? ': PURGE DUE' : ''})`);
  } else console.log(`INFO  ${t}: no rows`);
}
check(!/\bbytea\b|\baudio\b|\blo_|\bblob\b/i.test(sql.replace(/--.*$/gm, '')), 'no column in the migrations can hold audio or files (no bytea / blob / large objects)');

console.log(`\n${failures ? `${failures} check(s) FAILED` : 'all checks passed'}${warnings ? `, ${warnings} warning(s)` : ''}`);
process.exitCode = failures ? 1 : 0;
