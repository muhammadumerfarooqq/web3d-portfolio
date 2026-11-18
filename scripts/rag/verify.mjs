// P5: check the live knowledge base and its lockdown. `npm run rag:verify` (reads .env; prints counts and
// HTTP statuses only, never keys or content).
// 1. service role: documents / chunks counted, every chunk has a 768-d unit-length embedding, and a real
//    match_chunks query returns ranked chunks.
// 2. anon key: documents, chunks, chat_logs and chat_hits can NOT be read, and match_chunks / chat_submit
//    can NOT be called (expect HTTP 401/403/404 or an empty list).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createSupabase } from '../../api/_lib/supabase.js';
import { embedTexts, toPgVector } from '../../api/_lib/embed.js';

const ROOT = join(import.meta.dirname, '..', '..');
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));
const env = (n) => process.env[n]?.trim() ?? '';
const url = env('SUPABASE_URL').replace(/\/+$/, '');
const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_ANON_KEY', 'GEMINI_API_KEY'].filter((n) => !env(n));
if (missing.length) {
  console.error(`rag:verify: missing env vars: ${missing.join(', ')}`);
  process.exit(1);
}

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
};

// 1. service role
const db = createSupabase({ url, key: env('SUPABASE_SERVICE_ROLE_KEY'), fetch });
const docs = await db.select('documents', 'select=id');
const chunks = await db.select('chunks', 'select=id,embedding,token_estimate');
check(docs.length > 0, `service role reads documents (${docs.length})`);
check(chunks.length > 0, `service role reads chunks (${chunks.length})`);
const vectors = chunks.map((c) => (typeof c.embedding === 'string' ? JSON.parse(c.embedding) : c.embedding));
check(vectors.every((v) => Array.isArray(v) && v.length === 768), 'every chunk has a 768-d embedding (no nulls)');
check(vectors.every((v) => Math.abs(Math.hypot(...v) - 1) < 1e-3), 'every embedding is L2-normalised');
const [q] = await embedTexts({ texts: ['What did Umer build at Axisero?'], taskType: 'RETRIEVAL_QUERY', apiKey: env('GEMINI_API_KEY'), model: env('EMBED_MODEL') || 'gemini-embedding-001', dim: Number(env('EMBED_DIM')) || 768 });
const hits = await db.rpc('match_chunks', { query_embedding: toPgVector(q), query_text: 'What did Umer build at Axisero?', match_count: 6, min_similarity: 0 });
check(Array.isArray(hits) && hits.length > 0, `match_chunks returns ${hits?.length ?? 0} ranked chunks (best similarity ${hits?.[0] ? Math.max(...hits.map((h) => h.similarity)).toFixed(3) : 'n/a'}; top anchors: ${hits?.slice(0, 3).map((h) => h.anchor).join(', ')})`);

// 2. anon key: everything refused
const anonHeaders = { apikey: env('VITE_SUPABASE_ANON_KEY'), Authorization: `Bearer ${env('VITE_SUPABASE_ANON_KEY')}`, 'Content-Type': 'application/json' };
for (const table of ['documents', 'chunks', 'chat_logs', 'chat_hits']) {
  const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, { headers: anonHeaders });
  const body = res.ok ? await res.json() : null;
  check(!res.ok || (Array.isArray(body) && body.length === 0), `anon cannot read ${table} (HTTP ${res.status}${res.ok ? `, ${body.length} rows` : ''})`);
}
for (const [fn, args] of [['match_chunks', { query_embedding: toPgVector(q), query_text: 'x', match_count: 1, min_similarity: 0 }], ['chat_submit', { p_ip_hash: '0'.repeat(64), p_daily_cap: 1 }]]) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: anonHeaders, body: JSON.stringify(args) });
  check(!res.ok, `anon cannot call ${fn} (HTTP ${res.status})`);
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;
