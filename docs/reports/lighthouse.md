# Lighthouse (P11 E2)

Run on 18-Nov-2026 with Lighthouse 13.6.0 (Node CLI) in headless Chrome 157 on this Windows laptop, against the **live site** `https://umerfarooq-ai.vercel.app/` (first visit, no cache), once per form factor. The earlier failures (NO_FCP, LIMITATIONS L185) did not happen this time; they came from the machine / Chrome combination of that day, not from the site.

| Form factor | Performance | Accessibility | Best practices | SEO | FCP | LCP | TBT | CLS | Speed Index |
|---|---|---|---|---|---|---|---|---|---|
| Desktop | **100** | **100** | **100** | **100** | 0.4 s | 0.4 s | 20 ms | 0 | 0.9 s |
| Mobile (simulated Moto G Power, slow 4G) | **97** | **100** | **100** | **100** | 1.1 s | 1.1 s | 200 ms | 0 | 2.0 s |

Also run locally on the production build (`vite preview`, desktop): 100 / 100 / 100 / 100.

Notes:
- Mobile performance 97 is limited by Total Blocking Time (200 ms) from the Classic entry's start-up (GSAP + Lenis + the reveals). Lighthouse mobile is bimodal on this machine (P3.3); a 95–97 band is the expected range.
- This run was made BEFORE the P11 changes were deployed (canonical link, aria fixes, contrast fix); none of them touches loading, so scores should not move. Re-run after deploying to confirm.
- Only one run per form factor was made, as asked; do not read ±3 points as a change.

**To repeat in Chrome DevTools (for the viva, and for the screenshots in `docs/screenshots/p11/`):** open the live site in a fresh Incognito window → F12 → Lighthouse tab → choose Mobile, then Desktop, categories Performance / Accessibility / Best practices / SEO → Analyze page load → screenshot the four gauges (shot list P11-4 and P11-5). Command line: `npx lighthouse https://umerfarooq-ai.vercel.app/ --preset=desktop --only-categories=performance,accessibility,best-practices,seo --view` (leave out `--preset=desktop` for mobile).
