# P11 progress: security, QA and production hardening

Resume rule: read this file first and continue from the first item that is not ✅.

| Part | Item | Status | Files / reports | Result |
|---|---|---|---|---|
| 0 | Baseline run | ✅ | — | 2 of 742 failed at the start: two tests assumed the TALEEM360 cover was portrait; Umer replaced it with a wide cover (commit 09c7d32). Tests fixed (`tests/rag-p5a.test.js`); 742/742. |
| A1 | Secret scan: tree + full history | ✅ | `scripts/security/scan-secrets.mjs` (`npm run scan:secrets`) | 299 files, 32 commits, 125,009 added lines: **0 findings**; 0 forbidden files in history; `.gitignore` covers `.env*`, `content-inbox/`, `promo-4k.mp4`, `*.pem`. gitleaks not installed, not run (L209). |
| A2 | `npm audit`, pins, `.npmrc`, lockfile | ✅ | `docs/reports/dependencies.md`, `.npmrc` | 0 vulnerabilities (prod and dev); exact versions; lockfile committed; `ignore-scripts=true` added. |
| A3 | Licences and assets | ✅ | `scripts/security/licences.mjs`, `docs/reports/licences.md` | 10 runtime packages, all permissive except GSAP (no-charge licence, reviewed); assets original or licensed. |
| B1 | Live black-box check | ✅ | `scripts/security/live-check.mjs` (`npm run live:check`), `docs/reports/live-check.md` | 77 of 78 on the pre-P11 deployment; the one failure (canonical link) is fixed locally, not deployed yet. |
| B2 | Observatory | ✅ | `docs/reports/observatory.md` | **A+ (130)**, 12 of 12. |
| B3 | ZAP baseline | ⏳ Umer | `docs/reports/zap-baseline.md` | No Docker here; exact command written (L210). |
| C1 | Anon key vs every table and function | ✅ | `scripts/security/verify-rls.mjs` (`npm run rls:verify`) | 31 of 32 PASS; FAIL: anon can execute `rls_auto_enable()` (F8). Signups enabled (L212). |
| C2 | Advisor checklist | ✅ (doc) / ⏳ Umer (dashboard) | `docs/reports/supabase-advisor.md`, `supabase/maintenance/audit-rls.sql` | Expected results reasoned from the SQL; nothing seen in the dashboard. |
| C3 | No raw IP / audio; retention; purge SQL | ✅ | `supabase/maintenance/purge.sql`, security.md §1d, `supabase/migrations/0004_hardening.sql` | Schema test: only salted hashes, no bytea; purge is manual (L217). 0004 must be run by Umer (L211). |
| D1 | Review of `api/` and `api/_lib/` | ✅ | security.md F8–F14, `tests/security/p11-hardening.test.js` | Fixed: voice body read before the session check (F9), no crash guard (F10). Checked and clean: SSRF, ReDoS (13 hostile strings), prototype pollution, constant-time compare, timeouts, no retry loops, cost paths, error bodies. Not fixed (accepted / Umer): token endpoints unlimited (L213). |
| D2 | Front-end review | ✅ | `p11-hardening.test.js` | No sinks / eval / inline handlers / `javascript:`; every `target=_blank` has `rel="noopener noreferrer"`; storage is whitelisted prefs only; URLs carry only filter state. |
| D3 | CSP check | ✅ | `scripts/csp-check.mjs` | Zero violations (Classic with the microphone, Explore WebGPU + WebGL2). |
| E1 | Accessibility | ✅ | `scripts/qa/a11y-check.mjs`, `docs/reports/accessibility.md` | axe found 3 real problems (F11), fixed; now 0 violations in dark, light, reduced motion; keyboard pass clean. No screen reader (L219). |
| E2 | Lighthouse | ✅ | `docs/reports/lighthouse.md` | Ran this time: live desktop 100 / 100 / 100 / 100, mobile 97 / 100 / 100 / 100. |
| E3 | Performance budget | ✅ | `scripts/qa/budget.mjs`, `docs/reports/performance-budget.md` | Classic entry +1.8 KB (budget 5); Explore 349.7 KB of 350 (L218); first visit 406 KB; Classic never loads Explore. |
| E4 | Links, anchors, SEO | ✅ | `index.html`, `public/robots.txt`, `public/sitemap.xml`, tests | All hrefs, aria references and 17 chat source anchors resolve; canonical + absolute og + sitemap added (F12). |
| F1 | `npm run test:security` | ✅ | `scripts/security/test-security.mjs` | 12 files, 350 tests, one summary. Full suite 792. |
| F2 | Evidence pack | ✅ | `docs/security.md` (T19, C13, §1d, §5, F8–F14, R6–R8, plain-English) | |
| F3 | Viva demo script | ✅ | `docs/VIVA_SECURITY_DEMO.md` | Steps 1–4 and 8 run for the expected output; 5–7 need Umer and the live site. |
| F4 | Viva cheat sheet | ✅ | `docs/VIVA_CHEATSHEET.md`, `scripts/security/viva-cheatsheet.mjs` | Regenerate after any LIMITATIONS change. |

## Umer's steps

1. Supabase SQL editor: run `supabase/migrations/0004_hardening.sql`; then `npm run rls:verify` (all PASS); open Advisors → Security; turn off email signups.
2. Vercel: Firewall rate-limit rule on `/api/*`; redeploy; `npm run live:check` (expect 78/78).
3. `npm run scan:secrets`; optionally gitleaks; the ZAP Docker command.
4. Screenshots P11-1 … P11-13 into `docs/screenshots/p11/`.
5. Rehearse `docs/VIVA_SECURITY_DEMO.md`.
6. Still pending from P5 and P6: the live chat and voice checks (L186, L196, L197).
