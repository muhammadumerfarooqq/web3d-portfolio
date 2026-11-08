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

## Limitations

Every known limitation and issue since P0, with its impact, a plain-English defence and the planned fix, is tracked in [docs/LIMITATIONS.md](docs/LIMITATIONS.md). It is updated after every step; rows are never deleted, and fixed ones are marked `SOLVED in P<n>`.

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
- **P2 Step 2: content pipeline + Hero, About, Skills, Journey.**
  - **Pipeline:** `/content` is rendered into `index.html` at build time (`scripts/content/`). Front matter is plain YAML (core schema; `---js` is rejected and never evaluated) and is checked by strict zod schemas (`src/shared/content-schema.js`). Bodies go through markdown-it with raw HTML off and a link allowlist; every string is escaped. A PII guard fails the build on phone, CNIC or email. Drafts are excluded, and `virtual:content` exports the public JSON.
  - **Sections:** Hero statement + intro, a profile card with a holographic photo ring and 3D tilt + glare, a two-row skills marquee, About bio + rolling stats, a Skills bento with hand-drawn icons, and a Journey timeline whose aurora line draws on scroll. Everything is pre-rendered, so it works with JS off.
  - **Polish:** the day gradient is fixed (OKLCH, new daylight prism stops, no olive band). Experience + Education are merged into `#journey` (anchors `#experience`/`#education` kept), and the sections are renumbered 00–08. The mobile menu is opaque and has a bottom bar. The meta description is generated from `profile.md`.
  - **Tests:** control C7 tests in `tests/security/p2-content.test.js`, plus `tests/content.test.js` and gradient tests.
- **P2 Step 3: projects gallery, achievements, video player; decision record.**
  - **Gallery:** cards are pre-rendered (deterministic generated SVG covers per category), with category chips, a stack listbox, debounced search with highlights, sort, `?cat/stack/q/sort` URL state and a Flip reflow. A native `<dialog>` detail modal morphs from the card cover; `#project-<slug>` deep links open it.
  - **Achievements and video:** the Achievements section has a photo lightbox. A reusable accessible video player is used for APEX (labelled "No audio") and for the promo once it exists. Chat and contact show placeholders.
  - **P2.2 fixes:** the YAML chip split is fixed, with a bracket guard. The hero is compact (whole card visible at 1440×900 and 1366×768). Journey has a sticky year, a rail and one column of cards, with "See project" chips that fail the build if they don't resolve. Social links are generated from `profile.links`.
  - **Security:** control C8 (DOM-sink and URL-state hygiene), tested in `tests/security/p2-gallery.test.js`.
  - **Decision record (9-Nov-2026):** the avatar becomes a stylized animated-film human built from Blender bpy scripts (DESIGN.md §7). The Blender MCP is retired (removed from `.mcp.json`, C4 retired, R5 closed).
  - **New doc:** [docs/LIMITATIONS.md](docs/LIMITATIONS.md).
