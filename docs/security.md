# Security

Security documentation for the web3d-portfolio project. Updated every phase; each new control is added to the register in section 4 together with the test that proves it.

<!-- NOTE: No Content-Security-Policy header yet. It is built in P4/P11, once the Cloudflare Turnstile
     and Supabase origins are known. Adding a guessed CSP now would either break the site or be too loose to mean anything. -->

> **Content-Security-Policy: not set yet.** It will be added in P4/P11 once the Turnstile and Supabase origins are known (see limitations, section 6).

Last updated: P1 Step 6 (After Effects MCP registered).

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
| T10 | Developer machine (Blender MCP) | Another local process or a compromised MCP package sending commands to the Blender socket; telemetry or third-party services reaching out | Pinned package and verified binary, localhost-only socket, firewall denied, integrations off, telemetry content collection disabled, server run only while working, spike pages dev-only | P1 | Done (C4) on 30-Oct-2026; anonymous usage counts remain (see limitations); unauthenticated socket accepted as R5 |
| T11 | Developer machine (After Effects MCP) | A compromised server build or dependency; another local process writing commands into the bridge's IPC file; AE scripts using file/network access | Commit-pinned and code-reviewed server, lockfile install, `npm audit fix`, stdio only (no network listener), per-user install without admin, bridge and AE preference on only while working | P1 | Done (C5) on 30-Oct-2026; residual risks accepted as R1 to R4 |

## 2. OWASP Top 10:2025 mapping

| ID | Category | How this project addresses it | Control(s) | Status |
|---|---|---|---|---|
| A01 | Broken Access Control | RLS on every table, admin check on every `/api/admin/*` call; local MCP tooling reachable only from this machine (localhost socket, stdio) | C4, C5 (local tooling); app controls planned | Local tooling done; app planned (P4, P7) |
| A02 | Security Misconfiguration | Security headers, no real `.env` in the repo, region pinned; MCP integrations and telemetry off, per-user tool installs without admin | C1, C2, C4, C5 | Partly done (CSP pending) |
| A03 | Software Supply Chain Failures | Exact pins, strict install-script policy, `npm audit`, gitleaks; MCP servers pinned (version or commit), hash-verified Blender, code-reviewed AE server | C3, C4, C5 | Partly done (audit in P11; R1, R2 accepted) |
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

