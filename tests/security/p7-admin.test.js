// C14 (P7): the admin API. /api/admin/* (one catch-all function), /api/project-order (public) and
// /api/cron/keepalive with a stateful mock of Supabase Auth (GoTrue) and REST: request checks, login (generic
// errors, rate limit, Turnstile action), TOTP enrolment and verification, the admin gate (token + admins row +
// aal2), messages (whitelisted fields, ip_hash never returned), project order (unknown slugs, duplicates),
// the cron secret, and the front end / bundle / headers.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createAdminHandler, ADMIN_ENV, FAIL_DELAY_MS } from '../../api/admin/[...path].js';
import { createKeepaliveHandler } from '../../api/cron/keepalive.js';
import { createProjectOrderHandler } from '../../api/project-order.js';
import { bearerToken, jwtClaims } from '../../api/_lib/auth.js';
import { publicProjects } from '../../scripts/content/slugs.mjs';
import { PROJECTS, PROJECT_SLUGS } from '../../src/shared/project-slugs.js';
import { buildSite } from '../helpers/build-site.js';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const strip = (code) => code.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const ORIGIN = 'https://umerfarooq-ai.vercel.app';
const S = 'https://proj.supabase.test';
const IP = '203.0.113.50';
const ENV = {
  SUPABASE_URL: S,
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
  VITE_SUPABASE_ANON_KEY: 'anon-test-key',
  TURNSTILE_SECRET_KEY: 'turnstile-test-secret',
  IP_HASH_SALT: 'admin-test-salt-0123456789abcdefghijklmnopqrstuvwxyz',
  CRON_SECRET: 'cron-secret-test-0123456789abcdefghijklmnopqrstuvwxyz-ABCDEFGH',
};
const UID_ADMIN = '11111111-1111-4111-8111-111111111111';
const UID_OTHER = '22222222-2222-4222-8222-222222222222';
const MSG_ID = '33333333-3333-4333-8333-333333333333';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const makeJwt = (claims) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.c2lnbmF0dXJlLXRlc3Q`;

/** A stateful stand-in for Supabase Auth + PostgREST + Turnstile. */
function upstream({ factors = {}, admins = [UID_ADMIN], turnstile = { success: true, hostname: 'umerfarooq-ai.vercel.app', action: 'admin' }, authDown = false, dbDown = false, enrolErrors = [], deleteStatus = 200, qr = 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"/>' } = {}) {
  const users = { 'admin@example.com': { password: 'correct horse battery', id: UID_ADMIN }, 'other@example.com': { password: 'other password 1', id: UID_OTHER } };
  const f = { [UID_ADMIN]: [], [UID_OTHER]: [], ...factors };
  const tokens = new Map(); // access token → { id, aal }
  const state = { calls: [], logins: 0, rpc: [], patches: [], saved: [], revoked: [], removed: [], enrolBodies: [], hits: { login: 0, mfa: 0 }, selects: [], messages: [
    { id: MSG_ID, created_at: '2026-11-19T10:00:00Z', name: 'Ada Lovelace', email: 'ada@example.com', subject: 'General', message: 'Hello <b>there</b>\nsecond line', status: 'new', ip_hash: 'a'.repeat(64), user_agent: 'Mozilla/5.0 secret-agent' },
    { id: '44444444-4444-4444-8444-444444444444', created_at: '2026-11-18T10:00:00Z', name: 'Bob', email: 'bob@example.com', subject: 'Other', message: 'Email failed one for the mailbox test', status: 'email_failed', ip_hash: 'b'.repeat(64), user_agent: 'x' },
    { id: '55555555-5555-4555-8555-555555555555', created_at: '2026-11-17T10:00:00Z', name: 'Cy', email: 'cy@example.com', subject: 'Other', message: 'A legacy read message for the board', status: 'read', ip_hash: 'c'.repeat(64), user_agent: 'x' },
  ] };
  const mint = (id, aal) => {
    const t = makeJwt({ sub: id, aal, exp: Math.floor(Date.now() / 1000) + 3600, n: tokens.size });
    tokens.set(t, { id, aal });
    return t;
  };
  const json = (data, status = 200) => new Response(data === null ? null : JSON.stringify(data), { status });
  const bearer = (init) => String(init.headers?.Authorization ?? '').replace(/^Bearer /, '');
  const fetch = vi.fn(async (url, init = {}) => {
    const u = String(url);
    const method = init.method ?? 'GET';
    state.calls.push(`${method} ${u.replace(S, '')}`);
    const body = init.body && typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : {};
    if (u.includes('siteverify')) {
      state.siteverify = body;
      return json(turnstile);
    }
    if (u.startsWith(`${S}/auth/v1`)) {
      if (authDown) return json({}, 503);
      const path = u.slice(`${S}/auth/v1`.length);
      if (path.startsWith('/token')) {
        state.logins += 1;
        const user = users[body.email];
        if (!user || user.password !== body.password) return json({ error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400);
        return json({ access_token: mint(user.id, 'aal1'), refresh_token: 'refresh-token-should-never-reach-the-browser', expires_in: 3600, user: { id: user.id, email: body.email } });
      }
      if (path === '/user') {
        const t = tokens.get(bearer(init));
        return t ? json({ id: t.id, email: 'x@example.com', factors: f[t.id] }) : json({ msg: 'invalid JWT' }, 401);
      }
      if (path === '/factors' && method === 'POST') {
        const t = tokens.get(bearer(init));
        state.enrolBodies.push(body);
        state.enrolHeaders = { apikey: init.headers?.apikey, bearerIsUser: tokens.has(bearer(init)), type: init.headers?.['Content-Type'] };
        const err = enrolErrors.shift();
        if (err) return json(err.body, err.status);
        const factor = { id: `66666666-6666-4666-8666-66666666666${f[t.id].length}`, factor_type: 'totp', status: 'unverified' };
        f[t.id].push(factor);
        return json({ id: factor.id, totp: { qr_code: qr, secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/Byte%20Island:admin?secret=JBSWY3DPEHPK3PXP' } });
      }
      const fm = /^\/factors\/([^/]+)(?:\/(challenge|verify))?$/.exec(path);
      if (fm) {
        const t = tokens.get(bearer(init));
        if (method === 'DELETE') {
          state.removed.push(fm[1]);
          if (deleteStatus !== 200) return json({ error_code: 'bad_jwt', msg: 'SECRET upstream text' }, deleteStatus);
          f[t.id] = f[t.id].filter((x) => x.id !== fm[1]);
          return json({});
        }
        if (fm[2] === 'challenge') return json({ id: 'challenge-1' });
        if (fm[2] === 'verify') {
          if (body.code !== '123456') return json({ code: 'mfa_verification_failed' }, 400);
          f[t.id].find((x) => x.id === fm[1]).status = 'verified';
          return json({ access_token: mint(t.id, 'aal2'), refresh_token: 'r2', expires_in: 3600 });
        }
      }
      if (path === '/logout') {
        state.revoked.push(bearer(init));
        tokens.delete(bearer(init));
        return new Response(null, { status: 204 });
      }
      return json({}, 404);
    }
    if (u.startsWith(`${S}/rest/v1`)) {
      if (dbDown) return json({}, 500);
      const path = u.slice(`${S}/rest/v1`.length);
      if (path === '/rpc/admin_login_submit') {
        state.rpc.push(['admin_login_submit', body]);
        state.hits[body.p_kind] += 1;
        const limit = body.p_kind === 'mfa' ? 10 : 5;
        return json(state.hits[body.p_kind] > limit ? { allowed: false, retry_after: 240 } : { allowed: true });
      }
      if (path === '/rpc/project_order_save') {
        state.rpc.push(['project_order_save', body]);
        state.saved = body.p_slugs;
        return json(body.p_slugs.length);
      }
      if (path.startsWith('/admins?')) {
        const id = /user_id=eq\.([^&]+)/.exec(path)[1];
        return json(admins.includes(decodeURIComponent(id)) ? [{ user_id: id }] : []);
      }
      if (path.startsWith('/project_order?')) return json(state.saved.map((slug) => ({ slug })));
      if (path.startsWith('/documents?')) return json([{ id: 1 }]);
      if (path.startsWith('/contact_messages?') && method === 'GET') {
        state.selects.push(path);
        const cols = /select=([^&]+)/.exec(path)[1].split(',');
        const only = /id=eq\.([^&]+)/.exec(path);
        const rows = only ? state.messages.filter((m) => m.id === decodeURIComponent(only[1])) : state.messages;
        return json(rows.map((m) => Object.fromEntries(cols.map((c) => [c, m[c]]))));
      }
      if (path.startsWith('/contact_messages?') && method === 'PATCH') {
        state.patches.push([path, body]);
        return new Response(null, { status: 204 });
      }
    }
    throw new Error(`unexpected fetch ${method} ${u}`);
  });
  return { fetch, state, tokens, mint, factors: f, users };
}

function request(path, { method = 'POST', body, type = 'application/json', headers = {}, raw } = {}) {
  const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  const req = Readable.from(payload === undefined || method === 'GET' ? [] : [Buffer.from(payload)]);
  req.method = method;
  req.url = `/api/admin/${path}`;
  req.headers = { origin: ORIGIN, 'x-real-ip': IP, ...(payload !== undefined && method !== 'GET' ? { 'content-type': type } : {}), ...headers };
  for (const [k, v] of Object.entries(req.headers)) if (v === undefined) delete req.headers[k];
  return req;
}
const response = () => {
  const res = { statusCode: 0, headers: {}, body: '' };
  res.setHeader = (k, v) => {
    res.headers[k.toLowerCase()] = String(v);
  };
  res.end = (b = '') => {
    res.body = String(b);
  };
  res.json = () => JSON.parse(res.body);
  return res;
};

async function call(path, options = {}, up = upstream(), env = ENV) {
  const res = response();
  const sleeps = [];
  const logs = [];
  await createAdminHandler({ env, fetch: up.fetch, now: () => 1_800_000_000_000, sleep: async (ms) => void sleeps.push(ms), log: (e, f) => logs.push(JSON.stringify({ e, ...f })) })(request(path, options), res);
  return { res, sleeps, logs, up };
}
const login = (up, extra = {}) => call('login', { body: { email: 'admin@example.com', password: 'correct horse battery', token: 'turnstile-token', ...extra } }, up);
const auth = (token) => ({ authorization: `Bearer ${token}` });
/** An aal1 and an aal2 session for the admin. */
function sessions(up) {
  const aal1 = up.mint(UID_ADMIN, 'aal1');
  const aal2 = up.mint(UID_ADMIN, 'aal2');
  return { aal1, aal2 };
}

describe('C14 /api/admin: request checks', () => {
  it('unknown route 404; wrong method 405 with Allow; no admin route answers without an allowed origin (403, nothing called)', async () => {
    expect((await call('nothing', { method: 'GET' })).res.statusCode).toBe(404);
    expect((await call('', { method: 'GET' })).res.statusCode).toBe(404);
    expect((await call('constructor', { method: 'GET' })).res.statusCode).toBe(404); // not a property lookup on the route table
    const get = await call('login', { method: 'GET' });
    expect(get.res.statusCode).toBe(405);
    expect(get.res.headers.allow).toBe('POST');
    expect((await call('messages', { method: 'DELETE' })).res.statusCode).toBe(405);
    for (const [path, method] of [['login', 'POST'], ['mfa/verify', 'POST'], ['mfa/enroll', 'POST'], ['projects-order', 'GET'], ['messages', 'GET'], ['messages', 'PATCH'], ['logout', 'POST']]) {
      for (const headers of [{ origin: 'https://evil.example' }, { origin: undefined }, { origin: 'null' }]) {
        const up = upstream();
        const r = await call(path, { method, body: {}, headers }, up);
        expect(r.res.statusCode, `${method} ${path} ${headers.origin}`).toBe(403);
        expect(up.fetch).not.toHaveBeenCalled();
      }
    }
  });

  it('wrong content type 415, malformed JSON 400, over the size limit 413 (declared and streamed), nothing called', async () => {
    for (const [path, method] of [['login', 'POST'], ['projects-order', 'POST'], ['messages', 'PATCH'], ['mfa/verify', 'POST']]) {
      for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
        const up = upstream();
        expect((await call(path, { method, body: {}, type }, up)).res.statusCode, `${path} ${type}`).toBe(415);
        expect(up.fetch).not.toHaveBeenCalled();
      }
      expect((await call(path, { method, raw: '{not json' })).res.statusCode).toBe(400);
    }
    const big = JSON.stringify({ email: 'a@example.com', password: 'x'.repeat(5000), token: 't' });
    expect((await call('login', { raw: big, headers: { 'content-length': String(big.length) } })).res.statusCode).toBe(413);
    expect((await call('login', { raw: big })).res.statusCode).toBe(413);
    expect((await call('projects-order', { raw: JSON.stringify({ order: ['a'.repeat(9000)] }) })).res.statusCode).toBe(413);
  });

  it('503 not_configured when a required variable is missing (including the public anon key); responses are never cacheable', async () => {
    for (const name of ADMIN_ENV) {
      const up = upstream();
      const r = await call('login', { body: { email: 'a@example.com', password: 'x', token: 't' } }, up, { ...ENV, [name]: '' });
      expect(r.res.statusCode, name).toBe(503);
      expect(r.res.json()).toEqual({ ok: false, error: 'not_configured' });
      expect(up.fetch).not.toHaveBeenCalled();
    }
    const r = await call('messages', { method: 'GET' });
    expect(r.res.headers['cache-control']).toBe('no-store');
  });

  it('a salt shorter than 32 characters disables the admin API', async () => {
    expect((await call('login', { body: { email: 'a@example.com', password: 'x', token: 't' } }, upstream(), { ...ENV, IP_HASH_SALT: 'short' })).res.statusCode).toBe(503);
  });
});

describe('C14 login', () => {
  it('an admin gets an aal1 token and the next step; nothing else (no refresh token, no user object)', async () => {
    const up = upstream();
    const r = await login(up);
    expect(r.res.statusCode).toBe(200);
    const body = r.res.json();
    expect(Object.keys(body).sort()).toEqual(['accessToken', 'expiresIn', 'mfa', 'ok']);
    expect(body.mfa).toBe('enroll');
    expect(jwtClaims(body.accessToken)).toMatchObject({ sub: UID_ADMIN, aal: 'aal1' });
    expect(r.res.body).not.toMatch(/refresh|admin@example\.com/);
    const enrolled = upstream({ factors: { [UID_ADMIN]: [{ id: '66666666-6666-4666-8666-666666666660', factor_type: 'totp', status: 'verified' }] } });
    expect((await login(enrolled)).res.json().mfa).toBe('verify');
  });

  it('Turnstile is checked with the action "admin"; another action, another hostname or a failure → 400 and the password is never tried', async () => {
    const up = upstream();
    await login(up);
    expect(up.state.siteverify).toMatchObject({ secret: ENV.TURNSTILE_SECRET_KEY, response: 'turnstile-token', remoteip: IP });
    for (const turnstile of [{ success: true, hostname: 'umerfarooq-ai.vercel.app', action: 'contact' }, { success: true, hostname: 'evil.example', action: 'admin' }, { success: false }]) {
      const bad = upstream({ turnstile });
      const r = await login(bad);
      expect(r.res.statusCode).toBe(400);
      expect(r.res.json().error).toBe('verification_failed');
      expect(bad.state.logins).toBe(0);
    }
  });

  it('unknown user, wrong password and a real user who is not an admin get the SAME status, body and delay; no token for the non-admin, whose session is revoked', async () => {
    const answers = [];
    for (const creds of [{ email: 'nobody@example.com', password: 'whatever it is' }, { email: 'admin@example.com', password: 'wrong password' }, { email: 'other@example.com', password: 'other password 1' }]) {
      const up = upstream();
      const r = await login(up, creds);
      answers.push([r.res.statusCode, r.res.body, r.sleeps]);
      if (creds.email === 'other@example.com') {
        expect(up.state.revoked).toHaveLength(1);
        expect(r.res.body).not.toMatch(/eyJ|accessToken/);
      }
    }
    expect(answers[0]).toEqual(answers[1]);
    expect(answers[1]).toEqual(answers[2]);
    expect(answers[0]).toEqual([401, '{"ok":false,"error":"invalid_credentials"}', [FAIL_DELAY_MS]]);
  });

  it('5 attempts per 10 minutes per IP hash: the 6th is 429 with Retry-After, before Turnstile and before any password is tried; the raw IP is never sent', async () => {
    const up = upstream();
    for (let i = 0; i < 5; i += 1) expect((await login(up, { password: 'wrong' })).res.statusCode).toBe(401);
    const before = up.state.logins;
    const r = await login(up);
    expect(r.res.statusCode).toBe(429);
    expect(r.res.headers['retry-after']).toBe('240');
    expect(r.res.json()).toMatchObject({ error: 'rate_limited', retryAfter: 240 });
    expect(up.state.logins).toBe(before);
    expect(up.state.calls.filter((c) => c.includes('siteverify')).length).toBe(5);
    const sent = up.state.rpc.filter(([n]) => n === 'admin_login_submit');
    expect(sent.every(([, b]) => /^[0-9a-f]{64}$/.test(b.p_ip_hash) && b.p_kind === 'login')).toBe(true);
    expect(JSON.stringify(up.state.rpc)).not.toContain(IP);
  });

  it('invalid bodies (extra keys, bad email, empty or huge password) are 400 before the rate limiter or Supabase is touched', async () => {
    for (const body of [{ email: 'admin@example.com', password: 'x', token: 't', role: 'admin' }, { email: 'not-an-email', password: 'x', token: 't' }, { email: 'a@example.com', password: '', token: 't' }, { email: 'a@example.com', password: 'x'.repeat(201), token: 't' }, { password: 'x', token: 't' }, { email: 'a@example.com', password: 'x' }, []]) {
      const up = upstream();
      expect((await call('login', { body }, up)).res.statusCode).toBe(400);
      expect(up.fetch).not.toHaveBeenCalled();
    }
  });

  it('a Supabase outage is a generic 500 (no detail)', async () => {
    const r = await login(upstream({ authDown: true }));
    expect(r.res.statusCode).toBe(500);
    expect(r.res.json()).toEqual({ ok: false, error: 'server_error' });
    const r2 = await login(upstream({ dbDown: true }));
    expect(r2.res.statusCode).toBe(500);
  });

  it('logs hold no email, password, token or IP', async () => {
    const up = upstream();
    const r = await login(up);
    const bad = await login(upstream(), { password: 'wrong password' });
    const all = [...r.logs, ...bad.logs].join('\n');
    for (const secret of ['admin@example.com', 'correct horse battery', 'wrong password', 'turnstile-token', IP, 'eyJ']) expect(all).not.toContain(secret);
  });
});

describe('C14 TOTP enrolment: the P7-fix (unique name, stale factors, real reasons, safe messages)', () => {
  const unverified = (n) => ({ id: `66666666-6666-4666-8666-66666666666${n}`, factor_type: 'totp', status: 'unverified' });
  const verified = { id: '66666666-6666-4666-8666-666666666669', factor_type: 'totp', status: 'verified' };

  it('POST /auth/v1/factors: the USER token is the bearer, the anon key is apikey, JSON body {factor_type, friendly_name, issuer}; every attempt has a different friendly name', async () => {
    const up = upstream();
    const { aal1 } = sessions(up);
    await call('mfa/enroll', { body: {}, headers: auth(aal1) }, up);
    await call('mfa/enroll', { body: {}, headers: auth(aal1) }, up);
    expect(up.state.enrolHeaders).toEqual({ apikey: 'anon-test-key', bearerIsUser: true, type: 'application/json' });
    const [one, two] = up.state.enrolBodies;
    for (const b of [one, two]) {
      expect(Object.keys(b).sort()).toEqual(['factor_type', 'friendly_name', 'issuer']);
      expect(b.factor_type).toBe('totp');
      expect(b.friendly_name).toMatch(/^admin-[0-9a-f]{12}$/);
    }
    expect(one.friendly_name).not.toBe(two.friendly_name);
  });

  it('stale UNVERIFIED factors are deleted before enrolling; a VERIFIED factor is never deleted (409, nothing removed)', async () => {
    const stale = upstream({ factors: { [UID_ADMIN]: [unverified(1), unverified(2), unverified(3)] } });
    const { aal1 } = sessions(stale);
    const r = await call('mfa/enroll', { body: {}, headers: auth(aal1) }, stale);
    expect(r.res.statusCode).toBe(200);
    expect(stale.state.removed).toEqual([unverified(1).id, unverified(2).id, unverified(3).id]);
    expect(stale.state.calls.filter((c) => c.includes('/factors')).at(-1)).toBe('POST /auth/v1/factors'); // the enrol comes after every delete
    const mixed = upstream({ factors: { [UID_ADMIN]: [unverified(1), verified] } });
    const r2 = await call('mfa/enroll', { body: {}, headers: auth(sessions(mixed).aal1) }, mixed);
    expect(r2.res.statusCode).toBe(409);
    expect(r2.res.json()).toEqual({ ok: false, error: 'already_enrolled' });
    expect(mixed.state.removed).toEqual([]);
    expect(mixed.state.enrolBodies).toEqual([]);
  });

  it('a stale factor that cannot be removed is logged (status and code only) and the enrolment still goes on', async () => {
    const up = upstream({ factors: { [UID_ADMIN]: [unverified(1)] }, deleteStatus: 401 });
    const r = await call('mfa/enroll', { body: {}, headers: auth(sessions(up).aal1) }, up);
    expect(r.res.statusCode).toBe(200);
    expect(r.logs.join('\n')).toContain('factor_remove_upstream_401_bad_jwt');
    expect(r.logs.join('\n')).not.toContain('SECRET');
  });

  it('a duplicate friendly name from Supabase is retried once with a new name', async () => {
    const up = upstream({ enrolErrors: [{ status: 422, body: { code: 422, error_code: 'mfa_factor_name_conflict', msg: 'A factor with the friendly name "x" for this user already exists' } }] });
    const r = await call('mfa/enroll', { body: {}, headers: auth(sessions(up).aal1) }, up);
    expect(r.res.statusCode).toBe(200);
    expect(up.state.enrolBodies).toHaveLength(2);
    expect(up.state.enrolBodies[0].friendly_name).not.toBe(up.state.enrolBodies[1].friendly_name);
  });

  it('known upstream codes map to short FIXED messages with no raw upstream text; unknown codes get no message', async () => {
    const cases = [
      ['mfa_totp_enroll_not_enabled', 'Two-step setup is switched off in Supabase.'],
      ['mfa_factor_name_conflict', 'A previous setup attempt is pending. Try again.'],
      ['too_many_enrolled_mfa_factors', 'A previous setup attempt is pending. Try again.'],
    ];
    for (const [code, message] of cases) {
      const err = { status: 422, body: { code: 422, error_code: code, msg: 'RAW upstream text with user@example.com and a-secret' } };
      const up = upstream({ enrolErrors: [err, err] });
      const r = await call('mfa/enroll', { body: {}, headers: auth(sessions(up).aal1) }, up);
      expect(r.res.statusCode, code).toBe(502);
      expect(r.res.json(), code).toEqual({ ok: false, error: 'enroll_failed', message });
      expect(r.res.body).not.toMatch(/RAW|secret|example\.com/);
    }
    const odd = upstream({ enrolErrors: [{ status: 500, body: { msg: 'RAW upstream text', error_code: 'Some Weird Code!' } }] });
    const r = await call('mfa/enroll', { body: {}, headers: auth(sessions(odd).aal1) }, odd);
    expect(r.res.statusCode).toBe(502);
    expect(r.res.json()).toEqual({ ok: false, error: 'enroll_failed' });
    expect(r.res.body).not.toContain('RAW');
  });

  it('every enrol failure logs the outcome with the upstream HTTP status and error code, and nothing secret; verify says which step failed', async () => {
    const up = upstream({ enrolErrors: [{ status: 422, body: { code: 422, error_code: 'mfa_totp_enroll_not_enabled', msg: 'RAW text user@example.com' } }] });
    const { aal1 } = sessions(up);
    const r = await call('mfa/enroll', { body: {}, headers: auth(aal1) }, up);
    const line = r.logs.map((l) => JSON.parse(l)).find((l) => /upstream/.test(l.reason ?? ''));
    expect(line).toMatchObject({ e: 'admin', status: 502, reason: 'enroll_upstream_422_mfa_totp_enroll_not_enabled' });
    const all = r.logs.join('\n');
    for (const secret of [aal1, 'RAW', 'example.com', 'JBSWY3DPEHPK3PXP', 'anon-test-key', 'service-role-test-key', IP, 'data:image']) expect(all).not.toContain(secret);
    const down = upstream({ enrolErrors: [{ status: 503, body: {} }] });
    const r2 = await call('mfa/enroll', { body: {}, headers: auth(sessions(down).aal1) }, down);
    expect(r2.logs.join('\n')).toContain('enroll_upstream_503_none');
    const wrong = upstream({ factors: { [UID_ADMIN]: [verified] } });
    const r3 = await call('mfa/verify', { body: { code: '000000' }, headers: auth(sessions(wrong).aal1) }, wrong);
    expect(r3.res.statusCode).toBe(401);
    expect(r3.logs.join('\n')).toContain('verify_upstream_400_mfa_verification_failed');
    expect(r3.logs.join('\n')).not.toContain('000000');
  });

  it('the QR is accepted as an SVG data URI or as raw SVG (converted); a raw SVG with a script is dropped', async () => {
    const raw = upstream({ qr: '<svg xmlns="http://www.w3.org/2000/svg" width="10"><rect width="10" height="10"/></svg>' });
    const r = await call('mfa/enroll', { body: {}, headers: auth(sessions(raw).aal1) }, raw);
    expect(r.res.json().qr).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(Buffer.from(r.res.json().qr.split(',')[1], 'base64').toString('utf8')).toMatch(/^<svg /);
    const evil = upstream({ qr: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' });
    expect((await call('mfa/enroll', { body: {}, headers: auth(sessions(evil).aal1) }, evil)).res.json().qr).toBe('');
  });

  it('the browser shows only the safe fixed message and never builds HTML from it', () => {
    const code = strip(read('src/admin/main.js'));
    expect(code).toMatch(/data\.message/);
    expect(code).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
  });
});

describe('C14 P7-fix2: the real root cause (a NESTED path never reached the function on Vercel)', () => {
  const unverified = { id: '66666666-6666-4666-8666-666666666661', factor_type: 'totp', status: 'unverified' };

  it('the browser calls ONLY single-segment admin paths (a nested /api/admin/mfa/enroll got Vercel\'s own 404: nothing reached the function, nothing was logged)', () => {
    const code = strip(read('src/admin/main.js'));
    const paths = [...code.matchAll(/\b(?:api|guarded)\(\s*'([^']+)'/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThanOrEqual(5);
    for (const path of paths) expect(path, path).not.toContain('/');
    expect(paths).toEqual(expect.arrayContaining(['login', 'mfa-enroll', 'mfa-verify']));
    expect(code).not.toMatch(/mfa\/(enroll|verify)/);
    // the plain fetch for logout is single segment too
    expect(code).toMatch(/\/api\/admin\/logout/);
  });

  it('mfa-enroll and mfa-verify are served by the catch-all as single segments; the nested spelling and a Vercel-style ?path= query reach the same route', async () => {
    const up = upstream();
    const { aal1 } = sessions(up);
    for (const path of ['mfa-enroll', 'mfa/enroll', 'mfa-enroll?path=mfa-enroll', 'mfa/enroll?path=mfa%2Fenroll']) {
      const r = await call(path, { body: {}, headers: auth(aal1) }, up);
      expect(r.res.statusCode, path).toBe(200);
      expect(r.res.json().factorId, path).toBeTruthy();
    }
    for (const path of ['mfa-verify', 'mfa/verify']) {
      const r = await call(path, { body: { code: '000000' }, headers: auth(aal1) }, up);
      expect([400, 401], path).toContain(r.res.statusCode); // routed (not 404): refused for the body / code, never "not found"
    }
    for (const path of ['mfa', 'mfa/', 'mfa/other', 'mfa-enroll/extra', 'mfa/enroll/extra']) expect((await call(path, { body: {}, headers: auth(aal1) }, up)).res.statusCode, path).toBe(404);
    // unauthenticated: 401 on the single-segment name (the live check asserts exactly this on the real site)
    expect((await call('mfa-enroll', { body: {} }, up)).res.statusCode).toBe(401);
    expect((await call('mfa-verify', { body: { code: '123456' } }, up)).res.statusCode).toBe(401);
  });

  it('the real Supabase QR is a RAW SVG document of about 320 KB with an XML prolog and a comment: it is accepted (stripped, base64); script-like content is dropped; a huge or non-SVG value is dropped', async () => {
    const big = `<?xml version="1.0"?>\n<!-- generated -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${'<rect width="1" height="1" x="1" y="1"/>'.repeat(8000)}</svg>`;
    expect(big.length).toBeGreaterThan(300000);
    const up = upstream({ qr: big });
    const r = await call('mfa-enroll', { body: {}, headers: auth(sessions(up).aal1) }, up);
    const qr = r.res.json().qr;
    expect(qr).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(qr.split(',')[1], 'base64').toString('utf8');
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg).not.toMatch(/<\?xml|<!--/);
    for (const bad of ['<svg><script>alert(1)</script></svg>', '<svg onload="x()"></svg>', '<svg><foreignObject/></svg>', '<svg><a href="javascript:x"/></svg>', '<html><svg/></html>', 'https://evil.example/q.svg', `<svg>${'x'.repeat(700000)}</svg>`]) {
      const u = upstream({ qr: bad });
      expect((await call('mfa-enroll', { body: {}, headers: auth(sessions(u).aal1) }, u)).res.json().qr, bad.slice(0, 30)).toBe('');
    }
  });

  it('LOG BEFORE RESPOND: every failure of the MFA routes writes one line naming the route and our status before the answer is sent', async () => {
    const up = upstream({ factors: { [UID_ADMIN]: [{ id: '66666666-6666-4666-8666-666666666669', factor_type: 'totp', status: 'verified' }] } });
    const { aal1 } = sessions(up);
    const order = [];
    const run = async (path, options, upstreamOverride = up) => {
      const res = response();
      const logs = [];
      const original = res.end;
      res.end = (b) => {
        order.push(`end:${res.statusCode}`);
        original(b);
      };
      await createAdminHandler({ env: ENV, fetch: upstreamOverride.fetch, now: () => 1_800_000_000_000, sleep: async () => {}, log: (e, f) => { order.push(`log:${f.status}:${f.reason}`); logs.push(f); } })(request(path, options), res);
      return { res, logs };
    };
    // no token, forged token, wrong body, wrong code, enrol when verified, rate limit
    const cases = [
      ['mfa-enroll', { body: {} }, 401, 'enroll_unauthorized'],
      ['mfa-verify', { body: { code: '123456' }, headers: auth('nope.nope.nope-nope-nope') }, 401, 'verify_unauthorized'],
      ['mfa-verify', { body: { code: '12' }, headers: auth(aal1) }, 400, 'verify_bad_request'],
      ['mfa-enroll', { body: {}, headers: auth(aal1) }, 409, 'enroll_already_enrolled'],
      ['mfa-verify', { body: { code: '000000' }, headers: auth(aal1) }, 401, 'verify_invalid_code'],
    ];
    for (const [path, options, status, reason] of cases) {
      order.length = 0;
      const { res, logs } = await run(path, options);
      expect(res.statusCode, reason).toBe(status);
      expect(logs.map((l) => l.reason), reason).toContain(reason);
      const logAt = order.findIndex((o) => o === `log:${status}:${reason}`);
      const endAt = order.findIndex((o) => o === `end:${status}`);
      expect(logAt, `${reason}: logged before the answer`).toBeGreaterThanOrEqual(0);
      expect(logAt, reason).toBeLessThan(endAt);
    }
    // an exception inside the enrol (the database is down) still logs a route-named line before the 500
    order.length = 0;
    const down = upstream({ dbDown: true });
    const { res, logs } = await run('mfa-enroll', { body: {}, headers: auth(down.mint(UID_ADMIN, 'aal1')) }, down);
    expect(res.statusCode).toBe(500);
    expect(logs.map((l) => l.reason)).toContain('mfa_enroll_exception');
    expect(order.findIndex((o) => o === 'log:500:mfa_enroll_exception')).toBeLessThan(order.findIndex((o) => o === 'end:500'));
    // the rate limit
    const limited = upstream({ factors: { [UID_ADMIN]: [unverified] } });
    limited.state.hits.mfa = 10;
    const r = await run('mfa-enroll', { body: {}, headers: auth(limited.mint(UID_ADMIN, 'aal1')) }, limited);
    expect(r.res.statusCode).toBe(429);
    expect(r.logs.map((l) => l.reason)).toContain('enroll_rate_limited');
    // none of the lines holds a secret
    expect(JSON.stringify(r.logs)).not.toMatch(/eyJ|anon-test-key|service-role|203\.0\.113/);
  });

  it('the page names the failure with a tag of OUR own (setup_404, setup_502, setup_network) and nothing from upstream', () => {
    const code = strip(read('src/admin/main.js'));
    expect(code).toMatch(/setup_network/);
    expect(code).toMatch(/`setup_\$\{Number\(status\) \|\| 0\}`/);
    expect(code).toMatch(/\(\$\{tag\}\)/);
    expect(code).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
  });

  it('the live check demands 401 (not 404) for the admin routes, using the single-segment MFA paths', () => {
    const live = read('scripts/security/live-check.mjs');
    expect(live).toContain("'/api/admin/mfa-enroll'");
    expect(live).toContain("'/api/admin/mfa-verify'");
    expect(live).not.toMatch(/\/api\/admin\/mfa\/(enroll|verify)/);
    expect(live).toMatch(/none\.res\.status === 401/);
    expect(live).toMatch(/forged\.res\.status === 401/);
    expect(live).toMatch(/evil\.res\.status === 403/);
  });
});

describe('C14 TOTP enrolment and verification', () => {
  it('enrol: needs a valid admin session (401 / 403), returns QR + secret + otpauth URI once, refuses a second enrolment (409), removes abandoned factors', async () => {
    const up = upstream();
    const { aal1 } = sessions(up);
    for (const headers of [{}, auth('nope.nope.nope-nope-nope'), auth(up.mint(UID_OTHER, 'aal1'))]) {
      const r = await call('mfa/enroll', { body: {}, headers }, up);
      expect([401, 403]).toContain(r.res.statusCode);
    }
    expect((await call('mfa/enroll', { body: {}, headers: auth(up.mint(UID_OTHER, 'aal1')) }, up)).res.statusCode).toBe(403);
    const first = await call('mfa/enroll', { body: {}, headers: auth(aal1) }, up);
    expect(first.res.statusCode).toBe(200);
    const b = first.res.json();
    expect(b).toMatchObject({ ok: true, secret: 'JBSWY3DPEHPK3PXP' });
    expect(b.qr).toMatch(/^data:image\/svg\+xml/);
    expect(b.uri).toMatch(/^otpauth:\/\/totp\//);
    // abandoned: enrol again without verifying → the unverified factor is removed first
    const again = await call('mfa/enroll', { body: {}, headers: auth(aal1) }, up);
    expect(again.res.statusCode).toBe(200);
    expect(up.state.removed).toHaveLength(1);
    // verified → enrolment is closed
    await call('mfa/verify', { body: { code: '123456', factorId: again.res.json().factorId }, headers: auth(aal1) }, up);
    expect((await call('mfa/enroll', { body: {}, headers: auth(aal1) }, up)).res.statusCode).toBe(409);
  });

  it('only an SVG data URI is passed on as the QR; anything else is dropped (the secret and the link remain)', async () => {
    const up = upstream({ qr: 'https://evil.example/qr.svg' });
    const { aal1 } = sessions(up);
    const r = await call('mfa/enroll', { body: {}, headers: auth(aal1) }, up);
    expect(r.res.json().qr).toBe('');
    expect(r.res.json().secret).toBeTruthy();
  });

  it('verify: a wrong code is 401 invalid_code with a delay; the right code returns an aal2 token; a factor that is not the user\'s is refused', async () => {
    const up = upstream();
    const { aal1 } = sessions(up);
    const enrol = (await call('mfa/enroll', { body: {}, headers: auth(aal1) }, up)).res.json();
    const wrong = await call('mfa/verify', { body: { code: '000000', factorId: enrol.factorId }, headers: auth(aal1) }, up);
    expect(wrong.res.statusCode).toBe(401);
    expect(wrong.res.json()).toEqual({ ok: false, error: 'invalid_code' });
    expect(wrong.sleeps).toEqual([FAIL_DELAY_MS]);
    const foreign = await call('mfa/verify', { body: { code: '123456', factorId: '77777777-7777-4777-8777-777777777777' }, headers: auth(aal1) }, up);
    expect(foreign.res.statusCode).toBe(400);
    const ok = await call('mfa/verify', { body: { code: '123456', factorId: enrol.factorId }, headers: auth(aal1) }, up);
    expect(ok.res.statusCode).toBe(200);
    expect(Object.keys(ok.res.json()).sort()).toEqual(['accessToken', 'expiresIn', 'ok']);
    expect(jwtClaims(ok.res.json().accessToken).aal).toBe('aal2');
    expect(ok.res.body).not.toMatch(/refresh|r2/);
    // later logins use the verified factor without naming it
    const later = await call('mfa/verify', { body: { code: '123456' }, headers: auth(up.mint(UID_ADMIN, 'aal1')) }, up);
    expect(later.res.statusCode).toBe(200);
  });

  it('verify refuses bad bodies (not 6 digits, extra keys, bad factor id) and non-admins; 10 attempts per 10 minutes, then 429', async () => {
    const up = upstream({ factors: { [UID_ADMIN]: [{ id: '66666666-6666-4666-8666-666666666660', factor_type: 'totp', status: 'verified' }] } });
    const { aal1 } = sessions(up);
    for (const body of [{ code: '12345' }, { code: 'abcdef' }, { code: '1234567' }, { code: 123456 }, { code: '123456', extra: 1 }, { code: '123456', factorId: 'not-a-uuid' }, {}]) {
      expect((await call('mfa/verify', { body, headers: auth(aal1) }, up)).res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await call('mfa/verify', { body: { code: '123456' }, headers: auth(up.mint(UID_OTHER, 'aal1')) }, up)).res.statusCode).toBe(403);
    expect((await call('mfa/verify', { body: { code: '123456' } }, up)).res.statusCode).toBe(401);
    const limited = upstream({ factors: { [UID_ADMIN]: [{ id: '66666666-6666-4666-8666-666666666660', factor_type: 'totp', status: 'verified' }] } });
    const t = limited.mint(UID_ADMIN, 'aal1');
    let last;
    for (let i = 0; i < 11; i += 1) last = await call('mfa/verify', { body: { code: '000000' }, headers: auth(t) }, limited);
    expect(last.res.statusCode).toBe(429);
    expect(last.res.headers['retry-after']).toBe('240');
  });

  it('logout revokes the session on Supabase and always answers the same', async () => {
    const up = upstream();
    const { aal2 } = sessions(up);
    const r = await call('logout', { body: {}, headers: auth(aal2) }, up);
    expect(r.res.json()).toEqual({ ok: true });
    expect(up.state.revoked).toEqual([aal2]);
    expect((await call('messages', { method: 'GET', headers: auth(aal2) }, up)).res.statusCode).toBe(401); // the revoked token no longer works
    expect((await call('logout', { body: {} }, upstream())).res.json()).toEqual({ ok: true });
  });
});

describe('C14 the gate on every data route: valid token + a row in admins + aal2', () => {
  const routes = [['messages', 'GET', undefined], ['messages', 'PATCH', { id: MSG_ID, status: 'replied' }], ['projects-order', 'GET', undefined], ['projects-order', 'POST', { order: PROJECT_SLUGS }]];
  it.each(routes)('%s %s: no token, malformed token, forged token → 401 with no detail', async (path, method, body) => {
    const up = upstream();
    const forgedClaims = makeJwt({ sub: UID_ADMIN, aal: 'aal2', exp: 9_999_999_999 }); // says aal2 but Supabase never issued it
    for (const headers of [{}, auth('x'), auth('a.b.c'), { authorization: 'Basic abc' }, { authorization: `Bearer ${forgedClaims}` }, auth(`${forgedClaims}x`)]) {
      const r = await call(path, { method, body, headers }, up);
      expect(r.res.statusCode, JSON.stringify(headers)).toBe(401);
      expect(r.res.json()).toEqual({ ok: false, error: 'unauthorized' });
    }
    expect(up.state.calls.some((c) => c.includes('contact_messages') || c.includes('project_order'))).toBe(false);
  });

  it.each(routes)('%s %s: a token Supabase has expired or revoked → 401', async (path, method, body) => {
    const up = upstream();
    const t = up.mint(UID_ADMIN, 'aal2');
    up.tokens.delete(t);
    expect((await call(path, { method, body, headers: auth(t) }, up)).res.statusCode).toBe(401);
  });

  it.each(routes)('%s %s: a real user who is not in admins → 403', async (path, method, body) => {
    const up = upstream();
    const r = await call(path, { method, body, headers: auth(up.mint(UID_OTHER, 'aal2')) }, up);
    expect(r.res.statusCode).toBe(403);
    expect(r.res.json()).toEqual({ ok: false, error: 'forbidden' });
  });

  it.each(routes)('%s %s: an admin who has NOT passed MFA (aal1) → 403, even with the right password', async (path, method, body) => {
    const up = upstream();
    const { aal1 } = sessions(up);
    const r = await call(path, { method, body, headers: auth(aal1) }, up);
    expect(r.res.statusCode).toBe(403);
    expect(up.state.calls.some((c) => c.startsWith('PATCH') || c.includes('project_order_save'))).toBe(false);
  });

  it('the aal claim is read only after Supabase accepted the token; helpers handle junk without throwing', () => {
    expect(bearerToken({ headers: { authorization: `Bearer ${makeJwt({ aal: 'aal2' })}` } })).toBeTruthy();
    for (const bad of [undefined, '', 'Bearer', 'Bearer a', 'Bearer a b c', `Bearer ${'a'.repeat(5000)}`]) expect(bearerToken({ headers: { authorization: bad } })).toBeNull();
    for (const junk of ['', 'a', 'a.b', 'a.!!!.c', 'a.bnVsbA.c', `a.${Buffer.from('[1]').toString('base64url')}.c`]) expect(() => jwtClaims(junk)).not.toThrow();
    expect(jwtClaims('a.bnVsbA.c')).toBeNull();
    expect(jwtClaims(makeJwt({ aal: 'aal2' })).aal).toBe('aal2');
    const code = strip(read('api/_lib/auth.js'));
    expect(code.indexOf('auth.user(token)')).toBeLessThan(code.indexOf("jwtClaims(token)?.aal"));
  });
});

describe('C14 messages', () => {
  it('GET returns the board fields only: ip_hash and user_agent are never selected, never returned; statuses map to the four columns', async () => {
    const up = upstream();
    const { aal2 } = sessions(up);
    const r = await call('messages', { method: 'GET', headers: auth(aal2) }, up);
    expect(r.res.statusCode).toBe(200);
    const { messages } = r.res.json();
    expect(messages).toHaveLength(3);
    for (const m of messages) expect(Object.keys(m).sort()).toEqual(['createdAt', 'email', 'emailFailed', 'id', 'message', 'name', 'status', 'subject']);
    expect(r.res.body).not.toMatch(/ip_hash|user_agent|secret-agent|aaaaaaaaaaaa/);
    expect(up.state.selects[0]).not.toMatch(/ip_hash|user_agent|\*/);
    expect(up.state.selects[0]).toMatch(/limit=200/);
    expect(messages.map((m) => [m.name, m.status, m.emailFailed])).toEqual([['Ada Lovelace', 'new', false], ['Bob', 'new', true], ['Cy', 'reading', false]]);
    expect(r.res.headers['cache-control']).toBe('no-store');
  });

  it('PATCH accepts exactly { id, status } with a status of new | reading | replied | archived; every other key or value is 400', async () => {
    const up = upstream();
    const { aal2 } = sessions(up);
    for (const body of [{ id: MSG_ID, status: 'spam' }, { id: MSG_ID, status: 'email_failed' }, { id: MSG_ID, status: 'read' }, { id: MSG_ID, status: 'hacked' }, { id: MSG_ID, status: '' }, { id: MSG_ID }, { status: 'new' }, { id: 'not-a-uuid', status: 'new' }, { id: `${MSG_ID}&status=eq.new`, status: 'new' }, { id: MSG_ID, status: 'new', ip_hash: 'x' }, { id: MSG_ID, status: 'new', message: 'rewritten' }, { id: MSG_ID, status: 'new', name: 'x' }, { id: MSG_ID, status: ['new'] }, []]) {
      const r = await call('messages', { method: 'PATCH', body, headers: auth(aal2) }, up);
      expect(r.res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(up.state.patches).toEqual([]);
    for (const status of ['new', 'reading', 'replied', 'archived']) {
      const r = await call('messages', { method: 'PATCH', body: { id: MSG_ID, status }, headers: auth(aal2) }, up);
      expect(r.res.statusCode).toBe(200);
      expect(r.res.json()).toEqual({ ok: true, id: MSG_ID, status });
    }
    expect(up.state.patches).toHaveLength(4);
    for (const [path, body] of up.state.patches) {
      expect(path).toBe(`/contact_messages?id=eq.${MSG_ID}`);
      expect(Object.keys(body)).toEqual(['status']);
    }
  });

  it('an unknown message id is 404 and nothing is written', async () => {
    const up = upstream();
    const { aal2 } = sessions(up);
    const r = await call('messages', { method: 'PATCH', body: { id: '99999999-9999-4999-8999-999999999999', status: 'new' }, headers: auth(aal2) }, up);
    expect(r.res.statusCode).toBe(404);
    expect(up.state.patches).toEqual([]);
  });
});

describe('C14 project order', () => {
  it('GET returns every real project with its title: the saved order first, never-saved projects after, unknown saved slugs dropped', async () => {
    const up = upstream();
    const { aal2 } = sessions(up);
    const fresh = (await call('projects-order', { method: 'GET', headers: auth(aal2) }, up)).res.json();
    expect(fresh).toMatchObject({ ok: true, saved: false });
    expect(fresh.projects.map((p) => p.slug)).toEqual(PROJECT_SLUGS);
    expect(fresh.projects[0].title).toBe(PROJECTS[0].title);
    up.state.saved = [PROJECT_SLUGS[2], 'ghost-project', PROJECT_SLUGS[0]];
    const saved = (await call('projects-order', { method: 'GET', headers: auth(aal2) }, up)).res.json();
    expect(saved.saved).toBe(true);
    expect(saved.projects.map((p) => p.slug).slice(0, 2)).toEqual([PROJECT_SLUGS[2], PROJECT_SLUGS[0]]);
    expect(saved.projects).toHaveLength(PROJECT_SLUGS.length);
    expect(saved.projects.map((p) => p.slug)).not.toContain('ghost-project');
  });

  it('POST saves a valid order through the atomic SQL function, with exactly the given slugs', async () => {
    const up = upstream();
    const { aal2 } = sessions(up);
    const order = [...PROJECT_SLUGS].reverse();
    const r = await call('projects-order', { method: 'POST', body: { order }, headers: auth(aal2) }, up);
    expect(r.res.statusCode).toBe(200);
    expect(up.state.rpc.at(-1)).toEqual(['project_order_save', { p_slugs: order }]);
    expect(r.res.json().projects.map((p) => p.slug)).toEqual(order);
    const subset = await call('projects-order', { method: 'POST', body: { order: PROJECT_SLUGS.slice(0, 2) }, headers: auth(aal2) }, up);
    expect(subset.res.statusCode).toBe(200);
  });

  it('POST refuses unknown slugs, duplicates, an empty list, too many, odd characters, other keys and non-arrays; nothing is saved', async () => {
    const up = upstream();
    const { aal2 } = sessions(up);
    const [a, b] = PROJECT_SLUGS;
    const bad = [{ order: [a, 'not-a-project'] }, { order: [a, a] }, { order: [a, b, a] }, { order: [] }, { order: [...PROJECT_SLUGS, 'extra'] }, { order: ['../../etc/passwd'] }, { order: ["x'; drop table project_order;--"] }, { order: ['UPPER'] }, { order: [a], extra: true }, { order: a }, { order: [1, 2] }, { order: [null] }, { slugs: [a] }, {}, []];
    for (const body of bad) {
      const r = await call('projects-order', { method: 'POST', body, headers: auth(aal2) }, up);
      expect(r.res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(up.state.rpc.filter(([n]) => n === 'project_order_save')).toEqual([]);
  });

  it('GET /api/project-order is public: slugs only, known slugs only, cacheable for seconds, generic errors, GET only', async () => {
    const up = upstream();
    up.state.saved = [PROJECT_SLUGS[1], 'ghost', PROJECT_SLUGS[0]];
    const handler = createProjectOrderHandler({ env: ENV, fetch: up.fetch, log: () => {} });
    const res = response();
    await handler({ method: 'GET', headers: {}, url: '/api/project-order' }, res);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['ok', 'order']);
    expect(body.order.slice(0, 2)).toEqual([PROJECT_SLUGS[1], PROJECT_SLUGS[0]]);
    expect(body.order).not.toContain('ghost');
    expect(res.headers['cache-control']).toMatch(/s-maxage=15/);
    expect(res.body).not.toMatch(/user|token|key|admin/i);
    const empty = response();
    await handler({ method: 'GET', headers: {} }, empty);
    expect(empty.statusCode).toBe(200);
    const none = upstream();
    const r2 = response();
    await createProjectOrderHandler({ env: ENV, fetch: none.fetch, log: () => {} })({ method: 'GET', headers: {} }, r2);
    expect(r2.json()).toEqual({ ok: true, order: [] }); // nothing saved: the page keeps the built-in order
    const post = response();
    await handler({ method: 'POST', headers: {} }, post);
    expect(post.statusCode).toBe(405);
    const down = response();
    await createProjectOrderHandler({ env: ENV, fetch: upstream({ dbDown: true }).fetch, log: () => {} })({ method: 'GET', headers: {} }, down);
    expect(down.statusCode).toBe(500);
    expect(down.json()).toEqual({ ok: false, error: 'server_error' });
    const unconfigured = response();
    await createProjectOrderHandler({ env: { ...ENV, SUPABASE_URL: '' }, fetch: up.fetch, log: () => {} })({ method: 'GET', headers: {} }, unconfigured);
    expect(unconfigured.statusCode).toBe(503);
  });
});

describe('C14 cron keep-alive', () => {
  const run = async (headers, env = ENV, method = 'GET', fetch = upstream().fetch) => {
    const res = response();
    await createKeepaliveHandler({ env, fetch, log: () => {} })({ method, headers, url: '/api/cron/keepalive' }, res);
    return res;
  };
  it('without the secret, with a wrong one, with a near miss, the wrong scheme or the wrong method → 401 and nothing is read', async () => {
    const up = upstream();
    for (const [headers, method] of [[{}, 'GET'], [{ authorization: 'Bearer wrong' }, 'GET'], [{ authorization: `Bearer ${ENV.CRON_SECRET}x` }, 'GET'], [{ authorization: `Bearer ${ENV.CRON_SECRET.slice(0, -1)}` }, 'GET'], [{ authorization: ENV.CRON_SECRET }, 'GET'], [{ authorization: `Basic ${ENV.CRON_SECRET}` }, 'GET'], [{ authorization: `Bearer ${ENV.CRON_SECRET}` }, 'POST'], [{ 'x-cron-secret': ENV.CRON_SECRET }, 'GET']]) {
      const res = await run(headers, ENV, method, up.fetch);
      expect(res.statusCode, `${method} ${JSON.stringify(headers)}`).toBe(401);
      expect(res.json()).toEqual({ ok: false, error: 'unauthorized' });
    }
    expect(up.fetch).not.toHaveBeenCalled();
  });
  it('an unset or short CRON_SECRET refuses everything, even an empty or guessed bearer', async () => {
    for (const secret of [undefined, '', '   ', 'short', 'x'.repeat(31)]) {
      for (const authorization of ['Bearer ', `Bearer ${secret}`, 'Bearer undefined', 'Bearer null']) expect((await run({ authorization }, { ...ENV, CRON_SECRET: secret })).statusCode).toBe(401);
    }
  });
  it('the right secret → 200 { ok: true } and nothing else, after exactly one trivial read; a read failure is a generic 500', async () => {
    const up = upstream();
    const res = await run({ authorization: `Bearer ${ENV.CRON_SECRET}` }, ENV, 'GET', up.fetch);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('{"ok":true}');
    expect(up.state.calls).toEqual(['GET /rest/v1/documents?select=id&limit=1']);
    const failed = await run({ authorization: `Bearer ${ENV.CRON_SECRET}` }, ENV, 'GET', upstream({ dbDown: true }).fetch);
    expect(failed.statusCode).toBe(500);
    expect(failed.json()).toEqual({ ok: false, error: 'server_error' });
  });
  it('the secret is compared in constant time (hash both sides, timingSafeEqual) and the cron is scheduled daily', () => {
    expect(strip(read('api/cron/keepalive.js'))).toMatch(/safeEqual\(given, secret\)/);
    expect(strip(read('api/_lib/security.js'))).toMatch(/export const safeEqual = [^;]*timingSafeEqual\(createHash\('sha256'\)/s);
    const cfg = JSON.parse(read('vercel.json'));
    expect(cfg.crons).toEqual([{ path: '/api/cron/keepalive', schedule: '17 5 * * *' }]);
    expect(cfg.functions['api/cron/keepalive.js']).toBeTruthy();
  });
});

describe('C14 headers, configuration and migration', () => {
  const cfg = JSON.parse(read('vercel.json'));
  const all = Object.fromEntries(cfg.headers.find((h) => h.source === '/(.*)').headers.map((h) => [h.key, h.value]));
  it('the CSP is unchanged (the admin talks only to same-origin /api; one third-party origin: Turnstile)', () => {
    expect(all['Content-Security-Policy']).toBe("default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' blob: https://challenges.cloudflare.com; media-src 'self' blob:; worker-src 'self' blob:; frame-src https://challenges.cloudflare.com; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    expect(all['Permissions-Policy']).toBe('camera=(), geolocation=(), microphone=(self), payment=(), usb=()');
    expect(all['Content-Security-Policy']).not.toMatch(/supabase/);
  });
  it('/api/admin/* is never cached or indexed; /admin is noindex and disallowed in robots.txt', () => {
    const rule = cfg.headers.find((h) => h.source === '/api/admin/(.*)');
    expect(Object.fromEntries(rule.headers.map((h) => [h.key, h.value]))).toEqual({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    expect(cfg.headers.find((h) => h.source === '/admin(.*)').headers).toEqual([{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }]);
    expect(read('public/robots.txt')).toMatch(/Disallow: \/admin\n/);
    expect(read('admin/index.html')).toMatch(/<meta name="robots" content="noindex, nofollow" \/>/);
  });
  it('the project stays far under the 12-function limit of the free plan (the admin API is ONE catch-all function)', () => {
    const fns = [];
    const walk = (dir) => {
      for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (e.name !== '_lib') walk(`${dir}/${e.name}`);
        } else if (e.name.endsWith('.js')) fns.push(`${dir}/${e.name}`);
      }
    };
    walk('api');
    expect(fns.sort()).toEqual(['api/admin/[...path].js', 'api/chat-token.js', 'api/chat.js', 'api/collect.js', 'api/contact-token.js', 'api/contact.js', 'api/cron/keepalive.js', 'api/project-order.js', 'api/transcribe.js']);
    expect(fns.length).toBeLessThanOrEqual(12);
    for (const f of ['api/admin/[...path].js', 'api/cron/keepalive.js', 'api/project-order.js']) expect(cfg.functions[f], f).toBeTruthy();
    for (const f of ['api/admin/[...path].js', 'api/cron/keepalive.js', 'api/project-order.js']) expect(read(f)).toMatch(/export default safe\(/);
  });
  it('0005_admin.sql: RLS enabled and forced, no policies, no public privileges, service role only; limits 5 and 10; atomic order save; the status CHECK keeps every old value', () => {
    const sql = read('supabase/migrations/0005_admin.sql').replace(/--.*$/gm, '');
    for (const t of ['admins', 'project_order', 'admin_login_hits']) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${t} enable row level security`));
      expect(sql).toMatch(new RegExp(`alter table public\\.${t} force row level security`));
      expect(sql).toMatch(new RegExp(`revoke all on table public\\.${t} from public, anon, authenticated`));
    }
    expect(sql).not.toMatch(/create policy|security definer|\bto\s+(public|anon|authenticated)\b/i);
    expect(sql).toMatch(/revoke all on function public\.admin_login_submit\(text, text\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.admin_login_submit\(text, text\) to service_role/);
    expect(sql).toMatch(/revoke all on function public\.project_order_save\(text\[\]\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.project_order_save\(text\[\]\) to service_role/);
    expect(sql).toMatch(/case when p_kind = 'mfa' then 10 else 5 end/);
    expect(sql).toMatch(/interval '10 minutes'/);
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect([...sql.matchAll(/set search_path = ''/g)]).toHaveLength(2);
    expect(sql).toMatch(/s !~ '\^\[a-z0-9-\]\{1,80\}\$'/);
    const check = /status in \(([^)]*)\)/.exec(sql)[1];
    for (const old of ['new', 'email_failed', 'read', 'replied', 'spam']) expect(check).toContain(`'${old}'`); // existing rows stay valid
    for (const added of ['reading', 'archived']) expect(check).toContain(`'${added}'`);
    expect(sql).toMatch(/admins \(\s*user_id uuid primary key references auth\.users/);
  });
  it('the saved-order slugs list in src/shared/project-slugs.js matches /content (run `node scripts/content/slugs.mjs` after adding a project)', () => {
    expect(PROJECTS).toEqual(publicProjects());
  });
});

