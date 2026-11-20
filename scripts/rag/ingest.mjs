// P5: build the chatbot's knowledge base. `npm run rag:ingest` (reads .env; values are never printed).
//   --dry-run   no network: build and print the chunks, then stop.
// Steps: /content → documents + chunks (scripts/rag/chunk.mjs, with the PII guard) → upsert documents
// by slug → embed only chunks whose content_hash is new (Gemini, RETRIEVAL_DOCUMENT, 768-d, normalised)
// → insert them → delete chunks and documents that no longer exist. Uses the service role key (server
// side only) through PostgREST with plain fetch.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createSupabase } from '../../api/_lib/supabase.js';
import { embedTexts, toPgVector } from '../../api/_lib/embed.js';
import { buildKnowledgeBase } from './chunk.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const dryRun = process.argv.includes('--dry-run');

if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));
const MODEL = process.env.EMBED_MODEL?.trim() || 'gemini-embedding-001';
const DIM = Number(process.env.EMBED_DIM) || 768;

const kb = buildKnowledgeBase(ROOT, { model: MODEL, dim: DIM });
if (!kb.cvFiles.length) console.log('content/cv/ has no CV text: the CV is not in the index (LIMITATIONS L118).');

if (dryRun) {
  for (const c of kb.chunks) {
    console.log(`\n── ${c.slug} #${c.ord} · ${c.token_estimate} tokens · #${c.anchor} · ${c.heading}`);
    console.log(c.content);
  }
  console.log(`\nDRY RUN: ${kb.docs.length} documents, ${kb.chunks.length} chunks (model ${MODEL}, ${DIM} dims). Nothing was sent.`);
  process.exit(0);
}

const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GEMINI_API_KEY'].filter((n) => !process.env[n]?.trim());
if (missing.length) {
  console.error(`rag:ingest: missing env vars: ${missing.join(', ')} (set them in .env)`);
  process.exit(1);
}
const db = createSupabase({ url: process.env.SUPABASE_URL.trim(), key: process.env.SUPABASE_SERVICE_ROLE_KEY.trim(), fetch });

const t0 = Date.now();
const existingChunks = (await db.select('chunks', 'select=id,content_hash')) ?? [];
const existingDocs = (await db.select('documents', 'select=id,slug')) ?? [];

// documents: upsert by slug
const docRows = kb.docs.map((d) => ({ slug: d.slug, title: d.title, anchor: d.anchor, source_path: d.source_path, content_hash: d.content_hash, updated_at: new Date().toISOString() }));
const savedDocs = await db.upsert('documents', docRows, 'slug');
const docId = new Map(savedDocs.map((d) => [d.slug, d.id]));

// chunks: embed only what is new
const known = new Set(existingChunks.map((c) => c.content_hash));
const fresh = kb.chunks.filter((c) => !known.has(c.content_hash));
let embedded = 0;
if (fresh.length) {
  const vectors = await embedTexts({ texts: fresh.map((c) => c.content), titles: fresh.map((c) => c.title), taskType: 'RETRIEVAL_DOCUMENT', apiKey: process.env.GEMINI_API_KEY.trim(), model: MODEL, dim: DIM });
  const rows = fresh.map((c, i) => ({ document_id: docId.get(c.slug), ord: c.ord, heading: c.heading, content: c.content, anchor: c.anchor, token_estimate: c.token_estimate, embedding: toPgVector(vectors[i]), content_hash: c.content_hash }));
  await db.upsert('chunks', rows, 'content_hash');
  embedded = rows.length;
}

// clean up what no longer exists (chunks first, then documents; documents cascade anyway)
const wanted = new Set(kb.chunks.map((c) => c.content_hash));
const staleChunks = existingChunks.filter((c) => !wanted.has(c.content_hash)).map((c) => c.id);
if (staleChunks.length) await db.remove('chunks', `id=in.(${staleChunks.join(',')})`);
const slugs = new Set(kb.docs.map((d) => d.slug));
const staleDocs = existingDocs.filter((d) => !slugs.has(d.slug)).map((d) => d.id);
if (staleDocs.length) await db.remove('documents', `id=in.(${staleDocs.join(',')})`);

console.log(`rag:ingest done in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${kb.docs.length} documents, ${kb.chunks.length} chunks, ${embedded} embedded, ${kb.chunks.length - embedded} skipped (unchanged), ${staleChunks.length} chunks + ${staleDocs.length} documents deleted. Model ${MODEL}, ${DIM} dims.`);
