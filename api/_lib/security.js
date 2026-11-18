// Visitor privacy and the time trap. IPs are never stored: only SHA-256(ip + IP_HASH_SALT). The form
// gets an HMAC-signed timestamp when it renders (GET /api/contact-token); a submission must arrive at
// least MIN_SUBMIT_MS later (bots post instantly) and within MAX_STAMP_AGE_MS. The stamp is bound to
// the visitor's hashed IP, so it cannot be minted once and replayed from elsewhere.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const MIN_SUBMIT_MS = 3000;
export const MAX_STAMP_AGE_MS = 2 * 60 * 60 * 1000;

export const hashIp = (ip, salt) => createHash('sha256').update(`${ip}${salt}`).digest('hex');

const sign = (ts, ipHash, salt) => createHmac('sha256', salt).update(`contact.${ts}.${ipHash}`).digest('base64url');

export const issueStamp = (now, ipHash, salt) => `${now}.${sign(now, ipHash, salt)}`;

/** { ok: true } or { ok: false, reason: 'missing' | 'invalid' | 'too_fast' | 'expired' }. */
export function checkStamp(stamp, now, ipHash, salt) {
  const m = /^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(String(stamp ?? ''));
  if (!m) return { ok: false, reason: stamp ? 'invalid' : 'missing' };
  const ts = Number(m[1]);
  const expected = Buffer.from(sign(ts, ipHash, salt));
  const given = Buffer.from(m[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'invalid' };
  const age = now - ts;
  if (age < MIN_SUBMIT_MS) return { ok: false, reason: 'too_fast' };
  if (age > MAX_STAMP_AGE_MS) return { ok: false, reason: 'expired' };
  return { ok: true };
}