| ID | Control | OWASP Top 10:2025 | Where | Test (in `tests/security/`: C1 to C3 in `p0-baseline.test.js`, C4 and C5 in `p1-mcp.test.js`) | Added |
|---|---|---|---|---|---|
| C1 | **Secrets management.** `.env` and `.env.*` are git-ignored (only `.env.example` is tracked); `.env.example` contains names with empty values and explains that only `VITE_` variables reach the browser. No secret is stored in the repo. | A02 Security Misconfiguration, A04 Cryptographic Failures (key management) | [`.gitignore`](../.gitignore), [`.env.example`](../.env.example) | `.gitignore ignores .env and .env.local but not .env.example`; `.gitignore keeps .env.example tracked even after tool edits` (regression for F1); `.env.example has no non-empty values`; `.env.example lists every variable from PLAN.md section 4, and only public ones use VITE_` | P0 Step 4 |
| C2 | **HTTP security headers** on every route: HSTS (2 years, preload), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy` (camera, geolocation, payment, USB off; microphone allowed for this origin only, for voice chat). Deploy region pinned to `bom1`. | A02 Security Misconfiguration | [`vercel.json`](../vercel.json) | `deploys to the Mumbai region only`; `applies the headers to every route`; one `sets <header> with the exact required value` test per header | P0 Step 4 |
| C3 | **Supply chain.** Exact dependency versions (`save-exact=true`, no `^` or `~`). Strict install-script policy: `strict-allow-scripts=true` plus an `allowScripts` list in `package.json`, so any dependency that wants to run an install script makes the install fail until the script is reviewed and approved by hand. The list currently contains one explicit denial: `fsevents` (a macOS-only optional dependency of Vite; its install script is never run). | A03 Software Supply Chain Failures (also A08 Software or Data Integrity Failures) | [`package.json`](../package.json), [`.npmrc`](../.npmrc) | `dependencies and devDependencies use exact versions (no ^ or ~)`; `.npmrc keeps exact saves and the strict install-script policy on` | P0 Step 4 |
| C4 | **Local MCP tooling (Blender).** Claude Code talks to Blender through the `mcp-for-blender` server. (1) The server package is pinned to an exact version, `mcp-for-blender@2.2.6`, in a project-scoped `.mcp.json` that holds no secrets and no `env` values. (2) The Blender binary (5.2.3 LTS, portable, `D:\blender\blender-5.2.3-windows-x64\`) was checked against blender.org: zip SHA-256 `723F08A4401502561EB763CDEACF8745B31E5F3F154D287D3830D97CF75DC2FB`. (3) The Blender add-on "MCP for Blender" 1.8 (from the PyPI package 2.2.6) listens on `localhost:9876` only (verified in its source: `host='localhost'`), so it is not reachable from other machines. (4) The socket has no authentication, so any local process can use it while the server runs (accepted risk R5, section 7). (5) Windows Firewall access for Blender is denied. (6) All optional integrations are off and have no API keys: Poly Haven, Sketchfab, Poly Pizza, Hyper3D Rodin, Hunyuan3D, Tripo, Meshy. (7) Telemetry: the add-on's "Allow Telemetry" setting is off, and on 30-Oct-2026 the MCP tool `disable_telemetry` was called before any other tool. It returned: "Data collection is now OFF. Prompts, code, screenshots and scene data are no longer collected. Minimal anonymous usage counts (tool name, success, duration) still apply". So content collection is off; anonymous usage counts cannot be turned off from the tool (see limitations). (8) Only four tools are used: `disable_telemetry`, `get_scene_info`, `execute_blender_code`, `look`. `generate_3d`, `search_assets` and `import_asset` are never called, so nothing is sent to third-party asset or AI services. (9) Spike test pages (`spikes/`) are dev-only: they are not `vite.config.js` inputs, so they and the Blender exports they load never reach the production build (verified at P1 Step 4: `dist/` has no `spikes/` folder and no `.glb`). | A03 Software Supply Chain Failures (pinned package, hash-verified binary), A02 Security Misconfiguration (integrations and telemetry off, firewall denied), A01 Broken Access Control (localhost-only socket) | [`.mcp.json`](../.mcp.json); Blender add-on preferences and firewall (outside the repo) | `is valid JSON with a mcpServers object`; `contains no env values and nothing that looks like a secret`; `pins every uvx/npx package to an exact version (name@x.y.z)`; `registers the Blender server pinned to mcp-for-blender@2.2.6`; `keeps the Blender entry exactly as registered in P1 Step 3`; `the pin checker rejects unpinned or range specs`; `vite.config.js build inputs do not include anything under spikes/`. Items 2, 3, 5, 6, 7 and 8 live outside the repo and were verified by hand (screenshots P1-1 to P1-3 in `docs/screenshots/SHOTLIST.md`). | P1 Step 3 |
| C5 | **Local MCP tooling (After Effects).** Claude Code talks to After Effects 2022 (22.6) through `a-y-ibrahim/after-effects-mcp`. (1) **Pinned source:** cloned from github.com/a-y-ibrahim/after-effects-mcp to `D:/PROJECTS/tools/after-effects-mcp`, at commit `e9ffbed9f675a3ac31a4295c83abfd1fb4a7b3f5` (16-Aug-2026), package v1.13.0, MIT licence. `.mcp.json` runs that clone's `build/index.js` with `node` and nothing else (no `env` block, no secrets). (2) **Code review** (Claude chat, 30-Oct-2026; the transport, network and process points were re-checked by grep of `src/` and `build/` in Claude Code the same day): the server uses `StdioServerTransport` only, so there is no HTTP server and no listening port; there are no outbound network calls; `child_process` spawns `aerender` for background renders and also `ffmpeg` (a `-version` probe and audio conversion to WAV in the temp folder; path from `AE_FFMPEG_PATH` or `PATH`), always with an argument array and never with a shell. (3) **Bridge:** file-based IPC in `%LOCALAPPDATA%\ae-mcp-bridge` (`ae_command.json`) polled by a ScriptUI panel. The panel evaluates the ExtendScript it receives, and the `execute-script` tool runs arbitrary ExtendScript by design (see upstream `SECURITY.md`). The panel makes no `system.callSystem` or other shell calls. (4) **Install:** `npm ci` (exact lockfile, which also builds `build/`), then `npm audit fix` **without** `--force`. Production advisories went from 7 to 2. The two that remain are accepted as R1 (`@modelcontextprotocol/sdk` 1.9.0) and R2 (`zod` 3.25.76). The remaining "moderate" items are upstream's own `vitest` devDependencies, which we never run. `npm audit fix` rewrote the clone's `package-lock.json` locally, so the installed dependency tree is the pinned commit plus those local fixes. (5) **Per-user install, no admin:** `npm run install-bridge` copied the panel to `%APPDATA%\Adobe\After Effects\22.6\Scripts\ScriptUI Panels\mcp-bridge-auto.jsx`. Nothing was written to Program Files. (6) **AE preference** "Allow Scripts to Write Files and Access Network" is enabled because the panel needs it (accepted risk R4). The panel shows "Ready - Auto-run is ON". | A03 Software Supply Chain Failures (commit pin, lockfile install, code review, audit), A02 Security Misconfiguration (per-user install, no admin), A01 Broken Access Control (stdio only, no network listener) | [`.mcp.json`](../.mcp.json); `D:/PROJECTS/tools/after-effects-mcp` and AE preferences (outside the repo) | `runs node with exactly one arg: the reviewed build under D:/PROJECTS/tools/`; `contains no env values and nothing that looks like a secret` (scans every entry, including `aftereffects`); `keeps the Blender entry exactly as registered in P1 Step 3`. Everything except the `.mcp.json` entry lives outside the repo. It was verified by hand and by read-only checks on 30-Oct-2026 (commit hash, version, licence, transports, spawn calls, `npm audit --omit=dev`, panel path); evidence screenshots P1-7 to P1-9. | P1 Step 6 |

## 5. Scans

| Scan | Tool | When | Result |
|---|---|---|---|
| Dependency vulnerabilities | `npm audit` | Every install; formally in P11 (no high/critical allowed) | `found 0 vulnerabilities` at P0 Step 4; still 0 after adding `three@0.187.0` at P1 Step 4 |
| Dependency vulnerabilities, After Effects MCP server (production deps) | `npm audit --omit=dev` in `D:/PROJECTS/tools/after-effects-mcp` | P1 Step 6, and again on any server update | 7 → 2 after `npm audit fix` (no `--force`). Re-checked 30-Oct-2026: 2 high (`@modelcontextprotocol/sdk` ≤1.31.0, `zod` <4.6.6), both accepted as R1 and R2 |
| Secret scan | gitleaks over full history | P11 (and before the first public push) | Not run yet |
| Security headers | Browser DevTools / securityheaders.com on the live URL | P11 | Not run yet |
| Accessibility | axe | P10 | Not run yet |

## 6. Limitations

- **No Content-Security-Policy yet.** It is built in P4/P11 when the Turnstile and Supabase origins are known. Until then the site is protected against framing, sniffing and downgrade, but not against injected scripts. The site currently has no user-supplied content and no scripts of substance.
- **Strict install-script policy only protects the install step.** It does not make a pinned package trustworthy; it only stops it from running code during install without review. A compromised pinned version would still run when imported.
- **`allowScripts` and `strict-allow-scripts` need a recent npm** (this project was set up with npm 11.16). Older npm versions ignore them. `engines.node >= 24` is the guard.
- **HSTS `preload`** is declared, but the domain is only on the browser preload list if it is submitted separately. Do not submit a `*.vercel.app` hostname.
- **Tests check configuration, not behaviour on the live site.** Live header verification happens in P11.
- **The Blender MCP socket is unauthenticated.** Moved to the risk register as **R5** (section 7).
- **The After Effects server path in `.mcp.json` is machine-specific** (`D:/PROJECTS/tools/...`). On another machine the server simply fails to start; it is a local authoring tool, not part of the site. The commit pin lives in the clone, not in this repo, so after any `git pull` in the clone the review and audit must be repeated before use.
- **`.mcp.json` pins the server package, not its dependencies, and the add-on is installed separately.** `uvx` fetches `mcp-for-blender@2.2.6` from PyPI without hash checking, and the add-on inside Blender was installed by hand from the same version. They are not tied together by the repo; if one is upgraded the other should be too.
- **Blender MCP telemetry is not fully off.** `disable_telemetry` stops collection of prompts, code, screenshots and scene data, but the server still sends minimal anonymous usage counts (tool name, success, duration). The tool cannot turn these off. They contain no project content. Removing them entirely would mean blocking the server's outbound traffic at the firewall, which has not been done.
- **The dev server exposes more than production.** `npm run dev` serves any file under the repo (including `blender/exports/` and `node_modules/`) to `localhost`, which is how spike pages load their models. It binds to localhost only (no `--host`), and none of this is in `dist/`.
- Admin, database and chatbot controls do not exist yet (see sections 1 to 3).

## 7. Accepted risks (risk register)

Known risks we have decided to live with for now, why, what reduces them, and what would make us look again.

| ID | Risk | Why accepted | Compensating controls | Review trigger |
|---|---|---|---|---|
| R1 | **`@modelcontextprotocol/sdk` 1.9.0** in the After Effects MCP server (vulnerable range ≤1.31.0). Advisories: DNS rebinding protection off by default (GHSA-w48q-cv73-mx4w), HTTP client transports and OAuth re-sending headers on cross-origin redirects (GHSA-6prh-2h8m-c8cw), one HTTP request exhausting server memory (GHSA-46jr-4wx8-v453), server bearer auth accepting tokens for another service (GHSA-rvq5-wwqv-78pq), and a ReDoS (GHSA-8r9q-7v3j-jr4g). | Four of the five are specific to HTTP/SSE transports, OAuth or bearer auth. This server uses `StdioServerTransport` only, so it has no HTTP endpoint, no OAuth and no bearer auth. The ReDoS is not transport-specific, but its only input source is Claude Code on this machine over stdio; the worst case is a hung local server that Claude Code restarts. Upstream documents that the patched SDK breaks its build. | Commit pin and code review (C5); stdio only, no listener; server runs only while working on the video; Claude Code's approval prompt on every MCP tool call. | Upstream releases a buildable patched SDK; the server is ever exposed over HTTP/SSE; a new advisory affects the stdio transport. |
| R2 | **`zod` 3.25.76** in the same server (vulnerable <4.6.6): memory exhaustion while validating oversized constrained collections (GHSA-mrhx-c7xc-m3w5). | The fix is zod 4, a semver-major change that `npm audit fix` without `--force` does not apply and that upstream has not adopted. Tool input only arrives from the local, trusted MCP client (Claude Code); the worst case is a local server crash. | Same as R1. | Upstream moves to zod ≥4.6.6; the server ever accepts input from anything other than the local MCP client. |
| R3 | **File-based IPC can be used by any local process.** Anything running as Umer can write `%LOCALAPPDATA%\ae-mcp-bridge\ae_command.json`, and the bridge panel will execute it as ExtendScript inside After Effects. | It is how the bridge works: AE 2022 has no other automation channel this server can use. A process already running as Umer could do most things Umer can anyway, but this adds a path into AE (and through R4, file and network access from AE). | Bridge panel open only while working; close the panel (or AE) afterwards; no untrusted scripts or projects opened in AE; Claude Code approval on `execute-script` and every other tool call. | Upstream adds authentication or a per-session token to the bridge; the machine gets other users; the bridge ever moves to a network transport. |
| R4 | **The AE preference "Allow Scripts to Write Files and Access Network"** widens what *any* script run in After Effects can do, not only the MCP panel. | The bridge panel needs it to read and write its IPC files. | Turn the preference off after each video session; only the reviewed `mcp-bridge-auto.jsx` panel is installed; no untrusted `.jsx`, `.jsxbin` or `.aep` opened while it is on. | The preference has to stay on permanently; any other third-party script or panel is installed. |
| R5 | **The Blender MCP socket is unauthenticated** on `localhost:9876` (from C4). While the add-on's server runs, any local process can connect, and the add-on executes Python inside Blender, so such a process could run code as this Windows user. The localhost binding and the firewall rule only block other machines. | The add-on has no authentication option, and the MCP workflow needs the socket. | Start the Blender server only while working on the avatar and stop it afterwards; Claude Code approval prompts on every MCP tool call; no untrusted `.blend` files or add-ons opened while it runs. | Upstream adds authentication; the socket is ever bound to anything other than localhost; the machine gets other users. |

## 8. Findings / incidents log

Things that went wrong or nearly did, how they were detected and how they were fixed.

| ID | Date | Finding | Detected by | Fix | Lesson |
|---|---|---|---|---|---|
| F1 | 30-Oct-2026 | During `vercel link`, the Vercel CLI appended `.vercel` and `.env*` to `.gitignore`. The `.env*` line came after `!.env.example`, so it overrode the exception and `.env.example` became ignored (it could no longer be committed). | Control C1 check (`git check-ignore --no-index`), run by `tests/security/p0-baseline.test.js` | Reverted `.gitignore` to the committed version. The existing rules `.env.*` and `.vercel/` already cover `.env.local` (which holds `VERCEL_OIDC_TOKEN`) and `.vercel/`. A regression test was added: `.gitignore keeps .env.example tracked even after tool edits`. | Tools can silently change security configuration; the automated test caught it. |

## 9. Plain-English explainer

- **Secrets.** Passwords and API keys live in a file called `.env` that git is told to ignore, so it can never be uploaded by accident. `.env.example` is a fill-in-the-blanks form with the names of the secrets but none of the values. Anything starting with `VITE_` is deliberately public (it ends up in the website's code), so only harmless values get that prefix.
- **Security headers.** These are instructions the server sends to the visitor's browser: always use HTTPS, do not guess file types, do not let other sites put this page inside a frame, share only the minimum in the referrer, and only allow the microphone on this site (needed for voice chat later).
- **Supply chain.** Our site is built from code written by other people (npm packages). A malicious update could steal data when installed. We reduce the risk by fixing exact versions, so nothing changes without us noticing, and by refusing to let packages run install-time scripts until a human has reviewed them.
- **AI tools on the development computer (Blender and After Effects MCP).** Claude Code can drive Blender and After Effects through small helper programs. Each helper is pinned to an exact version we reviewed, and neither one can be reached from the network. The weak spot is that other programs on the same computer could talk to them too, so we switch them on only while working and off afterwards. The risks we knowingly accepted, and why, are listed in the risk register (section 7).
