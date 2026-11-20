// P7 admin authentication, server side only. The browser never talks to Supabase: these helpers call Supabase Auth
// (GoTrue) over plain fetch with the PUBLIC anon key as `apikey` and the visitor's access token as the bearer.
// Nothing here returns or logs a response body from Supabase (they can contain emails and tokens).
//
// requireAdmin() is the gate of every admin data endpoint:
//   1. a bearer token of the right shape,
//   2. Supabase itself validates it (GET /auth/v1/user: signature, expiry, revoked session),
//   3. the user has a row in `admins`,
//   4. the token's `aal` claim is "aal2" (a TOTP code was verified in this session). The claim is read from the
//      payload ONLY AFTER step 2 has proved the token genuine.
// 401 = no valid session; 403 = a valid user who is not an admin or has not passed MFA. No detail is returned.
import { randomBytes } from 'node:crypto';
import { getHeader } from './http.js';

// What Supabase said when a call failed, reduced to values that are safe to log: the HTTP status and its short
// machine code (for example mfa_totp_enroll_not_enabled). Never the message text, tokens, codes, QR data or emails.
const CODE = /^[a-z][a-z0-9_]{0,63}$/;
export class AuthUpstreamError extends Error {
  constructor(op, status, code) {
    super(`auth ${op} ${status}`);
    this.op = op;
    this.status = status;
    this.code = code;
  }
}
/** A log-safe reason such as `enroll_upstream_422_mfa_factor_name_conflict`. */
export const upstreamReason = (op, status, code) => `${op}_upstream_${Number(status) || 0}_${CODE.test(String(code)) ? code : 'none'}`;

const JWT = /^[A-Za-z0-9_-]{8,2048}\.[A-Za-z0-9_-]{8,2048}\.[A-Za-z0-9_-]{0,2048}$/;
const TIMEOUT = 8000;

/** The bearer token of a request, or null when absent or not shaped like a JWT. */
export function bearerToken(req) {
  const m = /^Bearer (\S{20,4096})$/.exec(String(getHeader(req, 'authorization') ?? ''));
  return m && JWT.test(m[1]) ? m[1] : null;
}

/** The claims of a JWT (no signature check: call it only on a token Supabase has already accepted). */
export function jwtClaims(token) {
  try {
    const claims = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? claims : null;
  } catch {
    return null;
  }
}

/**
 * The QR as an SVG data URI. Supabase's real answer is a RAW SVG document of about 320 KB (`<?xml …?><!-- … --><svg …>`);
 * some versions send a `data:image/svg+xml` URI instead. Both are accepted, comments and the XML prolog are stripped,
 * anything with script-like content is dropped (an <img> never runs scripts, this is belt and braces), and the result
 * is passed on as base64. Vercel compresses the JSON answer, so the size on the wire is small.
 */
