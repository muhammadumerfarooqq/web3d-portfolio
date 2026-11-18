# Performance budget (P11 E3)

Measured on 2026-11-18 by `node scripts/qa/budget.mjs --write` on the production build (`vite build`), gzip sizes as a browser downloads them. The first-visit numbers come from real Chrome against `vite preview` (which does not compress, so text is gzip-sized afterwards; Vercel serves brotli/gzip, so real transfer is the same or smaller).

## Bundles

| Item | Size (gzip) | Note |
|---|---|---|
| Classic entry (main + static imports) | 79.1 KB (81,011 B) | 1 file(s); baseline 79170 B, growth 1841 B, budget +5,120 B |
| Explore (lazy; chunk + static imports incl. three.js) | 349.7 KB (358,047 B) | 10 file(s); budget 350 KB (350.0 KB) |
| Explore chunk alone | 106.0 KB (108,554 B) | the app code without three.js |
| Chat chunk (lazy: chat + voice + schema) | 6.6 KB (6,808 B) | loads when the Ask my AI section nears the viewport |
| Turnstile chunk (lazy, shared by contact and chat) | 22.2 KB (22,740 B) |  |
| CSS explore.css | 3.9 KB (4,009 B) |  |
| CSS main.css | 17.6 KB (18,073 B) |  |
| CSS main.css | 0.2 KB (227 B) |  |

## Budgets

| Budget | Result |
|---|---|
| Classic entry growth ≤ 5 KB over the P3.2 baseline | PASS |
| Explore + three.js ≤ 350 KB gz | PASS |
| Explore code is NOT downloaded by a Classic visit | PASS |

## Images and media (stored size, not gzip: they are already compressed)

- Images in `public/images`: 1395.8 KB in 25 files. Largest: `tiny-village-1600.webp` 220.5 KB, `fydp-techfest26-winner.jpg` 212.8 KB, `umer-portrait.jpg` 121.6 KB, `tiny-village-800.webp` 97.6 KB, `taleem360-1600.webp` 88.6 KB. Cards use 800 px WebP with a 1600 px `srcset` and `loading="lazy"`.
- 3D models (Explore only, never loaded by Classic): 4787.8 KB. Promo film + poster + captions: 18904.2 KB (`preload="none"`). Project videos: 2765.7 KB (`preload="none"`).

## What a first visit to Classic transfers

- First view (page load + opening dismissed): **405.9 KB** in 19 requests.
- After scrolling the whole page once (lazy images, the chat chunk, the contact form and Turnstile's local chunk): **964.0 KB** in 34 requests.
- By type: document 22.2 KB, stylesheet 17.9 KB, script 113.3 KB, font 118.4 KB, image 690.1 KB, texttrack 1.7 KB, other 0.3 KB, fetch 0.1 KB.
- Explore, three.js and the models are not downloaded by a Classic visit.
- Third-party requests are not counted here: the only one is Cloudflare Turnstile (~40 KB), loaded only when the contact form or the chat panel is on screen.

Not measured here: Lighthouse scores (see `docs/reports/lighthouse.md`).
