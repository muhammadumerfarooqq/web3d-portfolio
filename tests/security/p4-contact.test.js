// C10 (P4): contact system security. CSP with exactly one third-party origin, no secret reaches the
// browser bundle, RLS on contact_messages with no public policies, and the accessible form markup.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { SUBJECTS } from '../../src/shared/contact-schema.js';
import { MESSAGES, TURNSTILE_SRC, outcome } from '../../src/ui/contact.js';
import { INTERVIEW_DRAFT, INTERVIEW_SUBJECT } from '../../src/explore/case-files.js';
import { buildSite } from '../helpers/build-site.js';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const vercel = JSON.parse(read('vercel.json'));
const globalHeaders = vercel.headers.find((h) => h.source === '/(.*)').headers;
const headerValue = (key) => globalHeaders.find((h) => h.key === key)?.value;
const csp = Object.fromEntries(
  headerValue('Content-Security-Policy')
    .split(';')
    .map((d) => d.trim().split(/\s+/))
    .map(([name, ...values]) => [name, values]),
);

describe('C10 Content-Security-Policy (vercel.json)', () => {
  it('whitelists exactly ONE third-party origin, https://challenges.cloudflare.com', () => {
    const origins = new Set(Object.values(csp).flat().filter((v) => /^https?:|^wss?:|\*/.test(v)));
    expect([...origins]).toEqual(['https://challenges.cloudflare.com']);
    expect(csp['script-src']).toContain('https://challenges.cloudflare.com');
    expect(csp['frame-src']).toEqual(['https://challenges.cloudflare.com']);
    expect(csp['connect-src']).toContain('https://challenges.cloudflare.com');
    expect(TURNSTILE_SRC.startsWith('https://challenges.cloudflare.com/')).toBe(true);
  });

  it('allows only what the site needs, with no unsafe keywords', () => {
    expect(csp['default-src']).toEqual(["'self'"]);
    expect(csp['script-src']).toEqual(["'self'", "'wasm-unsafe-eval'", 'https://challenges.cloudflare.com']);
    expect(csp['style-src']).toEqual(["'self'"]);
    expect(csp['img-src']).toEqual(["'self'", 'data:', 'blob:']);
    expect(csp['media-src']).toEqual(["'self'", 'blob:']);
    expect(csp['worker-src']).toEqual(["'self'", 'blob:']);
    expect(csp['connect-src']).toEqual(["'self'", 'blob:', 'https://challenges.cloudflare.com']); // blob: = GLB textures
    expect(csp['font-src']).toEqual(["'self'"]);
    for (const values of Object.values(csp)) for (const v of values) expect(v).not.toMatch(/'unsafe-inline'|'unsafe-eval'|'unsafe-hashes'|'strict-dynamic'/);
  });

  it('keeps the hardening directives', () => {
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'self'"]);
    expect(csp['form-action']).toEqual(["'self'"]);
  });

  it('extends the P0 headers without duplicating any of them (HSTS, nosniff, Referrer, Permissions, COOP)', () => {
    const keys = globalHeaders.map((h) => h.key.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
    expect(headerValue('Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains; preload');
    expect(headerValue('X-Content-Type-Options')).toBe('nosniff');
    expect(headerValue('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headerValue('Permissions-Policy')).toMatch(/camera=\(\)/);
    expect(headerValue('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(vercel.regions).toEqual(['bom1']);
  });

  it('the client never loads Turnstile with eval-like code and zod runs without JIT', () => {
    expect(read('src/shared/contact-schema.js')).toContain('z.config({ jitless: true })');
    expect(read('src/ui/contact.js')).not.toMatch(/innerHTML|insertAdjacentHTML|eval\(|new Function/);
  });
});

describe('C10 secrets stay on the server', () => {
  let outputs;
  beforeAll(async () => {
    ({ outputs } = await buildSite());
  }, 180_000);

  const envNames = read('.env.example')
    .split(/\r?\n/)
    .map((l) => /^([A-Z][A-Z0-9_]*)=/.exec(l)?.[1])
    .filter(Boolean);

  it('.env.example lists names only (every value empty), including all P4 names', () => {
    for (const line of read('.env.example').split(/\r?\n/)) if (/^[A-Z][A-Z0-9_]*=/.test(line)) expect(line, line.split('=')[0]).toMatch(/^[A-Z0-9_]+=$/);
    for (const n of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TURNSTILE_SECRET_KEY', 'VITE_TURNSTILE_SITE_KEY', 'SMTP_USER', 'SMTP_APP_PASSWORD', 'CONTACT_TO', 'IP_HASH_SALT', 'GEMINI_API_KEY', 'GROQ_API_KEY']) expect(envNames).toContain(n);
  });

  it('dist/ contains no env NAME except VITE_TURNSTILE_SITE_KEY’s value', () => {
    const files = outputs.map((o) => ({ name: o.fileName, text: String(o.code ?? o.source ?? '') }));
    for (const name of envNames) {
      const hit = files.find((f) => f.text.includes(name));
      expect(hit?.name ?? null, `env name ${name} found in the bundle`).toBeNull();
    }
  });

  it('dist/ contains no env VALUE from .env other than the public Turnstile site key (values never printed)', () => {
    if (!existsSync(join(ROOT, '.env'))) return; // CI without secrets: the name check above still runs
    const values = {};
    for (const line of read('.env').split(/\r?\n/)) {
      const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (m) values[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
    const text = outputs.map((o) => String(o.code ?? o.source ?? '')).join('\n');
    // The one address the site publishes on purpose (content/profile.md links.email) may equal an env value
    // (CONTACT_TO): it is public by design, not a leaked secret.
    const publicEmail = /^\s*email:\s*(\S+)/m.exec(read('content/profile.md'))?.[1]?.toLowerCase();
    expect(publicEmail).toBe('mumerfarooq.ned@gmail.com');
    // P5: the AI provider keys, by name (their values are covered by the loop below).
    for (const key of ['GEMINI_API_KEY', 'GROQ_API_KEY']) expect(text.includes(key), `${key} name in the bundle`).toBe(false);
    for (const [name, value] of Object.entries(values)) {
      if (name === 'VITE_TURNSTILE_SITE_KEY' || value.length < 12 || /^\d+$/.test(value) || value.toLowerCase() === publicEmail) continue;
      expect(text.includes(value), `the value of ${name} is in the bundle`).toBe(false);
    }
    // the one public value is there (the widget needs it), when configured
    if (values.VITE_TURNSTILE_SITE_KEY) expect(text.includes(values.VITE_TURNSTILE_SITE_KEY)).toBe(true);
  });

  it('server code reads secrets from process.env only, never from a VITE_ variable or a literal', () => {
    for (const f of ['api/contact.js', 'api/contact-token.js', 'api/_lib/env.js', 'api/_lib/mail.js', 'api/_lib/turnstile.js', 'api/_lib/supabase.js']) {
      const c = read(f);
      expect(c, f).not.toMatch(/import\.meta\.env|VITE_/);
      expect(c, f).not.toMatch(/console\.(?:log|error|warn|info)\(/); // only api/_lib/log.js writes logs
    }
    expect(read('api/_lib/log.js')).toMatch(/const SAFE = new Set\(\['event', 'status', 'reason', 'ms', 'missing'\]\)/);
  });
});

describe('C10 database: RLS on contact_messages, service role only', () => {
  const sql = read('supabase/migrations/0001_contact_messages.sql');
  it('enables (and forces) RLS and creates NO policies', () => {
    expect(sql).toMatch(/alter table public\.contact_messages enable row level security;/);
    expect(sql).toMatch(/alter table public\.contact_messages force row level security;/);
    expect(sql).not.toMatch(/create\s+policy/i);
  });
  it('revokes the table and the function from public, anon and authenticated; grants service_role', () => {
    expect(sql).toMatch(/revoke all on table public\.contact_messages from public, anon, authenticated;/);
    expect(sql).toMatch(/revoke all on function public\.contact_submit\([^)]*\) from public, anon, authenticated;/);
    expect(sql).toMatch(/grant execute on function public\.contact_submit\([^)]*\) to service_role;/);
  });
  it('the rate limit is atomic (advisory lock) at 5/hour and 20/day; the function pins search_path', () => {
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sql).toMatch(/v_hour >= 5/);
    expect(sql).toMatch(/v_day >= 20/);
    expect(sql).toMatch(/set search_path = ''/);
    expect(sql).toMatch(/security invoker/);
    expect(sql).toMatch(/status text not null default 'new'/);
    for (const s of SUBJECTS) expect(sql).toContain(`'${s}'`);
  });
});

describe('C10 accessible contact form (built HTML)', () => {
  let html;
  beforeAll(async () => {
    const { indexHtml } = await buildSite();
    html = indexHtml.slice(indexHtml.indexOf('<section id="contact"'), indexHtml.indexOf('</section>', indexHtml.indexOf('<section id="contact"')));
  }, 180_000);

  it('every visible field has a label, aria-describedby targets that exist, and an error slot', () => {
    for (const name of ['name', 'email', 'subject', 'message']) {
      const id = `contact-${name}`;
      expect(html, name).toMatch(new RegExp(`<label class="field__label" for="${id}">`));
      const control = html.match(new RegExp(`<(?:input|select|textarea)[^>]*id="${id}"[^>]*>`))?.[0];
      expect(control, name).toBeTruthy();
      expect(control).toMatch(/\brequired\b/);
      const described = control.match(/aria-describedby="([^"]+)"/)[1].split(' ');
      expect(described).toContain(`${id}-error`);
      for (const d of described) expect(html).toContain(`id="${d}"`);
      expect(html).toMatch(new RegExp(`<p class="field__error" id="${id}-error" data-error-for="${name}" hidden></p>`));
    }
  });

  it('P5 fix: the email field asks for the visitor’s own address (placeholder + one described hint)', () => {
    expect(html).toMatch(/<input[^>]*id="contact-email"[^>]*placeholder="your-email@example\.com"[^>]*aria-describedby="contact-email-hint contact-email-error"/);
    expect(html).toContain('<p class="field__hint" id="contact-email-hint">Type your own email so I can reply to you.</p>');
  });

  it('subject options are exactly the server allow-list', () => {
    const options = [...html.matchAll(/<option value="([^"]*)">/g)].map((m) => m[1]);
    expect(options).toEqual(['', ...SUBJECTS]);
    expect(SUBJECTS).toContain(INTERVIEW_SUBJECT); // the Deputy's Commission pre-fill
    expect(INTERVIEW_DRAFT.length).toBeGreaterThanOrEqual(20);
  });

  it('error summary (focusable group), polite live status, success message and honeypot', () => {
    expect(html).toMatch(/<div class="contact__summary" data-contact-summary tabindex="-1" role="group" aria-labelledby="contact-summary-title" hidden>/);
    expect(html).toMatch(/<p class="contact__status" data-contact-status role="status" aria-live="polite"><\/p>/);
    expect(html).toContain('Telegram sent. Umer will reply to your email.');
    expect(html).toMatch(/<div class="field field--trap" aria-hidden="true">/);
    expect(html).toMatch(/<input id="contact-website" name="website" type="text" tabindex="-1" autocomplete="off" \/>/);
  });

  it('works without JS: the form is hidden until the script enables it; the mailto link is always there', () => {
    expect(html).toMatch(/<form class="contact__form" data-contact-form[^>]*\shidden\s/);
    expect(html).toMatch(/<a class="[^"]*social-link--email" href="mailto:[^"]+"/);
    expect(html).toMatch(/data-contact-unavailable hidden role="status"/);
    expect(html).not.toMatch(/\+92|tel:/);
  });

  it('client messages: 429 shows a wait time, 503 falls back to the email link, field errors map back', () => {
    expect(outcome(200, { ok: true }).kind).toBe('success');
    expect(outcome(400, { error: 'invalid', fields: { email: 'x' } })).toEqual({ kind: 'fields', fields: { email: 'x' } });
    expect(outcome(429, {}, '1800').text).toBe(MESSAGES.rateLimited(1800));
    expect(MESSAGES.rateLimited(1800)).toMatch(/30 minutes/);
    expect(outcome(503, {}).kind).toBe('unavailable');
    expect(outcome(400, { error: 'too_fast' }).text).toBe(MESSAGES.tooFast);
    expect(outcome(400, { error: 'stale_form' })).toMatchObject({ refresh: true });
    expect(outcome(500, {}).text).toBe(MESSAGES.server);
    expect(MESSAGES.summary(1)).toMatch(/this problem/);
    expect(MESSAGES.summary(3)).toMatch(/these 3 problems/);
  });

  it('the Explore case-files chunk does not pull in zod (it pre-fills the shared form through the DOM)', () => {
    expect(read('src/explore/case-files.js')).not.toMatch(/^import[^;]*(?:contact-schema|'zod')/m);
  });
});
