# Promo film: "The Case File of Umer" (P9 storyboard)

**Brief:** Module 3 (Adobe After Effects): a 30–60 s promotional video introducing the student and the portfolio. Name, introduction, skills, projects and achievements; typography, transitions, animation and VFX; properly licensed sound; MP4 embedded in the portfolio; .aep submitted.

**Spec:** 45.0 s · 16:9 · 3840×2160 (UHD 4K) · 24 fps (1080 frames) · score at **96 bpm**, so one beat is 15 frames and one bar is 60 frames (2.5 s). The film is 18 bars, and every cut lands on a beat.
**Deliverables:** `aftereffects/promo.aep`, `aftereffects/promo.jsx` (builds the project), `aftereffects/promo-4k.mp4` (master), `public/media/promo-1080.mp4` (web), poster frame, captions (`.vtt`), `aftereffects/LICENCE-AUDIO.md`.
**No narration.** Typography carries the story. Every fact comes from `/content` (the single source of truth); nothing is invented.

## The one idea
**A railroad line runs through the whole film.** A thin sheriff-gold line with a glowing lantern at its head travels left to right along the lower third. Each chapter is a station it pulls into: `01 OFFICE · 02 WORKSHOP · 03 BOUNTIES · 04 RAILWAY · 05 THE TOWN`. In the Railway chapter the line becomes the hero: big, with years and counters, much like the reference's staircase chart. It ends at the last station: the end card.

## Look
- Day / case file: parchment `#E9DCC0`, poster `#F3E9D2`, ink `#231C15`, rust `#7E2F1A`, sheriff gold `#D9A441` / `#B8862A`, forest `#2F5D46`
- Night / island footage: indigo `#14182E` → `#2A2F5C`, lantern amber `#FFB45A`
- Type: **Rokkitt 900** (headlines), **Ultra** (WANTED and the stamps), **Courier Prime** (typewriter labels and timecode), **Source Serif 4** (small body)
- Texture: paper grain (Fractal Noise), film grain, a subtle gate weave, vignette, and 2.39:1 letterbox bars on the footage shots only
- A persistent thin overlay: corner brackets, chapter counter `CH 01/05`, and a running timecode in Courier Prime

## Motion rules
Hard cuts on the beat. Type **slams** with a 1–2 frame overshoot and a 4 px camera shake on stamp hits. Stamps rotate −4° and thud. Ink-wipe transitions use Turbulent Displace on a linear wipe. On fast cuts: chromatic split for 2 frames and projector flicker. The 3D camera has depth of field on the parchment scenes and motion blur everywhere.

