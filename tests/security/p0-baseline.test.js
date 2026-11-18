import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

// `git check-ignore --no-index` applies the .gitignore rules even to untracked paths.
// Exit code 0 = ignored, 1 = not ignored.
function isIgnored(path) {
  try {
    execFileSync('git', ['check-ignore', '--no-index', '-q', path], { cwd: root, stdio: 'ignore' });
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}

describe('C1 secrets management (.gitignore + .env.example)', () => {
  it('.gitignore ignores .env and .env.local but not .env.example', () => {
    expect(isIgnored('.env')).toBe(true);
    expect(isIgnored('.env.local')).toBe(true);
    expect(isIgnored('.env.production')).toBe(true);
    expect(isIgnored('.env.example')).toBe(false);
  });

  it('.gitignore keeps .env.example tracked even after tool edits', () => {
    // A tool (e.g. `vercel link`) may append rules such as `.env*` after `!.env.example`,
    // which re-ignores it. check-ignore evaluates the whole file, so a later line is caught.
    expect(isIgnored('.env.example')).toBe(false);
    // The rules that protect Vercel's pulled secrets must still be in force.
    expect(isIgnored('.env.local')).toBe(true);
    expect(isIgnored('.vercel/project.json')).toBe(true);
  });

  it('.env.example has no non-empty values', () => {
    const entries = read('.env.example')
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));

    expect(entries.length).toBeGreaterThan(0);
    for (const line of entries) {
      expect(line, `"${line}" must be NAME=`).toMatch(/^[A-Z][A-Z0-9_]*=$/);
    }
  });

  it('.env.example lists every variable from PLAN.md section 4, and only public ones use VITE_', () => {
    const names = read('.env.example')
      .split(/\r?\n/)
      .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
      .map((line) => line.split('=')[0]);

    const expected = [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_ANON_KEY',
      'GEMINI_API_KEY',
      'GROQ_API_KEY',
      'LLM_MODEL',
      'LLM_FALLBACK_MODEL',
      'LLM_SECONDARY_MODEL', // P5: the second Groq model in the fallback chain
      'EMBED_MODEL',
      'EMBED_DIM',
      'STT_MODEL',
      'RAG_MIN_SIMILARITY',
      'CHAT_DAILY_CAP',
      'SMTP_USER',
      'SMTP_APP_PASSWORD',
      'CONTACT_TO',
      'TURNSTILE_SECRET_KEY',
      'VITE_TURNSTILE_SITE_KEY',
      'IP_HASH_SALT',
      'CRON_SECRET',
    ];
    expect([...names].sort()).toEqual([...expected].sort());

    // Only these three may be exposed to the browser (PLAN.md section 2.4).
    const browserVars = names.filter((name) => name.startsWith('VITE_')).sort();
    expect(browserVars).toEqual(['VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL', 'VITE_TURNSTILE_SITE_KEY']);
  });
});

describe('C2 HTTP security headers (vercel.json)', () => {
  const config = JSON.parse(read('vercel.json'));
  const rule = config.headers?.find((entry) => entry.source === '/(.*)');
  const headers = Object.fromEntries((rule?.headers ?? []).map((h) => [h.key, h.value]));

  it('deploys to the Mumbai region only', () => {
    expect(config.regions).toEqual(['bom1']);
  });

  it('applies the headers to every route', () => {
    expect(rule).toBeDefined();
  });

  it.each([
    ['Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload'],
    ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['X-Frame-Options', 'DENY'],
    ['Permissions-Policy', 'camera=(), geolocation=(), microphone=(self), payment=(), usb=()'],
  ])('sets %s with the exact required value', (key, value) => {
    expect(headers[key]).toBe(value);
  });
});

describe('C3 supply chain (exact version pinning + install-script policy)', () => {
  const pkg = JSON.parse(read('package.json'));

  it('dependencies and devDependencies use exact versions (no ^ or ~)', () => {
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(all).length).toBeGreaterThan(0);
    for (const [name, version] of Object.entries(all)) {
      expect(version, `${name}@${version} must be an exact x.y.z version`).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('.npmrc keeps exact saves and the strict install-script policy on', () => {
    const npmrc = read('.npmrc');
    expect(npmrc).toMatch(/^save-exact=true$/m);
    expect(npmrc).toMatch(/^strict-allow-scripts=true$/m);
    expect(pkg.allowScripts).toBeDefined();
  });
});
