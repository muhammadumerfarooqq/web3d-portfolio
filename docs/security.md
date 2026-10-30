# Security

Security documentation for the web3d-portfolio project. Updated every phase; each new control is added to the register in section 4 together with the test that proves it.

<!-- NOTE: No Content-Security-Policy header yet. It is built in P4/P11, once the Cloudflare Turnstile
     and Supabase origins are known. Adding a guessed CSP now would either break the site or be too loose to mean anything. -->

> **Content-Security-Policy: not set yet.** It will be added in P4/P11 once the Turnstile and Supabase origins are known (see limitations, section 6).

Last updated: P0 Step 4 (project scaffold).

---

## 1. Threat model

| # | Asset | Threat | Planned mitigation | Phase | Status |
|---|---|---|---|---|---|
| T1 | API keys, Supabase service role key, SMTP App Passwords | Committed to git or leaked to the browser bundle | `.gitignore` for `.env*`, `.env.example` names only, `VITE_` prefix only for public values, gitleaks | P0, P4, P11 | Partly done (C1) |
| T2 | Visitor-facing site | Clickjacking, MIME sniffing, downgrade to HTTP, over-broad browser permissions | Security headers in `vercel.json` | P0 | Done (C2) |
| T3 | Build and install on this machine | Malicious or compromised npm package running install scripts | Exact version pinning, strict install-script policy, `npm audit` | P0, P11 | Done (C3), audit in P11 |
| T4 | Contact form and chat | Spam, bots, abuse of free-tier quotas | Turnstile, honeypot, time-trap, rate limits, daily caps | P4, P5 | Planned |
| T5 | Contact form email | Header injection, spam relay | CR/LF stripping, plain-text body, no auto-reply | P4 | Planned |
| T6 | Chatbot | Prompt injection, system prompt leakage, invented personal info | Context-only prompt, relevance gate, output rendered as text, no tools | P5 | Planned |
| T7 | Admin dashboard | Credential stuffing, account takeover, privilege escalation | Email confirmation, signups disabled, TOTP MFA (`aal2`), `admins` table check, Turnstile | P7 | Planned |
| T8 | Database | Anonymous reads of messages, logs, vectors | Row Level Security on every table, server-only service role key | P4 | Planned |
| T9 | Visitor privacy | Storing raw IPs or a phone number | Salted IP hashes, phone never published, CV redacted during ingest | P4, P5 | Planned |

## 2. OWASP Top 10:2025 mapping

| ID | Category | How this project addresses it | Control(s) | Status |
|---|---|---|---|---|
| A01 | Broken Access Control | RLS on every table, admin check on every `/api/admin/*` call | planned | Planned (P4, P7) |
| A02 | Security Misconfiguration | Security headers, no real `.env` in the repo, region pinned | C1, C2 | Partly done (CSP pending) |
| A03 | Software Supply Chain Failures | Exact pins, strict install-script policy, `npm audit`, gitleaks | C3 | Partly done (audit in P11) |
| A04 | Cryptographic Failures | Secrets kept out of source and out of the browser bundle, HSTS, salted IP hashes | C1, C2 | Partly done |
| A05 | Injection | Shared zod validation, parameterized SQL functions, header-injection guard | planned | Planned (P4, P5) |
| A06 | Insecure Design | Threat model (section 1), no visitor accounts, least-privilege keys | this document | Ongoing |
| A07 | Authentication Failures | Email confirmation, MFA, signups disabled, Turnstile | planned | Planned (P7) |
| A08 | Software or Data Integrity Failures | Lockfile committed, exact versions | C3 | Partly done |
| A09 | Security Logging and Alerting Failures | Event log and rate-limit table, no PII in logs | planned | Planned (P4, P10) |
| A10 | Mishandling of Exceptional Conditions | Generic error responses, no stack traces | planned | Planned (P4) |

## 3. OWASP Top 10 for LLM Applications mapping

| ID | Category | Planned handling | Status |
|---|---|---|---|
| LLM01 | Prompt Injection | User text treated as data, no tools or writes reachable from the prompt | Planned (P5) |
| LLM02 | Sensitive Information Disclosure | Phone redacted at ingest, only public content indexed | Planned (P5) |
| LLM03 | Supply Chain | Pinned npm dependencies (C3); model and provider choices documented | Partly done (C3) |
| LLM04 | Data and Model Poisoning | Knowledge base comes only from the owner's `/content` and CV | Planned (P5) |
| LLM05 | Improper Output Handling | Answers rendered as text, never as HTML | Planned (P5) |
| LLM06 | Excessive Agency | Chatbot has no tools and no write access | Planned (P5) |
| LLM07 | System Prompt Leakage | System prompt never echoed, no secrets in prompts | Planned (P5) |
| LLM08 | Vector and Embedding Weaknesses | No anon access to `chunks`, fixed-parameter `match_chunks` function | Planned (P4, P5) |
| LLM09 | Misinformation | Relevance gate, context-only prompt, citations, refusal test set | Planned (P5) |
| LLM10 | Unbounded Consumption | Rate limits, token caps, daily global cap | Planned (P5) |

