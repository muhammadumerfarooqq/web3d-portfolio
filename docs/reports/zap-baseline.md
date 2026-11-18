# OWASP ZAP baseline scan (P11 B3): NOT RUN HERE

Docker is not installed on the development machine, and the rules for P11 forbid installing it or downloading scanner images silently, so this scan was **not run**. Everything ZAP's passive rules look at was checked another way (see "Covered by other checks"), but the report itself still has to be produced by Umer.

## How to run it (passive only: no active attack, no login)

1. Install Docker Desktop from docker.com (official installer) and start it.
2. In PowerShell, from the project folder:

```powershell
New-Item -ItemType Directory -Force docs\reports | Out-Null
docker run --rm -v "${PWD}\docs\reports:/zap/wrk/:rw" -t zaproxy/zap-stable zap-baseline.py -t https://umerfarooq-ai.vercel.app -r zap-baseline.html -J zap-baseline.json -I
```

`zap-baseline.py` is the passive baseline: it spiders the site briefly and applies passive rules only. `-I` makes warnings not fail the run. The reports land in `docs/reports/zap-baseline.html` and `.json`.

3. Open the HTML report, screenshot the summary (shot list P11-9) and note the alert counts in `docs/security.md` section 5.

**Exit criterion from the plan:** 0 high and 0 medium alerts.

## What to expect (reasoned from the headers, NOT observed)

| Alert ZAP may raise | Risk | Why / what to do |
|---|---|---|
| Insufficient Site Isolation Against Spectre Vulnerability (COEP / CORP missing) | Low | Known and accepted (R8, L215): `COEP: require-corp` would block the Cloudflare Turnstile iframe |
| Timestamp Disclosure / Information Disclosure in comments | Info | Build output may contain version-like numbers; check that nothing sensitive is in the flagged text |
| Sub Resource Integrity Attribute Missing | Low | Only for third-party scripts; the single one (Turnstile) is loaded dynamically from Cloudflare and cannot carry a fixed hash, by design |
| `Server` header / `Access-Control-Allow-Origin: *` on static files | Low / Info | Platform defaults (L214, L216), accepted |
| Strict-Transport-Security, CSP, X-Frame-Options, X-Content-Type-Options, Permissions-Policy | none expected | All present (live-check, Observatory A+) |
| Cookies without flags | none expected | The site sets no cookies |

If ZAP reports anything medium or high, add it to `docs/security.md` section 8 as a finding, fix it, and re-run.

## Covered by other checks (done)

Headers and CSP on every page type (`docs/reports/live-check.md`, 77/78 on the pre-P11 deployment), grade A+ 130 (`docs/reports/observatory.md`), no cookies, no information leaks or stack traces in error bodies, no `.env`, `.git`, `package.json` or SQL served, cross-origin and preflight refused, axe for the page (`accessibility.md`).
