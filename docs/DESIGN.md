# Art Direction — "Sheriff of Byte Island" · Hybrid Explore + Classic (re-skin of 9-Nov-2026, P2.5)

> Claude Code: read this file before ANY frontend, 3D, audio or Blender step. It replaces the "PRISM" aurora/glass direction (v1/v2) and the old "Midnight Lab". Reference mockup for the Classic look: `docs/design/classic-casefile-mockup.html`.

## 1. Concept
**A sheriff arrives on Byte Island and files the cases he has closed.**
Umer is the new sheriff of a small frontier town on a floating island. Every brief section is a building in that town (Explore mode) and a page in his case file (Classic mode). The look is **printed paper and ink**, not light and glass: parchment, wanted posters, rubber stamps, typewriter labels, hard shadows. Warm, tactile, confident, and quick to read.

Reference format: explorable character portfolios (e.g. samsy.ninja, Bruno Simon). **Inspired by the format only. No copied layouts, assets, characters or code.** Western imagery here is generic (posters, stamps, star badge, railway); no existing film, game or brand is referenced.

## 2. Experience architecture (Hybrid)
```
First visit:  Intro "A new sheriff arrives in town" (placeholder sting now, AE intro.mp4 later, Skip from 0 s) → Start screen
Start screen: [Enter with sound] [Enter silently]   ·   [Explore the island] [Classic portfolio]
Returning:    intro skipped (remembered), one-tap "Continue" (or "Change")
Any time:     one header button switches Explore ⇄ Classic (src/ui/mode.js); same content, same anchors
```
| Mode | What it is | Default for |
|---|---|---|
| **Explore** = the frontier town | Third-person 3D island town of 8 buildings; you walk Umer's avatar between them; the Sheriff NPC is the RAG chatbot | desktop + capable laptops (ULTRA/HIGH tiers) |
| **Classic** = the case file | Fast, scrollable, fully accessible HTML portfolio: header masthead, WANTED poster, bounty board, railway timeline | phones/LOW tier, reduced motion, no WebGL, Save-Data, screen readers, recruiters in a hurry |

Both modes render from `/content` (single source of truth). Every brief section exists in Classic mode, so grading never depends on finding something in the town. Case-file wording appears **in labels only** (eyebrows, stamps, button captions); headings, nav names and all real content keep their plain words.

## 3. Tokens (`src/styles/tokens.css`)
### Day: "High noon" parchment
| Token | Value | Use |
|---|---|---|
| --bg | #E9DCC0 | parchment page |
| --surface | #F3E9D2 | poster paper (cards, buttons, dialogs) |
| --surface-2 | #E0CFA9 | recessed paper |
| --text / --ink | #231C15 | text, rules, borders |
| --text-muted | #5A4A38 | secondary text (≥ 5.5:1 everywhere) |
| --rust / --accent-text | #7E2F1A | accent, links, stamps, eyebrows |
| --brass | #B8862A | decoration only (bars, shadows, marks); never text on paper |
| --forest | #2F5D46 | status ("Live", "Available") |
| --dusk, --clay | #3B4F6B, #8A5A2B | secondary hues for categories and railway stations |
| --focus | #7E2F1A | focus ring |

### Night: "Desert night"
| Token | Value | Use |
|---|---|---|
| --bg | #14100C | warm dark |
| --surface / --surface-2 | #1E1812 / #2A2118 | poster / recessed paper |
| --text, --ink | #F1E6CE, #D9C9A6 | cream text; cream rules and borders |
| --text-muted | #BDAE90 | secondary |
| --accent-text | #D9A441 | lantern gold (labels, active nav) |
| --rust / --rust-text | #D9785A / #E08A6E | secondary accent |
| --brass, --forest, --dusk, --clay | #D9A441, #6FB48F, #8FA6C9, #C99A63 | brighter so each reads on dark |
| --focus | #F3C566 | focus ring |
The only soft glow in the whole system is `--lantern`, night only, on the active nav link.

### Shape, shadow, rhythm
- **Radii 2px.** Borders 2px ink (`--rule`); dividers dashed 2px.
- **Hard offset shadows, no blur:** `--shadow-hard 8px 9px 0`, `--shadow-mid 5px 6px 0`, `--shadow-sm 3px 3px 0`, gold `4px 4px 0` for primary buttons. Hover lifts (`translate(-2px,-2px)`, bigger shadow); press sinks.
- 4px spacing scale; fluid type scale (display 52–128 px, Rokkitt is condensed).
- **Contrast:** every text pair used by a component is ≥ 4.5:1 in both themes, UI lines and focus ring ≥ 3:1 (`tests/design-tokens.test.js`). No gradient text, no glass, no blur, no aurora.

