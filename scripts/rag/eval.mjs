// P5: evaluate "Ask my AI" on tests/rag/eval.json. `npm run rag:eval -- [--model <groq id>] [--min-sim 0.55]
// [--gap 12] [--out docs/reports/rag-eval.md]`. Runs the REAL /api/chat handler in-process (same code as
// the dev server and Vercel) against the live knowledge base, with a server-signed session (Turnstile is
// a browser check). Each question gets its own synthetic IP, so the per-IP rate limit does not skew it.
// Measures: answerable correctness (every expected fact present, not refused), refusals (5 must refuse),
// citation validity (every cited anchor exists in the index; at least one expected source cited),
// latency p50 / p95, and how often the fallback chain was needed. Appends a section to the report.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createChatHandler } from '../../api/chat.js';
import { hashIp, issueSession } from '../../api/_lib/security.js';
import { buildKnowledgeBase } from './chunk.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));
const env = { ...process.env };
if (arg('model')) env.LLM_MODEL = arg('model');
if (arg('min-sim')) env.RAG_MIN_SIMILARITY = arg('min-sim');
const gapMs = Number(arg('gap', '12')) * 1000;
const out = join(ROOT, arg('out', 'docs/reports/rag-eval.md'));
const salt = env.IP_HASH_SALT?.trim();
if (!salt) throw new Error('rag:eval needs IP_HASH_SALT in .env');

const { questions } = JSON.parse(readFileSync(join(ROOT, 'tests', 'rag', 'eval.json'), 'utf8'));
const anchors = new Set(buildKnowledgeBase(ROOT).chunks.map((c) => c.anchor));
// Compare without case, zero-width / Arabic vowel marks and typographic variants (no-break and thin spaces, non-breaking hyphens, curly quotes).
const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[\u200C\u200E\u200F\u064B-\u065F\u0670]/g, '')
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u2018\u2019]/g, "'");

let fallbacks = 0;
const handler = createChatHandler({
  env,
  log: (event, fields) => {
    if (event === 'chat_llm') fallbacks += 1;
  },
});

async function ask(q, i) {
  const ip = `10.250.${Math.floor(i / 250)}.${(i % 250) + 1}`;
  const session = issueSession(Date.now(), hashIp(ip, salt), salt);
  const req = Readable.from([Buffer.from(JSON.stringify({ message: q.q, lang: q.lang, session }))]);
  req.method = 'POST';
  req.headers = { origin: 'http://localhost:5173', 'content-type': 'application/json', 'x-real-ip': ip, 'user-agent': 'rag-eval' };
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  const before = fallbacks;
  const t = Date.now();
  await handler(req, res);
  const ms = Date.now() - t;
  const body = JSON.parse(res.body ?? '{}');
  return { status: res.statusCode, ms, body, fellBack: fallbacks > before };
}

const rows = [];
const t0 = Date.now();
for (const [i, q] of questions.entries()) {
  const r = await ask(q, i + Math.floor(Math.random() * 1000) * 20);
  const answer = String(r.body.answer ?? '');
  const cited = (r.body.sources ?? []).map((s) => s.anchor);
  const citationsValid = cited.every((a) => anchors.has(a));
  let pass;
  let why = '';
  if (q.refuse) {
    pass = r.status === 200 && r.body.refused === true;
    if (!pass) why = r.status !== 200 ? `HTTP ${r.status}` : 'answered instead of refusing';
  } else {
    const missing = (q.facts ?? []).filter((alts) => !alts.some((f) => norm(answer).includes(norm(f))));
    const sourceHit = cited.some((a) => q.sources.includes(a));
    pass = r.status === 200 && !r.body.refused && missing.length === 0 && citationsValid && sourceHit;
    if (!pass) why = r.status !== 200 ? `HTTP ${r.status}` : r.body.refused ? 'refused' : missing.length ? `missing ${missing.map((m) => m[0]).join(', ')}` : !citationsValid ? 'invalid citation' : 'no expected source cited';
  }
  rows.push({ ...q, pass, why, ms: r.ms, status: r.status, refused: r.body.refused, cited, citationsValid, fellBack: r.fellBack, answer });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${q.id} ${String(r.ms).padStart(5)}ms ${r.fellBack ? '(fallback) ' : ''}${why}`);
  if (i < questions.length - 1) await new Promise((res) => setTimeout(res, gapMs));
}

const answerable = rows.filter((r) => !r.refuse);
const refusals = rows.filter((r) => r.refuse);
const ms = rows.filter((r) => r.status === 200).map((r) => r.ms).sort((a, b) => a - b);
const pct = (p) => (ms.length ? ms[Math.min(ms.length - 1, Math.ceil((p / 100) * ms.length) - 1)] : 0);
const summary = {
  model: env.LLM_MODEL ?? '(default)',
  minSimilarity: env.RAG_MIN_SIMILARITY ?? '(default)',
  answerable: `${answerable.filter((r) => r.pass).length}/${answerable.length}`,
  accuracy: answerable.length ? answerable.filter((r) => r.pass).length / answerable.length : 0,
  refusals: `${refusals.filter((r) => r.pass).length}/${refusals.length}`,
  citationsValid: rows.every((r) => r.citationsValid),
  p50: pct(50),
  p95: pct(95),
  fallbacks: rows.filter((r) => r.fellBack).length,
};
console.log(JSON.stringify(summary, null, 1));

const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 240);
const section = [
  `\n## ${summary.model} · min similarity ${summary.minSimilarity} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  '',
  `- **Answerable correct:** ${summary.answerable} (${Math.round(summary.accuracy * 100)}%) · **Refusals:** ${summary.refusals} · **Citations valid:** ${summary.citationsValid ? 'yes' : 'no'} · **Latency:** p50 ${summary.p50} ms, p95 ${summary.p95} ms · **Fallback used:** ${summary.fallbacks}/${rows.length} · run ${((Date.now() - t0) / 1000).toFixed(0)} s (${gapMs / 1000} s gap between questions for Groq's free-tier token limit)`,
  '',
  '| ID | Lang | Question | Result | ms | Sources | Answer (start) |',
  '|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.id} | ${r.lang} | ${esc(r.q)} | ${r.pass ? '✅' : `❌ ${esc(r.why)}`}${r.fellBack ? ' (fallback)' : ''} | ${r.ms} | ${r.cited.join(', ')} | ${esc(r.answer)} |`),
  '',
].join('\n');
if (!existsSync(out)) writeFileSync(out, '# RAG evaluation ("Ask my AI")\n\nGenerated by `npm run rag:eval` from `tests/rag/eval.json`: 15 answerable questions (3 in Urdu / Roman Urdu) and 5 that must be refused, run through the real `/api/chat` handler against the live knowledge base. A question passes when every expected fact is in the answer, it is not refused, every citation points at an existing anchor and at least one expected source is cited.\n');
appendFileSync(out, section);
console.log(`report: ${out.slice(ROOT.length + 1)}`);
