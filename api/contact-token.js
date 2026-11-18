// GET /api/contact-token: the time-trap stamp for the contact form, issued when the form renders
// (HMAC-SHA256 over the time and the visitor's hashed IP, key IP_HASH_SALT; see api/_lib/security.js).
// Same-origin only; 503 when the contact system is not configured (the form then shows the email link).
import { CONTACT_ENV, readEnv } from './_lib/env.js';
import { clientIp, isAllowedOrigin, requestOrigin, safe, sendJson } from './_lib/http.js';
import { hashIp, issueStamp } from './_lib/security.js';

export function createTokenHandler({ env = process.env, now = Date.now } = {}) {
  return function contactToken(req, res) {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' }, { Allow: 'GET' });
    if (!isAllowedOrigin(requestOrigin(req))) return sendJson(res, 403, { ok: false, error: 'forbidden' });
    const config = readEnv(CONTACT_ENV, env);
    if (!config.ok) return sendJson(res, 503, { ok: false, error: 'not_configured' });
    const salt = config.values.IP_HASH_SALT;
    return sendJson(res, 200, { ok: true, stamp: issueStamp(now(), hashIp(clientIp(req), salt), salt) });
  };
}

export default safe(createTokenHandler(), 'contact_token');
