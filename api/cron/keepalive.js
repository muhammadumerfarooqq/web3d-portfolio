// GET /api/cron/keepalive — called once a day by the Vercel cron in vercel.json. It runs one trivial read so the free
// Supabase project never pauses for inactivity. Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically
// when the CRON_SECRET environment variable is set; anything else is refused with a bare 401 (compared in
// constant time; an unset secret refuses everything). The answer is `{ ok: true }` and nothing else.
import { getHeader, safe, sendJson } from '../_lib/http.js';
import { logEvent } from '../_lib/log.js';
import { safeEqual } from '../_lib/security.js';
import { createSupabase } from '../_lib/supabase.js';

export function createKeepaliveHandler({ env = process.env, fetch = globalThis.fetch, log = logEvent } = {}) {
  return async function keepalive(req, res) {
    const secret = typeof env.CRON_SECRET === 'string' ? env.CRON_SECRET.trim() : '';
    const given = /^Bearer (\S{1,512})$/.exec(String(getHeader(req, 'authorization') ?? ''))?.[1] ?? '';
    if (req.method !== 'GET' || secret.length < 32 || !given || !safeEqual(given, secret)) {
      log('keepalive', { status: 401, reason: 'unauthorized' });
      return sendJson(res, 401, { ok: false, error: 'unauthorized' });
    }
    const url = typeof env.SUPABASE_URL === 'string' ? env.SUPABASE_URL.trim() : '';
    const key = typeof env.SUPABASE_SERVICE_ROLE_KEY === 'string' ? env.SUPABASE_SERVICE_ROLE_KEY.trim() : '';
    if (!url || !key) return sendJson(res, 503, { ok: false, error: 'not_configured' });
    try {
      await createSupabase({ url, key, fetch }).select('documents', 'select=id&limit=1');
    } catch {
      log('keepalive', { status: 500, reason: 'read_failed' });
      return sendJson(res, 500, { ok: false, error: 'server_error' });
    }
    log('keepalive', { status: 200, reason: 'ok' });
    return sendJson(res, 200, { ok: true });
  };
}

export default safe(createKeepaliveHandler(), 'keepalive');
