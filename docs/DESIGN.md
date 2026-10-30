# Art Direction — "PRISM" (v1 · 30-Oct-2026)

> Claude Code: read this file before ANY frontend or 3D step. It overrides the old "Midnight Lab" direction.

## 1. Concept (one sentence, everything protects it)
**Light goes in as raw data — and refracts into everything Umer builds.**
A living glass prism splits light into an aurora of colour. Each section of the site is a different "refraction": AI, 3D, projects, achievements. The avatar stands inside the light.

Rule: colourful **and** premium. Colour lives in light, glass, gradients and particles on a deep base — never in flat UI blocks.

## 2. Palette (tokens)
### Dark — "Aurora Night" (default)
| Token | Value | Use |
|---|---|---|
| --bg | #07060F | page base (deep space violet-black) |
| --surface | #0F0D1E | cards |
| --surface-2 | #17142B | raised panels |
| --glass | rgba(255,255,255,0.06) + backdrop-blur 18px | glass panels |
| --border | rgba(255,255,255,0.10) | hairlines |
| --text | #F3F1FF | primary text |
| --text-muted | #A9A3C7 | secondary text |
| --violet | #7C3AED | aurora 1 |
| --magenta | #FF2E93 | aurora 2 / hot accent |
| --cyan | #22D3EE | aurora 3 / AI accent |
| --mint | #34F5C5 | aurora 4 / success, data |
| --amber | #FFB547 | aurora 5 / awards, highlights |
| --focus | #22D3EE | focus ring |

**Signature gradient** `--aurora: linear-gradient(115deg, #7C3AED 0%, #FF2E93 35%, #FFB547 60%, #34F5C5 80%, #22D3EE 100%)` — used for headline text fills, borders on hover, the progress bar, never as large flat backgrounds.

### Light — "Daylight Prism"
Pearl base #F7F5FF, surface #FFFFFF, text #12101F, muted #514A6E; aurora colours deepened for AA contrast (violet #6D28D9, magenta #D61F78, cyan #0E7490, mint #0F766E, amber #B45309). 3D scene switches to pastel aurora + white fog.

**Contrast rule:** body text ≥ 4.5:1 on its background in both themes (automated test). Gradient text only for display sizes (≥ 32 px) and always with a solid-colour fallback for forced-colors mode.

## 3. Typography (all OFL, self-hosted)
- **Display:** Syne (ExtraBold 800) — huge, tight tracking (-0.04em), gradient fill on key words.
- **Body:** Inter Variable.
- **HUD / labels:** JetBrains Mono, uppercase, +0.12em tracking, 11–13 px ("01 — ABOUT").
- Fluid scale with clamp(); hero headline up to ~9 vw on desktop.

## 4. The three signature moments (protect these; everything else supports them)
1. **Hero — "The Prism Stage."** Avatar (P8) on a glossy reflective stage. Behind: a floating iridescent glass prism (MeshPhysicalMaterial: transmission + iridescence + dispersion) refracting a living aurora shader sky. Cursor = a light source: the prism tilts toward it, chromatic aberration and bloom intensify near the cursor. Headline splits in letter by letter with the aurora gradient.
2. **Scroll journey — "Refraction Particles."** One GPU particle system (GPUComputationRenderer, curl-noise flow) that **morphs into a different shape per section**: prism burst (hero) → neural network (about/AI) → skills constellation, clickable nodes via raycasting (skills) → floating holographic project panels (projects) → trophy/star burst (achievements) → timeline ribbon (experience/education) → globe of light (contact). The camera flies along a spline, driven by scroll (GSAP ScrollTrigger + Lenis, scrubbed).
3. **Projects — "Holographic gallery."** Project cards with WebGL image-distortion hover (RGB-shift + ripple), magnetic tilt, animated aurora borders; opening a project = displacement-shader transition into a detail view (View Transitions API for the DOM part).