## Beat sheet
| Bars | Time | Scene | Picture | On-screen text (exact) | Sound |
|---|---|---|---|---|---|
| 1–2 | 0.0–5.0 | **Cold open** | Black → projector flicker → **F1** night sea, lighthouse, the lit town; the boat rows in (**F2** close on oars and splash) | `BYTE ISLAND` stamps in (Ultra, cream) · small: `A NEW SHERIFF ARRIVES IN TOWN` (typewriter) | Projector clatter, sea wash, low drone; guitar pickup into bar 3; stamp hit |
| 3–4 | 5.0–10.0 | **01 · The Office (WANTED)** | Ink wipe to parchment. A WANTED poster builds in 3D space: the headshot drops in, lines rule themselves, the camera dollies in | `WANTED` · `MUHAMMAD UMER FAROOQ` · `ASSOCIATE AI ENGINEER · KARACHI` · `I build AI that people actually use, and make it feel alive in 3D.` · stamp `CASE FILE No. 021` | Typewriter keys per letter, paper slides, stamp thud on the beat; whistled melody enters |
| 5–7 | 10.0–17.5 | **02 · The Workshop (skills)** | Kinetic type on parchment, cut every beat against **F3** (blacksmith street, golden hour) | Header `TOOLS OF THE TRADE` then one per beat: `LLMs & RAG` · `COMPUTER VISION` · `PYTHON · FASTAPI` · `THREE.JS` · `BLENDER` · `AFTER EFFECTS` · `REACT · NEXT.JS` · `DOCKER · VERCEL` | Anvil hit on each word (pitched up the scale), tambourine |
| 8–11 | 17.5–27.5 | **03 · The Bounty Board (projects)** | **F4** push-in on the bounty board. Bounty posters fly in, pinned at angles, each with a hard cut; **F5** 4K capture of the Classic projects gallery (filter chips, cards flipping) | `CASES I'VE CLOSED` · `TALEEM360 · REWARD: 1ST OF 70+ TEAMS` · `KNODESK RAG · REWARD: 10+ BUSINESSES` · `SALES PIPELINE · REWARD: 25+ DAILY USERS` · `NED REGULATIONS AI · RECALL@5 = 1.000` · each poster gets a `CASE CLOSED` stamp | A pin tap per poster, a stamp per CASE CLOSED, full band in |
| 12–14 | 27.5–35.0 | **04 · The Railway (journey)** | The gold line goes big across a parchment map; the lantern races between stations, each station dropping in with its year; a counter ticks. Cut to **F6**: the train pulls into Byte Island Station, steam and headlamp | Stations: `AUG 2023 · NED UNIVERSITY · BS CS & IT` → `2ND YEAR · 2ND IN CLASS · GPA 3.83` → `AUG 2026 · AXISERO · ASSOCIATE AI ENGINEER` → `OCT 2026 · BEST FYDP · 1ST OF 70+` | A ratchet tick following the line, a woodblock per station, the train whistle on the cut |
| 15–16 | 35.0–40.0 | **05 · The Town (the portfolio)** | Split screen: left **F9** Classic case file (day), right **F7** horse gallop down the main street (golden hour); then **F8** stars fly to the counter 8/8, fireworks, a giant `CASE CLOSED` stamp | `TWO WAYS IN` · left `CLASSIC · THE CASE FILE` · right `EXPLORE · BYTE ISLAND` · `8/8 STARS` | Hooves, badge chimes on every star, fireworks pops, the deepest hit on CASE CLOSED |
| 17–18 | 40.0–45.0 | **End card** | **F10** slow aerial pull-back of the night island under parchment-ink framing; everything settles | `UMER` (Rokkitt 900, huge) · `MUHAMMAD UMER FAROOQ · AI ENGINEER` · `<LIVE URL>` · `mumerfarooq.ned@gmail.com` · `RIDE TO THE ISLAND →` | Music resolves; a low pad rings out; one last spur jingle; silence on the final frame |

## Footage to capture (Explore capture mode, 3840×2160, 24 fps, frame-perfect)
| ID | Shot | Time | Length |
|---|---|---|---|
| F1 | Low over the sea towards the lit town, lighthouse in frame, boat rowing in | night | 4.0 s |
| F2 | Close on the rowboat: oars pulling, splashes, the sheriff rowing | night | 2.0 s |
| F3 | Slow dolly past the Blacksmith's Workshop with dust | golden hour | 3.0 s |
| F4 | Push-in on the Bounty Board | night | 2.5 s |
| F5 | Classic projects gallery: chip clicks, Flip, a modal opening (browser capture) | day theme | 3.0 s |
| F6 | The train arriving at Byte Island Station | night | 4.0 s |
| F7 | Tracking shot: the sheriff gallops on the horse down the main street | golden hour | 3.0 s |
| F8 | Stars flying to the counter, then fireworks over the town | night | 3.0 s |
| F9 | Classic hero and WANTED poster scroll (browser capture) | day theme | 2.5 s |
| F10 | Slow aerial pull-back over the whole island | night | 5.0 s |

## Score and sound (original, generated by our own code; no third-party audio)
- Score: spaghetti-western in A minor at 96 bpm, 18 bars: twangy plucked guitar (Karplus-Strong) through a spring reverb, a whistled melody, harmonica, kick and tambourine, an anvil on the beats in ch.02, and a low drone in the cold open. The melody is original (it does not imitate any film theme).
- SFX: projector, sea, typewriter, paper, stamp thud, pin tap, anvil, ratchet tick, woodblock, train whistle and chuff, hooves, badge chime, fireworks, spur jingle.
- Rendered offline to 48 kHz 24-bit WAV stems (`music.wav`, `sfx.wav`, `ambience.wav`), imported into AE and mixed with markers on the beat grid. Peak −1 dBTP, loudness about −14 LUFS.

## Render
`aerender` writes a PNG sequence; ffmpeg then makes `promo-4k.mp4` (H.264 High, CRF 16, yuv420p, AAC 320k) and `promo-1080.mp4` (CRF 20, about 10–15 MB, for the web), plus `promo-poster.jpg` and `promo.vtt` captions. AE 2022 cannot write H.264 from the Render Queue; this aerender-plus-ffmpeg pipeline was proven in P1 (Test B).
