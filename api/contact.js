// POST /api/contact (Vercel Function, Node runtime, region bom1 from vercel.json).
// Order: method → origin → content type → size → configuration → parse → validate (schema, honeypot,
// time trap) → Turnstile → rate limit + store (one SQL call) → email. If the email fails after the row
// is stored, the visitor still gets success and the row is marked 'email_failed' (Umer sees it in the
// database / admin later). Errors are generic; only validation returns per-field messages. Logs carry
// no PII and no secrets (api/_lib/log.js). The same handler runs in the Vite dev middleware.
import nodemailer from 'nodemailer';
import { contactRequestSchema, fieldErrors, LIMITS } from '../src/shared/contact-schema.js';
import { CONTACT_ENV, readEnv } from './_lib/env.js';
import { HttpError, clientIp, getHeader, isAllowedOrigin, readBody, requestOrigin, sendJson } from './_lib/http.js';
import { logEvent } from './_lib/log.js';
import { buildMail, createMailer } from './_lib/mail.js';
import { checkStamp, hashIp } from './_lib/security.js';
import { createSupabase } from './_lib/supabase.js';
import { verifyTurnstile } from './_lib/turnstile.js';

const USER_AGENT_MAX = 200;

export function createContactHandler({ env = process.env, fetch = globalThis.fetch, createTransport = nodemailer.createTransport, now = Date.now, log = logEvent } = {}) {
  return async function contact(req, res) {
    const t0 = now();
    const fail = (status, error, extra = {}, headers = {}) => {
      log('contact', { status, reason: error, ms: now() - t0 });
      return sendJson(res, status, { ok: false, error, ...extra }, headers);
    };

    if (req.method !== 'POST') return fail(405, 'method_not_allowed', {}, { Allow: 'POST' });
    if (!isAllowedOrigin(requestOrigin(req))) return fail(403, 'forbidden');
    const type = String(getHeader(req, 'content-type') ?? '').toLowerCase();
    if (!/^application\/json(?:\s*;|$)/.test(type)) return fail(415, 'unsupported_media_type');

    let raw;
    try {
      raw = await readBody(req, LIMITS.body);
    } catch (error) {
      if (error instanceof HttpError) return fail(error.status, error.code);
      return fail(400, 'bad_request');
    }

    const config = readEnv(CONTACT_ENV, env);
    if (!config.ok) {
      log('contact_config', { status: 503, missing: config.missing });
      return sendJson(res, 503, { ok: false, error: 'not_configured' });
    }
    const cfg = config.values;

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return fail(400, 'invalid_json');
    }
    const parsed = contactRequestSchema.safeParse(body);
    if (!parsed.success) {
      const fields = fieldErrors(parsed.error);
      const visible = Object.fromEntries(Object.entries(fields).filter(([k]) => ['name', 'email', 'subject', 'message'].includes(k)));
      if (!Object.keys(visible).length) return fail(400, 'bad_request');
      return fail(400, 'invalid', { fields: visible });
    }
    const { website, stamp, token, ...data } = parsed.data;

    const ip = clientIp(req);
    const ipHash = hashIp(ip, cfg.IP_HASH_SALT);
    // Honeypot: a bot filled the hidden field. Pretend it worked; store and send nothing.
    if (website) {
      log('contact', { status: 200, reason: 'honeypot', ms: now() - t0 });
      return sendJson(res, 200, { ok: true });
    }
    const time = checkStamp(stamp, now(), ipHash, cfg.IP_HASH_SALT);
    if (!time.ok) return fail(400, time.reason === 'too_fast' ? 'too_fast' : 'stale_form');

    try {
      const check = await verifyTurnstile({ token, ip, secret: cfg.TURNSTILE_SECRET_KEY, fetch });
      if (!check.ok) return fail(400, 'verification_failed');
    } catch {
      return fail(500, 'server_error');
    }

    const db = createSupabase({ url: cfg.SUPABASE_URL, key: cfg.SUPABASE_SERVICE_ROLE_KEY, fetch });
    let stored;
    try {
      stored = await db.rpc('contact_submit', {
        p_ip_hash: ipHash,
        p_name: data.name,
        p_email: data.email,
        p_subject: data.subject,
        p_message: data.message,
        p_user_agent: String(getHeader(req, 'user-agent') ?? '').slice(0, USER_AGENT_MAX),
      });
    } catch {
      return fail(500, 'server_error');
    }
    if (!stored?.allowed) {
      const retry = Math.max(1, Math.ceil(Number(stored?.retry_after) || 3600));
      return fail(429, 'rate_limited', { retryAfter: retry }, { 'Retry-After': String(retry) });
    }

    try {
      const mailer = createMailer(createTransport, { user: cfg.SMTP_USER, pass: cfg.SMTP_APP_PASSWORD });
      await mailer.sendMail(buildMail({ from: cfg.SMTP_USER, to: cfg.CONTACT_TO, data, receivedAt: now() }));
    } catch {
      log('contact_email', { status: 200, reason: 'email_failed', ms: now() - t0 });
      try {
        await db.patch('contact_messages', `id=eq.${encodeURIComponent(stored.id)}`, { status: 'email_failed' });
      } catch {
        log('contact_email', { reason: 'status_update_failed' });
      }
      return sendJson(res, 200, { ok: true });
    }

    log('contact', { status: 200, reason: 'sent', ms: now() - t0 });
    return sendJson(res, 200, { ok: true });
  };
}

export default createContactHandler();