## 4. Typography (OFL, self-hosted via `@fontsource`, latin subsets only)
| Role | Font | Weights |
|---|---|---|
| Display (h1–h3, numbers, nav of the menu) | **Rokkitt**, uppercase, tight | 500 / 800 / 900 |
| Poster face (WANTED only; intro word is Rokkitt) | **Ultra** | 400 |
| Typewriter (labels, nav, chips, buttons, meta) | **Courier Prime**, uppercase +0.08–0.16em | 400 / 700 |
| Body | **Source Serif 4** | 400 / 600 |
Eight font files (~135 KB). Rokkitt 900 and Source Serif 4 400 are preloaded from the bundle (`scripts/font-preload.mjs`).

## 5. Components (Classic)
- **Masthead:** star badge + UMER, typewriter nav with a rust underline, "Explore island" button, sound/theme icons; a 2px ink rule appears when scrolled.
- **Eyebrows (typewriter, rust):** "Case file No. 021 · Byte Island Sheriff's Dept.", "01 · The sheriff's office", "03 · The bounty board", "04 · The vault", "05 · The railway", "06 · The picture house", "07 · Question the sheriff", "08 · The telegraph office".
- **WANTED poster = profile card:** tilted 1.6°, pin dot, Ultra "WANTED", sepia headshot, name, role, chips, languages, dashed footer ("Last seen / Status"), stamp "REMOTE · ON-SITE" on the photo corner.
- **Ink stat strip:** About numbers on an ink panel in brass Rokkitt; the skills ticker is an ink tape.
- **Skills = workshop:** paper cards with an 8px hue bar.
- **Projects = bounty board:** filter chips ("bounty type"), bounty-poster cards (tilted −1.1°/0.8°/−0.5°, pin, print-hatched cover, status "Live/Completed", dashed footer, CASE CLOSED stamp on completed ones). The modal is an opened case file ("Case file · opened").
- **Achievements = vault:** paper cards, sepia photo, lightbox as a tacked photograph.
- **Journey = railway:** two ink rails with sleepers, rust "travelled" stretch, square station signs, outlined year, paper cards.
- **Promo video = picture house:** ink-framed player with a rust play stamp.
- **Contact / chat = telegraph / question the sheriff:** dashed placeholder forms.
- **Start screen / intro:** a notice pinned on parchment; intro "UMER" drops in letter by letter after a rust ink-band wipe: "A new sheriff arrives in town".
- **Tilt/pin** are off for `prefers-reduced-motion` and under 480 px. Focus ring: 3px solid, offset 3px, visible on every control in both themes.

## 6. Explore mode spec: the frontier town (P3)
The island is a small frontier town of **8 buildings**, one per section. Each building carries a **star badge**; once its content has been opened the badge turns into a **"Case closed"** stamp.
| Building | Section | Interaction | Opens |
|---|---|---|---|
| **Sheriff's Office** | About (+ profile) | **E** at the door | About panel |
| **Bounty Board** | Projects | walk up / **E**; posters pinned on the board | project detail panel (case file) |
| **Blacksmith** | Skills | hover/raycast anvil, tools | skills list |
| **Railway** (station + track) | Journey (education, experience) | walk the track, stops = stations | timeline panel |
| **Bank vault** | Achievements | **E** at the vault door | achievements panel (photo frame, certificates) |
| **Picture House** | Promo video | **E** / sit | promo video (spatial audio) |
| **Telegraph Office** | Contact | **E** at the counter | contact form panel |
| **Sheriff NPC** | RAG chatbot ("Question the sheriff") | press **T** / click | chat panel + speech bubble, cited answers |
Spawn: the town square with giant "UMER" letters (physics, lightweight). Day/night = the theme toggle (sky, lanterns, window lights).

### Controls & camera
WASD / arrows + Shift run + Space jump · **click-to-move** (raycast on ground) · **E** interact · **T** talk · **M** map/teleport · Esc closes panels · mobile: virtual joystick + tap-to-move + on-screen E/T. Third-person follow camera with smoothing, orbit drag, zoom, wall-collision pull-in.

### Engine
Capsule character vs world collision with **three-mesh-bvh** (no heavy physics engine for the walk); simple rigid-body physics only for the spawn letters. Zones via trigger volumes. Minimap + teleport menu (accessibility and speed). Panels are HTML overlays (CSS2D/DOM) styled as Classic paper panels, not WebGL text. Look: stylized, warm, flat-shaded wood and paper textures; no neon, no glass.

## 7. The AI twin (avatar) — style & behaviour
> **Decision record 9-Nov-2026:** replaces the 31-Oct-2026 chibi designer-toy concept. Unchanged by the P2.5 re-skin.

