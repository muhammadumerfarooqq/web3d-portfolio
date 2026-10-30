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
