// Gemini embeddings over plain fetch (no SDK). Checked against Google's docs (18-Nov-2026):
// POST https://generativelanguage.googleapis.com/v1beta/models/<model>:batchEmbedContents, the key in the
// x-goog-api-key header (never in the URL); gemini-embedding-001 takes taskType and outputDimensionality,
// and vectors below 3072 dimensions must be L2-normalised by the caller.

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const BATCH = 50;

export function normalise(values) {
  const norm = Math.hypot(...values);
  return norm > 0 ? values.map((v) => v / norm) : values;
}

/**
 * Embed texts. taskType: 'RETRIEVAL_DOCUMENT' (index) or 'RETRIEVAL_QUERY' (questions).
 * titles (documents only) improve retrieval. Returns one normalised vector per text.
 */
export async function embedTexts({ texts, taskType, apiKey, model = 'gemini-embedding-001', dim = 768, titles = [], fetch = globalThis.fetch, timeoutMs = 15000 }) {
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    const requests = slice.map((text, j) => ({
      model: `models/${model}`,
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: dim,
      ...(taskType === 'RETRIEVAL_DOCUMENT' && titles[i + j] ? { title: titles[i + j] } : {}),
    }));
    const res = await fetch(`${GEMINI_BASE}/models/${model}:batchEmbedContents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ requests }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`gemini embeddings ${res.status}`);
    const data = await res.json();
    const vectors = (data.embeddings ?? []).map((e) => e.values);
    if (vectors.length !== slice.length || vectors.some((v) => !Array.isArray(v) || v.length !== dim)) throw new Error('gemini embeddings: unexpected response shape');
    out.push(...vectors.map(normalise));
  }
  return out;
}

/** pgvector text form, e.g. "[0.12,-0.03,…]" (PostgREST passes it straight to the vector type). */
export const toPgVector = (values) => `[${values.map((v) => Number(v.toFixed(7))).join(',')}]`;
