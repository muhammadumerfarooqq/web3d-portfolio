// P6 voice for "Ask my AI" (part of the lazy chat chunk; Classic and the Explore Saloon share it).
// - createRecorder: the microphone state machine (idle → requesting → recording → transcribing → idle) with
//   injected dependencies (getUserMedia, MediaRecorder, transcribe, timers), so tests drive it with mocks.
//   Press to record, press again to stop, a 30 s cap with a countdown, tracks released at once, audio kept in
//   memory only and sent once to POST /api/transcribe. Nothing is ever sent as a question automatically.
// - createSpeaker + pickVoice: "Listen" reads an answer aloud with the browser's own speechSynthesis (no
//   network, no cost, nothing remembered).
import { looksUrdu } from '../shared/chat-schema.js';
import { AUDIO_TYPES, baseType, VOICE_LIMITS } from '../shared/voice-limits.js';

export const VOICE_MESSAGES = {
  unsupported: 'Voice input is not supported in this browser. You can still type your question.',
  denied: 'Microphone access is blocked. Allow it in your browser’s site settings, or just type your question.',
  nomic: 'No microphone was found. You can still type your question.',
  busyMic: 'The microphone is in use by another app. Close it and try again, or type your question.',
  requesting: 'Allow the microphone when your browser asks…',
  recording: (s) => `Listening… ${s} second${s === 1 ? '' : 's'} left. Press the microphone again to stop.`,
  almost: (s) => `${s} seconds left.`,
  transcribing: 'Turning your voice into text…',
  ready: 'Check the text below, then press Send. Nothing is sent until you do.',
  empty: 'I could not hear anything. Try again, a little closer to the microphone.',
  tooBig: 'That recording is too large. Keep it under 30 seconds and try again.',
  tooLong: 'That recording is too long. Keep it under 30 seconds and try again.',
  unavailable: 'Voice input is not available right now. You can still type your question.',
  resting: 'The AI is resting today (the daily limit is reached). Please try again tomorrow, or send me a telegram.',
  network: 'Could not reach the sheriff. Check your connection and try again.',
  server: 'Voice input hit a problem on my side. You can still type your question.',
  verifyFailed: 'The anti-spam check did not pass. Please try again.',
  rateLimited: (seconds) => {
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    return `You are using the microphone quickly, partner. Please wait ${minutes} minute${minutes === 1 ? '' : 's'} or type your question.`;
  },
  noVoice: (name) => `No ${name} voice is installed on this device, so I cannot read this answer aloud.`,
  cancelled: 'Recording cancelled because the chat left the screen.',
  speakFailed: 'The browser could not read this answer aloud.',
};

/** What a /api/transcribe response means (pure; tested). */
export function transcribeOutcome(status, body = {}, retryAfter = null) {
  if (status === 200 && body.ok) {
    if (body.refused && body.reply) return { kind: 'refused', reply: String(body.reply) };
    const text = String(body.text ?? '').trim();
    return text ? { kind: 'text', text } : { kind: 'empty' };
  }
  if (status === 401) return { kind: 'session' };
  if (status === 413) return { kind: 'error', key: body.error === 'too_long' ? 'tooLong' : 'tooBig' };
  if (status === 415) return { kind: 'error', key: 'unsupported' };
  if (status === 429) return { kind: 'rate', seconds: Number(retryAfter) || Number(body.retryAfter) || 600 };
  if (status === 503 && body.error === 'resting') return { kind: 'error', key: 'resting' };
  if (status === 503) return { kind: 'error', key: 'unavailable' };
  return { kind: 'error', key: 'server' };
}

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/wav'];

/** The first recording type this browser can produce (and the server accepts); '' lets the browser choose. */
export function pickMime(MR) {
  if (!MR || typeof MR.isTypeSupported !== 'function') return '';
  return MIME_CANDIDATES.find((m) => MR.isTypeSupported(m)) ?? '';
}

/** Voice input possible here (secure context for getUserMedia is the browser's own rule)? */
export const voiceInputSupported = (nav = globalThis.navigator, MR = globalThis.MediaRecorder) => Boolean(nav?.mediaDevices?.getUserMedia && typeof MR === 'function');

