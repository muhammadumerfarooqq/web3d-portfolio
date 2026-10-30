# web3d-portfolio

Interactive 3D portfolio for Muhammad Umer Farooq, Associate AI Engineer, built as the semester project for Web 3D Programming. The finished site will combine a Three.js scene with a custom Blender avatar, an After Effects promo video, a RAG-based AI chatbot (with voice and Urdu support), a secure contact form and an admin dashboard. The stack is Vite with vanilla JavaScript, Vercel Functions and Supabase. The full plan is in [docs/PLAN.md](docs/PLAN.md).

## Status

```
Overall  [█░░░░░░░░░░░░░░░░░░░]  4%
```

| Phase | Weight | Status |
|---|---|---|
| P0 Setup, accounts & content | 4% | ✅ |
| P1 MCP setup & spikes | 4% | ⬜ |
| P2 Frontend structure & sections | 11% | ⬜ |
| P3 3D scene & interactions | 11% | ⬜ |
| P4 Supabase + contact & email | 10% | ⬜ |
| P5 RAG chatbot | 13% | ⬜ |
| P6 Voice chat | 4% | ⬜ |
| P7 Admin dashboard & secure login | 8% | ⬜ |
| P8 Blender avatar | 12% | ⬜ |
| P9 After Effects video | 9% | ⬜ |
| P10 Analytics, a11y audit & polish | 4% | ⬜ |
| P11 Security, QA & production | 4% | ⬜ |
| P12 Documentation & submission | 6% | ⬜ |
| **Total** | **100%** | |

A phase counts only when its exit test passes. P0 is complete (tag `p0-done`). P1 is in progress (Blender MCP registered; the pipeline spikes are still open).

## Prerequisites

- Node.js 24 or newer
- npm 11 or newer (the install-script policy in `.npmrc` needs a recent npm)
- git

## Setup

```powershell
npm install        # install dependencies
npm run dev        # start the dev server (portfolio at /, admin placeholder at /admin/)
npm run build      # production build into dist/
npm test           # run all tests (Vitest)
```

`npm run test:security` runs only the security tests in `tests/security/`.

## Environment variables

Copy `.env.example` to `.env` and fill in the values. **Never commit `.env`**: it is git-ignored. `.env.example` lists every variable by name, with empty values. Only variables prefixed with `VITE_` reach the browser, so they must be safe to make public. Nothing needs to be set for the current placeholder site.

## Security

Threat model, OWASP mappings, the controls register and known limitations are in [docs/security.md](docs/security.md).

## Progress log

- **P0 Step 4: project scaffold.** Vite multi-page project (`/` and `/admin/`), `vercel.json` (region `bom1` plus security headers; no CSP yet), `.gitignore`, `.env.example`, `.npmrc` (exact versions and strict install-script policy; `fsevents` install script explicitly denied), folder skeleton from the plan, `docs/security.md` and the first security tests (`tests/security/p0-baseline.test.js`). Dev dependencies: Vite and Vitest only.
- **P0 Step 5a: Vercel project linked + GitHub connected (auto-deploy on push).**
- **P0 Step 5b: `.gitattributes` + security finding F1.** LF line endings in the repo (CRLF kept for `.ps1`/`.bat`, binaries marked). Finding F1 (the Vercel CLI added `.env*` to `.gitignore` and re-ignored `.env.example`) is logged in [docs/security.md](docs/security.md) with a regression test. Screenshot checklist started in [docs/screenshots/SHOTLIST.md](docs/screenshots/SHOTLIST.md).
- **P0 complete (tag `p0-done`).** Scaffold, deployment, `.gitattributes`, security finding F1 and the portfolio content are done. Overall progress is 4%.
- **P1 Step 3: Blender MCP registered.** `.mcp.json` registers the Blender server pinned to `mcp-for-blender@2.2.6` (no secrets, no `env` values). Control C4 (local MCP tooling) is in [docs/security.md](docs/security.md), with tests in `tests/security/p1-mcp.test.js`. The add-on socket is localhost-only but unauthenticated, so the server is started only while working. Telemetry is disabled in the next step. The After Effects server comes later.
