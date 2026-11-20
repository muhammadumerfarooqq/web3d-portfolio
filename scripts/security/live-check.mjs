// P11 B1: black-box security check of the LIVE site. `node scripts/security/live-check.mjs [url] [--write]`
// (default https://umerfarooq-ai.vercel.app). Verifies the response headers of the pages, assets and API,
// that cross-origin / wrong-type / oversized / session-less / wrong-method requests are rejected, and that
// /api/cron and /api/admin leak nothing. EVERY request here is refused BEFORE any paid or side-effecting call:
// no contact email is sent, no Supabase rate-limit row is written, and no Gemini / Groq / Whisper call is made
// (the checks stop at origin, content type, size, method or the session token). No secret is needed or
// printed. --write saves docs/reports/live-check.md with the raw results.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const BASE = (args.find((a) => /^https?:\/\//.test(a)) ?? 'https://umerfarooq-ai.vercel.app').replace(/\/+$/, '');
const WRITE = args.includes('--write');
const EVIL = 'https://evil.example';
const results = [];
const raw = [];

const pick = (res, names) => Object.fromEntries(names.map((n) => [n, res.headers.get(n)]).filter(([, v]) => v !== null));
async function call(method, path, { headers = {}, body, origin } = {}) {
  const h = { ...headers };
  if (origin) h.Origin = origin;
  const res = await fetch(`${BASE}${path}`, { method, headers: h, body, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  const text = await res.text().catch(() => '');
  return { res, text };
}
function check(id, title, ok, detail) {
  results.push({ id, title, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${title}${ok ? '' : `  -> ${detail}`}`);
}
const json = (t) => {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
};

// ── 1. headers on pages, assets and errors ──
const CSP_EXPECT = ["default-src 'self'", "script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com", "style-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'", "frame-src https://challenges.cloudflare.com", "connect-src 'self' blob: https://challenges.cloudflare.com"];
const hdrNames = ['strict-transport-security', 'content-security-policy', 'cross-origin-opener-policy', 'x-content-type-options', 'referrer-policy', 'permissions-policy', 'x-frame-options', 'server', 'x-powered-by', 'set-cookie', 'access-control-allow-origin'];
for (const path of ['/', '/robots.txt', '/does-not-exist']) {
  const { res } = await call('GET', path);
  raw.push([`GET ${path}`, res.status, pick(res, hdrNames)]);
  const h = (n) => res.headers.get(n) ?? '';
  const id = `H ${path}`;
  check(`${id} HSTS`, 'Strict-Transport-Security: ≥ 1 year, includeSubDomains', /max-age=(\d+)/.test(h('strict-transport-security')) && Number(/max-age=(\d+)/.exec(h('strict-transport-security'))[1]) >= 31536000 && /includeSubDomains/i.test(h('strict-transport-security')), h('strict-transport-security') || 'missing');
  const csp = h('content-security-policy');
  check(`${id} CSP`, 'strict CSP with exactly one third-party origin (Cloudflare Turnstile)', CSP_EXPECT.every((d) => csp.includes(d)) && [...new Set(csp.match(/https?:\/\/[^\s;]+/g) ?? [])].join() === 'https://challenges.cloudflare.com' && !/(?<!wasm-)unsafe-(eval|inline)/.test(csp), csp || 'missing');
  check(`${id} COOP`, 'Cross-Origin-Opener-Policy: same-origin', h('cross-origin-opener-policy') === 'same-origin', h('cross-origin-opener-policy') || 'missing');
  check(`${id} nosniff`, 'X-Content-Type-Options: nosniff', h('x-content-type-options') === 'nosniff', h('x-content-type-options') || 'missing');
  check(`${id} referrer`, 'Referrer-Policy: strict-origin-when-cross-origin', h('referrer-policy') === 'strict-origin-when-cross-origin', h('referrer-policy') || 'missing');
  check(`${id} permissions`, 'Permissions-Policy: microphone=(self) only; camera, geolocation, payment, usb denied', h('permissions-policy') === 'camera=(), geolocation=(), microphone=(self), payment=(), usb=()', h('permissions-policy') || 'missing');
  check(`${id} framing`, 'X-Frame-Options: DENY and CSP frame-ancestors none', h('x-frame-options') === 'DENY' && /frame-ancestors 'none'/.test(csp), `${h('x-frame-options')} / ${csp.includes("frame-ancestors 'none'")}`);
  check(`${id} no leaks`, 'no X-Powered-By, no Set-Cookie (the Server header is the platform name only)', !h('x-powered-by') && !h('set-cookie') && !/\d/.test(h('server')), `${h('x-powered-by')} ${h('set-cookie')} ${h('server')}`);
}
{
  const { res } = await call('GET', '/');
  check('H / https', 'plain http redirects to https (HSTS preload list requires it)', await fetch(BASE.replace(/^https:/, 'http:'), { redirect: 'manual' }).then((r) => [301, 302, 307, 308].includes(r.status) && /^https:/.test(r.headers.get('location') ?? ''), () => false), 'no redirect');
  void res;
}
{
  const html = (await call('GET', '/')).text;
  const m = /src="(\/assets\/[^"]+\.js)"/.exec(html);
  if (m) {
    const { res } = await call('GET', m[1]);
    raw.push([`GET ${m[1]}`, res.status, pick(res, hdrNames)]);
    check('H asset', 'built script: nosniff and a long immutable cache or revalidation (no leak)', res.headers.get('x-content-type-options') === 'nosniff' && !res.headers.get('set-cookie'), JSON.stringify(pick(res, ['x-content-type-options', 'cache-control'])));
  }
  check('H inline', 'the home page has no inline script bodies and no on*= handlers', !/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(html.replace(/<script[^>]*type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/gi, '')) && !/\son[a-z]+="/i.test(html), 'inline script or handler found');
}

// ── 2. API: cross-origin, content type, size, method, session ──
const API = ['/api/contact', '/api/chat', '/api/transcribe', '/api/chat-token', '/api/contact-token'];
const POSTS = [['/api/contact', 'application/json'], ['/api/chat', 'application/json'], ['/api/transcribe', 'audio/webm']];
for (const [path, type] of POSTS) {
  const { res, text } = await call('POST', path, { origin: EVIL, headers: { 'Content-Type': type }, body: type === 'application/json' ? '{}' : new Uint8Array(32) });
  raw.push([`POST ${path} (Origin ${EVIL})`, res.status, pick(res, ['access-control-allow-origin', 'content-type']), text.slice(0, 120)]);
  check(`A ${path} cross-origin`, 'cross-origin POST → 403 and no CORS headers', res.status === 403 && !res.headers.get('access-control-allow-origin'), `${res.status} ${res.headers.get('access-control-allow-origin')}`);
  const none = await call('POST', path, { headers: { 'Content-Type': type }, body: type === 'application/json' ? '{}' : new Uint8Array(32) });
  check(`A ${path} no origin`, 'POST with no Origin and no Referer → 403', none.res.status === 403, String(none.res.status));
}
for (const path of ['/api/chat-token', '/api/contact-token']) {
  const { res } = await call('GET', path, { origin: EVIL });
  check(`A ${path} cross-origin`, 'cross-origin GET → 403', res.status === 403 && !res.headers.get('access-control-allow-origin'), String(res.status));
}
{
  const pre = await call('OPTIONS', '/api/chat', { origin: EVIL, headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  raw.push(['OPTIONS /api/chat (preflight from evil origin)', pre.res.status, pick(pre.res, ['access-control-allow-origin', 'access-control-allow-methods', 'allow'])]);
  check('A preflight', 'a cross-origin preflight gets no Access-Control-Allow-* headers', !pre.res.headers.get('access-control-allow-origin') && !pre.res.headers.get('access-control-allow-methods'), JSON.stringify(pick(pre.res, ['access-control-allow-origin', 'access-control-allow-methods'])));
}
for (const [path, type] of [['/api/contact', 'text/plain'], ['/api/chat', 'text/plain'], ['/api/chat', 'application/x-www-form-urlencoded'], ['/api/transcribe', 'application/json'], ['/api/transcribe', 'audio/mpeg']]) {
  const { res } = await call('POST', path, { origin: BASE, headers: { 'Content-Type': type }, body: 'x=1' });
  check(`A ${path} ${type}`, 'wrong content type → 415', res.status === 415, String(res.status));
}
for (const [path, type, size] of [['/api/contact', 'application/json', 9 * 1024], ['/api/chat', 'application/json', 9 * 1024], ['/api/transcribe', 'audio/webm', 2 * 1024 * 1024 + 10]]) {
  const body = type === 'application/json' ? `{"message":"${'a'.repeat(size)}"}` : new Uint8Array(size);
  const { res } = await call('POST', path, { origin: BASE, headers: { 'Content-Type': type }, body });
  check(`A ${path} oversized`, `body over the limit (${size} bytes) → 413`, res.status === 413, String(res.status));
}
for (const path of ['/api/contact', '/api/chat', '/api/transcribe']) {
  const { res, text } = await call('GET', path, { origin: BASE });
  check(`A ${path} GET`, 'GET on a POST route → 405 with Allow: POST', res.status === 405 && /POST/.test(res.headers.get('allow') ?? ''), `${res.status} ${res.headers.get('allow')}`);
  void text;
}
{
  // session token: rejected before the rate limiter, the embeddings, the LLM or Whisper
  const chat = (session) => call('POST', '/api/chat', { origin: BASE, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Hello there', lang: 'en', ...(session === undefined ? {} : { session }) }) });
  for (const [label, session] of [['missing', undefined], ['empty', ''], ['garbage', 'not-a-token'], ['forged (right shape, wrong signature)', `${Date.now() + 3_000_000}.${'A'.repeat(43)}`], ['expired', `${Date.now() - 86_400_000}.${'A'.repeat(43)}`]]) {
    const { res, text } = await chat(session);
    raw.push([`POST /api/chat (session ${label})`, res.status, {}, text.slice(0, 120)]);
    check(`A /api/chat session ${label}`, 'no valid chat session → 401 (503 if the chat is not configured), no model call', [401, 503].includes(res.status) && json(text)?.ok === false, `${res.status} ${text.slice(0, 80)}`);
  }
  for (const [label, session] of [['missing', undefined], ['forged', `${Date.now() + 3_000_000}.${'A'.repeat(43)}`]]) {
    const { res, text } = await call('POST', '/api/transcribe', { origin: BASE, headers: { 'Content-Type': 'audio/webm', ...(session ? { 'X-Chat-Session': session } : {}) }, body: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) });
    raw.push([`POST /api/transcribe (session ${label})`, res.status, {}, text.slice(0, 120)]);
    check(`A /api/transcribe session ${label}`, 'no valid chat session → 401 (503 if not configured), no Whisper call', [401, 503].includes(res.status) && json(text)?.ok === false, `${res.status} ${text.slice(0, 80)}`);
  }
  const contact = await call('POST', '/api/contact', { origin: BASE, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Security Check', email: 'security-check@example.com', subject: 'Other', message: 'This is an automated header check, it must be rejected.', website: '', stamp: '', token: '' }) });
  raw.push(['POST /api/contact (no stamp, no Turnstile token)', contact.res.status, {}, contact.text.slice(0, 120)]);
  check('A /api/contact no stamp', 'a contact post without the time-trap stamp and Turnstile token → 400/503, nothing is sent', [400, 503].includes(contact.res.status) && json(contact.text)?.ok === false, `${contact.res.status} ${contact.text.slice(0, 80)}`);
}

// P7: the admin API and the cron. None of these requests carries a valid credential, so each is refused before any
// database read, and none of them attempts a login (a login attempt would use up the owner's own rate limit).
{
  const FORGED = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: '00000000-0000-4000-8000-000000000000', aal: 'aal2', exp: 9999999999 })).toString('base64url')}.c2lnbmF0dXJlLXRlc3Q`;
  const adminRoutes = [['GET', '/api/admin/messages'], ['PATCH', '/api/admin/messages'], ['GET', '/api/admin/projects-order'], ['POST', '/api/admin/projects-order'], ['POST', '/api/admin/mfa/enroll'], ['POST', '/api/admin/mfa/verify']];
  for (const [method, path] of adminRoutes) {
    const body = method === 'GET' ? undefined : '{}';
    const type = { 'Content-Type': 'application/json' };
    const none = await call(method, path, { origin: BASE, headers: type, body });
    raw.push([`${method} ${path} (no token)`, none.res.status, pick(none.res, ['cache-control']), none.text.slice(0, 80)]);
    check(`P7 ${method} ${path} no token`, 'admin API without a token → 401 (404 only before the P7 deploy), nothing returned', [401, 404].includes(none.res.status) && !/messages|projects|email/.test(none.text.replace(/"error":"[a-z_]+"/g, '')), `${none.res.status} ${none.text.slice(0, 80)}`);
    const forged = await call(method, path, { origin: BASE, headers: { ...type, Authorization: `Bearer ${FORGED}` }, body });
    check(`P7 ${method} ${path} forged token`, 'a token Supabase never issued (even one whose payload claims aal2) → 401', [401, 404].includes(forged.res.status), `${forged.res.status} ${forged.text.slice(0, 80)}`);
    const evil = await call(method, path, { origin: EVIL, headers: { ...type, Authorization: `Bearer ${FORGED}` }, body });
    check(`P7 ${method} ${path} cross-origin`, 'cross-origin → 403 (404 only before the P7 deploy), no CORS headers', [403, 404].includes(evil.res.status) && !evil.res.headers.get('access-control-allow-origin'), `${evil.res.status}`);
  }
  const bad = await call('POST', '/api/admin/login', { origin: BASE, headers: { 'Content-Type': 'application/json' }, body: '{"email":"nobody"}' });
  check('P7 login bad body', 'a login body that fails validation → 400 before the rate limiter, Turnstile or Supabase is touched', [400, 404].includes(bad.res.status), `${bad.res.status} ${bad.text.slice(0, 80)}`);
  const get = await call('GET', '/api/admin/login', { origin: BASE });
  check('P7 login GET', 'GET on the login route → 405', [405, 404].includes(get.res.status), String(get.res.status));
  const cron = await call('GET', '/api/cron/keepalive');
  check('P7 cron no secret', '/api/cron/keepalive without the secret → 401 (404 only before the P7 deploy)', [401, 404].includes(cron.res.status) && !/"ok":true/.test(cron.text), `${cron.res.status} ${cron.text.slice(0, 60)}`);
  const cron2 = await call('GET', '/api/cron/keepalive', { headers: { Authorization: 'Bearer not-the-secret-0123456789abcdefghijklmnopqrstuvwxyz' } });
  check('P7 cron wrong secret', 'a wrong cron secret → 401 (404 only before the P7 deploy)', [401, 404].includes(cron2.res.status) && !/"ok":true/.test(cron2.text), `${cron2.res.status}`);
  const order = await call('GET', '/api/project-order');
  const o = json(order.text);
  check('P7 public order', 'GET /api/project-order is public and returns slugs only ({ ok, order })', order.res.status === 404 || (order.res.status === 200 && o?.ok === true && Array.isArray(o.order) && Object.keys(o).sort().join() === 'ok,order' && o.order.every((x) => /^[a-z0-9-]+$/.test(x))), `${order.res.status} ${order.text.slice(0, 80)}`);
  const page = await call('GET', '/admin/');
  check('P7 admin page', '/admin is served noindex (X-Robots-Tag header and meta) with no data in it', (page.res.status === 200 && /noindex/.test(page.res.headers.get('x-robots-tag') ?? '') && /<meta name="robots" content="noindex/.test(page.text) && !/@|messages/.test(page.text.replace(/<meta[^>]*>/g, ''))) || page.res.status === 404, `${page.res.status} ${page.res.headers.get('x-robots-tag')}`);
}

// P10: the analytics collector. Only requests that are refused or ignored: no counter is ever incremented here.
{
  const post = (body, type = 'application/json', origin = BASE) => call('POST', '/api/collect', { origin, headers: { 'Content-Type': type }, body });
  const get = await call('GET', '/api/collect', { origin: BASE });
  check('P10 collect GET', 'GET /api/collect → 405 (404 only before the P10 deploy)', [405, 404].includes(get.res.status), String(get.res.status));
  const evil = await post('{"e":"chat_open"}', 'application/json', EVIL);
  check('P10 collect cross-origin', 'a cross-origin POST is refused (403) and counts nothing, no CORS headers', [403, 404].includes(evil.res.status) && !evil.res.headers.get('access-control-allow-origin'), String(evil.res.status));
  const noOrigin = await call('POST', '/api/collect', { headers: { 'Content-Type': 'application/json' }, body: '{"e":"chat_open"}' });
  check('P10 collect no origin', 'a POST with no Origin or Referer is refused', [403, 404].includes(noOrigin.res.status), String(noOrigin.res.status));
  const type = await post('e=chat_open', 'application/x-www-form-urlencoded');
  check('P10 collect type', 'a form-encoded POST → 415', [415, 404].includes(type.res.status), String(type.res.status));
  const big = await post(JSON.stringify({ e: 'x'.repeat(400) }));
  check('P10 collect oversized', 'a body over 200 bytes → 413', [413, 404].includes(big.res.status), String(big.res.status));
  const unknown = await post('{"e":"not_an_event"}');
  check('P10 collect unknown event', 'an unknown event is ignored: 204 with no body, nothing counted', unknown.res.status === 404 || (unknown.res.status === 204 && unknown.text === ''), `${unknown.res.status} ${unknown.text.slice(0, 40)}`);
  const junk = await post('not json at all');
  check('P10 collect junk', 'a body that is not JSON is ignored the same way (204, empty)', junk.res.status === 404 || (junk.res.status === 204 && junk.text === ''), `${junk.res.status}`);
  const stats = await call('GET', '/api/admin/stats', { origin: BASE });
  check('P10 admin stats no token', '/api/admin/stats without a token → 401 (404 only before the deploy)', [401, 404].includes(stats.res.status) && !/"stats"/.test(stats.text), `${stats.res.status}`);
}

// ── 3. error bodies and unrouted paths ──
for (const path of ['/api/cron', '/api/cron/anything', '/api/admin', '/api/admin/users', '/api/admin/../../.env', '/api/nothing', '/.env', '/.git/config', '/package.json', '/vercel.json', '/supabase/migrations/0001_contact_messages.sql']) {
  const { res, text } = await call('GET', path);
  raw.push([`GET ${path}`, res.status, pick(res, ['content-type']), text.slice(0, 60).replace(/\s+/g, ' ')]);
  const looksLikeSecret = /SUPABASE|SERVICE_ROLE|GROQ|TURNSTILE|sk_|gsk_|BEGIN .*PRIVATE|"dependencies"|create table/i.test(text);
  check(`E ${path}`, 'not served (404, 429 from the firewall, or the app shell), no file or secret content', (res.status === 404 || res.status === 429 || (res.status === 200 && /<!doctype html/i.test(text))) && !looksLikeSecret, `${res.status} ${text.slice(0, 60)}`);
}
for (const path of API) {
  const { res, text } = await call('POST', path, { origin: BASE, headers: { 'Content-Type': 'application/json' }, body: '{not json' });
  const looksLeaky = /at \S+ \(|node_modules|\/var\/task|Error:|stack|supabase|postgres/i.test(text);
  check(`E ${path} bad JSON`, 'malformed JSON gives a short generic JSON error, no stack, path or provider name', !looksLeaky && text.length < 300, `${res.status} ${text.slice(0, 100)}`);
}

// ── 4. SEO / discoverability files used by E4 ──
{
  const html = (await call('GET', '/')).text;
  for (const [name, rx] of [['title', /<title>[^<]{10,}<\/title>/], ['meta description', /<meta name="description" content="[^"]{50,}"/], ['canonical', /<link rel="canonical" href="https:\/\/[^"]+"/], ['og:image', /<meta property="og:image" content="[^"]+"/], ['og:title', /<meta property="og:title"/], ['lang attribute', /<html[^>]*\blang="en"/]]) check(`S ${name}`, `index has ${name}`, rx.test(html), 'missing');
  const robots = (await call('GET', '/robots.txt')).text;
  check('S robots', 'robots.txt present and valid', /User-agent:/i.test(robots), robots.slice(0, 60));
  const sm = await call('GET', '/sitemap.xml');
  check('S sitemap', 'sitemap.xml present (or robots.txt does not promise one)', sm.res.status === 200 && /<urlset/.test(sm.text) || !/Sitemap:/i.test(robots), `${sm.res.status}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed against ${BASE}${failed.length ? ` — ${failed.length} FAILED` : ''}`);

if (WRITE) {
  const lines = [
    '# Live site security check',
    '',
    `Run by \`node scripts/security/live-check.mjs ${BASE} --write\` on ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC against **${BASE}**.`,
    '',
    'Every request is refused before any paid or side-effecting call (origin, content type, size, method or session token): no contact email, no database row, no Gemini / Groq / Whisper call. No secret is needed or printed.',
    '',
    `**Result: ${results.length - failed.length}/${results.length} checks passed.**${failed.length ? ` Failed: ${failed.map((f) => f.id).join(', ')}.` : ''}`,
    '',
    '## Checks',
    '',
    '| Result | Check | What | Detail on failure |',
    '|---|---|---|---|',
    ...results.map((r) => `| ${r.ok ? 'PASS' : '**FAIL**'} | ${r.id} | ${r.title} | ${r.ok ? '' : String(r.detail).replace(/\|/g, '/').slice(0, 160)} |`),
    '',
    '## Raw results (status and the headers that matter, response bodies cut to 120 characters)',
    '',
    '```',
    ...raw.map(([what, status, headers, body]) => `${what}\n  -> ${status} ${JSON.stringify(headers)}${body ? `  body: ${body}` : ''}`),
    '```',
  ];
  writeFileSync(join(import.meta.dirname, '..', '..', 'docs', 'reports', 'live-check.md'), lines.join('\n') + '\n');
  console.log('wrote docs/reports/live-check.md');
}
process.exitCode = failed.length ? 1 : 0;