const QR_MAX = 600_000;
function qrDataUri(value) {
  if (typeof value !== 'string' || value.length >= QR_MAX) return '';
  if (/^data:image\/svg\+xml/.test(value)) return value;
  const svg = value.replace(/^\s*<\?xml[^>]*\?>/i, '').replace(/<!--[\s\S]*?-->/g, '').trim();
  if (!/^<svg[\s>]/i.test(svg) || /<script|<foreignObject|<!ENTITY|<iframe|\son\w+\s*=|javascript:/i.test(svg)) return '';
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

export function createAuth({ url, anonKey, fetch }) {
  const base = `${url.replace(/\/+$/, '')}/auth/v1`;
  async function call(method, path, { token, body } = {}) {
    const headers = { apikey: anonKey, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT) });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    const raw = data?.error_code ?? data?.code; // GoTrue: { code: 422, error_code: 'mfa_factor_name_conflict', msg }
    return { status: res.status, data, code: typeof raw === 'string' && CODE.test(raw) ? raw : 'none' };
  }
  return {
    /** Password grant. { ok: true, accessToken, expiresIn, userId } | { ok: false }. Throws on a Supabase outage. */
    async password(email, password) {
      const { status, data, code } = await call('POST', '/token?grant_type=password', { body: { email, password } });
      if (status === 200 && typeof data?.access_token === 'string' && data.user?.id) return { ok: true, accessToken: data.access_token, expiresIn: Number(data.expires_in) || 3600, userId: String(data.user.id) };
      if (status >= 400 && status < 500) return { ok: false };
      throw new AuthUpstreamError('password', status, code);
    },
    /** Validates the token and returns the user with its MFA factors. */
    async user(token) {
      const { status, data, code } = await call('GET', '/user', { token });
      if (status === 200 && data?.id) return { ok: true, id: String(data.id), factors: Array.isArray(data.factors) ? data.factors.filter((f) => f && typeof f === 'object' && f.id).map((f) => ({ id: String(f.id), type: f.factor_type, status: f.status })) : [] };
      if (status === 401 || status === 403 || status === 404) return { ok: false };
      throw new AuthUpstreamError('user', status, code);
    },
    /**
     * Starts TOTP enrolment: POST /auth/v1/factors with the USER's token as the bearer and the anon key as `apikey`.
     * Every attempt uses a fresh friendly name (Supabase refuses a duplicate name for the same user; one retry if it
     * still says so). Returns the QR (an SVG data URI), the secret and the otpauth URI. Throws AuthUpstreamError.
     */
    async enroll(token) {
      const attempt = () => call('POST', '/factors', { token, body: { factor_type: 'totp', friendly_name: `admin-${randomBytes(6).toString('hex')}`, issuer: 'Byte Island admin' } });
      let res = await attempt();
      if (res.code === 'mfa_factor_name_conflict') res = await attempt();
      const { status, data, code } = res;
      if (status !== 200 && status !== 201) throw new AuthUpstreamError('enroll', status, code);
      const id = typeof data?.id === 'string' ? data.id : '';
      if (!id) throw new AuthUpstreamError('enroll', status, 'bad_response');
      const text = (v, max) => (typeof v === 'string' && v.length <= max ? v : '');
      return { factorId: id, qr: qrDataUri(data.totp?.qr_code), secret: text(data.totp?.secret, 200), uri: text(data.totp?.uri, 600) };
    },
    /** Removes a factor (used for never-verified enrolments). Never throws: { ok, status, code }. */
    async removeFactor(token, id) {
      try {
        const { status, code } = await call('DELETE', `/factors/${encodeURIComponent(id)}`, { token });
        return { ok: status >= 200 && status < 300, status, code };
      } catch {
        return { ok: false, status: 0, code: 'none' };
      }
    },
    /** Challenge + verify in one step. { ok: true, accessToken, expiresIn } (an aal2 session) | { ok: false }. */
    async verifyTotp(token, factorId, code) {
      const ch = await call('POST', `/factors/${encodeURIComponent(factorId)}/challenge`, { token, body: {} });
      if (ch.status !== 200 || !ch.data?.id) {
        if (ch.status >= 400 && ch.status < 500) return { ok: false, op: 'challenge', status: ch.status, code: ch.code };
        throw new AuthUpstreamError('challenge', ch.status, ch.code);
      }
      const v = await call('POST', `/factors/${encodeURIComponent(factorId)}/verify`, { token, body: { challenge_id: ch.data.id, code } });
      if (v.status === 200 && typeof v.data?.access_token === 'string') return { ok: true, accessToken: v.data.access_token, expiresIn: Number(v.data.expires_in) || 3600 };
      if (v.status >= 400 && v.status < 500) return { ok: false, op: 'verify', status: v.status, code: v.code };
      throw new AuthUpstreamError('verify', v.status, v.code);
    },
    /** Revokes the session on Supabase's side. Never throws. */
    async logout(token) {
      try {
        await call('POST', '/logout', { token });
      } catch {
        /* the token expires on its own */
      }
    },
  };
}

/**
 * The gate for admin data endpoints. Returns { ok: true, userId } or { ok: false, status: 401 | 403 }.
 * Throws only when Supabase itself is unreachable (the caller answers a generic 500).
 */
export async function requireAdmin({ req, auth, db, requireAal2 = true }) {
  const token = bearerToken(req);
  if (!token) return { ok: false, status: 401 };
  const user = await auth.user(token);
  if (!user.ok) return { ok: false, status: 401 };
  const rows = await db.select('admins', `select=user_id&user_id=eq.${encodeURIComponent(user.id)}&limit=1`);
  if (!Array.isArray(rows) || rows.length !== 1) return { ok: false, status: 403 };
  if (requireAal2 && jwtClaims(token)?.aal !== 'aal2') return { ok: false, status: 403 };
  return { ok: true, userId: user.id, token, factors: user.factors };
}