describe('C14 admin page and bundle', () => {
  let outputs;
  let adminHtml;
  beforeAll(async () => {
    ({ outputs, adminHtml } = await buildSite());
  }, 180_000);

  it('src/admin: text nodes only (no HTML sinks, eval), tokens in memory only (no storage, no cookie), talks only to /api/admin and never to Supabase', () => {
    const code = strip(read('src/admin/main.js'));
    expect(code).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function|javascript:/);
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|caches\./);
    expect(code).not.toMatch(/supabase|apikey|\/auth\/v1|\/rest\/v1/i);
    const urls = [...code.matchAll(/fetch\(\s*([^,)]+)/g)].map((m) => m[1].trim());
    expect(urls.length).toBeGreaterThan(1);
    for (const u of urls) expect(u).toMatch(/^`\/api\/admin\/\$\{path\}`$|^'\/api\/admin\/logout'$/);
    expect(code).toMatch(/const IDLE_MS = 15 \* 60 \* 1000/);
    expect(code).toMatch(/credentials: 'omit'/);
    expect(code).toMatch(/draggable/);
    expect(code).toMatch(/Move \$\{item\.title\} up/); // keyboard buttons next to drag and drop
    expect(code).toMatch(/Move \$\{item\.title\} down/);
  });
  it('the admin page: no inline script or handler, noindex, the module script and the admin stylesheet', () => {
    expect(adminHtml).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>\s*\S/);
    expect(adminHtml).not.toMatch(/\son[a-z]+="/i);
    expect(adminHtml).toMatch(/<meta name="robots" content="noindex, nofollow"/);
    expect(adminHtml).toMatch(/<script type="module"[^>]*src="\/assets\/admin-[^"]+\.js"/);
    expect(adminHtml).toMatch(/data-admin-root/);
  });
  it('the built bundle holds no CRON_SECRET (name or value), no service key name, no token and no Supabase URL', () => {
    const text = outputs.map((o) => String(o.code ?? o.source ?? '')).join('\n');
    for (const n of ['CRON_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'service_role', 'cron-secret-test', ENV.CRON_SECRET, 'IP_HASH_SALT', 'admin_login_submit', 'project_order_save']) expect(text.includes(n), n).toBe(false);
    expect(text).not.toMatch(/supabase\.co/);
    const adminJs = outputs.find((o) => /^assets\/admin-.*\.js$/.test(o.fileName));
    expect(adminJs).toBeTruthy();
    expect(adminJs.code).not.toMatch(/localStorage|sessionStorage/);
  });
  it('Classic: the gallery asks for the saved order and keeps the built-in one when that fails; the public endpoint is the only read', () => {
    const g = strip(read('src/ui/projects/gallery.js'));
    expect(g).toMatch(/fetch\('\/api\/project-order', \{ credentials: 'omit'/);
    expect(g).toMatch(/\.catch\(\(\) => \{\}\)/);
    expect(g).toMatch(/applyRanks\(projects, data\.order\) > 0/);
    expect(g).not.toMatch(/admin/i);
  });
});
