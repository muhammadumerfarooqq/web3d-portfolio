// P5 "Ask my AI": ONE zod schema for the chat request, used by the browser (src/ui/chat.js, lazy chunk) and
// the server (api/chat.js). Message 2–500 characters; up to 6 history turns of ≤ 500 characters; language
// en | ur (Urdu script) | roman (Roman Urdu). Control characters are rejected; the only line break allowed
// is a plain newline (CR and the Unicode line/paragraph separators are refused, so nothing can forge
// "turns" or headers). Unknown keys fail.
import { z } from 'zod';

// No JIT: zod would otherwise probe `new Function` once, which a strict CSP (no 'unsafe-eval') reports.
z.config({ jitless: true });

export const LANGS = ['en', 'ur', 'roman'];
export const CHAT_LIMITS = { message: [2, 500], history: 6, turn: 500, body: 8 * 1024 };

const BAD = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u2028\u2029]/; // everything but \n

const text = (max, min = 1) =>
  z
    .string({ error: 'Please type a question.' })
    .trim()
    .min(min, { error: `Please type at least ${min} characters.` })
    .max(max, { error: `Please keep it under ${max} characters.` })
    .refine((v) => !BAD.test(v), { message: 'That contains characters that are not allowed.' });

export const chatRequestSchema = z
  .object({
    message: text(CHAT_LIMITS.message[1], CHAT_LIMITS.message[0]),
    history: z
      .array(z.object({ role: z.enum(['user', 'assistant']), content: text(CHAT_LIMITS.turn) }).strict())
      .max(CHAT_LIMITS.history, { error: 'Too much history.' })
      .optional()
      .default([]),
    lang: z.enum(LANGS).optional().default('en'),
    session: z.string().max(300).optional().default(''),
  })
  .strict();

/** Arabic-script letters in the text → the visitor is writing Urdu script. */
export const looksUrdu = (s) => /[؀-ۿ]/.test(String(s));
