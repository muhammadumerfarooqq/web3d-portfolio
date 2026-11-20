# P12-UX progress: cursor, accessibility button, phones, Roman Urdu, repository audit

Resume rule: read this file first and continue from the first item that is not ✅. Status date: 21-Nov-2026. Nothing here is committed; Umer does the git.

| # | Task | Status | Files | Notes |
|---|---|---|---|---|
| 1 | Cursor visible everywhere | ✅ | `public/cursors/arrow.svg`, `public/cursors/pointer.svg`, `src/styles/cursor.css` (imported by `main.css`), `src/explore/explore.css` (reticle), `src/main.js`, deleted `src/ui/cursor.js`, `tests/cursor-p12.test.js`, `tests/p34b.test.js`, `tests/classic-nav.test.js` | Cause: the drawn dot + ring and `cursor: none` on the whole page (vanished behind `<dialog>` overlays, video controls, frames, after Tab or blur). Now the browser draws a 32 px solid arrow / hand with a light outline; native keyword fallback; text fields keep the I-beam; no `data:` URI; CSP unchanged. Only the dev-only capture mode may hide the cursor (guard test). Explore: cursor visible whenever the pointer is not locked, 10 px solid reticle while locked. |
| 2 | Accessibility button into normal layout | ✅ | `index.html` (box moved into `.header-actions`), `src/styles/a11y.css`, `src/ui/a11y-loader.js` (`placeA11y`), `tests/a11y-placement-p12.test.js`, `tests/a11y-menu-p10.test.js` (updated) | Icon button in the Classic header; in Explore the same box moves into `.xp-top__right` on `modechange` (and back). Panel anchored under the button, max-height with inner scroll, bottom sheet below 48rem. Esc, focus return, five switches, Reload now, Reset all, "skip 3D", EN/UR labels unchanged. Not in the Explore chunk. |
| 3 | Mobile responsive, EN and UR | ✅ | `src/styles/main.css` (header, contact, chat, gallery, project cards, touch targets, hero name), `scripts/qa/responsive-check.mjs`, `package.json` (`qa:responsive`), `docs/reports/responsive.md`, `docs/screenshots/p12/responsive/` | Found with the tool (not guessed): header 23 to 50 px wider than a 320 px screen (mobile Chrome zoomed the page out), contact grid grown by the e-mail pill (L250), hero name broke ("MUHAMMA / D"), tilted open project cards, 300 px Turnstile frame and chat form widening the chat, 30 to 41 px controls. All fixed; table in `docs/reports/responsive.md` (36 Classic loads, start dialog, admin sign-in, Explore HUD at 360 / 768 / 1280). Explore keeps its existing touch controls (L263). |
| 4 | Roman Urdu shows Hindi | ✅ | `src/shared/devanagari.js`, `api/transcribe.js`, `api/_lib/stt.js`, `tests/security/p12-voice.test.js` | Roman Urdu prompt (constant, no user data), no forced language, Devanagari → Roman only when Devanagari comes back, screens on the final text, Arabic-script Urdu untouched. Limits, validation, rate limits, privacy rules unchanged. Approximate (L262). |
| 5 | Repository completeness | ✅ | `docs/DOWNLOADS.md`, `docs/report/README.md`, `README.md` ("Repository contents vs assignment") | Audit: public repo, 524 tracked files, largest 19 MB, no forbidden files tracked, `.gitignore` excludes only the 4K film, local footage, stems, `.env*`, `content-inbox/`. Open for Umer: attach the 4K film to a Release, commit the final report PDF (L265). |
| 6 | Budgets | ✅ | n/a | Explore 349.9 KB of 350 KB (unchanged; the reticle edit is size-neutral, nothing else touched the chunk). Classic entry growth fell from 4,479 B to 4,210 B (cursor.js removed, `placeA11y` added). No budget was raised. |
| 7 | Docs | ✅ | `README.md`, `docs/LIMITATIONS.md` (L250 and L173 updated, L258 to L266 added), `docs/VIVA_CHEATSHEET.md` (regenerated), `docs/DESIGN.md`, `docs/screenshots/SHOTLIST.md` (P12-1 to P12-9), this file | |

## Umer's steps

1. Commit and push (commands in the final summary), wait for Ready.
2. Open the live site on a **real phone** (Classic in English and Urdu: menu, accessibility sheet, chat with the keyboard up, contact form) and Explore once (L266, L263).
3. Hover test: move the mouse over buttons, project cards, the video, a project dialog and the Explore canvas; you should always see the dark arrow or hand.
4. Speak "umer kaun hai" into the chat microphone: the text box shows Roman letters.
5. Attach the 4K film (and the 1080p film and the final report PDF) to a GitHub Release: `docs/DOWNLOADS.md`. Commit the report PDF to `docs/report/`.
6. Take the P12-1 to P12-9 screenshots (`docs/screenshots/SHOTLIST.md`).

## Commands

- `npm run build` then `npm run qa:responsive` (real Chrome, ~3.5 minutes, writes `docs/reports/responsive.md` and the screenshots; `--no-explore` skips the Explore HUD, `--only=320,390` limits the widths).
- Build from **PowerShell**: a build from Git Bash leaves the `<!--content:…-->` markers unreplaced in `dist/index.html`.
