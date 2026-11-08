# Screenshot shot list

Every step adds its rows here. Save each screenshot under `docs/screenshots/<module>/` and mark the row ✅ when done.

| # | Module/Phase | What to capture | How to reproduce (exact command or URL/page) | Status (⬜/✅) |
|---|---|---|---|---|
| P0-1 | Security | `npm run test:security` output, all tests passing | run `npm run test:security` in the VS Code terminal | ⬜ |
| P0-2 | Deployment | Vercel project dashboard showing the GitHub repo connected and first deployment Ready | vercel.com → web3d-portfolio → Deployments | ⬜ |
| P0-3 | Security | `.gitignore` + `.env.example` (names only, no values) side by side in VS Code | open both files | ⬜ |
| P1-1 | MCP/Security | Blender zip SHA-256 matches blender.org | re-run `Get-FileHash` on the zip (or show the command + output from the log) | ⬜ |
| P1-2 | MCP | Blender N-panel "MCP for Blender": server on port 9876, all integrations unticked | open Blender → N → MCP for Blender | ⬜ |
| P1-3 | MCP | Add-on preferences: telemetry off, all API key fields empty | Blender → Edit → Preferences → Add-ons → MCP for Blender | ⬜ |
| P1-4 | MCP | Claude Code `/mcp` showing "blender" connected | run `/mcp` in Claude Code | ⬜ |
| P1-5 | MCP/Blender | Blender viewport with SpikeCube + SpikeLimb + rig (Material Preview, armature visible) | open `blender/spikes/spike-a.blend` in Blender 5.2.3 | ⬜ |
| P1-6 | MCP/Three.js | `spike-a.html` in the browser showing both animations (cube spinning, limb bending) + info panel (clips Spin/Bend, morph Squash, 1 skinned mesh) | `npm run dev` → http://localhost:5173/spikes/spike-a.html | ⬜ |
| P1-7 | MCP/After Effects | AE bridge panel showing "Ready - Auto-run is ON" | AE 2022 → Window → `mcp-bridge-auto.jsx` | ⬜ |
| P1-8 | MCP/Security | `npm audit --omit=dev` before/after `npm audit fix`: 7 → 2 advisories | re-run `npm audit --omit=dev` in `D:\PROJECTS\tools\after-effects-mcp` (plus the earlier "7" output from your log) | ⬜ |
| P1-9 | MCP | Claude Code `/mcp` showing `blender` + `aftereffects` connected | run `/mcp` in Claude Code (restart it in the repo folder first) | ⬜ |
| P1-10 | MCP/After Effects | AE timeline of SpikeB: layers (Subtitle, Title, AccentLine, BG), keyframes with easing (hourglass icons), Glow on Title, motion blur switches on | open `aftereffects/spikes/spike-b.aep` in AE 2022 → SpikeB → select all layers → press `U` | ⬜ |
| P1-11 | MCP/Video | `spike-b.html` playing the MP4 with the info line "Duration: 5.00 s · Resolution: 1920×1080" | `npm run dev` → http://localhost:5173/spikes/spike-b.html | ⬜ |
| P1-12 | MCP/Video | ffprobe output of `spike-b.mp4` (h264 High, 1920x1080, 30 fps, 5.000 s, yuv420p, bt709) | `ffprobe -v error -show_entries stream=codec_name,profile,width,height,r_frame_rate,pix_fmt,color_space -show_entries format=duration,size -of default=nw=1 aftereffects/renders/spike-b.mp4` | ⬜ |
| P2-1 | Classic UI | Night (dark) desktop shell: aurora background, gradient name, glass profile slot, nav, HUD index, scroll-progress bar (also one shot scrolled to Projects: glass header + active link) | `npm run dev` → http://localhost:5173 at 1440×900, system in dark mode or theme toggle on the moon | ⬜ |
| P2-2 | Classic UI | Day (light) desktop shell, mid circular theme reveal if you can catch it | same page, click the sun/moon toggle (or system light mode) | ⬜ |
| P2-3 | Classic UI | Mobile menu open: full-screen glass, big Syne links, close button | DevTools device toolbar at 390×844 → tap the menu button | ⬜ |
| P2-4 | Classic UI | Custom cursor ring + magnetic "View projects" button with spinning aurora border | desktop, hover "View projects" in the hero (mouse, not touch) | ⬜ |
| P2-5 | Classic UI / Hero | Hero + profile card (night): gradient name, statement line, holographic photo ring with live dot, chips, tilted card with glare, skills marquee below | `npm run dev` → http://localhost:5173, night theme, hover the profile card with the mouse | ⬜ |
| P2-6 | Classic UI / About + Skills | About counters mid-roll and the skills bento (day theme) | day theme → nav "About" (counters roll), then "Skills" (hover a card: spotlight + chip glow) | ⬜ |
| P2-7 | Classic UI / Journey | Journey timeline mid-draw: aurora line part-way down, first nodes lit, alternating cards | nav "Journey", then scroll slowly until the line is between two nodes | ⬜ |
| P2-8 | Classic UI / No-JS | Page with JavaScript disabled showing the pre-rendered content (hero, about, skills, journey all visible) | Chrome DevTools → ⋮ → Run command → "Disable JavaScript" → reload http://localhost:5173 | ⬜ |
| P2-9 | Classic UI / Projects | Projects gallery with a filter active (e.g. AI & RAG + a search term with highlighted matches) and the URL bar showing `?cat=…&q=…` | `npm run dev` → http://localhost:5173/?cat=AI+%26+RAG&q=pipeline#projects (screenshot the whole browser window so the URL bar is visible) | ⬜ |
| P2-10 | Classic UI / Projects | Project modal for APEX with the video player (No audio chip, scrub bar, controls) | open http://localhost:5173/#project-ae-car-edit, press play | ⬜ |
| P2-11 | Classic UI / Achievements | Achievements lightbox showing the Best FYDP photo with its caption | nav "Achievements" → click the award photo | ⬜ |
| P2-12 | Classic UI / Projects | Designed empty search state ("No projects match" + Clear filters) | Projects → type `zzzz` in the search box | ⬜ |
| P2-13 | Classic UI / Intro | First-visit intro sting: "UMER" assembled over the aurora sweep, "ASSOCIATE AI ENGINEER" tagline, **Skip intro (Esc)** button bottom-right | `npm run build` → `npm run preview` → open http://localhost:4173 in a **private window** (fresh storage); screenshot at about 2 s | ⬜ |
| P2-14 | Classic UI / Start screen | Start screen glass card: Mode (Explore the island · "Arrives in P3", Classic portfolio) + Enter with sound / Enter silently. Optional second shot: the returning-visitor card ("Last time: Classic · sound off" + Continue / Change) | private window → press Esc on the intro (first variant); reload the page after entering once (returning variant) | ⬜ |
| P2-15 | Classic UI / Lighthouse | Lighthouse scores, desktop and mobile (four gauges each: Performance, Accessibility, Best Practices, SEO) | open `docs/reports/lighthouse/desktop-dark.report.html` and `mobile-dark.report.html` in Chrome; screenshot the score header of each (light reports sit next to them) | ⬜ |
| P2-16 | Classic UI / Keyboard | Keyboard focus walkthrough, one frame: a visible focus ring on a header nav link after Tab from the start screen | private window → Esc → Enter silently with the keyboard (Tab to it, Enter) → Tab twice → screenshot | ⬜ |
| P2-17 | Avatar / Renders | Avatar v5 renders for the report: turnaround, face expressions and animation poses | existing files: `blender/renders/avatar-v5-turnaround.jpg`, `avatar-v5-faces.jpg`, `avatar-v5-animations.jpg` (no capture needed; insert into the report) | ⬜ |
