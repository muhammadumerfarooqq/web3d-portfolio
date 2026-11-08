# Art Direction — "PRISM" v2 · Hybrid Explore + Classic (31-Oct-2026; §7 avatar updated 9-Nov-2026)

> Claude Code: read this file before ANY frontend, 3D, audio or Blender step. v2 supersedes v1 and the old "Midnight Lab".

## 1. Concept
**Light goes in as raw data — and refracts into everything Umer builds.**
A floating aurora island made of light and glass. Umer's AI twin lives on it. Colourful **and** premium: colour lives in light, glass, gradients and particles on a deep base — never in flat UI blocks.

Reference format: explorable character portfolios (e.g. samsy.ninja, Bruno Simon). **Inspired by the format only — no copied layouts, assets, characters or code.**

## 2. Experience architecture (Hybrid)
```
First visit:  Intro sting (8–10 s AE, Skip from 0 s) → Start screen
Start screen: [Enter with sound] [Enter silently]   ·   [Explore the island] [Classic portfolio]
Returning:    intro auto-skipped (remembered), straight to the last chosen mode
Any time:     one HUD button switches Explore ⇄ Classic; same content, same anchors
```
| Mode | What it is | Default for |
|---|---|---|
| **Explore** | Third-person 3D island; you control Umer's avatar; zones = portfolio sections; the avatar is the **AI twin** you can talk to | desktop + capable laptops (ULTRA/HIGH tiers) |
| **Classic** | Fast, scrollable, fully accessible HTML portfolio with premium motion and a 3D prism hero | phones/LOW tier, reduced motion, no WebGL, screen readers, recruiters in a hurry |

Both modes render from `/content` (single source of truth). Every brief section exists in Classic mode, so grading never depends on finding something in the game.

## 3. Palette (tokens)
### Dark — "Aurora Night" (default) / Night on the island
| Token | Value | Use |
|---|---|---|
| --bg | #07060F | base |
| --surface | #0F0D1E | cards |
| --surface-2 | #17142B | raised panels |
| --glass | rgba(255,255,255,0.06) + blur 18px | glass panels |
| --border | rgba(255,255,255,0.10) | hairlines |
| --text | #F3F1FF | text |
| --text-muted | #A9A3C7 | secondary |
| --violet | #7C3AED | aurora 1 |
| --magenta | #FF2E93 | aurora 2 |
| --cyan | #22D3EE | aurora 3 / AI |
| --mint | #34F5C5 | aurora 4 / data |
| --amber | #FFB547 | aurora 5 / awards |
| --focus | #22D3EE | focus ring |
Signature gradient `--aurora: linear-gradient(115deg,#7C3AED 0%,#FF2E93 35%,#FFB547 60%,#34F5C5 80%,#22D3EE 100%)` for display text, borders, progress — never big flat backgrounds.

### Light — "Daylight Prism" / Day on the island
Pearl #F7F5FF, surface #FFFFFF, text #12101F, muted #514A6E; aurora deepened for AA (violet #6D28D9, magenta #D61F78, cyan #0E7490, mint #0F766E, amber #B45309). **The theme toggle = day/night cycle on the island** (sky, sun/moon, fog, light colours animate between states).

Contrast: body text ≥ 4.5:1 in both themes (automated test). Gradient text only ≥ 32 px with solid fallback.

## 4. Typography (OFL, self-hosted)
Display **Syne** 800 (tight −0.04em, gradient on key words) · Body **Inter Variable** · HUD **JetBrains Mono** uppercase +0.12em ("03 — PROJECTS").