const errorKey = (error) => {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'nomic';
    case 'NotReadableError':
    case 'AbortError':
      return 'busyMic';
    default:
      return 'nomic';
  }
};

/**
 * The microphone state machine. `onState` receives { state, … }:
 *   requesting · recording { secondsLeft } · transcribing · text { text } · refused { reply } · empty ·
 *   rate { seconds } · session · error { key } · idle
 * `transcribe(blob)` resolves to a transcribeOutcome()-shaped object.
 */
export function createRecorder({ mediaDevices = globalThis.navigator?.mediaDevices, MediaRecorder: MR = globalThis.MediaRecorder, transcribe, onState = () => {}, setTimer = (fn, ms) => setInterval(fn, ms), clearTimer = (id) => clearInterval(id), maxSeconds = VOICE_LIMITS.seconds, maxBytes = VOICE_LIMITS.bytes } = {}) {
  let state = 'idle';
  let stream = null;
  let rec = null;
  let timer = null;
  let chunks = [];
  let secondsLeft = maxSeconds;
  let cancelled = false;
  let mime = '';

  const set = (next, extra = {}) => {
    state = next;
    onState({ state: next, ...extra });
  };
  const release = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    for (const track of stream?.getTracks?.() ?? []) track.stop();
    stream = null;
  };
  const fail = (key) => {
    release();
    rec = null;
    set('error', { key });
    set('idle');
  };

  async function finish() {
    release();
    const type = rec?.mimeType || mime || chunks[0]?.type || '';
    const blob = new Blob(chunks, { type });
    chunks = [];
    rec = null;
    if (cancelled) return set('idle');
    if (!blob.size) return fail('empty');
    if (blob.size > maxBytes) return fail('tooBig');
    if (!AUDIO_TYPES.includes(baseType(blob.type))) return fail('unsupported');
    set('transcribing');
    let outcome;
    try {
      outcome = (await transcribe(blob)) ?? {};
    } catch {
      return fail('network');
    }
    if (cancelled) return set('idle');
    if (outcome.kind === 'text') set('text', { text: outcome.text });
    else if (outcome.kind === 'refused') set('refused', { reply: outcome.reply });
    else if (outcome.kind === 'empty') set('empty');
    else if (outcome.kind === 'rate') set('rate', { seconds: outcome.seconds });
    else if (outcome.kind === 'session') set('session');
    else if (outcome.kind === 'error') set('error', { key: outcome.key });
    else set('error', { key: 'server' });
    set('idle');
  }

  const api = {
    get state() {
      return state;
    },
    async start() {
      if (state !== 'idle') return;
      if (!mediaDevices?.getUserMedia || typeof MR !== 'function') return fail('unsupported');
      cancelled = false;
      set('requesting');
      try {
        stream = await mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch (error) {
        return fail(errorKey(error));
      }
      if (cancelled) {
        release();
        return set('idle');
      }
      mime = pickMime(MR);
      try {
        rec = new MR(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32000 });
      } catch {
        try {
          rec = new MR(stream);
        } catch {
          return fail('unsupported');
        }
      }
      chunks = [];
      rec.ondataavailable = (event) => {
        if (event.data?.size) chunks.push(event.data);
      };
      rec.onstop = () => void finish();
      rec.onerror = () => fail('server');
      secondsLeft = maxSeconds;
      rec.start(1000);
      set('recording', { secondsLeft });
      timer = setTimer(() => {
        secondsLeft -= 1;
        if (secondsLeft <= 0) api.stop();
        else set('recording', { secondsLeft });
      }, 1000);
    },
    /** Stop recording; the audio is then transcribed. */
    stop() {
      if (state === 'recording' && rec && rec.state !== 'inactive') {
        if (timer !== null) clearTimer(timer);
        timer = null;
        rec.stop();
      }
    },
    /** Throw the recording away and release the microphone (panel closed, tab hidden). */
    cancel() {
      if (state === 'idle') return;
      cancelled = true;
      if (state === 'recording' && rec && rec.state !== 'inactive') {
        rec.stop(); // finish() sees `cancelled` and drops the audio
        return;
      }
      release();
      if (state === 'requesting') return; // start() sees `cancelled` once the permission prompt settles
      if (state === 'transcribing') return; // the response is ignored
      set('idle');
    },
  };
  return api;
}