- **Style:** stylized **animated-film human** (Pixar-inspired, **not** a copy of any studio's style, film or existing character) with Umer's likeness. Realistic-leaning proportions (head ≈ 1/6.5 of height), slightly enlarged head and eyes, soft shapes, clean PBR materials (soft skin, matte wool suit, satin tie).
- **Likeness (blender/AVATAR_BRIEF.md):** slim; long oval face; warm medium-brown skin; black curly/textured hair; light stubble; charcoal suit; no glasses.
- **How it is built:** by Claude (assistant) in a cloud workspace with **Blender 5.2.3 Python (bpy) scripts**, committed under `blender/scripts/`. No Blender MCP, no AI 3D generators, no imported third-party models or base meshes. Reproducible: running the scripts rebuilds `blender/avatar.blend`.
- **Rig:** custom humanoid armature, glTF-compatible.
- **Actions (exported as glTF clips):** Idle, IdleArmsCrossed, Walk, Run, Jump, Wave, Talk, Think, Nod.
- **Shape keys:** Blink, Smile, Mouth_Open.
- **Budget:** `avatar.glb` ≤ 3 MB (Draco + compressed textures), ≤ 40k triangles.
- **Behaviour:** waves when you arrive; turns to face you when talked to; Think loop while the RAG answer loads; Mouth_Open follows TTS audio amplitude; answers in first person with source citations in the chat panel.
- **Sheriff NPC (P3/P8 option):** the chatbot character in town can be this twin with a star badge (and optionally a hat) added as a P8 accessory. Not built yet; the avatar files are untouched.

## 8. Effects stack (Explore, P3)
Restrained: soft shadows, warm fog tinted by theme, subtle film grain, vignette, light bloom on lanterns at night only, SMAA, AgX tone mapping. No chromatic aberration, no neon bloom, no glass or iridescence.

## 9. Motion language
Short and weighted, like paper and rubber stamps: **`power3/expo.out` entrances 0.3–0.6 s, hovers 0.15 s**, a small **thud** (`back.out` / `cubic-bezier(0.34,1.4,0.64,1)`) when something lands (intro letters, dialog drop-in, station signs). Poster drop-in = 18 px down + 1.2° → rest. Only `transform` and `opacity` animate. One loop: Lenis on `gsap.ticker`, ScrollTrigger from Lenis, three.js on the same tick (`lagSmoothing(0)`). Masked line reveals (GSAP SplitText), counters, label type-on. Everything respects `prefers-reduced-motion` (no reveals, no tilt, no marquee, no pins).

## 10. Micro-interactions
Custom cursor (rust dot + ink ring; **appears only after the first real mouse move**, never on touch, never hides focus), hard-shadow button lift/press, nav underline slide, chips fill with ink on hover, sound toggle always visible. No magnetic pull, no spotlight, no tilt, no spinning borders.

## 11. Sound design (all licensed, credited in docs/licenses)
Start choice "Enter with sound / silently" (respects browser autoplay rules). Music bed (acoustic/ambient, looped, under UI) · footsteps on boards/dust synced to Walk/Run events · building ambiences as THREE.PositionalAudio (train, telegraph clicks, wind) · stamp thud and paper UI sounds · avatar voice = TTS. Global mute + volume; pauses when tab hidden.

## 12. Performance tiers (detect-gpu + deviceMemory + reduced-motion + Save-Data)
| Tier | Default mode | Explore detail | Post-processing | DPR |
|---|---|---|---|---|
| ULTRA | Explore | full props, shadows | full | 2 |
| HIGH | Explore | reduced props, baked shadows | bloom + grain + SMAA | 1.75 |
| LOW (phones/iGPU) | Classic (Explore "lite" opt-in) | minimal props, no shadows | none | 1.5 |
| STATIC | Classic only | — | — | — |
Three.js is dynamically imported after first paint. Render loop pauses when hidden/off-screen. Budgets: initial JS ≤ 200 KB gz (Classic today ≈ 78 KB); LCP < 2.5 s (Classic); Explore 60 fps on HIGH/ULTRA, ≥ 30 fps on lite; avatar GLB ≤ 3 MB, world GLB ≤ 6 MB. Quality toggle + Pause motion always available.

## 13. Accessibility
Classic mode is the complete accessible path. Explore: full keyboard control, teleport menu, captions for video/voice, panels are real HTML with focus management, reduced-motion → Classic. Contrast tests in CI (`tests/design-tokens.test.js`). Decorative stamps, pins and the intro are `aria-hidden`; eyebrow wording never replaces a real heading.

## 14. Anti-patterns
Cloning reference sites · third-party or brand-lookalike characters · long unskippable intros · loaders > 1.5 s · WebGL text for content · neon glow, glass or gradient text (the old PRISM look) · case-file jokes that hide real information · animating layout properties · Explore as the only way to reach content.
