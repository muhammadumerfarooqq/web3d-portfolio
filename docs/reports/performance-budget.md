# Performance budget (P11 E3)

Measured on 2026-11-19 by `node scripts/qa/budget.mjs --write` on the production build (`vite build`), gzip sizes as a browser downloads them. The first-visit numbers come from real Chrome against `vite preview` (which does not compress, so text is gzip-sized afterwards; Vercel serves brotli/gzip, so real transfer is the same or smaller).

## Bundles

| Item | Size (gzip) | Note |
|---|---|---|
| Classic entry (main + static imports) | 81.7 KB (83,649 B) | 5 file(s); baseline 79170 B, growth 4479 B, budget +5,120 B |
| Explore (lazy; chunk + static imports incl. three.js) | 349.9 KB (358,317 B) | 12 file(s); budget 350 KB (350.0 KB) |
| Explore chunk alone | 106.0 KB (108,584 B) | the app code without three.js |
| Chat chunk (lazy: chat + voice + schema) | 6.8 KB (6,912 B) | loads when the Ask my AI section nears the viewport |
| Turnstile chunk (lazy, shared by contact and chat) | 22.2 KB (22,740 B) |  |
| CSS admin.css | 1.2 KB (1,197 B) |  |
| CSS explore.css | 3.9 KB (4,009 B) |  |
| CSS main.css | 0.2 KB (227 B) |  |
| CSS project-order.css | 18.9 KB (19,360 B) |  |

## Budgets

| Budget | Result |
|---|---|
| Classic entry growth ≤ 5 KB over the P3.2 baseline | PASS |
| Explore + three.js ≤ 350 KB gz | PASS |
| Explore code is NOT downloaded by a Classic visit | PASS |

## Images and media (stored size, not gzip: they are already compressed)

- Images in `public/images`: 1395.8 KB in 25 files. Largest: `tiny-village-1600.webp` 220.5 KB, `fydp-techfest26-winner.jpg` 212.8 KB, `umer-portrait.jpg` 121.6 KB, `tiny-village-800.webp` 97.6 KB, `taleem360-1600.webp` 88.6 KB. Cards use 800 px WebP with a 1600 px `srcset` and `loading="lazy"`.
- 3D models (Explore only, never loaded by Classic): 4787.8 KB. Promo film + poster + captions: 18898.9 KB (`preload="none"`). Project videos: 2765.7 KB (`preload="none"`).

## What a first visit to Classic transfers

- First view (page load + opening dismissed): **412.8 KB** in 25 requests.
- After scrolling the whole page once (lazy images, the chat chunk, the contact form and Turnstile's local chunk): **971.3 KB** in 41 requests.
- By type: document 24.9 KB, script 116.1 KB, stylesheet 19.1 KB, font 118.4 KB, image 690.1 KB, texttrack 2.3 KB, other 0.3 KB, fetch 0.1 KB.
- Explore, three.js and the models are not downloaded by a Classic visit.
- Third-party requests are not counted here: the only one is Cloudflare Turnstile (~40 KB), loaded only when the contact form or the chat panel is on screen.

Not measured here: Lighthouse scores (see `docs/reports/lighthouse.md`).
