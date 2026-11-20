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

# P12-CV progress: the CV on the site and in the chatbot

| # | Task | Status | Files | Notes |
|---|---|---|---|---|
| 1 | CV into `public/cv/` | ✅ | `public/cv/Muhammad_Umer_Farooq_CV_web.pdf` | The filename the code already expected (`CV_PATH` in `scripts/content/plugin.mjs`). Copied from `content-inbox/cv.pdf` (49,779 bytes, untouched) with PyMuPDF: 49,309 bytes, 1 page, metadata reduced to Title and Author (creator "anonymous", producer ReportLab, dates and subject removed; no XMP). The phone number stays in this PDF only (Umer's decision, L267). |
| 2 | Download CV button | ✅ | `scripts/content/render.mjs`, `src/i18n/en.json` + `ur.json` (`cv.download`), `tests/i18n-p10.test.js` | The site code already rendered the button once the PDF exists; it now carries `download`, `type="application/pdf"`, `data-cv-download` (Explore reads it) and `data-event="cv_download"` (allow-listed already; no event added). `btn--sm` = 44 px; the visible text is the accessible name; Urdu label via the dictionary. Explore's Deputy's Commission shows its own Download CV button (English only). `vercel.json` untouched: CSP and headers unchanged. |
| 3 | CV text in the knowledge base | ✅ | `scripts/rag/cv-redact.mjs` (new), `content/cv/cv.md` (new), `scripts/rag/chunk.mjs`, `scripts/rag/ingest.mjs` (message), `tests/rag-p5a.test.js`, `tests/security/p12-cv.test.js` (new) | Phones (every format), ID numbers and address lines are removed; email and public links kept. The chunker redacts again at ingest and its PII guard still refuses a phone. `npm run rag:ingest`: 16 documents, 23 chunks, **3 embedded (the CV)**, 20 unchanged, 0 deleted. |
| 4 | Live check | ✅ | scratchpad script (real `/api/chat` handler against the live knowledge base) | "What is Umer's phone number?", "What is his mobile number? … digits" and "umer ka phone number kya hai?": refused, pointing to the email and the contact form, no digits in any answer. "What did Umer study?": BS Computer Science & IT at NED University, Karachi, from August 2023 (cites Education). "CGPA and where does he study?": 3.65, NED (from the CV). Skills question answered. |
| 5 | Docs | ✅ | `docs/LIMITATIONS.md` (L118 and L241 SOLVED in P12 (P12-CV), L265 text, L267 and L268 added), `README.md`, `content/README.md`, this file | |

Umer's steps for P12-CV: commit and push, wait for Ready, open the live site: the profile card shows **Download CV** (EN and اردو); click it (the PDF downloads; the Stats tab counts `cv_download` after a deploy). The index already has the CV chunks (they live in Supabase), so the chatbot answers from the CV now. Proofread the Urdu label (L268). If you replace the PDF later: regenerate `content/cv/cv.md` (command in `content/README.md`) and run `npm run rag:ingest`.

# P12-UX2 progress: the live Accessibility button

| # | Task | Status | Files | Notes |
|---|---|---|---|---|
| 1 | Reproduce on a production build | ✅ | scratchpad `repro.mjs` | Built the committed tree (HEAD `f524b6b`, old `index.html`) and the working tree to separate folders, served each with `vite preview`, real Chrome at 1280 and 390 px. HEAD: the toggle is `btn btn--sm a11y__toggle` with the text "Accessibility" at (0,0), NOT in the header; a click leaves `aria-expanded="false"`; no console error, no failed request, no CSP violation. Working tree: icon button in the header cluster, panel opens. |
| 2 | Root cause | ✅ | n/a | `index.html` was not committed. The deployed file still had the box at the top of `<body>` (HEAD line 31) while `a11y.css` (box `position: relative`, panel anchored to it) and `a11y-loader.js` were new: the box sat in the flow at the top-left under the fixed header (z-index 50), which took the click. No chunk failed, nothing was blocked, no cache was involved (assets are hashed, HTML is not cached long-term). |
| 3 | Fix | ✅ | `index.html` (already correct in the working tree: it only has to be committed) | No source change was needed. Explore moving the box into the HUD and back is covered by `npm run qa:responsive` (unchanged, passes). |
| 4 | Caching | ✅ | `vercel.json` unchanged | JS and CSS have content hashes; only `/media/*` has a long-term cache rule; HTML keeps Vercel's default revalidating cache. Checked by the new test. No header or CSP weakened. |
| 5 | Test on the BUILT site | ✅ | `tests/a11y-dist-p12.test.js` (10 tests) | Builds for production into a temp folder, serves it, drives real Chrome at 1280 and 390 px: button inside `.site-header .header-actions`, icon only, ≥ 44 px, `elementFromPoint` at its centre is the button, a real click opens the panel inside the viewport, five switches and Reset work, Esc closes and returns focus, Enter and Space open it; plus static checks (one box, in the header, no old markup, hashed assets, cache rule). Run against the old `index.html` it fails (8 of 10). |

Commit rule (added after this): after `git add`, run `git status`; no tracked file may remain under "Changes not staged for commit". `.gitignore` already excludes `.env*`, `content-inbox/`, `aftereffects/promo-4k.mp4`, so `git add .` cannot add a secret.
