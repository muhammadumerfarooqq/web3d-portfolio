# Content — single source of truth

Every file here feeds **two** things:
1. the website sections (rendered from frontmatter + body), and
2. the RAG chatbot index (`scripts/ingest.mjs`, Phase P5).

So: **only true, verifiable facts.** If something isn't true or isn't approved by Umer, it doesn't go here.

## Rules
- Body text is first person ("I built…"). Ingest prefixes each chunk with "Muhammad Umer Farooq —" so the chatbot knows who "I" is.
- Every file and every project has an `anchor` → the site renders `id="<anchor>"` and chatbot citations link to `#<anchor>`.
- Never put a phone number, home address or any private data in this folder.
- Files in UPPERCASE (`README.md`, `OPEN_QUESTIONS.md`) are **not** ingested and **not** rendered.
- `cv/cv.md` is the CV text for the chatbot, already redacted (no phone number, ID numbers or address lines): regenerate it with `pdftotext -enc UTF-8 -layout content-inbox/cv.pdf cv.txt` then `node scripts/rag/cv-redact.mjs cv.txt > content/cv/cv.md`, read it, then `npm run rag:ingest`. The public PDF itself is `public/cv/Muhammad_Umer_Farooq_CV_web.pdf` (never indexed).

## Project frontmatter schema (`projects/<slug>.md`)
| Field | Type | Notes |
|---|---|---|
| slug | string | file name without `.md` |
| title | string | |
| tagline | string | one line |
| anchor | string | `project-<slug>` |
| categories | list | from: `AI & RAG`, `Computer Vision`, `Full-Stack`, `Games & 3D`, `Motion & Video` |
| stack | list | technologies, as shown on the card |
| role | string | what Umer did |
| context | string | `Axisero (work)`, `University`, `Independent` |
| year | number | |
| status | enum | `live`, `completed`, `in-development` |
| featured | bool | featured projects appear first and in the promo video |
| order | number | default order (admin can reorder in P7) |
| links | map | `live`, `repo`, `video`, `dashboard` — empty string = not available |
| images | list | paths under `/images/projects/` |
| highlights | list | 2–4 short result lines with numbers, shown on the card |
| draft | bool | `true` = hidden from the site AND excluded from the chatbot index until completed |

Local media paths (`/video/...`, `/images/...`) point to files in `public/`. Published videos are muted unless the music licence is documented in `docs/licenses/`.
