// Cloudflare Turnstile, verified on the server (the browser's "success" means nothing on its own).
// A token passes only if siteverify says success AND it was solved on one of our hostnames AND for
// the "contact" action (so a token from another form or another site is refused).
import { isAllowedHostname } from './http.js';

export const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const CONTACT_ACTION = 'contact';

/** { ok: true } | { ok: false, reason }. Network / Cloudflare failures throw (→ 500). */
export async function verifyTurnstile({ token, ip, secret, fetch, action = CONTACT_ACTION }) {
  if (!token) return { ok: false, reason: 'missing' };
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set('remoteip', ip);
  const res = await fetch(SITEVERIFY, { method: 'POST', body, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`siteverify ${res.status}`);
  const data = await res.json();
  if (data?.success !== true) return { ok: false, reason: 'rejected' };
  if (!isAllowedHostname(data.hostname)) return { ok: false, reason: 'hostname' };
  if (data.action !== action) return { ok: false, reason: 'action' };
  return { ok: true };
}
