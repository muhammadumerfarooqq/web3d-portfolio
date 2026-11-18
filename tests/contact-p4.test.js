// P4 contact system: the /api/contact and /api/contact-token handlers with mocked fetch (Turnstile
// siteverify + Supabase REST) and a mocked nodemailer transport. No network, no real secrets.
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createContactHandler } from '../api/contact.js';
import { createTokenHandler } from '../api/contact-token.js';
import { checkStamp, hashIp, issueStamp, MAX_STAMP_AGE_MS } from '../api/_lib/security.js';
import { isAllowedOrigin } from '../api/_lib/http.js';
import { SUBJECTS } from '../src/shared/contact-schema.js';

const NOW = 1_800_000_000_000;
const SALT = 'test-salt-0123456789abcdefghijklmnopqrstuvwxyz'; // ≥ 32 chars
const IP = '203.0.113.7';
const ENV = {
  SUPABASE_URL: 'https://proj.supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
  TURNSTILE_SECRET_KEY: 'turnstile-test-secret',
  SMTP_USER: 'sender@example.test',
  SMTP_APP_PASSWORD: 'app-password-test',
  CONTACT_TO: 'inbox@example.test',
  IP_HASH_SALT: SALT,
};
const LS = String.fromCharCode(0x2028);
const goodStamp = (age = 5000) => issueStamp(NOW - age, hashIp(IP, SALT), SALT);
const valid = { name: 'Ann Visitor', email: 'ann@example.org', subject: 'General', message: 'Hello Umer, I would like to talk about a role.' };

function request({ method = 'POST', body = { ...valid, website: '', stamp: goodStamp(), token: 'tok-ok' }, headers = {}, raw } = {}) {
  const payload = raw ?? (typeof body === 'string' ? body : JSON.stringify(body));
  const req = Readable.from(method === 'GET' ? [] : [Buffer.from(payload)]);
  req.method = method;
  req.headers = { origin: 'https://umerfarooq-ai.vercel.app', 'content-type': 'application/json', 'x-real-ip': IP, 'user-agent': 'Mozilla/5.0 test', ...headers };
  for (const [k, v] of Object.entries(req.headers)) if (v === undefined) delete req.headers[k];
  return req;
}

function response() {
  const res = { statusCode: 0, headers: {}, body: '' };
  res.setHeader = (k, v) => {
    res.headers[k.toLowerCase()] = String(v);
  };
  res.end = (b = '') => {
    res.body = String(b);
    res.done = true;
  };
  res.json = () => JSON.parse(res.body);
  return res;
}