## 5. Signature moments (protect these)
1. **Intro → Start.** 8–10 s AE sting (name + light refracting through a prism), Skip button visible from 0 s, captions, auto-skip for returning visitors. Then the start screen (sound + mode choice). The full 45 s promo lives in the island's Cinema and in Classic mode's video section.
2. **Explore: the aurora island.** Third-person control of the AI-twin avatar across a floating island under an aurora sky; giant 3D letters "UMER" at spawn that can be knocked over; zones that glow and open content panels; day/night = theme.
3. **Classic: Prism hero + holographic gallery.** Iridescent glass prism (transmission + iridescence + dispersion) over an aurora shader; cursor acts as a light source; project cards with WebGL distortion hover and shader transitions.
(v1's scroll-driven 60k-particle journey is **cut from Classic** to protect scope; particles live inside Explore zones instead.)

## 6. Explore mode spec
### Zones (each = a brief section; content from /content)
| Zone | 3D landmark | Interaction | Opens |
|---|---|---|---|
| Spawn Plaza | giant "UMER" letters (physics), prism monolith | knock letters, read welcome | Home/profile card |
| AI Twin (anywhere) | the avatar itself | press **T** / click avatar | chat panel + speech bubble |
| Projects Gallery | floating holographic billboards | walk up / **E** | project detail panel |
| Skills Garden | glowing constellation of crystals (particles) | hover/raycast a crystal | skill tooltip + list |
| Awards Tower | spiral tower, trophy, award photo frame | **E** at the frame | achievements panel |
| Timeline Path | path with milestone stones | walk along, **E** | experience & education |
| Cinema | big glass screen + seats | **E** / sit | promo video (spatial audio) |
| Mailbox | glowing post box | **E** | contact form panel |
| About Overlook | cliff bench with view | **E** | about panel |
### Controls & camera
WASD / arrows + Shift run + Space jump · **click-to-move** (raycast on ground) · **E** interact · **T** talk · **M** map/teleport · Esc closes panels · mobile: virtual joystick + tap-to-move + on-screen E/T. Third-person follow camera with smoothing, orbit drag, zoom, wall-collision pull-in.
### Engine
Capsule character vs world collision with **three-mesh-bvh** (no heavy physics engine for the walk); simple rigid-body physics only for the spawn letters (lightweight, e.g. cannon-es or custom). Zones via trigger volumes. Minimap + teleport menu (accessibility and speed). Panels are HTML overlays (CSS2D/DOM), not WebGL text.

## 7. The AI twin (avatar) — style & behaviour
> **Decision record 9-Nov-2026:** replaces the 31-Oct-2026 chibi designer-toy concept.

- **Style:** stylized **animated-film human** (Pixar-inspired, **not** a copy of any studio's style, film or existing character) with Umer's likeness. Realistic-leaning proportions (head ≈ 1/6.5 of height), slightly enlarged head and eyes, soft shapes, clean PBR materials (soft skin, matte wool suit, satin tie).
- **Likeness (blender/AVATAR_BRIEF.md):** slim; long oval face; warm medium-brown skin; black curly/textured hair; light stubble; charcoal suit; no glasses.
- **How it is built:** by Claude (assistant) in a cloud workspace with **Blender 5.2.3 Python (bpy) scripts**, committed under `blender/scripts/`. No Blender MCP, no AI 3D generators, no imported third-party models or base meshes. Reproducible: running the scripts rebuilds `blender/avatar.blend`.
- **Rig:** custom humanoid armature, glTF-compatible.
- **Actions (exported as glTF clips):** Idle, IdleArmsCrossed, Walk, Run, Jump, Wave, Talk, Think, Nod.
- **Shape keys:** Blink, Smile, Mouth_Open.
- **Budget:** `avatar.glb` ≤ 3 MB (Draco + compressed textures), ≤ 40k triangles.
- **Behaviour:** waves when you arrive; turns to face you when talked to; Think loop while the RAG answer loads; Mouth_Open follows TTS audio amplitude (Web Audio analyser); answers in first person ("I built KnoDesk's RAG pipeline…") with source citations in the chat panel.

## 8. Effects stack (pmndrs `postprocessing`, one composer)
Bloom (selective) · Chromatic aberration (subtle) · Film grain 2–4% · Vignette · Depth of field (ULTRA) · SMAA · AgX tone mapping · height fog tinted by theme · stylized materials (soft PBR + rim light; glass/iridescent accents).

## 9. Motion language
`expo.out` entrances, `power4.inOut` camera moves, `elastic.out(1,0.5)` micro only; 0.6–1.2 s entrances, 0.25 s hovers; 0.03–0.06 s staggers. One loop: Lenis on `gsap.ticker`, ScrollTrigger from Lenis, three.js on the same tick (`lagSmoothing(0)`). Masked line reveals (GSAP SplitText), counters, HUD type-on.

## 10. Micro-interactions
Custom cursor (dot + lagging ring, hidden on touch, never hides focus), magnetic buttons, glass sheen hover, spinning aurora borders, aurora progress bar, section HUD index, sound toggle always visible.

## 11. Sound design (all licensed, credited in docs/licenses)
Start choice "Enter with sound / silently" (respects browser autoplay rules). Music bed (ambient synth, looped, −18 LUFS-ish under UI) · footsteps synced to Walk/Run animation events · zone ambiences as THREE.PositionalAudio (cinema, tower wind chimes, garden shimmer) · UI ticks/whooshes · avatar voice = TTS. Global mute + volume; pauses when tab hidden.

## 12. Performance tiers (detect-gpu + deviceMemory + reduced-motion + Save-Data)
| Tier | Default mode | Explore detail | Post-processing | DPR |
|---|---|---|---|---|
| ULTRA | Explore | full props, 40k particles, shadows | full incl. DOF | 2 |
| HIGH | Explore | reduced props, 15k particles, baked shadows | bloom + CA + grain + SMAA | 1.75 |
| LOW (phones/iGPU) | Classic (Explore "lite" opt-in) | minimal props, 4k particles, no shadows | bloom only | 1.5 |
| STATIC | Classic only | — | — | — |
Three.js is dynamically imported after first paint. Render loop pauses when hidden/off-screen. Budgets: initial JS ≤ 200 KB gz; LCP < 2.5 s (Classic); Explore 60 fps on HIGH/ULTRA, ≥ 30 fps on lite; avatar GLB ≤ 3 MB, world GLB ≤ 6 MB (Draco + KTX2 where possible). Quality toggle + Pause motion always available.

## 13. Accessibility
Classic mode is the complete accessible path. Explore: full keyboard control, teleport menu, captions for video/voice, panels are real HTML with focus management, reduced-motion → Classic. Contrast tests in CI.

## 14. Anti-patterns
Cloning reference sites · third-party or brand-lookalike characters · long unskippable intros · loaders > 1.5 s · WebGL text for content · 10 competing effects · animating layout properties · Explore as the only way to reach content.
