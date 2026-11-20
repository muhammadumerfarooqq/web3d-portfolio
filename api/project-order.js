// GET /api/project-order — public, no secrets: the saved order of the project gallery (slugs only), written by the
// admin dashboard. Classic's "Featured" sort uses it and falls back to the built-in order when this call fails.
// It exists because the anon key is denied on every table (rls:verify), so the browser cannot read project_order.
// Only slugs that exist in /content are returned. Cached 15 s at the edge so a reorder shows within one refresh.
import { PROJECT_SLUGS } from '../src/shared/project-slugs.js';
import { mergeOrder } from '../src/shared/project-order.js';
import { readEnv } from './_lib/env.js';
import { safe, sendJson } from './_lib/http.js';
import { logEvent } from './_lib/log.js';
import { createSupabase, dbReason } from './_lib/supabase.js';

export function createProjectOrderHandler({ env = process.env, fetch = globalThis.fetch, log = logEvent } = {}) {
  return async function projectOrder(req, res) {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' }, { Allow: 'GET' });
    const config = readEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'], env);
    if (!config.ok) return sendJson(res, 503, { ok: false, error: 'not_configured' });
    try {
      const rows = await createSupabase({ url: config.values.SUPABASE_URL, key: config.values.SUPABASE_SERVICE_ROLE_KEY, fetch }).select('project_order', 'select=slug&order=position.asc');
      const saved = (rows ?? []).map((r) => r.slug).filter((s) => PROJECT_SLUGS.includes(s));
      return sendJson(res, 200, { ok: true, order: saved.length ? mergeOrder(saved, PROJECT_SLUGS) : [] }, { 'Cache-Control': 'public, max-age=0, s-maxage=15, stale-while-revalidate=30' });
    } catch (error) {
      log('project_order', { status: 500, reason: dbReason('read_failed', error) });
      return sendJson(res, 500, { ok: false, error: 'server_error' });
    }
  };
}

export default safe(createProjectOrderHandler(), 'project_order');