/** Mocked services. turnstile: siteverify JSON; rpc: contact_submit result; failures by flag. */
function services({ turnstile = { success: true, hostname: 'umerfarooq-ai.vercel.app', action: 'contact' }, rpc = { allowed: true, id: '11111111-2222-3333-4444-555555555555' }, rpcStatus = 200, verifyThrows = false, mailFails = false } = {}) {
  const calls = { verify: [], rpc: [], patch: [], mail: [], transport: [] };
  const fetch = vi.fn(async (url, init = {}) => {
    const u = String(url);
    if (u === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
      if (verifyThrows) throw new Error('network down');
      calls.verify.push(Object.fromEntries(new URLSearchParams(String(init.body))));
      return new Response(JSON.stringify(turnstile), { status: 200 });
    }
    if (u === `${ENV.SUPABASE_URL}/rest/v1/rpc/contact_submit`) {
      calls.rpc.push({ body: JSON.parse(init.body), headers: init.headers });
      return new Response(JSON.stringify(rpc), { status: rpcStatus });
    }
    if (u.startsWith(`${ENV.SUPABASE_URL}/rest/v1/contact_messages?`)) {
      calls.patch.push({ url: u, body: JSON.parse(init.body), method: init.method });
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected fetch ${u}`);
  });
  const createTransport = vi.fn((options) => {
    calls.transport.push(options);
    return {
      sendMail: vi.fn(async (msg) => {
        calls.mail.push(msg);
        if (mailFails) throw new Error('smtp down');
        return { messageId: 'x' };
      }),
    };
  });
  const logs = [];
  const log = (event, fields) => logs.push(JSON.stringify({ event, ...fields }));
  return { fetch, createTransport, calls, logs, log };
}

async function run(reqOptions, serviceOptions, env = ENV) {
  const s = services(serviceOptions);
  const handler = createContactHandler({ env, fetch: s.fetch, createTransport: s.createTransport, now: () => NOW, log: s.log });
  const res = response();
  await handler(request(reqOptions), res);
  return { res, ...s };
}

const nothingSent = ({ calls }) => {
  expect(calls.rpc).toHaveLength(0);
  expect(calls.mail).toHaveLength(0);
};

describe('POST /api/contact: happy path', () => {
  it('validates, verifies Turnstile, stores through contact_submit and emails Umer (plain text, reply-to visitor)', async () => {
    const r = await run();
    expect(r.res.statusCode).toBe(200);
    expect(r.res.json()).toEqual({ ok: true });
    // Turnstile: secret, token and the visitor IP
    expect(r.calls.verify).toEqual([{ secret: ENV.TURNSTILE_SECRET_KEY, response: 'tok-ok', remoteip: IP }]);
    // Supabase: service role, hashed IP only (never the raw IP), trimmed fields, truncated UA
    const { body, headers } = r.calls.rpc[0];
    expect(headers.apikey).toBe(ENV.SUPABASE_SERVICE_ROLE_KEY);
    expect(headers.Authorization).toBe(`Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`);
    expect(body.p_ip_hash).toBe(hashIp(IP, SALT));
    expect(body.p_ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(body)).not.toContain(IP);
    expect(body).toMatchObject({ p_name: valid.name, p_email: valid.email, p_subject: valid.subject, p_message: valid.message, p_user_agent: 'Mozilla/5.0 test' });
    // Gmail SMTP over TLS on 465
    expect(r.calls.transport[0]).toMatchObject({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: ENV.SMTP_USER, pass: ENV.SMTP_APP_PASSWORD } });
    const mail = r.calls.mail[0];
    expect(mail.to).toBe(ENV.CONTACT_TO);
    expect(mail.from.address).toBe(ENV.SMTP_USER);
    expect(mail.replyTo).toEqual({ name: valid.name, address: valid.email });
    expect(mail.subject).toBe('[Portfolio] General from Ann Visitor');
    expect(mail.text).toContain(valid.message);
    expect(mail.html).toBeUndefined();
    expect(r.calls.patch).toHaveLength(0);
  });

  it('trims fields before storing and sending', async () => {
    const r = await run({ body: { name: '  Ann  ', email: ' ann@example.org ', subject: 'Other', message: `   ${valid.message}   `, stamp: goodStamp(), token: 'tok-ok' } });
    expect(r.res.statusCode).toBe(200);
    expect(r.calls.rpc[0].body).toMatchObject({ p_name: 'Ann', p_email: 'ann@example.org', p_message: valid.message });
  });

  it('accepts every allow-listed subject', async () => {
    for (const subject of SUBJECTS) expect((await run({ body: { ...valid, subject, stamp: goodStamp(), token: 'tok-ok' } })).res.statusCode, subject).toBe(200);
  });

  it('logs carry no PII and no secrets, and responses carry no CORS headers', async () => {
    const r = await run();
    const logs = r.logs.join('\n');
    for (const secret of [valid.name, valid.email, valid.message, IP, hashIp(IP, SALT), 'tok-ok', ...Object.values(ENV)]) expect(logs.includes(secret)).toBe(false);
    expect(Object.keys(r.res.headers).some((h) => h.startsWith('access-control-'))).toBe(false);
    expect(r.res.headers['cache-control']).toBe('no-store');
  });
});

describe('POST /api/contact: request checks (405 / 403 / 415 / 413 / 503)', () => {
  it('405 for anything but POST, with Allow: POST', async () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
      const r = await run({ method });
      expect(r.res.statusCode, method).toBe(405);
      expect(r.res.headers.allow).toBe('POST');
      nothingSent(r);
    }
  });

  it('403 without Origin/Referer, or from a foreign origin', async () => {
    for (const headers of [{ origin: undefined }, { origin: 'https://evil.example' }, { origin: 'https://umerfarooq-ai.vercel.app.evil.example' }, { origin: 'null' }, { origin: undefined, referer: 'https://evil.example/x' }, { origin: 'http://umerfarooq-ai.vercel.app' }, { origin: 'https://web3d-portfolio-abc-someone-else.vercel.app' }]) {
      const r = await run({ headers });
      expect(r.res.statusCode, JSON.stringify(headers)).toBe(403);
      nothingSent(r);
    }
  });

  it('allows production, the alias, this project’s previews and localhost; falls back to the Referer', async () => {
    for (const origin of ['https://umerfarooq-ai.vercel.app', 'https://web3d-portfolio-three.vercel.app', 'https://web3d-portfolio-git-main-umer-134e.vercel.app', 'https://web3d-portfolio-k3j2h1-umer-134e.vercel.app', 'http://localhost:5173', 'http://127.0.0.1:4173']) {
      expect(isAllowedOrigin(origin), origin).toBe(true);
    }
    const r = await run({ headers: { origin: undefined, referer: 'https://umerfarooq-ai.vercel.app/#contact' } });
    expect(r.res.statusCode).toBe(200);
  });

  it('415 unless the body is JSON', async () => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', undefined, 'application/jsonp']) {
      const r = await run({ headers: { 'content-type': type } });
      expect(r.res.statusCode, String(type)).toBe(415);
      nothingSent(r);
    }
    expect((await run({ headers: { 'content-type': 'application/json; charset=utf-8' } })).res.statusCode).toBe(200);
  });

  it('413 over 8 KB, by Content-Length or by the bytes actually streamed', async () => {
    const big = JSON.stringify({ ...valid, message: 'x'.repeat(9000) });
    let r = await run({ raw: big, headers: { 'content-length': String(Buffer.byteLength(big)) } });
    expect(r.res.statusCode).toBe(413);
    r = await run({ raw: big });
    expect(r.res.statusCode).toBe(413);
    nothingSent(r);
  });

  it('503 "not configured" when any env var is missing (or the salt is too short); nothing is called', async () => {
    for (const name of Object.keys(ENV)) {
      const env = { ...ENV, [name]: '' };
      const r = await run({}, {}, env);
      expect(r.res.statusCode, name).toBe(503);
      expect(r.res.json()).toEqual({ ok: false, error: 'not_configured' });
      expect(r.fetch).not.toHaveBeenCalled();
      expect(r.logs.join('')).not.toContain(SALT);
    }
    expect((await run({}, {}, { ...ENV, IP_HASH_SALT: 'short' })).res.statusCode).toBe(503);
  });
});

describe('POST /api/contact: validation (400 with field errors only)', () => {
  const cases = {
    'name too short': [{ name: 'A' }, 'name'],
    'name too long': [{ name: 'A'.repeat(81) }, 'name'],
    'name missing': [{ name: undefined }, 'name'],
    'email invalid': [{ email: 'not-an-email' }, 'email'],
    'email too long': [{ email: `${'a'.repeat(115)}@x.org` }, 'email'],
    'subject not allow-listed': [{ subject: 'Spam offer' }, 'subject'],
    'message too short': [{ message: 'too short' }, 'message'],
    'message too long': [{ message: 'x'.repeat(4001) }, 'message'],
    'more than 3 links': [{ message: 'see https://a.example https://b.example www.c.example http://d.example now' }, 'message'],
    'control character in message': [{ message: `Hello Umer ${String.fromCharCode(7)} this is a bell character` }, 'message'],
    'control character in name': [{ name: `Ann${String.fromCharCode(0)}x` }, 'name'],
  };
  it.each(Object.entries(cases))('%s', async (_, [patch, field]) => {
    const r = await run({ body: { ...valid, ...patch, stamp: goodStamp(), token: 'tok-ok' } });
    expect(r.res.statusCode).toBe(400);
    const body = r.res.json();
    expect(body.error).toBe('invalid');
    expect(Object.keys(body.fields)).toContain(field);
    expect(r.calls.verify).toHaveLength(0); // validation runs before Turnstile
    nothingSent(r);
  });

  it('3 links are fine; an email address in the message is not a link', async () => {
    const r = await run({ body: { ...valid, message: 'My work: https://a.example https://b.example www.c.example, mail me at ann@gmail.com', stamp: goodStamp(), token: 'tok-ok' } });
    expect(r.res.statusCode).toBe(200);
  });

  it('header injection: CR, LF or a Unicode line break in name or email is refused before any email exists', async () => {
    for (const patch of [{ name: 'Ann\r\nBcc: victim@example.org' }, { name: 'Ann\nX-Injected: 1' }, { name: `Ann${LS}Bcc: x@y.z` }, { email: 'ann@example.org\r\nBcc: victim@example.org' }, { email: 'ann@example.org\n' + 'bcc@example.org' }]) {
      const r = await run({ body: { ...valid, ...patch, stamp: goodStamp(), token: 'tok-ok' } });
      expect(r.res.statusCode, JSON.stringify(patch)).toBe(400);
      nothingSent(r);
    }
  });

  it('line breaks inside the message body are fine (plain text)', async () => {
    const r = await run({ body: { ...valid, message: 'Hello Umer,\r\n\r\nLine two of my message.\n\tThanks!', stamp: goodStamp(), token: 'tok-ok' } });
    expect(r.res.statusCode).toBe(200);
    expect(r.calls.mail[0].text).toContain('Line two of my message.');
  });

  it('400 for invalid JSON, a non-object, or unknown keys (generic, no field errors)', async () => {
    for (const raw of ['{not json', '[]', '"text"', JSON.stringify({ ...valid, stamp: goodStamp(), token: 't', admin: true })]) {
      const r = await run({ raw });
      expect(r.res.statusCode, raw).toBe(400);
      expect(r.res.json().fields).toBeUndefined();
      nothingSent(r);
    }
  });
});

describe('POST /api/contact: spam layers', () => {
  it('honeypot: answers 200 to the bot but stores and sends nothing', async () => {
    const r = await run({ body: { ...valid, website: 'https://spam.example', stamp: goodStamp(), token: 'tok-ok' } });
    expect(r.res.statusCode).toBe(200);
    expect(r.fetch).not.toHaveBeenCalled();
    nothingSent(r);
  });

  it('too-fast submit (< 3 s after the form rendered) → 400 too_fast', async () => {
    const r = await run({ body: { ...valid, stamp: goodStamp(1200), token: 'tok-ok' } });
    expect(r.res.statusCode).toBe(400);
    expect(r.res.json().error).toBe('too_fast');
    expect(r.calls.verify).toHaveLength(0);
    nothingSent(r);
  });

  it('missing, forged, expired or other-IP stamps → 400 stale_form', async () => {
    const otherIp = issueStamp(NOW - 5000, hashIp('198.51.100.9', SALT), SALT);
    const forged = `${NOW - 5000}.${'A'.repeat(43)}`;
    const otherKey = issueStamp(NOW - 5000, hashIp(IP, SALT), 'another-salt-0123456789abcdefghijklmnop');
    for (const stamp of ['', 'garbage', forged, otherIp, otherKey, goodStamp(MAX_STAMP_AGE_MS + 1000)]) {
      const r = await run({ body: { ...valid, stamp, token: 'tok-ok' } });
      expect(r.res.statusCode, stamp).toBe(400);
      expect(r.res.json().error).toBe('stale_form');
      nothingSent(r);
    }
  });

  it('bad Turnstile token: rejected, wrong hostname, wrong action or missing → 400 verification_failed', async () => {
    for (const turnstile of [{ success: false, 'error-codes': ['invalid-input-response'] }, { success: true, hostname: 'evil.example', action: 'contact' }, { success: true, hostname: 'umerfarooq-ai.vercel.app', action: 'login' }]) {
      const r = await run({}, { turnstile });
      expect(r.res.statusCode).toBe(400);
      expect(r.res.json().error).toBe('verification_failed');
      nothingSent(r);
    }
    const r = await run({ body: { ...valid, stamp: goodStamp(), token: '' } });
    expect(r.res.json().error).toBe('verification_failed');
    expect(r.calls.verify).toHaveLength(0);
  });

  it('Turnstile unreachable → 500 generic', async () => {
    const r = await run({}, { verifyThrows: true });
    expect(r.res.statusCode).toBe(500);
    expect(r.res.json()).toEqual({ ok: false, error: 'server_error' });
    nothingSent(r);
  });

  it('rate limited (contact_submit says no) → 429 with Retry-After, nothing emailed', async () => {
    const r = await run({}, { rpc: { allowed: false, retry_after: 1234 } });
    expect(r.res.statusCode).toBe(429);
    expect(r.res.headers['retry-after']).toBe('1234');
    expect(r.res.json()).toEqual({ ok: false, error: 'rate_limited', retryAfter: 1234 });
    expect(r.calls.mail).toHaveLength(0);
  });
});

describe('POST /api/contact: failures after validation', () => {
  it('email failure after storing still answers 200 and marks the row email_failed', async () => {
    const r = await run({}, { mailFails: true });
    expect(r.res.statusCode).toBe(200);
    expect(r.res.json()).toEqual({ ok: true });
    expect(r.calls.patch).toEqual([{ url: `${ENV.SUPABASE_URL}/rest/v1/contact_messages?id=eq.11111111-2222-3333-4444-555555555555`, body: { status: 'email_failed' }, method: 'PATCH' }]);
    expect(r.logs.join('\n')).toContain('email_failed');
  });

  it('database failure → 500 generic, no email', async () => {
    const r = await run({}, { rpcStatus: 500, rpc: { message: 'relation does not exist' } });
    expect(r.res.statusCode).toBe(500);
    expect(r.res.body).not.toContain('relation');
    expect(r.calls.mail).toHaveLength(0);
  });
});

describe('GET /api/contact-token', () => {
  const tokenRun = (req, env = ENV) => {
    const res = response();
    createTokenHandler({ env, now: () => NOW })(req, res);
    return res;
  };
  it('issues a stamp bound to the visitor IP that the contact handler accepts after 3 s', () => {
    const res = tokenRun(request({ method: 'GET', headers: { origin: undefined, referer: 'https://umerfarooq-ai.vercel.app/' } }));
    expect(res.statusCode).toBe(200);
    const { stamp } = res.json();
    expect(checkStamp(stamp, NOW + 3500, hashIp(IP, SALT), SALT)).toEqual({ ok: true });
    expect(checkStamp(stamp, NOW + 500, hashIp(IP, SALT), SALT).reason).toBe('too_fast');
    expect(checkStamp(stamp, NOW + 3500, hashIp('198.51.100.9', SALT), SALT).reason).toBe('invalid');
  });
  it('405 / 403 / 503', () => {
    expect(tokenRun(request({ method: 'POST' })).statusCode).toBe(405);
    expect(tokenRun(request({ method: 'GET', headers: { origin: 'https://evil.example' } })).statusCode).toBe(403);
    expect(tokenRun(request({ method: 'GET' }), { ...ENV, IP_HASH_SALT: '' }).statusCode).toBe(503);
  });
});
