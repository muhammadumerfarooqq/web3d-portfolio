// P5: model calls over plain fetch (no SDKs). Keys travel in headers only.
// - Prompt Guard 2 (Groq, meta-llama/llama-prompt-guard-2-86m: multilingual, ~100 ms) returns the
//   probability that a text is a prompt attack; ≥ GUARD_THRESHOLD is flagged.
// - Groq chat completions (OpenAI-compatible) for the answer, Gemini generateContent as the fallback.
// Model ids were taken from each provider's live /models list (18-Nov-2026), not from memory.

export const GROQ_BASE = 'https://api.groq.com/openai/v1';
export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const GUARD_MODEL = 'meta-llama/llama-prompt-guard-2-86m';
export const GUARD_THRESHOLD = 0.9;

/** Highest Prompt Guard score over the texts (parallel; empty texts skipped). Throws on API failure. */
export async function promptGuard(texts, { apiKey, fetch = globalThis.fetch, timeoutMs = 3000 }) {
  const unique = [...new Set(texts.map((t) => String(t ?? '').trim()).filter(Boolean))].slice(0, 7);
  const scores = await Promise.all(
    unique.map(async (content) => {
      const res = await fetch(`${GROQ_BASE}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: GUARD_MODEL, messages: [{ role: 'user', content: content.slice(0, 2000) }] }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`prompt guard ${res.status}`);
      const data = await res.json();
      const score = Number(data.choices?.[0]?.message?.content);
      if (!Number.isFinite(score)) throw new Error('prompt guard: no score');
      return score;
    }),
  );
  return scores.length ? Math.max(...scores) : 0;
}

/** Reasoning models on Groq: keep the reasoning short and out of the reply. */
function groqExtras(model) {
  if (model.startsWith('openai/gpt-oss')) return { reasoning_effort: 'low', include_reasoning: false };
  if (/qwen3|deepseek|-r1/i.test(model)) return { reasoning_format: 'hidden' };
  return {};
}

/** messages: [{ role: 'system' | 'user' | 'assistant', content }]. Returns the reply text. */
export async function groqChat({ messages, model, apiKey, fetch = globalThis.fetch, timeoutMs = 8000, temperature = 0.3, maxTokens = 400 }) {
  const reasoning = Object.keys(groqExtras(model)).length > 0;
  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature, max_completion_tokens: reasoning ? maxTokens + 600 : maxTokens, ...groqExtras(model) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`groq ${res.status}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('groq: empty reply');
  return text;
}

/** Same contract on Gemini: the system prompt as systemInstruction, assistant turns as role "model". */
export async function geminiChat({ messages, model, apiKey, fetch = globalThis.fetch, timeoutMs = 6000, temperature = 0.3, maxTokens = 400 }) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const contents = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const res = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature, maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 } } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}`);
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  if (!text.trim()) throw new Error('gemini: empty reply');
  return text;
}
