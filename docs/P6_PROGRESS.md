# P6 progress: voice chat + 3 fixes

Resume rule: read this file first and continue from the first item that is not ✅.

| Part | Item | Status | Files | Notes |
|---|---|---|---|---|
| 0 | Baseline test run | ✅ | — | 672/672 before P6 (29 files). |
| F1 | Private-data screen false positives | ✅ | `api/_lib/chat-filter.js`, `api/chat.js`, `src/ui/chat.js`, `tests/security/p6-screen.test.js`, `tests/rag/eval.json`, `scripts/rag/eval.mjs` | Cause: a bare "phone" / "mobile" word list, and `/api/chat` re-screening every earlier user turn for private data (one refused phone request poisoned the next six answers; the browser also carried refused turns into the history). Now: a private-data phrase, or a possessive / request word next to the noun; history screened for injection only; refused turns not remembered by the browser. Regression: 35 harmless + 23 attack prompts (Roman Urdu, Urdu script, English). Eval set 26 questions: **qwen/qwen3.8-27b 19/19 answerable (7 Urdu / Roman Urdu), 7/7 refusals, citations valid, p50 1.6 s / p95 1.9 s, 0 fallbacks.** |
| F2 | TALEEM360 portrait cover | ✅ | `scripts/content/gallery.mjs`, `scripts/content/images.mjs`, `src/styles/main.css`, `src/explore/bounty-posters.js`, `tests/rag-p5a.test.js` | Portrait covers (h > w) are a plain `<img class="project-card__img project-card__img--portrait">` with `object-fit: cover; object-position: 50% 0` in the card and the modal hero; the bounty poster covers its photo box anchored to the top. No wrapper, no backdrop; landscape unchanged. Orientation is still recorded in `images.json`. |
| F3 | Nothing else changes | ✅ | — | Project descriptions untouched. |
| V1 | Migration `0003_voice.sql` | ✅ (Umer runs it) | `supabase/migrations/0003_voice.sql` | `chat_hits.kind` ('chat' / 'stt'), `stt_submit()` 10 per 10 minutes per IP hash + the same daily cap and locks, `chat_submit()` redefined to count only `kind = 'chat'` for its 20-per-10-minutes limit. Service role only. |
| V2 | `POST /api/transcribe` | ✅ | `api/transcribe.js`, `api/_lib/stt.js`, `src/shared/voice-limits.js`, `api/_lib/http.js` (`readBytes`), `api/chat.js` (`STT_MODEL` setting), `vercel.json` (maxDuration 15), `scripts/dev-api.mjs`, `.env` (`STT_MODEL=whisper-large-v3`, never printed) | Groq live /models checked 19-Nov-2026: `whisper-large-v3` and `whisper-large-v3-turbo`; chose large-v3 for Urdu accuracy. Live check with Windows-synthesised English speech through the real handler (rate limiter stubbed): accurate text in 0.3–0.4 s, a spoken injection refused. |
| V3 | Client: microphone, review row, Listen | ✅ | `src/ui/voice.js`, `src/ui/chat.js`, `index.html`, `src/styles/main.css` | State machine with injected dependencies; real Chrome (fake microphone): recording, 0:30 countdown, errors (server, rate limit, denied), text in the input with Send / Discard and 0 chat calls before Send, Listen ↔ Stop with real voices, no CSP violation, no page errors. |
| V4 | Explore sheriff | ✅ (wiring) | `src/explore/index.js`, `src/explore/player.js` (`endTalk()`) | Think while recording / transcribing, Talk while speaking, then Nod, then Idle. Not played in a browser (L204). |
| V5 | Tests | ✅ | `tests/security/p6-voice.test.js` (35), `tests/voice-p6.test.js` (32), `tests/security/p6-screen.test.js` (3) | Full suite 742/742 (32 files). |
| V6 | Build, CSP | ✅ | `scripts/csp-check.mjs` | Chat chunk 6.8 KB gz (was 3.5; lazy), Classic entry unchanged, Explore chunk unchanged. `node scripts/csp-check.mjs`: zero CSP violations (Classic with the microphone recording, Explore on WebGPU and WebGL2 with the Saloon chat). |
| V7 | Docs | ✅ | README (P6 line + "Voice setup (P6)"), PLAN (E3, E4, P6 block, tracker), security.md (§1c, T18, C12, LLM01 / LLM10 notes, F6, F7), SHOTLIST P6-1…P6-13, LIMITATIONS L196–L207 (+ notes on L13, L14) | |

## Umer's manual steps

1. Supabase SQL editor: run `supabase/migrations/0003_voice.sql`.
2. Vercel (Production and Preview): add `STT_MODEL` (`whisper-large-v3`). `GROQ_API_KEY` is the one already there.
3. Redeploy, then live checks: record an English, an Urdu and a Roman Urdu question on desktop and on Android; deny the microphone once; send 11 recordings in 10 minutes (expect the wait message); say "What is Umer's phone number?" and an injection; Listen on an English and an Urdu answer.
