// C15 (P10): privacy-friendly analytics. POST /api/collect with a mocked Supabase: request checks, the event
// allow-list, "always 204", nothing personal read, stored or logged, the daily cap, the client beacon (Do Not
// Track / Global Privacy Control), no cookies, no new third-party origin; and the admin Stats route (token + admin +
// aal2, only event / day / count ever returned).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdminHandler } from '../../api/admin/[...path].js';
import { createCollectHandler } from '../../api/collect.js';
import { ANALYTICS_BODY_MAX, ANALYTICS_DAILY_CAP, ANALYTICS_EVENTS, STATS_DAYS } from '../../src/shared/analytics-events.js';
import { track, trackingAllowed } from '../../src/ui/analytics.js';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const strip = (code) => code.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const ORIGIN = 'https://umerfarooq-ai.vercel.app';
const S = 'https://proj.supabase.test';
const ENV = { SUPABASE_URL: S, SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key', VITE_SUPABASE_ANON_KEY: 'anon-test-key', TURNSTILE_SECRET_KEY: 't', IP_HASH_SALT: 'analytics-test-salt-0123456789abcdefghijklmnopqrstuvwxyz' };
const SECRET_HEADERS = { 'user-agent': 'Mozilla/5.0 (Secret Agent 7.0)', referer: 'https://umerfarooq-ai.vercel.app/#private-section', 'x-forwarded-for': '198.51.100.23', 'x-real-ip': '198.51.100.23', cookie: 'sid=abc123', 'accept-language': 'ur-PK' };

function request({ method = 'POST', body = '{"e":"chat_open"}', type = 'application/json', headers = {} } = {}) {
  const req = Readable.from(method === 'GET' ? [] : [Buffer.from(body)]);
  req.method = method;
  req.headers = { origin: ORIGIN, 'content-type': type, ...SECRET_HEADERS, ...headers };
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
  return res;
};
function upstream({ fail = false } = {}) {
  const calls = [];
  const fetch = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (fail) return new Response('{}', { status: 500 });
    return new Response('true', { status: 200 });
  });
  return { fetch, calls };
}
async function post(options = {}, { env = ENV, fail = false } = {}) {
  const up = upstream({ fail });
  const logs = [];
  const res = response();
  await createCollectHandler({ env, fetch: up.fetch, log: (e, f) => logs.push(JSON.stringify({ e, ...f })) })(request(options), res);
  return { res, up, logs };
}

describe('C15 /api/collect: request checks', () => {
  it('GET is 405 with Allow; a cross-origin, missing or "null" origin is 403 and nothing is counted', async () => {
    const get = await post({ method: 'GET' });
    expect(get.res.statusCode).toBe(405);
    expect(get.res.headers.allow).toBe('POST');
    for (const headers of [{ origin: 'https://evil.example' }, { origin: undefined, referer: undefined }, { origin: 'null', referer: undefined }]) {
      const r = await post({ headers });
      expect(r.res.statusCode).toBe(403);
      expect(r.up.fetch).not.toHaveBeenCalled();
      expect(r.res.headers['access-control-allow-origin']).toBeUndefined();
    }
  });
  it('only JSON (or the beacon\'s text/plain) is accepted: a form, multipart or no type is 415', async () => {
    for (const type of ['application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/xml', null]) {
      const r = await post(type === null ? { headers: { 'content-type': undefined } } : { type });
      expect(r.res.statusCode, String(type)).toBe(415);
      expect(r.up.fetch).not.toHaveBeenCalled();
    }
    for (const type of ['application/json', 'application/json; charset=utf-8', 'text/plain;charset=UTF-8']) expect((await post({ type })).res.statusCode, type).toBe(204);
  });
  it('a body over 200 bytes is 413, by Content-Length and while streaming', async () => {
    const big = JSON.stringify({ e: 'chat_open', pad: 'x'.repeat(ANALYTICS_BODY_MAX) });
    const declared = await post({ body: big, headers: { 'content-length': String(big.length) } });
    expect(declared.res.statusCode).toBe(413);
    expect((await post({ body: big })).res.statusCode).toBe(413);
    expect(declared.up.fetch).not.toHaveBeenCalled();
    expect((await post({ body: JSON.stringify({ e: 'chat_open' }) })).res.statusCode).toBe(204);
  });
});

