// P6 voice: limits shared by the browser (src/ui/voice.js) and POST /api/transcribe.
// Audio never leaves memory: it is recorded, sent once, transcribed and dropped.
export const VOICE_LIMITS = {
  bytes: 2 * 1024 * 1024, // request body
  seconds: 30, // recording length (the browser stops at 30 s; the server rejects longer audio)
  rateInWindow: 10, // transcriptions per 10 minutes per hashed IP (enforced by stt_submit)
  textMax: 500, // a transcript is cut to the chat's message limit
};
/** The only accepted audio types (a codecs parameter is fine: "audio/webm;codecs=opus"). */
export const AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav'];
export const baseType = (header) => String(header ?? '').split(';')[0].trim().toLowerCase();
export const FILE_EXT = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/wav': 'wav' };
/** Whisper language hint from the chat's language selector: Urdu script → "ur", English → "en", Roman Urdu → none. */
export const sttLanguage = (lang) => (lang === 'ur' ? 'ur' : lang === 'en' ? 'en' : null);