## 5. Effects stack (pmndrs `postprocessing`, single EffectComposer)
Bloom (selective, luminance threshold) · Chromatic aberration (cursor-reactive, subtle) · Film grain/noise (2–4%) · Vignette · Depth of field (ULTRA only) · SMAA · AgX tone mapping · colour grading via LUT-style uniforms per section mood.

## 6. Motion language
- Easing: `expo.out` for entrances, `power4.inOut` for camera moves, `elastic.out(1,0.5)` only on micro-interactions.
- Durations: 0.6–1.2 s entrances, 0.25 s hovers. Staggers 0.03–0.06 s per letter/word.
- One animation loop: Lenis driven from `gsap.ticker`, ScrollTrigger updated from Lenis, three.js rendered on the same tick (`lagSmoothing(0)`).
- Section reveals: masked line reveals (GSAP SplitText), counters roll up, HUD labels type on.
- Page-level: preloader ≤ 1.5 s showing real load % (prism assembling), then a "light sweep" into the hero.

## 7. Micro-interactions
Custom cursor (dot + lagging ring, mix-blend difference; hidden on touch), magnetic buttons, hover sheen on glass cards, gradient border spin on focus/hover, scroll progress bar with aurora gradient, section index HUD ("03 / PROJECTS") fixed at the edge, sound toggle (off by default; CC0 ambient + UI ticks, documented in docs/licenses).

## 8. Performance tiers (decided at load with detect-gpu + device memory + reduced-motion)
| Tier | Who | Particles | Post-processing | DPR cap |
|---|---|---|---|---|
| ULTRA | desktop dGPU | 60k | full stack incl. DOF | 2 |
| HIGH | good laptops | 30k | bloom + CA + grain + SMAA | 1.75 |
| LOW | phones / iGPU | 10k | bloom only | 1.5 |
| STATIC | no WebGL, reduced motion, or Save-Data | 0 | none — designed poster image + CSS aurora gradients | — |
- Three.js is **dynamically imported after first paint**; the HTML (all text) renders first → LCP is text, not WebGL.
- Render loop pauses when the tab is hidden or the canvas is off-screen.
- Budgets: initial JS ≤ 200 KB gz (before the 3D chunk); 3D chunk lazy; LCP < 2.5 s; 60 fps on HIGH/ULTRA, ≥ 30 fps on LOW.
- An on-page **"Quality" toggle** (Auto / High / Low / Off) and a **"Pause motion"** button.

## 9. Accessibility (non-negotiable — extra-credit item)
All text is real HTML (never WebGL text for content). `prefers-reduced-motion` → STATIC tier + no Lenis + no reveals. Visible focus everywhere. 3D-only info always duplicated in HTML (e.g. skills list). Custom cursor never hides the system cursor for keyboard users. Contrast tests in CI.

## 10. Section storyboard
| Section | 3D state (particles / camera) | Mood colour | DOM highlights |
|---|---|---|---|
| Hero | prism burst; camera close on stage | violet → magenta | split-letter headline, profile card glass, CTA magnetic |
| About | neural network | cyan | stat counters, aurora quote line |
| Skills | constellation (raycast nodes) | mint | HTML skill chips mirror 3D nodes |
| Projects | holographic panels | magenta | filter/search/sort, distortion hover, detail transition |
| Achievements | trophy / star burst | amber | award photo in glass frame, lightbox |
| Experience & Education | timeline ribbon | violet → cyan | animated vertical timeline |
| Video | particles dim; light cone onto screen | neutral | promo MP4 in a glass "screen" with captions |
| Ask my AI | particles pulse with typing | cyan | chat panel, voice button, citations |
| Contact | globe of light (Karachi pin) | aurora full | form with glass fields, Turnstile |

## 11. Anti-patterns (don't)
Generic template layouts · flat neon on black with no light/material richness · 10 competing effects in one view · loaders longer than 1.5 s · WebGL text for content · animating layout properties (only transform/opacity) · effects on mobile that drop below 30 fps.
