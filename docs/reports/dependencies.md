# Dependencies: audit, triage and supply-chain settings (P11 A2)

Run on 19-Nov-2026 with npm 11.16.0, Node 24.18.0, from the repository root.

## Result

| Check | Command | Result |
|---|---|---|
| Production audit | `npm audit --omit=dev` | **0 vulnerabilities** (11 production packages: 10 direct + 1) |
| Full audit (dev tools included) | `npm audit` | **0 vulnerabilities** (248 packages audited: 11 prod, 238 dev, 69 optional) |
| Exact versions | `tests/security/p11-hardening.test.js` | every entry in `dependencies` and `devDependencies` is an exact `x.y.z` (no `^`, `~`, ranges, `latest`, git or URL specs) |
| Lockfile | `git ls-files package-lock.json` | committed (lockfileVersion 3) |
| Install scripts | `.npmrc` | `ignore-scripts=true` (added in P11), `strict-allow-scripts=true`, `save-exact=true`. The only package in the tree with an install script is `fsevents` (an optional macOS file watcher); `package.json` `allowScripts` denies it |
| Licences | `node scripts/security/licences.mjs --write` | see `docs/reports/licences.md` |

## Triage of advisories

There were **no advisories to triage** on this date, so nothing was upgraded and `npm audit fix` (and `--force`) was never run.
History: the first nodemailer pin (8.0.11) was covered by 15 advisories and was replaced in P4 by 10.3.1 (security.md F2).

## Newer versions available (informational, not vulnerabilities)

`npm outdated` shows patch / minor releases for `@tailwindcss/vite` and `tailwindcss` (4.3.5), `gsap` (3.15.1), `nodemailer` (10.6.0), `playwright-core` (1.65.1), `three-mesh-bvh` (0.9.18), `vite` (8.3.8) and `vitest` (5.1.1). They are deliberately not taken now: the audit is clean, every one would change what 742 tests and the visual QA were run against, and the project's rule is "upgrade for a reason (an advisory), with an exact pin, then re-run everything". Planned: re-check right before the final deploy (LIMITATIONS L02, L208).

## Reachability of the runtime packages (what a visitor's request can touch)

| Package | Where | Notes |
|---|---|---|
| `nodemailer` 10.3.1 | `api/contact.js` only (server) | Fixed recipient, no user-controlled addresses (reply-to is validated), no attachments, no URLs fetched |
| `zod` 4.6.7 | shared schema in browser and server | `jitless` so it never uses `new Function` |
| `three`, `three-mesh-bvh`, `gsap`, `lenis`, `@fontsource/*` | browser only | No network input is parsed by them; the models and textures are first-party files |

Nothing in `api/` imports a package that fetches or parses a user-supplied URL or file.

## Supply-chain settings (control C3)

- Exact pins and a committed lockfile mean the code that was tested is the code that builds.
- `ignore-scripts=true`: a compromised dependency cannot run code at install time.
- No CDN, no remote script: the only third-party origin in the CSP is Cloudflare Turnstile.
- No new runtime dependency was added in P4 to P11 beyond nodemailer (P4).

## How to repeat

```powershell
npm audit --omit=dev
npm audit
npm outdated
node scripts/security/licences.mjs
```
