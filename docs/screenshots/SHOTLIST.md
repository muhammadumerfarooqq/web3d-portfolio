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