- **P2 Step 4 (P2 exit): intro, start screen, mode shell, responsive + accessibility pass, Lighthouse.**
  - **Intro (first visit):** a ~6 s CSS/GSAP placeholder sting (aurora sweep, "UMER" assembling letter by letter, the title as tagline). It is replaced automatically by `public/video/intro.mp4` (muted, playsinline) once that file exists. **Skip intro** is visible and focused from 0 s and Esc skips. It plays once (`intro="seen"`) and never under reduced motion. `public/theme-init.js` sets `html[data-boot]` before first paint, so there is no flash of the page.
  - **Start screen:** a glass dialog with the mode (Explore the island: "Arrives in P3", choice saved; Classic portfolio) and Enter with sound / Enter silently (sets the sound preference). Returning visitors get a one-tap **Continue** plus **Change**. It is a labelled modal with a live region, and focus then returns to the top of the page. With JS off there is no intro or start screen.
  - **Mode shell:** `src/ui/mode.js` is the single place that sets `html[data-mode]` and dispatches `modechange` (the P3 hook). It defaults to Classic under reduced motion, without WebGL2 (detected, context released) or with Save-Data.
  - **QA:** headless Chrome at 320, 360, 390, 768, 1024, 1366 and 1440 px in both themes. No horizontal scroll anywhere. The keyboard walkthrough (start → skip link → nav → every control → footer) has visible focus throughout. Semantics: one h1, no heading jumps, landmarks, labelled dialogs.
  - **Lighthouse** (local production build, reports in `docs/reports/lighthouse/`): desktop 99–100, mobile 95–96 for Performance; Accessibility, Best Practices and SEO are 100 in all four runs. Fixes made for it:
    - font preloads (CLS 0.47 → 0);
    - no blur filter on the sweep (mobile TBT 2.9 s → 0.2 s);
    - start-up split into short tasks;
    - a contentful first intro frame (mobile LCP 3.4 s → 1.8 s);
    - `robots.txt`.
  - **Tests and security:** `tests/start.test.js`, `tests/security/p2-exit.test.js` and `tests/assets.test.js` (avatar GLB/.blend). C6 is extended to the `intro` and `mode` keys. `lighthouse@13.6.0` is a dev dependency (exact pin, no install scripts).
- **P2 Step 5: Classic re-skin, "Sheriff of Byte Island" case file.** Supersedes the PRISM look (aurora, glass, Syne) described in the entries above; structure, content, behaviour and security controls are unchanged. Art direction is in [docs/DESIGN.md](docs/DESIGN.md), the reference mockup in `docs/design/classic-casefile-mockup.html`.
  - **Look:** day = high-noon parchment (ink `#231C15`, parchment `#E9DCC0`, poster `#F3E9D2`, rust `#7E2F1A`), night = desert night (`#14100C`, cream text, lantern-gold accents). Hard offset shadows, 2px radii, 2px ink borders, dashed dividers, typewriter labels. No gradients, glass, blur or glow (one soft lantern on the active nav link at night).
  - **Fonts:** Rokkitt (display), Ultra (WANTED), Courier Prime (labels), Source Serif 4 (body); self-hosted `@fontsource/*` packages, exact pins, latin subsets (8 files, about 135 KB). Syne, Inter and JetBrains Mono are removed. The preloads are now Rokkitt 900 and Source Serif 4 400.
  - **Components:** WANTED-poster profile card, ink stat strip, workshop skills cards, bounty-poster project cards (tilt, pin, print-hatched recoloured covers, CASE CLOSED stamp), case-file modal, vault achievements and tacked-photo lightbox, railway Journey, ink-framed player, telegraph placeholders, new intro copy ("A new sheriff arrives in town"). Case-file wording is in labels only.
  - **Behaviour:** the custom cursor ring no longer sits at the top left (it stays hidden, with the native cursor, until the first mouse move; never on touch). Motion is retuned (stamp thud, poster drop-in, short ease-out). The tilt, spotlight and magnetic modules were removed because they fought the hard-shadow hover. Tilt and pins are off for reduced motion and under 480 px.
  - **Checks:** no horizontal scroll at 320, 375, 768, 1280 and 1920 px in both themes; keyboard walkthrough with a visible 3 px focus ring on every control in both themes; contrast tests rewritten for the new palette (all text pairs ≥ 4.5:1, UI lines and focus ring ≥ 3:1). Lighthouse (local production build): desktop 100 / 100 / 100 / 100, mobile 98 / 100 / 100 / 100 (Performance / Accessibility / Best Practices / SEO), reports in `docs/reports/lighthouse/` (they replace the P2.4 ones). JS bundle unchanged at about 78 KB gzipped.
  - **P3 plan updated:** Explore becomes a frontier town of 8 buildings (Sheriff's Office = About, Bounty Board = Projects, Blacksmith = Skills, Railway = Journey, Bank vault = Achievements, Picture House = Promo, Telegraph Office = Contact, Sheriff NPC = RAG chatbot), each with a star badge that turns into a "Case closed" stamp.
