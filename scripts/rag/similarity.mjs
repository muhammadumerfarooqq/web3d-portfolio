// P5: how well does the relevance gate separate answerable from unanswerable questions? `npm run rag:similarity`
// prints the best retrieval similarity (hybrid match_chunks, top 6) for every question in tests/rag/eval.json
// and the gap between the lowest answerable and the highest unanswerable score. Embeddings + database only
// (no LLM call). Used to choose RAG_MIN_SIMILARITY; the result is summarised in docs/reports/rag-eval.md.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSupabase } from '../../api/_lib/supabase.js';
import { embedTexts, toPgVector } from '../../api/_lib/embed.js';

const ROOT = join(import.meta.dirname, '..', '..');
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));
const env = (n) => process.env[n]?.trim() ?? '';
const { questions } = JSON.parse(readFileSync(join(ROOT, 'tests', 'rag', 'eval.json'), 'utf8'));
const db = createSupabase({ url: env('SUPABASE_URL'), key: env('SUPABASE_SERVICE_ROLE_KEY'), fetch });
const vectors = await embedTexts({ texts: questions.map((q) => q.q), taskType: 'RETRIEVAL_QUERY', apiKey: env('GEMINI_API_KEY'), model: env('EMBED_MODEL') || 'gemini-embedding-001', dim: Number(env('EMBED_DIM')) || 768 });
const rows = [];
for (const [i, q] of questions.entries()) {
  const hits = await db.rpc('match_chunks', { query_embedding: toPgVector(vectors[i]), query_text: q.q, match_count: 6, min_similarity: 0 });
  rows.push({ id: q.id, refuse: Boolean(q.refuse), best: Math.max(...hits.map((h) => h.similarity)) });
}
for (const r of rows) console.log(r.id, r.refuse ? 'unanswerable' : 'answerable  ', r.best.toFixed(3));
const answerable = rows.filter((r) => !r.refuse).map((r) => r.best);
const unanswerable = rows.filter((r) => r.refuse).map((r) => r.best);
const lo = Math.min(...answerable);
const hi = Math.max(...unanswerable);
console.log(`\nlowest answerable ${lo.toFixed(3)} · highest unanswerable ${hi.toFixed(3)} · ${lo > hi ? `separable, midpoint ${((lo + hi) / 2).toFixed(3)}` : 'NOT separable by similarity alone (the grounded prompt and the private-data screen carry the refusals)'}`);
console.log(`configured gate RAG_MIN_SIMILARITY = ${env('RAG_MIN_SIMILARITY') || '(default 0.55)'}`);
