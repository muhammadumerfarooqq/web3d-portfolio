# MDN HTTP Observatory (P11 B2)

Scanned on 18-Nov-2026 (20:20 UTC) through the public Observatory API (`POST https://observatory-api.mdn.mozilla.net/api/v2/scan?host=umerfarooq-ai.vercel.app`, algorithm version 6).

| Host | Grade | Score | Tests passed | Tests failed |
|---|---|---|---|---|
| umerfarooq-ai.vercel.app | **A+** | **130** | 12 of 12 | 0 |

Raw response (no secrets involved): `{"id":136305824,"algorithm_version":6,"scanned_at":"2026-11-18T20:20:32.309Z","error":null,"grade":"A+","score":130,"status_code":200,"tests_failed":0,"tests_passed":12,"tests_quantity":12}`

Target was A+; it is met, so **no header change was made** for Observatory. Headers behind it: strict CSP (no `unsafe-inline`, no `unsafe-eval`; one third-party origin, Cloudflare Turnstile), HSTS 2 years with `includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, COOP `same-origin`, no cookies.

**Repeat it yourself (for the viva):** open <https://developer.mozilla.org/en-US/observatory/analyze?host=umerfarooq-ai.vercel.app>, press "Scan", screenshot the grade (shot list P11-3). Or `curl -X POST "https://observatory-api.mdn.mozilla.net/api/v2/scan?host=umerfarooq-ai.vercel.app" -H "Content-Length: 0"`.
