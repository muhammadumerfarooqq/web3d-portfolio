# P10 (lite) progress: analytics, accessibility menu, captions, Urdu UI

Resume rule: read this file first and continue from the first item that is not ✅.

| Item | Status | Files | Notes |
|---|---|---|---|
| Migration `0006_analytics.sql` | ✅ (Umer runs it) | `supabase/migrations/0006_analytics.sql` | `analytics_daily(day, event CHECK, count)`, `analytics_bump(event, cap)` atomic upsert that stops at the cap; RLS enabled and forced, service role only |
| Event list + collect endpoint | ✅ | `src/shared/analytics-events.js`, `api/collect.js`, `vercel.json`, `scripts/dev-api.mjs` | Nine allow-listed events; POST only, same-origin, 200 bytes, always 204; reads no IP / UA / referrer / cookie; daily cap 5000 per event |
| Client analytics | ✅ | `src/ui/analytics.js`, `src/main.js` (idle dynamic import), `src/ui/chat.js`, `src/ui/contact.js` | sendBeacon, DNT and GPC honoured, localhost skipped, never throws; not in the Explore chunk or the Classic entry |
| Admin Stats tab | ✅ | `api/admin/[...path].js` (route `stats`), `src/admin/main.js`, `src/styles/admin.css` | The ONLY P7 changes: `GET /api/admin/stats` inside the existing catch-all (9 of 12 functions), a text-node table of the last 14 days |
| Accessibility menu | ✅ | `src/ui/a11y-menu.js`, `src/ui/a11y-loader.js`, `src/styles/a11y.css`, `public/theme-init.js`, `index.html`, `src/main.js`, `src/ui/mode.js` | Five switches + Open plain Classic (Explore only) + Reset; `data-a11y-*` on `<html>` set before first paint; Reduce motion keeps Explore from being offered |
| Promo captions | ✅ | `docs/promo/captions.json`, `scripts/promo/build-vtt.mjs`, `public/captions/promo.{en,ur}.vtt`, `scripts/content/gallery.mjs`, `src/styles/main.css` | Two `<track kind="captions">` (English default), transcript in both languages; Urdu flagged "REVIEW NEEDED by native speaker"; `public/media/promo.en.vtt` removed; the film was not re-rendered |
| Urdu UI | ✅ | `src/i18n/{index,apply,translate}.js`, `src/i18n/{en,ur}.json`, `src/ui/lang-loader.js`, `src/ui/motion.js`, `src/ui/menu.js`, `src/styles/main.css`, `index.html` | 187 flat keys; text-match translation (DOM walk, no innerHTML); EN \| اردو toggle; `?lang=ur`; RTL with logical CSS; system fonts only; lazy chunk; nothing in the Explore chunk |
| Privacy note | ✅ | `index.html` (footer `#privacy`), `src/i18n/*.json` | Three plain-language paragraphs, EN + UR; no e-mail address in the HTML |
| Live check + RLS verifier + CSP check + a11y check | ✅ | `scripts/security/live-check.mjs`, `scripts/security/verify-rls.mjs`, `scripts/csp-check.mjs`, `scripts/qa/a11y-check.mjs`, `scripts/security/test-security.mjs` | 9 new live checks (pass with 404 before the deploy); analytics objects probed by the RLS verifier; csp-check opens the menu and switches to Urdu; axe runs 12 modes |
| Tests | ✅ | `tests/security/p10-analytics.test.js`, `tests/i18n-p10.test.js`, `tests/a11y-menu-p10.test.js`, `tests/captions-p10.test.js` + updated `p11-hardening`, `p7-admin`, `p2-exit`, `promo-p95` | Full suite 1126 passed; `npm run test:security` 14 files, 435 tests |
| Docs | ✅ | README ("Extras setup (P10)", log), PLAN (P10 block, tracker), security.md (§1f, T21, C15, scans), SHOTLIST P10-1…P10-15, LIMITATIONS L238–L254, VIVA_SECURITY_DEMO step 10, VIVA_CHEATSHEET (regenerated) | |

## Numbers

- Budgets: Classic entry 81.7 KB gz (+4,479 B over the 79,170 B baseline; allowed +5,120 B); Explore + three.js 349.9 KB of 350 KB (nothing of P10 is in it; margin about 0.1 KB, L247); chat chunk 6.8 KB; analytics chunk about 0.6 KB; accessibility menu about 1 KB; Urdu strings about 4.6 KB and the apply chunk about 4.9 KB gz, all lazy.
- axe-core 4.14: 0 violations in 12 runs (dark, light, reduced motion, each menu mode, High contrast dark and light, all modes, Urdu dark, Urdu light + High contrast). Keyboard pass: 168 Tab stops, chat order input → microphone → Ask intact.
- CSP check: zero violations (Classic with the menu open and in Urdu, the admin page, Explore on WebGPU and WebGL2), no page errors.
- Live check against the deployed site (before this deploy): 110 of 111; the one failure is `/admin` still served without the noindex header by the old deployment (P7 not deployed yet).
- `npm run rls:verify`: all PASS, 7 warnings = the P7 and P10 tables / functions that Umer has not created yet (expected).

## Umer's steps

1. Supabase SQL editor: run `0005_admin.sql` (if not done), then `0006_analytics.sql`; `npm run rls:verify` (no warnings).
2. Deploy; `npm run live:check` (expect all pass).
3. Proofread `src/i18n/ur.json` and `docs/promo/captions.json` (Urdu), then `node scripts/promo/build-vtt.mjs` and commit.
4. Hand-test: language switch on a phone, the accessibility menu with the keyboard only, captions on the promo video, the Stats tab.
5. Screenshots: P10-1 … P10-15 in `docs/screenshots/SHOTLIST.md`.
