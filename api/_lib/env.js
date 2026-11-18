// Server configuration, read only from process.env (Vercel env vars in production, .env through the
// Vite dev middleware locally). Values are never logged; only which names are missing.

export const CONTACT_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TURNSTILE_SECRET_KEY', 'SMTP_USER', 'SMTP_APP_PASSWORD', 'CONTACT_TO', 'IP_HASH_SALT'];

/** { ok, missing, values } for the given names. A salt shorter than 32 characters counts as missing. */
export function readEnv(names, env = process.env) {
  const values = {};
  const missing = [];
  for (const name of names) {
    const v = typeof env[name] === 'string' ? env[name].trim() : '';
    if (!v || (name === 'IP_HASH_SALT' && v.length < 32)) missing.push(name);
    else values[name] = v;
  }
  return { ok: missing.length === 0, missing, values };
}
