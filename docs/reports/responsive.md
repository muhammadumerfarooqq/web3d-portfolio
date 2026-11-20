# Responsive check (P12-UX)

Real Chrome, `npm run qa:responsive` (scripts/qa/responsive-check.mjs), 2026-11-20. Widths ≤ 768 px use touch + mobile emulation. Screenshots: docs/screenshots/p12/responsive/.

## Overflow (px): document scrollWidth minus viewport width, and (+n) elements sticking out of the viewport

| Width | Classic EN light | Classic EN dark | Classic UR light | Classic UR dark | Start dialog | Admin sign-in | Explore HUD |
|---|---|---|---|---|---|---|---|
| 320 | 0 | 0 | 0 | 0 | 0 | 0 | – |
| 360 | 0 | 0 | 0 | 0 | 0 | 0 | clean |
| 375 | 0 | 0 | 0 | 0 | 0 | 0 | – |
| 390 | 0 | 0 | 0 | 0 | 0 | 0 | – |
| 414 | 0 | 0 | 0 | 0 | 0 | 0 | – |
| 600 | 0 | 0 | 0 | 0 | 0 | 0 | – |
| 768 | 0 | 0 | 0 | 0 | 0 | 0 | clean |
| 1024 | 0 | 0 | 0 | 0 | 0 | 0 | – |
| 1280 | 0 | 0 | 0 | 0 | 0 | 0 | clean |

## Other measures (Classic, all 36 width × language × theme loads)

- header overlaps / controls outside the viewport: **0**
- tap targets under 44 px on touch widths (≤ 768): **0**
- text under 12 px: **0**
- stretched images / video: **0**

## Notes

- cursor (computed): page url("http://localhost:4185/cursors/arrow…, button url("http://localhost:4185/cursors/pointer.s…, text field text

## Result

**All checks passed.**