## 4. Controls register

Only controls that exist in the repository today are listed. Every row has a test in `tests/security/`.

| ID | Control | OWASP Top 10:2025 | Where | Test (`tests/security/p0-baseline.test.js`) | Added |
|---|---|---|---|---|---|
| C1 | **Secrets management.** `.env` and `.env.*` are git-ignored (only `.env.example` is tracked); `.env.example` contains names with empty values and explains that only `VITE_` variables reach the browser. No secret is stored in the repo. | A02 Security Misconfiguration, A04 Cryptographic Failures (key management) | [`.gitignore`](../.gitignore), [`.env.example`](../.env.example) | `.gitignore ignores .env and .env.local but not .env.example`; `.gitignore keeps .env.example tracked even after tool edits` (regression for F1); `.env.example has no non-empty values`; `.env.example lists every variable from PLAN.md section 4, and only public ones use VITE_` | P0 Step 4 |
| C2 | **HTTP security headers** on every route: HSTS (2 years, preload), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy` (camera, geolocation, payment, USB off; microphone allowed for this origin only, for voice chat). Deploy region pinned to `bom1`. | A02 Security Misconfiguration | [`vercel.json`](../vercel.json) | `deploys to the Mumbai region only`; `applies the headers to every route`; one `sets <header> with the exact required value` test per header | P0 Step 4 |
| C3 | **Supply chain.** Exact dependency versions (`save-exact=true`, no `^` or `~`). Strict install-script policy: `strict-allow-scripts=true` plus an `allowScripts` list in `package.json`, so any dependency that wants to run an install script makes the install fail until the script is reviewed and approved by hand. The list currently contains one explicit denial: `fsevents` (a macOS-only optional dependency of Vite; its install script is never run). | A03 Software Supply Chain Failures (also A08 Software or Data Integrity Failures) | [`package.json`](../package.json), [`.npmrc`](../.npmrc) | `dependencies and devDependencies use exact versions (no ^ or ~)`; `.npmrc keeps exact saves and the strict install-script policy on` | P0 Step 4 |

## 5. Scans

| Scan | Tool | When | Result |
|---|---|---|---|
| Dependency vulnerabilities | `npm audit` | Every install; formally in P11 (no high/critical allowed) | `found 0 vulnerabilities` at P0 Step 4 |
| Secret scan | gitleaks over full history | P11 (and before the first public push) | Not run yet |
| Security headers | Browser DevTools / securityheaders.com on the live URL | P11 | Not run yet |
| Accessibility | axe | P10 | Not run yet |

## 6. Limitations

- **No Content-Security-Policy yet.** It is built in P4/P11 when the Turnstile and Supabase origins are known. Until then the site is protected against framing, sniffing and downgrade, but not against injected scripts. The site currently has no user-supplied content and no scripts of substance.
- **Strict install-script policy only protects the install step.** It does not make a pinned package trustworthy; it only stops it from running code during install without review. A compromised pinned version would still run when imported.
- **`allowScripts` and `strict-allow-scripts` need a recent npm** (this project was set up with npm 11.16). Older npm versions ignore them. `engines.node >= 24` is the guard.
- **HSTS `preload`** is declared, but the domain is only on the browser preload list if it is submitted separately. Do not submit a `*.vercel.app` hostname.
- **Tests check configuration, not behaviour on the live site.** Live header verification happens in P11.
- Admin, database and chatbot controls do not exist yet (see sections 1 to 3).

## 7. Findings / incidents log

Things that went wrong or nearly did, how they were detected and how they were fixed.

| ID | Date | Finding | Detected by | Fix | Lesson |
|---|---|---|---|---|---|
| F1 | 30-Oct-2026 | During `vercel link`, the Vercel CLI appended `.vercel` and `.env*` to `.gitignore`. The `.env*` line came after `!.env.example`, so it overrode the exception and `.env.example` became ignored (it could no longer be committed). | Control C1 check (`git check-ignore --no-index`), run by `tests/security/p0-baseline.test.js` | Reverted `.gitignore` to the committed version. The existing rules `.env.*` and `.vercel/` already cover `.env.local` (which holds `VERCEL_OIDC_TOKEN`) and `.vercel/`. A regression test was added: `.gitignore keeps .env.example tracked even after tool edits`. | Tools can silently change security configuration; the automated test caught it. |

## 8. Plain-English explainer

- **Secrets.** Passwords and API keys live in a file called `.env` that git is told to ignore, so it can never be uploaded by accident. `.env.example` is a fill-in-the-blanks form with the names of the secrets but none of the values. Anything starting with `VITE_` is deliberately public (it ends up in the website's code), so only harmless values get that prefix.
- **Security headers.** These are instructions the server sends to the visitor's browser: always use HTTPS, do not guess file types, do not let other sites put this page inside a frame, share only the minimum in the referrer, and only allow the microphone on this site (needed for voice chat later).
- **Supply chain.** Our site is built from code written by other people (npm packages). A malicious update could steal data when installed. We reduce the risk by fixing exact versions, so nothing changes without us noticing, and by refusing to let packages run install-time scripts until a human has reviewed them.