// ── Text to speech ──

/** The answer as speech: citation marks and markup characters removed. */
export function speechText(answer) {
  return String(answer ?? '')
    .replace(/\[\d{1,2}\]/g, '')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Which voice language fits an answer: Urdu script → ur; otherwise the selected language (en | roman). */
export const speechLang = (answer, selected) => (looksUrdu(answer) ? 'ur' : selected === 'roman' ? 'roman' : 'en');

const HAS = (v, prefix) => String(v.lang ?? '').toLowerCase().replace('_', '-').startsWith(prefix);
const PREFER = (voices, prefixes) => {
  for (const p of prefixes) {
    const hit = voices.find((v) => HAS(v, p));
    if (hit) return hit;
  }
  return null;
};

/**
 * A voice that matches the language, or null (the caller says so instead of reading Urdu script with an
 * English voice). en → English; ur → Urdu; roman (Urdu in Latin letters) → Hindi/Urdu if installed, then
 * Indian English, then any English.
 */
export function pickVoice(voices, lang) {
  const list = Array.isArray(voices) ? voices : [];
  if (lang === 'ur') return PREFER(list, ['ur']) ?? null;
  if (lang === 'roman') return PREFER(list, ['hi', 'ur', 'en-in', 'en']) ?? null;
  return PREFER(list, ['en-us', 'en-gb', 'en']) ?? null;
}

const LANG_NAME = { ur: 'Urdu', roman: 'Hindi, Urdu or English', en: 'English' };

/** Voices load asynchronously in some browsers: wait for them briefly. */
export function loadVoices(synth, ms = 1200) {
  const now = synth.getVoices?.() ?? [];
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      synth.removeEventListener?.('voiceschanged', finish);
      resolve(synth.getVoices?.() ?? []);
    };
    synth.addEventListener?.('voiceschanged', finish);
    setTimeout(finish, ms);
  });
}

export const speechSupported = (w = globalThis) => Boolean(w.speechSynthesis && typeof w.SpeechSynthesisUtterance === 'function');

/**
 * One utterance at a time. `speak(text, lang)` resolves with 'ended' | 'stopped' | 'novoice' | 'error'.
 * `onState({ state: 'speaking' | 'ended' | 'stopped', chars })` drives the buttons and the sheriff.
 */
export function createSpeaker({ synth = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance, onState = () => {} } = {}) {
  let current = null;
  const stop = () => {
    if (!current) return;
    const u = current;
    current = null;
    u.onend = null;
    u.onerror = null;
    synth.cancel();
    onState({ state: 'stopped' });
    u.resolve?.('stopped');
  };
  return {
    get speaking() {
      return current !== null;
    },
    stop,
    async speak(text, lang) {
      stop();
      const words = speechText(text);
      if (!words) return { result: 'error' };
      const voice = pickVoice(await loadVoices(synth), lang);
      if (!voice) return { result: 'novoice', name: LANG_NAME[lang] ?? 'matching' };
      return new Promise((resolve) => {
        const u = new Utterance(words);
        u.voice = voice;
        u.lang = voice.lang;
        u.rate = 1;
        u.resolve = (r) => resolve({ result: r });
        u.onend = () => {
          if (current !== u) return;
          current = null;
          onState({ state: 'ended' });
          resolve({ result: 'ended' });
        };
        u.onerror = (event) => {
          if (current !== u) return;
          current = null;
          const interrupted = event?.error === 'interrupted' || event?.error === 'canceled';
          onState({ state: interrupted ? 'stopped' : 'ended' });
          resolve({ result: interrupted ? 'stopped' : 'error' });
        };
        current = u;
        onState({ state: 'speaking', chars: words.length });
        synth.speak(u);
      });
    },
  };
}
