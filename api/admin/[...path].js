// /api/admin/* — ONE Vercel Function (catch-all, Node, bom1) for the whole admin API, so the project stays far under
// the 12-function limit of the free plan. Same-origin only; the browser never talks to Supabase.
//   POST  /api/admin/login          email + password + Turnstile (action "admin") → an aal1 access token, only for an admin
//   POST  /api/admin/mfa/enroll     first login only: starts TOTP enrolment (QR, secret, otpauth URI)
//   POST  /api/admin/mfa/verify     a 6-digit code → an aal2 access token
//   POST  /api/admin/logout         revokes the session on Supabase
//   GET   /api/admin/projects-order the saved gallery order (+ the titles)     POST saves it
//   GET   /api/admin/messages       the contact messages (never ip_hash / user_agent)   PATCH changes one status
// Every data route needs a valid Supabase token + a row in `admins` + aal2 (api/_lib/auth.js). Failures are generic.
// Order for each request: method → origin → content type → size → configuration → … (see each route).
import { ADMIN_LIMITS, STATUS_COLUMN, loginSchema, messagePatchSchema, mfaVerifySchema, orderSaveSchema } from '../../src/shared/admin-schema.js';
import { ANALYTICS_EVENTS, STATS_DAYS } from '../../src/shared/analytics-events.js';
import { mergeOrder, validateOrder } from '../../src/shared/project-order.js';
import { PROJECTS, PROJECT_SLUGS } from '../../src/shared/project-slugs.js';
import { createAuth, requireAdmin } from '../_lib/auth.js';
import { readEnv } from '../_lib/env.js';
import { HttpError, clientIp, getHeader, isAllowedOrigin, readBody, requestOrigin, safe, sendJson } from '../_lib/http.js';
import { logEvent } from '../_lib/log.js';
import { hashIp } from '../_lib/security.js';
import { createSupabase } from '../_lib/supabase.js';
import { verifyTurnstile } from '../_lib/turnstile.js';

export const ADMIN_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_ANON_KEY', 'TURNSTILE_SECRET_KEY', 'IP_HASH_SALT'];
export const FAIL_DELAY_MS = 700;
const MESSAGE_LIMIT = 200;
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ROUTES = {
  login: { methods: ['POST'], json: true, max: ADMIN_LIMITS.body },
  'mfa/enroll': { methods: ['POST'], json: true, max: ADMIN_LIMITS.body },
  'mfa/verify': { methods: ['POST'], json: true, max: ADMIN_LIMITS.body },
  logout: { methods: ['POST'], json: true, max: ADMIN_LIMITS.body },
  'projects-order': { methods: ['GET', 'POST'], json: 'POST', max: ADMIN_LIMITS.orderBody },
  messages: { methods: ['GET', 'PATCH'], json: 'PATCH', max: ADMIN_LIMITS.body },
  stats: { methods: ['GET'], json: false, max: 0 }, // P10: the analytics counters of the last 14 days
};

const routeOf = (req) => {
  try {
    return new URL(req.url ?? '', 'http://x').pathname.replace(/^\/api\/admin\/?/, '').replace(/\/+$/, '');
  } catch {
    return '';
  }
};

