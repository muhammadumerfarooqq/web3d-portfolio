// POST /api/chat — "Ask my AI" (Vercel Function, Node, bom1, maxDuration 15 s in vercel.json).
// Order: method → origin → content type → size (≤ 8 KB) → configuration → zod → session token →
// rate limit + daily cap (one SQL call) → prompt-injection / private-data screen (heuristics + Prompt
// Guard 2) → retrieval (Gemini query embedding + hybrid match_chunks) → relevance gate (no LLM below
// RAG_MIN_SIMILARITY) → grounded prompt → Groq (fallback Gemini) → output filter → log → respond
// { answer, sources: [{ title, anchor }], refused }. Errors are generic; logs carry no message text, no IP
// and no secrets; chat_logs keeps the question (≤ 500 chars) for evaluation, with a hashed IP only.
import { chatRequestSchema, CHAT_LIMITS, looksUrdu } from '../src/shared/chat-schema.js';
import { fieldErrors } from '../src/shared/contact-schema.js';
import { readEnv } from './_lib/env.js';
import { clientIp, getHeader, HttpError, isAllowedOrigin, readBody, requestOrigin, safe, sendJson } from './_lib/http.js';
import { logEvent } from './_lib/log.js';
import { checkSession, hashIp } from './_lib/security.js';
import { createSupabase } from './_lib/supabase.js';
import { embedTexts, toPgVector } from './_lib/embed.js';
import { filterAnswer, screenInput } from './_lib/chat-filter.js';
import { NOT_FOUND_MARK, REPLIES, systemPrompt, userTurn } from './_lib/chat-prompt.js';
import { geminiChat, groqChat, GUARD_THRESHOLD, promptGuard } from './_lib/llm.js';

export const CHAT_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'IP_HASH_SALT'];
export const DEFAULTS = { EMBED_MODEL: 'gemini-embedding-001', EMBED_DIM: 768, LLM_MODEL: 'qwen/qwen3.8-27b', LLM_FALLBACK_MODEL: 'gemini-3.5-flash', LLM_SECONDARY_MODEL: 'openai/gpt-oss-120b', STT_MODEL: 'whisper-large-v3', RAG_MIN_SIMILARITY: 0.55, CHAT_DAILY_CAP: 300 };
const MATCH_COUNT = 6;
// What reaches the LLM: the top 5 fused passages, each cut at ~1,200 characters on a sentence boundary
// (project passages lead with their key facts). Keeps a question near 1.5k tokens: Groq's free tier
// allows 8k tokens per minute per model.
export const CONTEXT_PASSAGES = 5;
export const PASSAGE_CHARS = 1200;
export function trimPassage(text, max = PASSAGE_CHARS) {
  const s = String(text);
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'));
  return `${cut.slice(0, end > max * 0.6 ? end + 1 : max).trim()} …`;
}

/** Optional settings with safe defaults and bounds (no secret values here). */
export function chatSettings(env) {
  const num = (name, min, max) => {
    const v = Number(env[name]);
    return Number.isFinite(v) && v >= min && v <= max ? v : DEFAULTS[name];
  };
  const str = (name) => (typeof env[name] === 'string' && /^[\w./:-]{2,80}$/.test(env[name].trim()) ? env[name].trim() : DEFAULTS[name]);
  return { embedModel: str('EMBED_MODEL'), embedDim: num('EMBED_DIM', 128, 3072), llmModel: str('LLM_MODEL'), fallbackModel: str('LLM_FALLBACK_MODEL'), secondaryModel: str('LLM_SECONDARY_MODEL'), sttModel: str('STT_MODEL'), minSimilarity: num('RAG_MIN_SIMILARITY', 0, 1), dailyCap: num('CHAT_DAILY_CAP', 0, 100000) };
}

/**
 * Is this reply the refusal itself ("That's not in my case files…", in any of the three languages)?
 * Only the START counts: an answer that gives facts and then adds a caveat ("…that is not in my case
 * files") is still an answer, with its sources.
 */
