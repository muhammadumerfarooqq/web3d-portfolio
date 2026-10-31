# web3d-portfolio

Interactive 3D portfolio for Muhammad Umer Farooq, Associate AI Engineer, built as the semester project for Web 3D Programming. The finished site will combine a Three.js scene with a custom Blender avatar, an After Effects promo video, a RAG-based AI chatbot (with voice and Urdu support), a secure contact form and an admin dashboard. The stack is Vite with vanilla JavaScript, Vercel Functions and Supabase. The full plan is in [docs/PLAN.md](docs/PLAN.md).

## Status

```
Overall  [██░░░░░░░░░░░░░░░░░░]  8%
```

| Phase | Weight | Status |
|---|---|---|
| P0 Setup, accounts & content | 4% | ✅ |
| P1 MCP setup & spikes | 4% | ✅ |
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

A phase counts only when its exit test passes. P0 and P1 are complete (P1: both MCP servers connected, Test A and Test B pass). P2 is next.

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
- **P1 Step 4: Test A (Blender → GLB → Three.js).** Built a test scene in Blender 5.2.3 over MCP: a textured cube (packed 1024 px colour grid, `Squash` shape key, `Spin` action) and a skinned cylinder on a 2-bone rig (`Bend` action), both pushed to NLA. Saved `blender/spikes/spike-a.blend` (resources packed), rendered `blender/renders/spike-a-f01.png` and `spike-a-f30.png`, exported `blender/exports/spike-a.glb` (Draco, 222 KB). Added `three@0.187.0` and the dev-only test page `spikes/spike-a.html` (`npm run dev` → `/spikes/spike-a.html`), which is not a build input and never reaches `dist/`. MCP content telemetry is off (anonymous usage counts remain; see [docs/security.md](docs/security.md)).
- **P1 Step 6: After Effects MCP reviewed, pinned and registered.** `a-y-ibrahim/after-effects-mcp` v1.13.0 (commit `e9ffbed`) is cloned to `D:/PROJECTS/tools/` and was code-reviewed: stdio only, no network calls. It was installed with `npm ci` plus `npm audit fix` (no `--force`; production advisories 7 → 2), and the bridge panel was installed per user with no admin. It is registered in `.mcp.json` next to the unchanged Blender entry. [docs/security.md](docs/security.md) has the new control C5 and a new risk register (R1 to R5: two dependency advisories, the bridge's file-based IPC, the AE scripting preference, and the Blender socket).
- **P1 Step 7: Test B (AE → aerender → ffmpeg → MP4).** Built a 5 s 1920×1080 comp in After Effects 2022 over MCP: a name and title reveal (Arial Bold/Regular) with an accent line, Easy Ease keyframes, Glow and motion blur. Saved `aftereffects/spikes/spike-b.aep` and preview stills `aftereffects/renders/spike-b-{0s,1s,3s}.png`. Rendered with aerender using the Lossless output module (8-bit RGB AVI, 933 MB, git-ignored), then converted with ffmpeg to `aftereffects/renders/spike-b.mp4` (H.264 High, CRF 20, yuv420p, BT.709, faststart, 76 KB). Dev-only test page: `spikes/spike-b.html` (`npm run dev` → `/spikes/spike-b.html`), not part of `dist/`. **P1 complete: both pipeline spikes pass.**
- **P2 Step 1: PRISM foundation + shell.** Classic-mode visual system from [docs/DESIGN.md](docs/DESIGN.md):
  - **Tokens:** design tokens for night and day (`src/styles/tokens.css`).
  - **Styles and fonts:** Tailwind v4 with a `@theme` mapping, plus glass, HUD, aurora-text and aurora-border utilities. Fonts are self-hosted (Syne, Inter, JetBrains Mono).
  - **Background:** a CSS-only aurora with film grain.
  - **Theme:** a day/night toggle with a circular View Transition, and no flash on load (`public/theme-init.js`).
  - **Shell:** header nav, a full-screen mobile menu (focus trap, Esc), a scroll-progress bar and the HUD section index.
  - **Interaction:** custom cursor, magnetic buttons, and Lenis on `gsap.ticker` with SplitText reveals and counters.
  - **Page:** empty section skeletons (`#home` … `#contact`) ready for P2.2 content.
  - **Reduced motion:** turns all motion off.
  - **Security:** control C6 (no inline scripts, zero third-party requests, whitelisted `localStorage`), tested in `tests/security/p2-foundation.test.js`. Contrast is tested in `tests/design-tokens.test.js`.
