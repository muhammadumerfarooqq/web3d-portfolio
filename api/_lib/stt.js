// P6: speech to text. Plain fetch to Groq's Whisper endpoint (OpenAI-compatible, multipart), no SDK; the key
// travels in a header. Everything here is pure or takes `fetch`, so it is unit-tested with mocks.
// Audio stays in memory: nothing is written anywhere.
import { FILE_EXT, VOICE_LIMITS } from '../../src/shared/voice-limits.js';
import { GROQ_BASE } from './llm.js';

/** Does the file start with the signature of the container the Content-Type claims? */
export function sniffAudio(bytes, type) {
  const b = bytes;
  if (!b || b.length < 12) return false;
  const ascii = (from, to) => b.subarray(from, to).toString('latin1');
  switch (type) {
    case 'audio/webm':
      return b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3; // EBML
    case 'audio/ogg':
      return ascii(0, 4) === 'OggS';
    case 'audio/wav':
      return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE';
    case 'audio/mp4':
      return ascii(4, 8) === 'ftyp';
    default:
      return false;
  }
}

/** Duration in seconds of a PCM WAV from its header (the one container whose length is knowable without decoding); null if unreadable. */
export function wavSeconds(bytes) {
  let pos = 12;
  let byteRate = 0;
  while (pos + 8 <= bytes.length) {
    const id = bytes.toString('latin1', pos, pos + 4);
    const size = bytes.readUInt32LE(pos + 4);
    if (id === 'fmt ' && pos + 20 <= bytes.length) byteRate = bytes.readUInt32LE(pos + 16);
    if (id === 'data') {
      const dataBytes = Math.min(size, bytes.length - pos - 8);
      return byteRate > 0 ? dataBytes / byteRate : null;
    }
    pos += 8 + size + (size % 2);
  }
  return null;
}

// A style prompt keeps proper nouns right and (for Roman Urdu, which has no language code) keeps the output
// in Latin letters. If Whisper echoes it back on silence, `cleanTranscript` throws that result away.
export const STT_PROMPTS = {
  en: 'Umer Farooq, Axisero, TALEEM360, KnoDesk, NED University, RAG, Groq.',
  ur: 'عمر فاروق، Axisero، TALEEM360، KnoDesk، NED یونیورسٹی۔',
  roman: 'Umer kon he? Kya aap remote kaam karte hain? Aap ke projects aur skills ke baare mein batayein. Axisero, TALEEM360, KnoDesk.',
};

/**
 * Transcribe audio with Groq Whisper. Returns { text, seconds, noSpeech }.
 * `language`: "en" | "ur" | null (auto). Throws on an API error or timeout.
 */
export async function transcribe({ bytes, type, language, prompt, model, apiKey, fetch = globalThis.fetch, timeoutMs = 12000 }) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), `audio.${FILE_EXT[type] ?? 'webm'}`);
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');
  if (language) form.append('language', language);
  if (prompt) form.append('prompt', prompt);
  const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`stt ${res.status}`);
  const data = await res.json();
  if (typeof data.text !== 'string') throw new Error('stt: no text');
  const segments = Array.isArray(data.segments) ? data.segments : [];
  const probs = segments.map((s) => Number(s.no_speech_prob)).filter(Number.isFinite);
  const noSpeech = probs.length > 0 && probs.reduce((a, b) => a + b, 0) / probs.length > 0.7;
  return { text: data.text, seconds: Number.isFinite(Number(data.duration)) ? Number(data.duration) : null, noSpeech };
}

const words = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);

/**
 * A transcript becomes a chat message: control characters and line separators become spaces (the chat schema
 * refuses them), whitespace is collapsed, the text is cut to the chat limit. Returns '' when there was no
 * speech: Whisper's "no speech" score, nothing left, or only the prompt echoed back.
 */
export function cleanTranscript(text, { noSpeech = false, prompt = '' } = {}) {
  if (noSpeech) return '';
  const clean = String(text ?? '')
    .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, VOICE_LIMITS.textMax)
    .trim();
  const w = words(clean);
  if (w.length === 0) return '';
  const p = new Set(words(prompt));
  // Only the style prompt came back (long enough to be the prompt, not a short real question that reuses its words).
  if (p.size && w.length >= Math.max(4, Math.floor(p.size * 0.6)) && w.every((x) => p.has(x))) return '';
  return clean;
}