export function isRefusal(answer) {
  const start = String(answer).replace(/^["'“”‘’«»([*_s]+/, '').replace(/[\u2019\u2018]/g, "'").toLowerCase();
  return [NOT_FOUND_MARK, 'yeh baat meri case files mein nahin', 'یہ بات میری کیس فائلوں میں نہیں'].some((m) => start.startsWith(m.replace(/[\u2019\u2018]/g, "'").toLowerCase()));
}
export function createChatHandler({ env = process.env, fetch = globalThis.fetch, now = Date.now, log = logEvent } = {}) {
  return async function chat(req, res) {
    const t0 = now();
    const fail = (status, error, extra = {}, headers = {}) => {
      log('chat', { status, reason: error, ms: now() - t0 });
      return sendJson(res, status, { ok: false, error, ...extra }, headers);
    };

    if (req.method !== 'POST') return fail(405, 'method_not_allowed', {}, { Allow: 'POST' });
    if (!isAllowedOrigin(requestOrigin(req))) return fail(403, 'forbidden');
    if (!/^application\/json(?:\s*;|$)/.test(String(getHeader(req, 'content-type') ?? '').toLowerCase())) return fail(415, 'unsupported_media_type');
    let raw;
    try {
      raw = await readBody(req, CHAT_LIMITS.body);
    } catch (error) {
      return error instanceof HttpError ? fail(error.status, error.code) : fail(400, 'bad_request');
    }

    const config = readEnv(CHAT_ENV, env);
    if (!config.ok) {
      log('chat_config', { status: 503, missing: config.missing });
      return sendJson(res, 503, { ok: false, error: 'not_configured' });
    }
    const cfg = config.values;
    const settings = chatSettings(env);

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return fail(400, 'invalid_json');
    }
    const parsed = chatRequestSchema.safeParse(body);
    if (!parsed.success) {
      const fields = fieldErrors(parsed.error);
      return fields.message ? fail(400, 'invalid', { fields: { message: fields.message } }) : fail(400, 'bad_request');
    }
    const { message, history, session } = parsed.data;
    const lang = looksUrdu(message) ? 'ur' : parsed.data.lang;

    const ip = clientIp(req);
    const ipHash = hashIp(ip, cfg.IP_HASH_SALT);
    const sess = checkSession(session, now(), ipHash, cfg.IP_HASH_SALT);
    if (!sess.ok) return fail(401, 'session', { reason: sess.reason });

    const db = createSupabase({ url: cfg.SUPABASE_URL, key: cfg.SUPABASE_SERVICE_ROLE_KEY, fetch });
    let gate;
    try {
      gate = await db.rpc('chat_submit', { p_ip_hash: ipHash, p_daily_cap: settings.dailyCap });
    } catch {
      return fail(500, 'server_error');
    }
    if (!gate?.allowed) {
      const retry = Math.max(1, Math.ceil(Number(gate?.retry_after) || 600));
      if (gate?.reason === 'daily') return fail(503, 'resting', { retryAfter: retry }, { 'Retry-After': String(retry) });
      return fail(429, 'rate_limited', { retryAfter: retry }, { 'Retry-After': String(retry) });
    }

    const userAgent = String(getHeader(req, 'user-agent') ?? '').slice(0, 200);
    const record = async (row) => {
      try {
        await db.insert('chat_logs', [{ ip_hash: ipHash, lang, question: message.slice(0, 500), user_agent: userAgent, latency_ms: now() - t0, flagged: false, ...row }]);
      } catch {
        log('chat_log', { reason: 'insert_failed' });
      }
    };
    const reply = async (answer, sources, refused, row = {}) => {
      await record({ answer_chars: answer.length, source_slugs: sources.map((s) => s.anchor), refused, ...row });
      log('chat', { status: 200, reason: row.flagged ? 'flagged' : refused ? 'refused' : 'answered', ms: now() - t0 });
      return sendJson(res, 200, { ok: true, answer, sources, refused });
    };

    // ── screen: heuristics first (free), then Prompt Guard 2 on the message and every history turn ──
    // The current message is checked for both; earlier turns only for injection. A request for private data in
    // an earlier turn was already answered with the fixed reply and must not make later questions refuse.
    const turns = [message, ...history.filter((h) => h.role === 'user').map((h) => h.content)];
    const heuristic = turns.some((t) => screenInput(t) === 'injection') ? 'injection' : screenInput(message);
    if (heuristic === 'injection') return reply(REPLIES.injection[lang], [], true, { flagged: true, provider: 'screen' });
    if (heuristic === 'private') return reply(REPLIES.private[lang], [], true, { provider: 'screen' });
    try {
      const score = await promptGuard([...turns, ...history.filter((h) => h.role === 'assistant').map((h) => h.content)], { apiKey: cfg.GROQ_API_KEY, fetch });
      if (score >= GUARD_THRESHOLD) return reply(REPLIES.injection[lang], [], true, { flagged: true, provider: 'prompt-guard' });
    } catch {
      log('chat_guard', { reason: 'unavailable' }); // heuristics already ran; the prompt rules still hold
    }

    // ── retrieval: a short follow-up borrows the previous question for context ──
    const lastUser = [...history].reverse().find((h) => h.role === 'user')?.content ?? '';
    const query = message.length < 60 && lastUser ? `${lastUser}\n${message}` : message;
    let hits;
    try {
      const [vector] = await embedTexts({ texts: [query], taskType: 'RETRIEVAL_QUERY', apiKey: cfg.GEMINI_API_KEY, model: settings.embedModel, dim: settings.embedDim, fetch, timeoutMs: 5000 });
      hits = (await db.rpc('match_chunks', { query_embedding: toPgVector(vector), query_text: query, match_count: MATCH_COUNT, min_similarity: 0 })) ?? [];
    } catch {
      return fail(500, 'server_error');
    }
    const best = hits.reduce((m, h) => Math.max(m, Number(h.similarity) || 0), 0);
    if (best < settings.minSimilarity) return reply(REPLIES.notFound[lang], [], true, { provider: 'gate' });

    // ── grounded answer ──
    const context = hits.slice(0, CONTEXT_PASSAGES).map((h) => ({ ...h, content: trimPassage(h.content) }));
    const messages = [{ role: 'system', content: systemPrompt(lang) }, ...history.map((h) => ({ role: h.role, content: h.content })), { role: 'user', content: userTurn(message, context) }];
    // Groq first; on an error or timeout Gemini (LLM_FALLBACK_MODEL); then a second Groq model, which has
    // its own rate limit. Every call is capped by what is left of a 13.5 s budget (maxDuration is 15 s).
    const deadline = t0 + 13500;
    const attempts = [
      ['groq', settings.llmModel, 7000],
      ['gemini', settings.fallbackModel, 4500],
      ['groq', settings.secondaryModel, 4000],
    ];
    let text = '';
    let provider = null;
    let model = null;
    for (const [p, m, cap] of attempts) {
      const left = Math.min(cap, deadline - now());
      if (left < 800) break;
      try {
        text = await (p === 'groq' ? groqChat : geminiChat)({ messages, model: m, apiKey: p === 'groq' ? cfg.GROQ_API_KEY : cfg.GEMINI_API_KEY, fetch, timeoutMs: left });
        provider = p;
        model = m;
        break;
      } catch {
        log('chat_llm', { reason: `${p}_failed`, ms: now() - t0 });
      }
    }
    if (!provider) return fail(502, 'llm_unavailable');

    const { text: answer, sources } = filterAnswer(text, context);
    const refused = isRefusal(answer);
    return reply(answer || REPLIES.notFound[lang], refused ? [] : sources, refused || !answer, { provider, model });
  };
}

export default safe(createChatHandler(), 'chat');