describe('C15 events and "always 204"', () => {
  it.each(ANALYTICS_EVENTS)('%s is counted: one atomic bump with the event and the daily cap, nothing else', async (event) => {
    const r = await post({ body: JSON.stringify({ e: event }) });
    expect(r.res.statusCode).toBe(204);
    expect(r.res.body).toBe('');
    expect(r.up.calls).toHaveLength(1);
    expect(r.up.calls[0].url).toBe(`${S}/rest/v1/rpc/analytics_bump`);
    expect(JSON.parse(r.up.calls[0].init.body)).toEqual({ p_event: event, p_cap: ANALYTICS_DAILY_CAP });
  });
  it('anything else is IGNORED with the same bare 204: unknown names, extra keys, arrays, numbers, non-JSON, empty', async () => {
    const bodies = ['{"e":"not_an_event"}', '{"e":"chat_open","x":1}', '{"e":["chat_open"]}', '{"e":1}', '{"event":"chat_open"}', '[]', '"chat_open"', '123', 'null', '{not json', '', '{"e":"chat_open\\u0000"}', '{"e":"CHAT_OPEN"}', '{"e":" chat_open"}', '{"__proto__":{"e":"chat_open"}}', '{"e":"pageview_classic;drop table analytics_daily"}'];
    for (const body of bodies) {
      const r = await post({ body });
      expect(r.res.statusCode, body).toBe(204);
      expect(r.res.body).toBe('');
      expect(r.up.fetch, body).not.toHaveBeenCalled();
    }
  });
  it('a body that is not valid JSON is a bare 204 even when the runtime body parser throws (Vercel) - nothing counted, still 413 for oversized', async () => {
    const res = response();
    const up = upstream();
    const logs = [];
    const req = request({ body: 'not json at all' });
    Object.defineProperty(req, 'body', { get() { throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 }); } });
    await createCollectHandler({ env: ENV, fetch: up.fetch, log: (e, f) => logs.push(JSON.stringify({ e, ...f })) })(req, res);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(up.fetch).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('ignored');
    expect(logs.join('\n')).not.toContain('not json');
    const big = await post({ body: JSON.stringify({ e: 'chat_open', pad: 'x'.repeat(ANALYTICS_BODY_MAX) }) });
    expect(big.res.statusCode).toBe(413);
  });
  it('a database failure, a full daily cap or a missing configuration never changes the answer (204, no body)', async () => {
    expect((await post({}, { fail: true })).res.statusCode).toBe(204);
    expect((await post({}, { env: { ...ENV, SUPABASE_URL: '' } })).res.statusCode).toBe(204);
    const full = upstream();
    full.fetch.mockResolvedValue(new Response('false', { status: 200 })); // analytics_bump says "cap reached"
    const res = response();
    await createCollectHandler({ env: ENV, fetch: full.fetch, log: () => {} })(request(), res);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
  });
  it('the response sets no cookie and no cache entry; the only headers are Cache-Control (and none from the visitor)', async () => {
    const r = await post({});
    expect(Object.keys(r.res.headers)).toEqual(['cache-control']);
    expect(r.res.headers['cache-control']).toBe('no-store');
    expect(r.res.headers['set-cookie']).toBeUndefined();
  });
});

