// P4 contact form: ONE zod schema, used by the browser form (src/ui/contact.js, lazy chunk) and by the
// server (api/contact.js). Every field is trimmed; control characters are rejected everywhere; CR/LF
// (and the other Unicode line breaks) are rejected in every field that reaches an email header
// (name → Subject, email → Reply-To, subject → Subject): the header-injection defence. The message is
// the plain-text body, so it may contain line breaks and tabs, nothing else from the control range.
import { z } from 'zod';

// No JIT: zod would otherwise probe `new Function` once, which a strict CSP (no 'unsafe-eval') reports.
z.config({ jitless: true });

export const SUBJECTS = ['General', 'Job / interview', 'Freelance project', 'Collaboration', 'Other'];
export const LIMITS = { name: [2, 80], email: 120, message: [20, 4000], links: 3, body: 8 * 1024 };
export const INTERVIEW_SUBJECT = 'Job / interview';

// C0 + DEL + C1 controls; the message additionally allows \t \n \r.
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
const CONTROL_IN_BODY = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
const LINE_BREAK = /[\r\n\u0085\u2028\u2029]/;
const LINK = /\bhttps?:\/\/|\bwww\./gi; // an email address in the message is not a link

export const countLinks = (text) => (String(text).match(LINK) ?? []).length;

/** A single-line field that may end up in an email header. */
const headerSafe = (schema, label) =>
  schema
    .refine((v) => !LINE_BREAK.test(v), { message: `${label} must be on one line.` })
    .refine((v) => !CONTROL.test(v), { message: `${label} contains characters that are not allowed.` });

export const contactSchema = z.object({
  name: headerSafe(
    z
      .string({ error: 'Please enter your name.' })
      .trim()
      .min(LIMITS.name[0], { error: `Please enter your name (at least ${LIMITS.name[0]} characters).` })
      .max(LIMITS.name[1], { error: `Your name can be at most ${LIMITS.name[1]} characters.` }),
    'Your name',
  ),
  email: headerSafe(
    z
      .string({ error: 'Please enter your email address.' })
      .trim()
      .min(1, { error: 'Please enter your email address.' })
      .max(LIMITS.email, { error: `Your email can be at most ${LIMITS.email} characters.` })
      .pipe(z.email({ error: 'Please enter a valid email address, like name@example.com.' })),
    'Your email',
  ),
  subject: z.enum(SUBJECTS, { error: 'Please choose a subject.' }),
  message: z
    .string({ error: 'Please write a message.' })
    .trim()
    .min(LIMITS.message[0], { error: `Please write a little more (at least ${LIMITS.message[0]} characters).` })
    .max(LIMITS.message[1], { error: `Your message can be at most ${LIMITS.message[1]} characters.` })
    .refine((v) => !CONTROL_IN_BODY.test(v), { message: 'Your message contains characters that are not allowed.' })
    .refine((v) => countLinks(v) <= LIMITS.links, { message: `Please include at most ${LIMITS.links} links.` }),
});

/** The request body: the four fields plus the spam-layer fields (never stored). Unknown keys fail. */
export const contactRequestSchema = contactSchema.extend({
  website: z.string().max(200).optional().default(''), // honeypot: humans never see or fill it
  stamp: z.string().max(200).optional().default(''), // HMAC-signed render timestamp (time trap)
  token: z.string().max(2048).optional().default(''), // Cloudflare Turnstile response
}).strict();

/** First message per field, e.g. { email: 'Please enter a valid email address…' }. */
export function fieldErrors(error) {
  const out = {};
  for (const issue of error?.issues ?? []) {
    const key = issue.path?.[0] ?? 'form';
    if (typeof key === 'string' && !(key in out)) out[key] = issue.message;
  }
  return out;
}

/** Validate the four visible fields. Returns { ok, data } or { ok: false, errors }. */
export function validateContact(input) {
  const r = contactSchema.safeParse(input);
  return r.success ? { ok: true, data: r.data } : { ok: false, errors: fieldErrors(r.error) };
}
