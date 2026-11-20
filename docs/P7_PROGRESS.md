# P7 (lite) progress: admin dashboard

Resume rule: read this file first and continue from the first item that is not ✅.

| Item | Status | Files | Notes |
|---|---|---|---|
| Migration `0005_admin.sql` | ✅ (Umer runs it) | `supabase/migrations/0005_admin.sql` | `admins`, `project_order`, `admin_login_hits`, `admin_login_submit()` (5 logins / 10 MFA codes per 10 minutes per IP hash), `project_order_save()` (atomic, validates first), `contact_messages.status` CHECK gains `reading` and `archived` (old values kept). RLS enabled + forced, no policies, service role only. |
| Auth helpers | ✅ | `api/_lib/auth.js` | Supabase Auth over plain fetch (password grant, user, enrol, challenge + verify, logout); `requireAdmin` = Supabase validates the token → `admins` row → `aal2` claim read after validation. |
| Admin API | ✅ | `api/admin/[...path].js` (ONE function), `src/shared/admin-schema.js`, `src/shared/project-order.js`, `src/shared/project-slugs.js` (+ `scripts/content/slugs.mjs`) | login, mfa/enroll, mfa/verify, logout, projects-order GET/POST, messages GET/PATCH. 8 of 12 free-plan functions used. |
| Public order + cron | ✅ | `api/project-order.js`, `api/cron/keepalive.js`, `vercel.json` (functions, cron `17 5 * * *`, `/api/admin/*` no-store + noindex, `/admin` noindex), `public/robots.txt`, `scripts/dev-api.mjs` | `CRON_SECRET` (48 random bytes, base64url) written to `.env` without printing it. |
| Classic gallery | ✅ | `src/ui/projects/gallery.js`, `src/ui/projects/filter.js` | Fetches `/api/project-order`, ranks the cards, Featured sort puts ranked projects first; any failure keeps the built-in order. |
| Admin page | ✅ | `admin/index.html`, `src/admin/main.js`, `src/styles/admin.css`, `src/styles/main.css` (placeholder removed) | Login (Turnstile) → TOTP (QR from Supabase as an SVG data URI + secret + otpauth text) → tabs Case order (drag and drop + Up / Down, announced, focus kept) and Telegrams (four columns, status select). Text nodes only; token in memory; 15-minute idle sign-out. Driven in real Chrome with the API mocked: all flows work, axe 0 violations (one heading-order fix), no CSP violation, nothing in any storage. |
| Live check + RLS verifier | ✅ | `scripts/security/live-check.mjs`, `scripts/security/verify-rls.mjs`, `scripts/csp-check.mjs` | 25 new live checks (admin routes without / with a forged token → 401, cross-origin → 403, login bad body → 400, cron → 401, public order shape, admin page noindex); `rls:verify` covers the new tables (non-`id` keys) and functions, and WARNs when a declared table is missing in the database. |
| Tests | ✅ | `tests/security/p7-admin.test.js` (53), `tests/project-order-p7.test.js` (5), `tests/security/p11-hardening.test.js` (lists updated), `scripts/security/test-security.mjs` | |
| Docs | ✅ | README ("Admin setup (P7)"), PLAN (P7 block, E10, tracker), security.md (§1e, T20, C14, R9, R10, A07, scans row), SHOTLIST P7-1…P7-10, LIMITATIONS L227–L237 (+ L06 SOLVED in P7, notes on L190, L212), VIVA_SECURITY_DEMO step 9, VIVA_CHEATSHEET regenerated | |

## Umer's steps

1. Supabase SQL editor: run `supabase/migrations/0005_admin.sql`; then `npm run rls:verify` (no warnings, all PASS).
2. Supabase → Authentication → Users → Add user (auto-confirm), with the admin email and a long password.
3. SQL editor, with your email (the same statement is at the bottom of 0005 and in the README):
```sql
insert into public.admins (user_id)
select id from auth.users where email = 'YOUR-ADMIN-EMAIL@example.com'
on conflict do nothing;
select a.user_id, u.email from public.admins a join auth.users u on u.id = a.user_id;
```
4. Vercel (Production + Preview): add `CRON_SECRET` (copy from your local `.env`); make sure `VITE_SUPABASE_ANON_KEY` exists. Redeploy.
5. Open `/admin/`, sign in, enrol the authenticator **immediately**, then try: reorder + Save (reload the live site), change a message status.
6. Vercel → Settings → Cron Jobs: check `/api/cron/keepalive`. Run `npm run live:check`.

## P7-fix (20-Nov-2026): TOTP enrolment failed live

- **Symptom:** login 200, then "Could not start the two-step setup"; no log line said why.
- **Cause found:** the exact upstream failure is not known (the handler discarded it). Confirmed in code: it was invisible, because `auth.js` threw a bare `auth enroll <status>` and the handler logged only `server_error`. Best evidence for the trigger: a Supabase refusal of the enrol call (switch off, duplicate friendly name or leftover unverified factors). The new log line shows which.
- **Changed:** `api/_lib/auth.js` (`AuthUpstreamError`, `upstreamReason`, unique name + one retry on `mfa_factor_name_conflict`, defensive QR / secret / uri parsing incl. a raw SVG, `removeFactor` returns its status), `api/admin/[...path].js` (stale unverified factors removed, never a verified one; 502 `enroll_failed` with one of three fixed sentences; logs `<op>_upstream_<status>_<code>`), `src/admin/main.js` (shows the fixed sentence, 429 shows the wait), `api/collect.js` (junk body: bare 204).
- **Tests:** `tests/security/p7-admin.test.js` (+8: headers and body of the enrol call, unique names, stale factors, verified never removed, name-conflict retry, fixed messages with no upstream text, log lines with status and code and no secrets, raw / unsafe SVG), `tests/security/p10-analytics.test.js` (+1: junk body when the runtime parser throws → 204 empty, oversized stays 413).
- **Umer:** deploy; wait 10 minutes (login rate limit); log in ONCE; enrol. If it fails again, the Vercel log line `enroll_upstream_<status>_<code>` names the cause (for example `mfa_totp_enroll_not_enabled`: Supabase → Authentication → Multi-Factor: enable TOTP enrol AND verify).