export function createAdminHandler({ env = process.env, fetch = globalThis.fetch, now = Date.now, log = logEvent, sleep = defaultSleep } = {}) {
  return async function admin(req, res) {
    const t0 = now();
    const fail = (status, error, extra = {}, headers = {}) => {
      log('admin', { status, reason: error, ms: now() - t0 });
      return sendJson(res, status, { ok: false, error, ...extra }, headers);
    };

    const name = routeOf(req);
    const route = Object.hasOwn(ROUTES, name) ? ROUTES[name] : null;
    if (!route) return fail(404, 'not_found');
    if (!route.methods.includes(req.method)) return fail(405, 'method_not_allowed', {}, { Allow: route.methods.join(', ') });
    if (!isAllowedOrigin(requestOrigin(req))) return fail(403, 'forbidden');

    // JSON body (when the method carries one)
    let body = null;
    if (route.json === true || route.json === req.method) {
      if (!/^application\/json(?:\s*;|$)/.test(String(getHeader(req, 'content-type') ?? '').toLowerCase())) return fail(415, 'unsupported_media_type');
      let raw;
      try {
        raw = await readBody(req, route.max);
      } catch (error) {
        return error instanceof HttpError ? fail(error.status, error.code) : fail(400, 'bad_request');
      }
      try {
        body = JSON.parse(raw);
      } catch {
        return fail(400, 'bad_request');
      }
    }

    const config = readEnv(ADMIN_ENV, env);
    if (!config.ok) {
      log('admin_config', { status: 503, missing: config.missing });
      return sendJson(res, 503, { ok: false, error: 'not_configured' });
    }
    const cfg = config.values;
    const db = createSupabase({ url: cfg.SUPABASE_URL, key: cfg.SUPABASE_SERVICE_ROLE_KEY, fetch });
    const auth = createAuth({ url: cfg.SUPABASE_URL, anonKey: cfg.VITE_SUPABASE_ANON_KEY, fetch });
    const ip = clientIp(req);
    const ipHash = hashIp(ip, cfg.IP_HASH_SALT);

    /** Rate limit. null when allowed, else the 429 response was sent. Throws → the caller answers 500. */
    const limited = async (kind) => {
      const gate = await db.rpc('admin_login_submit', { p_ip_hash: ipHash, p_kind: kind });
      if (gate?.allowed) return false;
      const retry = Math.max(1, Math.ceil(Number(gate?.retry_after) || 600));
      fail(429, 'rate_limited', { retryAfter: retry }, { 'Retry-After': String(retry) });
      return true;
    };
    const invalidLogin = async () => {
      await sleep(FAIL_DELAY_MS);
      return fail(401, 'invalid_credentials');
    };

    try {
      // ───────────── login ─────────────
      if (name === 'login') {
        const parsed = loginSchema.safeParse(body);
        if (!parsed.success) return fail(400, 'bad_request');
        const { email, password, token } = parsed.data;
        if (await limited('login')) return undefined;
        const human = await verifyTurnstile({ token, ip, secret: cfg.TURNSTILE_SECRET_KEY, fetch, action: 'admin' });
        if (!human.ok) return fail(400, 'verification_failed');
        const grant = await auth.password(email, password);
        if (!grant.ok) return invalidLogin();
        // Only an admin gets a token. Everyone else gets the SAME answer and delay as a wrong password.
        const rows = await db.select('admins', `select=user_id&user_id=eq.${encodeURIComponent(grant.userId)}&limit=1`);
        if (!Array.isArray(rows) || rows.length !== 1) {
          await auth.logout(grant.accessToken);
          return invalidLogin();
        }
        const user = await auth.user(grant.accessToken);
        const enrolled = user.ok && user.factors.some((f) => f.type === 'totp' && f.status === 'verified');
        log('admin', { status: 200, reason: 'login', ms: now() - t0 });
        return sendJson(res, 200, { ok: true, accessToken: grant.accessToken, expiresIn: grant.expiresIn, mfa: enrolled ? 'verify' : 'enroll' });
      }

      // ───────────── logout (never fails, reveals nothing) ─────────────
      if (name === 'logout') {
        const m = /^Bearer (\S{20,4096})$/.exec(String(getHeader(req, 'authorization') ?? ''));
        if (m) await auth.logout(m[1]);
        return sendJson(res, 200, { ok: true });
      }

      // ───────────── MFA: a valid admin session at aal1 (or aal2) ─────────────
      if (name === 'mfa/enroll' || name === 'mfa/verify') {
        const gate = await requireAdmin({ req, auth, db, requireAal2: false });
        if (!gate.ok) return fail(gate.status, gate.status === 401 ? 'unauthorized' : 'forbidden');
        if (await limited('mfa')) return undefined;
        const totp = gate.factors.filter((f) => f.type === 'totp');
        if (name === 'mfa/enroll') {
          if (totp.some((f) => f.status === 'verified')) return fail(409, 'already_enrolled');
          for (const f of totp) await auth.removeFactor(gate.token, f.id); // abandoned, never-verified enrolments
          const enrol = await auth.enroll(gate.token);
          log('admin', { status: 200, reason: 'enroll_started', ms: now() - t0 });
          return sendJson(res, 200, { ok: true, ...enrol });
        }
        const parsed = mfaVerifySchema.safeParse(body);
        if (!parsed.success) return fail(400, 'bad_request');
        const factor = parsed.data.factorId ? totp.find((f) => f.id.toLowerCase() === parsed.data.factorId.toLowerCase()) : totp.find((f) => f.status === 'verified');
        if (!factor) return fail(400, 'bad_request');
        const result = await auth.verifyTotp(gate.token, factor.id, parsed.data.code);
        if (!result.ok) {
          await sleep(FAIL_DELAY_MS);
          return fail(401, 'invalid_code');
        }
        log('admin', { status: 200, reason: 'mfa_ok', ms: now() - t0 });
        return sendJson(res, 200, { ok: true, accessToken: result.accessToken, expiresIn: result.expiresIn });
      }

      // ───────────── data routes: token + admin + aal2 ─────────────
      const gate = await requireAdmin({ req, auth, db });
      if (!gate.ok) return fail(gate.status, gate.status === 401 ? 'unauthorized' : 'forbidden');

      if (name === 'projects-order') {
        if (req.method === 'GET') {
          const saved = await db.select('project_order', 'select=slug&order=position.asc');
          const slugs = mergeOrder((saved ?? []).map((r) => r.slug), PROJECT_SLUGS);
          const titles = new Map(PROJECTS.map((p) => [p.slug, p.title]));
          return sendJson(res, 200, { ok: true, saved: Array.isArray(saved) && saved.length > 0, projects: slugs.map((slug) => ({ slug, title: titles.get(slug) })) });
        }
        const parsed = orderSaveSchema.safeParse(body);
        const checked = parsed.success ? validateOrder(parsed.data.order, PROJECT_SLUGS) : { ok: false };
        if (!checked.ok) return fail(400, 'bad_request');
        await db.rpc('project_order_save', { p_slugs: checked.order });
        log('admin', { status: 200, reason: 'order_saved', ms: now() - t0 });
        return sendJson(res, 200, { ok: true, projects: mergeOrder(checked.order, PROJECT_SLUGS).map((slug) => ({ slug, title: PROJECTS.find((p) => p.slug === slug)?.title })) });
      }

      if (name === 'stats') {
        // P10: anonymous daily totals only: { day, event, count }. Nothing else exists in the table.
        const days = Array.from({ length: STATS_DAYS }, (_, i) => new Date(now() - i * 86_400_000).toISOString().slice(0, 10));
        const rows = await db.select('analytics_daily', `select=day,event,count&day=gte.${days[days.length - 1]}&order=day.desc&limit=${STATS_DAYS * ANALYTICS_EVENTS.length}`);
        const stats = (rows ?? []).filter((r) => days.includes(r.day) && ANALYTICS_EVENTS.includes(r.event)).map((r) => ({ day: r.day, event: r.event, count: Number(r.count) || 0 }));
        return sendJson(res, 200, { ok: true, days, events: ANALYTICS_EVENTS, stats });
      }

      // messages
      if (req.method === 'GET') {
        const rows = await db.select('contact_messages', `select=id,created_at,name,email,subject,message,status&order=created_at.desc&limit=${MESSAGE_LIMIT}`);
        const messages = (rows ?? []).map((r) => ({
          id: r.id,
          createdAt: r.created_at,
          name: r.name,
          email: r.email,
          subject: r.subject,
          message: r.message,
          status: STATUS_COLUMN[r.status] ?? 'new',
          emailFailed: r.status === 'email_failed',
        }));
        return sendJson(res, 200, { ok: true, messages });
      }
      const parsed = messagePatchSchema.safeParse(body);
      if (!parsed.success) return fail(400, 'bad_request');
      const { id, status } = parsed.data;
      const exists = await db.select('contact_messages', `select=id&id=eq.${encodeURIComponent(id)}&limit=1`);
      if (!Array.isArray(exists) || exists.length !== 1) return fail(404, 'not_found');
      await db.patch('contact_messages', `id=eq.${encodeURIComponent(id)}`, { status });
      log('admin', { status: 200, reason: 'message_status', ms: now() - t0 });
      return sendJson(res, 200, { ok: true, id, status });
    } catch {
      return fail(500, 'server_error');
    }
  };
}

export default safe(createAdminHandler(), 'admin');
