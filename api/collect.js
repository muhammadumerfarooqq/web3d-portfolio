// POST /api/collect — privacy-friendly, first-party analytics (Vercel Function, Node, bom1).
// The browser sends {"e":"<event>"} (at most 200 bytes) with sendBeacon. The server counts it in one anonymous daily
// counter (analytics_daily): no IP, no hash, no user agent, no referrer, no cookie, no user id is read into the
// counter or logged. Order: method → same-origin → JSON type → size → event allow-list → configuration → the
// atomic bump with a per-event daily sanity cap. It ALWAYS answers 204 with no body once the request is
// well-formed enough to look at, whatever happens next (an unknown event, a full cap, a database error): a client
// learns nothing about the state, and a failure never disturbs a visitor. Wrong method, origin, type or size get
// the usual 405 / 403 / 415 / 413 so probing is visible. There is no per-visitor limit (that would need a stored
// IP hash): the daily cap bounds any abuse and the counters are not security-critical (LIMITATIONS).
import { ANALYTICS_BODY_MAX, ANALYTICS_DAILY_CAP, ANALYTICS_EVENTS } from '../src/shared/analytics-events.js';
import { readEnv } from './_lib/env.js';
import { HttpError, getHeader, isAllowedOrigin, readBody, requestOrigin, safe, sendJson } from './_lib/http.js';
import { logEvent } from './_lib/log.js';
import { createSupabase, dbReason } from './_lib/supabase.js';

const noContent = (res) => {
  res.statusCode = 204;
  res.setHeader('Cache-Control', 'no-store');
  res.end();
};

export function createCollectHandler({ env = process.env, fetch = globalThis.fetch, log = logEvent } = {}) {
  return async function collect(req, res) {
    const fail = (status, error, headers = {}) => {
      log('collect', { status, reason: error });
      return sendJson(res, status, { ok: false, error }, headers);
    };
    if (req.method !== 'POST') return fail(405, 'method_not_allowed', { Allow: 'POST' });
    if (!isAllowedOrigin(requestOrigin(req))) return fail(403, 'forbidden');
    // sendBeacon sends a Blob: application/json (allowed by the preflight-free beacon rules for same-origin) or text/plain
    const type = String(getHeader(req, 'content-type') ?? '').toLowerCase();
    if (!/^(?:application\/json|text\/plain)(?:\s*;|$)/.test(type)) return fail(415, 'unsupported_media_type');
    let raw;
    try {
      raw = await readBody(req, ANALYTICS_BODY_MAX);
    } catch (error) {
      // Too large stays a 413. Anything else (on Vercel the runtime's own body parser throws for invalid JSON) is junk:
      // ignored like an unknown event, so the answer never tells a prober which bodies count.
      if (error instanceof HttpError) return fail(error.status, error.code);
      raw = '';
    }
    let event = null;
    try {
      const body = JSON.parse(raw);
      if (body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 1 && typeof body.e === 'string' && ANALYTICS_EVENTS.includes(body.e)) event = body.e;
    } catch {
      /* not JSON: ignored below */
    }
    const config = readEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'], env);
    if (event && config.ok) {
      try {
        await createSupabase({ url: config.values.SUPABASE_URL, key: config.values.SUPABASE_SERVICE_ROLE_KEY, fetch }).rpc('analytics_bump', { p_event: event, p_cap: ANALYTICS_DAILY_CAP });
      } catch (error) {
        log('collect', { status: 204, reason: dbReason('bump_failed', error) });
      }
    } else log('collect', { status: 204, reason: event ? 'not_configured' : 'ignored' });
    return noContent(res);
  };
}

export default safe(createCollectHandler(), 'collect');
