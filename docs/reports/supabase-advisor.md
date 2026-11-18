# Supabase Security Advisor checklist (P11 C2)

**Status: not read by Claude.** The Advisor lives in the Supabase dashboard, which Claude does not open. Below is what Umer opens, and what each result should be, **reasoned from the SQL in `supabase/migrations/` and from `npm run rls:verify` (observed on 19-Nov-2026). None of the "expected" results has been seen in the dashboard.**

## What to open

1. Supabase dashboard → the project → **Advisors** (left menu) → **Security Advisor** → "Rerun linter". Screenshot the list (shot list P11-8).
2. Also open **Performance Advisor** (not required for the exit criterion; for information).
3. **SQL Editor** → paste `supabase/maintenance/audit-rls.sql` and run it (read-only). Compare each result with the "Expected" comment above it.
4. **Authentication → Sign In / Providers**: switch off "Allow new users to sign up" (nothing uses Supabase Auth until P7).
5. Before any of that, run `supabase/migrations/0004_hardening.sql` once (L211), then `npm run rls:verify`.

## Expected Security Advisor results

| Lint | Level | Expected now | Reasoning |
|---|---|---|---|
| RLS Disabled in Public | ERROR | **none** | All five tables have RLS enabled AND forced (checked statically by `p11-hardening.test.js`; catalog query 1 in `audit-rls.sql`) |
| RLS Enabled, No Policy | INFO | **5 findings** (`chat_hits`, `chat_logs`, `chunks`, `contact_messages`, `documents`) | **Intended.** With RLS on and no policy, nobody except the service role (which bypasses RLS) can read or write; the anon key was tested to be denied everywhere. Do NOT "fix" it by adding a policy |
| Function Search Path Mutable | WARN | **none** | Every function has `set search_path` fixed (`''` or `public, extensions, pg_temp`), tested |
| Extension in Public | WARN | **none** | pgvector is installed in the `extensions` schema |
| Security Definer View / Exposed Auth Users / Materialized View in API | ERROR / WARN | **none** | The schema has no views and no materialized views; nothing references `auth.users` |
| Public / Signed-in Users Can Execute SECURITY DEFINER Function | WARN | **`rls_auto_enable` before 0004, none after** | `rls:verify` showed anon could execute this Supabase helper (finding F8). 0004 revokes it. Our own functions are `security invoker` with EXECUTE only for `service_role` |
| Leaked Password Protection Disabled | WARN | **may appear** | Only matters once passwords exist (P7 admin login). Enable it under Authentication → Providers → Email → "Prevent use of leaked passwords" when P7 starts |
| Insufficient MFA Options | WARN | **may appear** | P7 enrolls TOTP MFA for the admin |
| Auth OTP Long Expiry / Auth Allow Anonymous Sign-ins | WARN | **may appear** | Not used; set OTP expiry to 3600 s or less and keep anonymous sign-ins off |
| Auth Users Exposed / FK without index (performance) | — | none / none | No FK to `auth.users`; `chunks.document_id` is indexed |

## What is NOT a finding (so nobody "fixes" it)

- "RLS Enabled, No Policy" on all five tables: it is the design (service-role-only data, server code only).
- Tables with no grants to `anon` / `authenticated`: the point of `revoke all`.
- Performance Advisor "unused index" on the new tables: they hold a few hundred rows.

## Reasoning from the SQL (the part Claude can verify)

- **RLS:** `enable row level security` + `force row level security` on every table; no `create policy` anywhere (tested).
- **Privileges:** `revoke all on table … from public, anon, authenticated` on every table; `grant … to service_role` only; `revoke all on function … from public, anon, authenticated` + `grant execute … to service_role` on `contact_submit`, `chat_submit`, `stt_submit`, `match_chunks` (tested).
- **search_path:** fixed on every function (tested).
- **Default privileges:** after 0004, new tables, functions and sequences created by `postgres` in `public` are private by default.
- **Outside view:** `npm run rls:verify` (anon key vs every table and function, OpenAPI, storage buckets, auth settings): all denied except `rls_auto_enable()` before 0004; the auth settings show signups enabled (L212).