describe('C15 nothing personal is read, stored or logged', () => {
  it('the visitor\'s IP, user agent, referrer, cookie and language never reach Supabase (URL, headers or body) or the logs', async () => {
    const r = await post({});
    const sent = JSON.stringify(r.up.calls);
    for (const secret of ['198.51.100.23', 'Secret Agent', '#private-section', 'sid=abc123', 'ur-PK', ORIGIN]) expect(sent, secret).not.toContain(secret);
    const logs = r.logs.join('\n');
    for (const secret of ['198.51.100.23', 'Secret Agent', 'private-section', 'abc123', 'ur-PK', 'chat_open', ENV.SUPABASE_SERVICE_ROLE_KEY]) expect(logs, secret).not.toContain(secret);
    expect(Object.keys(r.up.calls[0].init.headers).map((k) => k.toLowerCase()).sort()).toEqual(['apikey', 'authorization', 'content-type']);
  });
  it('the handler source never reads the IP, user agent, referrer or cookies, and does not hash anything', () => {
    const code = strip(read('api/collect.js'));
    expect(code).not.toMatch(/clientIp|hashIp|user-agent|referer|cookie|x-forwarded|x-real-ip|accept-language|salt/i);
  });
  it('the table holds only (day, event, count): no ip, hash, agent, referrer, user or timestamp; RLS forced, service role only, event CHECK = the allow-list', () => {
    const sql = read('supabase/migrations/0006_analytics.sql').replace(/--.*$/gm, '');
    const columns = /create table if not exists public\.analytics_daily \(([\s\S]*?)\n\);/.exec(sql)[1];
    const names = [...columns.matchAll(/^\s{2}(\w+) /gm)].map((m) => m[1]).filter((n) => n !== 'primary');
    expect(names).toEqual(['day', 'event', 'count']);
    expect(columns).toMatch(/primary key \(day, event\)/);
    expect(sql).not.toMatch(/\b(ip|ip_hash|user_agent|referrer|referer|user_id|session|cookie|fingerprint|created_at|timestamptz)\b/i);
    const allowed = [.../event in \(([^)]*)\)/.exec(sql)[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
    expect(allowed).toEqual(ANALYTICS_EVENTS);
    expect(sql).toMatch(/alter table public\.analytics_daily enable row level security/);
    expect(sql).toMatch(/alter table public\.analytics_daily force row level security/);
    expect(sql).toMatch(/revoke all on table public\.analytics_daily from public, anon, authenticated/);
    expect(sql).toMatch(/grant select, insert, update on table public\.analytics_daily to service_role/);
    expect(sql).toMatch(/revoke all on function public\.analytics_bump\(text, int\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.analytics_bump\(text, int\) to service_role/);
    expect(sql).not.toMatch(/create policy|security definer|\bto\s+(public|anon|authenticated)\b/i);
    expect(sql).toMatch(/set search_path = ''/);
  });
  it('the daily cap is enforced inside the atomic upsert (update only while count < cap) and the table can hold at most one row per event per day', () => {
    const sql = read('supabase/migrations/0006_analytics.sql').replace(/--.*$/gm, '');
    expect(sql).toMatch(/on conflict \(day, event\) do update\s+set count = a\.count \+ 1\s+where a\.count < greatest\(p_cap, 0\)/);
    expect(sql).toMatch(/return v_count is not null/);
    expect(ANALYTICS_DAILY_CAP).toBe(5000);
    expect(ANALYTICS_EVENTS).toHaveLength(9);
  });
});

describe('C15 the browser beacon', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (nav = {}, extra = {}) => {
    const sendBeacon = vi.fn(() => true);
    const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('navigator', { sendBeacon, ...nav });
    vi.stubGlobal('window', { doNotTrack: undefined, ...extra });
    vi.stubGlobal('fetch', fetch);
    return { sendBeacon, fetch };
  };

  it('Do Not Track and Global Privacy Control switch it off: nothing is sent, not even a fallback fetch', () => {
    for (const nav of [{ doNotTrack: '1' }, { doNotTrack: 'yes' }, { globalPrivacyControl: true }, { doNotTrack: '1', globalPrivacyControl: true }]) {
      const s = stub(nav);
      expect(track('lang_ur'), JSON.stringify(nav)).toBe(false);
      expect(s.sendBeacon).not.toHaveBeenCalled();
      expect(s.fetch).not.toHaveBeenCalled();
    }
    const s = stub({}, { doNotTrack: '1' }); // the legacy window.doNotTrack
    expect(track('lang_ur')).toBe(false);
    expect(s.sendBeacon).not.toHaveBeenCalled();
    expect(trackingAllowed({ doNotTrack: '0' }, {})).toBe(true);
    expect(trackingAllowed({ doNotTrack: null }, {})).toBe(true);
    expect(trackingAllowed({ globalPrivacyControl: false }, {})).toBe(true);
  });
  it('otherwise one beacon to same-origin /api/collect with {"e":"<event>"} and nothing else (≤ 200 bytes, no credentials)', async () => {
    const s = stub();
    expect(track('voice_used')).toBe(true);
    expect(s.sendBeacon).toHaveBeenCalledTimes(1);
    const [url, blob] = s.sendBeacon.mock.calls[0];
    expect(url).toBe('/api/collect');
    expect(blob.type).toBe('application/json');
    const text = await blob.text();
    expect(JSON.parse(text)).toEqual({ e: 'voice_used' });
    expect(text.length).toBeLessThanOrEqual(ANALYTICS_BODY_MAX);
    expect(s.fetch).not.toHaveBeenCalled();
  });
  it('an event outside the allow-list is never sent; `once` sends an event once per page load; it never throws', () => {
    const s = stub();
    for (const bad of ['not_an_event', '', undefined, null, 42, '__proto__', 'pageview_classic ']) expect(track(bad)).toBe(false);
    expect(s.sendBeacon).not.toHaveBeenCalled();
    expect(track('chat_open', { once: true })).toBe(true);
    expect(track('chat_open', { once: true })).toBe(false);
    expect(s.sendBeacon).toHaveBeenCalledTimes(1);
    const boom = stub({ sendBeacon: () => { throw new Error('blocked'); } });
    expect(() => track('a11y_menu_used')).not.toThrow();
    expect(boom.fetch).not.toHaveBeenCalled(); // the exception is swallowed, not retried
  });
  it('without sendBeacon (or when it refuses) a keepalive fetch is used, with no credentials and no cache', () => {
    const s = stub({ sendBeacon: undefined });
    expect(track('contact_submit_ok')).toBe(true);
    expect(s.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = s.fetch.mock.calls[0];
    expect(url).toBe('/api/collect');
    expect(init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'omit', cache: 'no-store' });
    expect(JSON.parse(init.body)).toEqual({ e: 'contact_submit_ok' });
    const refused = stub({ sendBeacon: vi.fn(() => false) });
    track('cv_download');
    expect(refused.fetch).toHaveBeenCalledTimes(1);
  });
  it('the client module sets no cookie, uses no storage, no referrer and no third-party URL, and has no HTML sink', () => {
    const code = strip(read('src/ui/analytics.js'));
    expect(code).not.toMatch(/cookie|localStorage|sessionStorage|indexedDB|referrer|innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/);
    expect([...code.matchAll(/https?:\/\/[^\s'"`)]+/g)]).toEqual([]);
    expect(code).toMatch(/globalPrivacyControl/);
    expect(code).toMatch(/doNotTrack/);
  });
});

describe('C15 wiring and configuration', () => {
  it('Classic loads analytics from its own chunk after idle; the Explore code never imports analytics, i18n or the accessibility menu', () => {
    expect(read('src/main.js')).toMatch(/import\('\.\/ui\/analytics\.js'\)/);
    expect(read('src/main.js')).not.toMatch(/from '\.\/ui\/analytics\.js'/);
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.js') ? [join(d, e.name)] : []));
    for (const f of walk(join(ROOT, 'src', 'explore'))) expect(strip(readFileSync(f, 'utf8')), f).not.toMatch(/analytics|i18n|a11y-menu|a11y-loader|lang-loader/);
  });
  it('events are sent from the right places: chat open / message, voice, contact success, language, accessibility menu, CV links', () => {
    expect(read('src/ui/chat.js')).toMatch(/track\('chat_open', \{ once: true \}\)/);
    expect(read('src/ui/chat.js')).toMatch(/track\('chat_message'\)/);
    expect(read('src/ui/chat.js')).toMatch(/track\('voice_used'\)/);
    expect(read('src/ui/contact.js')).toMatch(/track\('contact_submit_ok'\)/);
    expect(read('src/i18n/apply.js')).toMatch(/track\('lang_ur'\)/);
    expect(read('src/ui/a11y-menu.js')).toMatch(/track\('a11y_menu_used', \{ once: true \}\)/);
    expect(read('src/ui/analytics.js')).toMatch(/pageview_classic/);
    expect(read('src/ui/analytics.js')).toMatch(/pageview_explore/);
    expect(read('src/ui/analytics.js')).toMatch(/a\[data-event\]/);
  });
  it('the CSP is unchanged (exactly one third-party origin, Cloudflare Turnstile); /api/collect has its own function entry and the dev route', () => {
    const cfg = JSON.parse(read('vercel.json'));
    const all = Object.fromEntries(cfg.headers.find((h) => h.source === '/(.*)').headers.map((h) => [h.key, h.value]));
    expect(all['Content-Security-Policy']).toBe("default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' blob: https://challenges.cloudflare.com; media-src 'self' blob:; worker-src 'self' blob:; frame-src https://challenges.cloudflare.com; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    expect([...new Set(all['Content-Security-Policy'].match(/https?:\/\/[^\s;]+/g))]).toEqual(['https://challenges.cloudflare.com']);
    expect(cfg.functions['api/collect.js']).toEqual({ maxDuration: 10 });
    expect(read('scripts/dev-api.mjs')).toMatch(/path === '\/api\/collect'/);
    expect(read('public/robots.txt')).toMatch(/Disallow: \/api\//);
  });
  it('no new runtime dependency, and none of the new code has an HTML sink or eval', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['@fontsource/courier-prime', '@fontsource/rokkitt', '@fontsource/source-serif-4', '@fontsource/ultra', 'gsap', 'lenis', 'nodemailer', 'three', 'three-mesh-bvh', 'zod']);
    for (const f of ['src/ui/analytics.js', 'src/ui/a11y-menu.js', 'src/ui/a11y-loader.js', 'src/ui/lang-loader.js', 'src/i18n/index.js', 'src/i18n/apply.js', 'src/i18n/translate.js', 'api/collect.js', 'src/shared/analytics-events.js']) {
      expect(strip(read(f)), f).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function|javascript:/);
    }
  });
});

// ── admin Stats ──
const UID = '11111111-1111-4111-8111-111111111111';
const jwt = (aal) => `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: UID, aal })).toString('base64url')}.c2lnbmF0dXJlLXRlc3Q`;
function adminUpstream({ admin = true, rows } = {}) {
  const tokens = new Map();
  const calls = [];
  const today = new Date(1_800_000_000_000).toISOString().slice(0, 10);
  const data =
    rows ??
    [
      { day: today, event: 'chat_open', count: 7, ip_hash: 'a'.repeat(64), secret: 'x' },
      { day: today, event: 'lang_ur', count: '3' },
      { day: '1999-01-01', event: 'chat_open', count: 99 }, // outside the 14 days
      { day: today, event: 'not_an_event', count: 5 }, // not on the allow-list
    ];
  const fetch = vi.fn(async (url) => {
    const u = String(url);
    calls.push(u);
    const json = (d, status = 200) => new Response(JSON.stringify(d), { status });
    if (u.endsWith('/auth/v1/user')) return json({ id: UID, factors: [] });
    if (u.includes('/rest/v1/admins?')) return json(admin ? [{ user_id: UID }] : []);
    if (u.includes('/rest/v1/analytics_daily?')) return json(data);
    return json({}, 404);
  });
  return { fetch, calls, tokens, today };
}
async function stats(headers, up = adminUpstream()) {
  const res = response();
  const req = Readable.from([]);
  req.method = 'GET';
  req.url = '/api/admin/stats';
  req.headers = { origin: ORIGIN, ...headers };
  await createAdminHandler({ env: ENV, fetch: up.fetch, now: () => 1_800_000_000_000, log: () => {}, sleep: async () => {} })(req, res);
  return { res, up, json: res.body ? JSON.parse(res.body) : null };
}

describe('C15 admin Stats (/api/admin/stats)', () => {
  it('needs a valid token, a row in admins and an aal2 session: 401 / 403 / 403 without any analytics read', async () => {
    const none = await stats({});
    expect(none.res.statusCode).toBe(401);
    const junk = await stats({ authorization: 'Bearer nope.nope.nope-nope' });
    expect(junk.res.statusCode).toBe(401);
    const nonAdmin = await stats({ authorization: `Bearer ${jwt('aal2')}` }, adminUpstream({ admin: false }));
    expect(nonAdmin.res.statusCode).toBe(403);
    const aal1 = await stats({ authorization: `Bearer ${jwt('aal1')}` });
    expect(aal1.res.statusCode).toBe(403);
    for (const r of [none, junk, nonAdmin, aal1]) {
      expect(r.res.body).not.toMatch(/count|stats|chat_open/);
      expect(r.up.calls.some((c) => c.includes('analytics_daily'))).toBe(false);
    }
  });
  it('an admin at aal2 gets only { day, event, count } for the last 14 days and the allow-listed events; extra columns, old days and unknown events are dropped', async () => {
    const up = adminUpstream();
    const r = await stats({ authorization: `Bearer ${jwt('aal2')}` }, up);
    expect(r.res.statusCode).toBe(200);
    expect(Object.keys(r.json).sort()).toEqual(['days', 'events', 'ok', 'stats']);
    expect(r.json.days).toHaveLength(STATS_DAYS);
    expect(r.json.events).toEqual(ANALYTICS_EVENTS);
    expect(r.json.stats).toEqual([{ day: up.today, event: 'chat_open', count: 7 }, { day: up.today, event: 'lang_ur', count: 3 }]);
    expect(r.res.body).not.toMatch(/ip_hash|secret|a{20}|1999|not_an_event/);
    const query = up.calls.find((c) => c.includes('analytics_daily?'));
    expect(query).toMatch(/select=day,event,count&/);
    expect(query).not.toMatch(/\*|ip|agent/);
    expect(r.res.headers['cache-control']).toBe('no-store');
  });
  it('the route is GET only and cross-origin is refused', async () => {
    const res = response();
    const req = Readable.from([Buffer.from('{}')]);
    req.method = 'POST';
    req.url = '/api/admin/stats';
    req.headers = { origin: ORIGIN, 'content-type': 'application/json', authorization: `Bearer ${jwt('aal2')}` };
    await createAdminHandler({ env: ENV, fetch: adminUpstream().fetch, log: () => {} })(req, res);
    expect(res.statusCode).toBe(405);
    expect((await stats({ origin: 'https://evil.example', authorization: `Bearer ${jwt('aal2')}` })).res.statusCode).toBe(403);
  });
  it('the Stats tab renders text nodes only, as a table of counts, and says what is not stored', () => {
    const code = strip(read('src/admin/main.js'));
    expect(code).toMatch(/\['stats', 'Stats'\]/);
    expect(code).toMatch(/async function loadStats\(\)/);
    expect(code).toMatch(/guarded\('stats'\)/);
    expect(code).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
    expect(code).toMatch(/no cookies, no IP address, no referrer/);
  });
});
