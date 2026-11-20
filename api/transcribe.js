// POST /api/transcribe — speech to text for the chat's microphone button (Vercel Function, Node, bom1,
// maxDuration 15 s in vercel.json). The body is the raw recording.
// Order: method → origin → audio content type (webm | ogg | mp4 | wav) → declared size (≤ 2 MB) → configuration →
// language header → chat session (X-Chat-Session, from GET /api/chat-token) → body read (≤ 2 MB) → rate limit + the shared daily
// cap (stt_submit: 10 per 10 minutes per hashed IP) → container signature + WAV length → Groq Whisper
// (STT_MODEL) → length check (≤ 30 s) → Devanagari → Roman transliteration (only if Whisper wrote Devanagari) → cleaning → the chat's injection and private-data screens (heuristics
// + Prompt Guard 2) → { ok, text, seconds } or a fixed refusal. Audio is never stored; logs hold metadata only
// (no audio, no transcript, no IP, no keys). The visitor confirms the text before it is sent as a question.
import { looksUrdu } from '../src/shared/chat-schema.js';
import { devanagariToRoman, hasDevanagari } from '../src/shared/devanagari.js';
import { AUDIO_TYPES, baseType, sttLanguage, VOICE_LIMITS } from '../src/shared/voice-limits.js';
import { chatSettings } from './chat.js';
import { screenInput } from './_lib/chat-filter.js';
import { REPLIES } from './_lib/chat-prompt.js';
import { readEnv } from './_lib/env.js';
import { HttpError, clientIp, getHeader, isAllowedOrigin, readBytes, requestOrigin, safe, sendJson } from './_lib/http.js';
import { GUARD_THRESHOLD, promptGuard } from './_lib/llm.js';
import { logEvent } from './_lib/log.js';
import { checkSession, hashIp } from './_lib/security.js';
import { cleanTranscript, sniffAudio, STT_PROMPTS, transcribe, wavSeconds } from './_lib/stt.js';
import { createSupabase } from './_lib/supabase.js';

export const STT_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GROQ_API_KEY', 'IP_HASH_SALT'];
const LANGS = ['en', 'ur', 'roman'];

export function createTranscribeHandler({ env = process.env, fetch = globalThis.fetch, now = Date.now, log = logEvent } = {}) {
  return async function transcribeHandler(req, res) {
    const t0 = now();
    const fail = (status, error, extra = {}, headers = {}) => {
      log('transcribe', { status, reason: error, ms: now() - t0 });
      return sendJson(res, status, { ok: false, error, ...extra }, headers);
    };

    if (req.method !== 'POST') return fail(405, 'method_not_allowed', {}, { Allow: 'POST' });
    if (!isAllowedOrigin(requestOrigin(req))) return fail(403, 'forbidden');
    const type = baseType(getHeader(req, 'content-type'));
    if (!AUDIO_TYPES.includes(type)) return fail(415, 'unsupported_media_type');
    // P11: a declared size over the limit is refused before anything else; the body itself is read only after
    // the chat session has been checked, so an unauthenticated client cannot make the function buffer 2 MB.
    const declared = Number(getHeader(req, 'content-length'));
    if (Number.isFinite(declared) && declared > VOICE_LIMITS.bytes) return fail(413, 'payload_too_large');

    const config = readEnv(STT_ENV, env);
    if (!config.ok) {
      log('transcribe_config', { status: 503, missing: config.missing });
      return sendJson(res, 503, { ok: false, error: 'not_configured' });
    }
    const cfg = config.values;
    const settings = chatSettings(env);

    const lang = String(getHeader(req, 'x-chat-lang') ?? 'en').toLowerCase();
    if (!LANGS.includes(lang)) return fail(400, 'bad_request');

    const ip = clientIp(req);
    const ipHash = hashIp(ip, cfg.IP_HASH_SALT);
    const sess = checkSession(String(getHeader(req, 'x-chat-session') ?? '').slice(0, 300), now(), ipHash, cfg.IP_HASH_SALT);
    if (!sess.ok) return fail(401, 'session', { reason: sess.reason });

    let bytes;
    try {
      bytes = await readBytes(req, VOICE_LIMITS.bytes);
    } catch (error) {
      return error instanceof HttpError ? fail(error.status, error.code) : fail(400, 'bad_request');
    }

    const db = createSupabase({ url: cfg.SUPABASE_URL, key: cfg.SUPABASE_SERVICE_ROLE_KEY, fetch });
    let gate;
    try {
      gate = await db.rpc('stt_submit', { p_ip_hash: ipHash, p_daily_cap: settings.dailyCap });
    } catch {
      return fail(500, 'server_error');
    }
    if (!gate?.allowed) {
      const retry = Math.max(1, Math.ceil(Number(gate?.retry_after) || 600));
      if (gate?.reason === 'daily') return fail(503, 'resting', { retryAfter: retry }, { 'Retry-After': String(retry) });
      return fail(429, 'rate_limited', { retryAfter: retry }, { 'Retry-After': String(retry) });
    }

    // The bytes must be the container the header claims; a WAV also states its own length.
    if (!sniffAudio(bytes, type)) return fail(415, 'unsupported_media_type');
    if (type === 'audio/wav') {
      const seconds = wavSeconds(bytes);
      if (seconds === null) return fail(400, 'bad_request');
      if (seconds > VOICE_LIMITS.seconds + 1) return fail(413, 'too_long');
    }

    const language = sttLanguage(lang);
    const prompt = STT_PROMPTS[lang];
    let result;
    try {
      result = await transcribe({ bytes, type, language, prompt, model: settings.sttModel, apiKey: cfg.GROQ_API_KEY, fetch });
    } catch {
      return fail(502, 'stt_unavailable');
    }
    // Other containers carry no cheap length: Whisper reports the real duration.
    if (result.seconds !== null && result.seconds > VOICE_LIMITS.seconds + 1) return fail(413, 'too_long');

    // P12-UX: Whisper may write spoken Roman Urdu in Devanagari (it has no Roman Urdu language code). Only then the text
    // is transliterated to Roman letters (rule based, approximate); the screens below run on this FINAL text.
    const transliterated = hasDevanagari(result.text);
    const text = cleanTranscript(transliterated ? devanagariToRoman(result.text) : result.text, { noSpeech: result.noSpeech, prompt });
    const done = (body, reason) => {
      log('transcribe', { status: 200, reason, ms: now() - t0, bytes: bytes.length, seconds: result.seconds === null ? null : Math.round(result.seconds), lang, model: settings.sttModel });
      return sendJson(res, 200, { ok: true, ...body });
    };
    if (!text) return done({ text: '', seconds: result.seconds }, 'no_speech');

    // The transcript is visitor text like any other: the same screens as /api/chat, before it can become a question.
    const replyLang = looksUrdu(text) ? 'ur' : transliterated ? 'roman' : lang;
    const heuristic = screenInput(text);
    if (heuristic) return done({ text: '', refused: true, reason: heuristic, reply: REPLIES[heuristic][replyLang] }, `screen_${heuristic}`);
    try {
      if ((await promptGuard([text], { apiKey: cfg.GROQ_API_KEY, fetch })) >= GUARD_THRESHOLD) return done({ text: '', refused: true, reason: 'injection', reply: REPLIES.injection[replyLang] }, 'screen_prompt_guard');
    } catch {
      log('transcribe_guard', { reason: 'unavailable' }); // the heuristics already ran; /api/chat screens the text again
    }
    return done({ text, seconds: result.seconds }, 'ok');
  };
}

export default safe(createTranscribeHandler(), 'transcribe');
