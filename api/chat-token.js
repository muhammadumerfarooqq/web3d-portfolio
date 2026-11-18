// GET /api/chat-token (Vercel Function, bom1): verifies a Cloudflare Turnstile token ONCE (action "chat",
// sent in the X-Turnstile-Token header, never in the URL) and returns an HMAC-signed chat session token
// (1 hour, bound to the visitor's hashed IP). POST /api/chat requires it, so bots cannot spend the LLM
// budget. Same-origin only; 503 when not configured. Logs are PII-free.
import { readEnv } from './_lib/env.js';
import { clientIp, getHeader, isAllowedOrigin, requestOrigin, sendJson } from './_lib/http.js';
import { logEvent } from './_lib/log.js';
import { hashIp, issueSession, SESSION_MS } from './_lib/security.js';
import { verifyTurnstile } from './_lib/turnstile.js';

export const CHAT_TOKEN_ENV = ['TURNSTILE_SECRET_KEY', 'IP_HASH_SALT'];

export function createChatTokenHandler({ env = process.env, fetch = globalThis.fetch, now = Date.now, log = logEvent } = {}) {
  return async function chatToken(req, res) {
    const fail = (status, error, headers = {}) => {
      log('chat_token', { status, reason: error });
      return sendJson(res, status, { ok: false, error }, headers);
    };
    if (req.method !== 'GET') return fail(405, 'method_not_allowed', { Allow: 'GET' });
    if (!isAllowedOrigin(requestOrigin(req))) return fail(403, 'forbidden');
    const config = readEnv(CHAT_TOKEN_ENV, env);
    if (!config.ok) return fail(503, 'not_configured');
    const token = String(getHeader(req, 'x-turnstile-token') ?? '').slice(0, 2048);
    const ip = clientIp(req);
    try {
      const check = await verifyTurnstile({ token, ip, secret: config.values.TURNSTILE_SECRET_KEY, fetch, action: 'chat' });
      if (!check.ok) return fail(403, 'verification_failed');
    } catch {
      return fail(500, 'server_error');
    }
    const salt = config.values.IP_HASH_SALT;
    log('chat_token', { status: 200, reason: 'issued' });
    return sendJson(res, 200, { ok: true, session: issueSession(now(), hashIp(ip, salt), salt), expiresIn: SESSION_MS / 1000 });
  };
}

export default createChatTokenHandler();
