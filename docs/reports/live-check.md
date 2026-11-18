# Live site security check

Run by `node scripts/security/live-check.mjs https://umerfarooq-ai.vercel.app --write` on 2026-11-18 20:21 UTC against **https://umerfarooq-ai.vercel.app**.

Every request is refused before any paid or side-effecting call (origin, content type, size, method or session token): no contact email, no database row, no Gemini / Groq / Whisper call. No secret is needed or printed.

**Result: 77/78 checks passed.** Failed: S canonical.

## Checks

| Result | Check | What | Detail on failure |
|---|---|---|---|
| PASS | H / HSTS | Strict-Transport-Security: ≥ 1 year, includeSubDomains |  |
| PASS | H / CSP | strict CSP with exactly one third-party origin (Cloudflare Turnstile) |  |
| PASS | H / COOP | Cross-Origin-Opener-Policy: same-origin |  |
| PASS | H / nosniff | X-Content-Type-Options: nosniff |  |
| PASS | H / referrer | Referrer-Policy: strict-origin-when-cross-origin |  |
| PASS | H / permissions | Permissions-Policy: microphone=(self) only; camera, geolocation, payment, usb denied |  |
| PASS | H / framing | X-Frame-Options: DENY and CSP frame-ancestors none |  |
| PASS | H / no leaks | no X-Powered-By, no Set-Cookie (the Server header is the platform name only) |  |
| PASS | H /robots.txt HSTS | Strict-Transport-Security: ≥ 1 year, includeSubDomains |  |
| PASS | H /robots.txt CSP | strict CSP with exactly one third-party origin (Cloudflare Turnstile) |  |
| PASS | H /robots.txt COOP | Cross-Origin-Opener-Policy: same-origin |  |
| PASS | H /robots.txt nosniff | X-Content-Type-Options: nosniff |  |
| PASS | H /robots.txt referrer | Referrer-Policy: strict-origin-when-cross-origin |  |
| PASS | H /robots.txt permissions | Permissions-Policy: microphone=(self) only; camera, geolocation, payment, usb denied |  |
| PASS | H /robots.txt framing | X-Frame-Options: DENY and CSP frame-ancestors none |  |
| PASS | H /robots.txt no leaks | no X-Powered-By, no Set-Cookie (the Server header is the platform name only) |  |
| PASS | H /does-not-exist HSTS | Strict-Transport-Security: ≥ 1 year, includeSubDomains |  |
| PASS | H /does-not-exist CSP | strict CSP with exactly one third-party origin (Cloudflare Turnstile) |  |
| PASS | H /does-not-exist COOP | Cross-Origin-Opener-Policy: same-origin |  |
| PASS | H /does-not-exist nosniff | X-Content-Type-Options: nosniff |  |
| PASS | H /does-not-exist referrer | Referrer-Policy: strict-origin-when-cross-origin |  |
| PASS | H /does-not-exist permissions | Permissions-Policy: microphone=(self) only; camera, geolocation, payment, usb denied |  |
| PASS | H /does-not-exist framing | X-Frame-Options: DENY and CSP frame-ancestors none |  |
| PASS | H /does-not-exist no leaks | no X-Powered-By, no Set-Cookie (the Server header is the platform name only) |  |
| PASS | H / https | plain http redirects to https (HSTS preload list requires it) |  |
| PASS | H asset | built script: nosniff and a long immutable cache or revalidation (no leak) |  |
| PASS | H inline | the home page has no inline script bodies and no on*= handlers |  |
| PASS | A /api/contact cross-origin | cross-origin POST → 403 and no CORS headers |  |
| PASS | A /api/contact no origin | POST with no Origin and no Referer → 403 |  |
| PASS | A /api/chat cross-origin | cross-origin POST → 403 and no CORS headers |  |
| PASS | A /api/chat no origin | POST with no Origin and no Referer → 403 |  |
| PASS | A /api/transcribe cross-origin | cross-origin POST → 403 and no CORS headers |  |
| PASS | A /api/transcribe no origin | POST with no Origin and no Referer → 403 |  |
| PASS | A /api/chat-token cross-origin | cross-origin GET → 403 |  |
| PASS | A /api/contact-token cross-origin | cross-origin GET → 403 |  |
| PASS | A preflight | a cross-origin preflight gets no Access-Control-Allow-* headers |  |
| PASS | A /api/contact text/plain | wrong content type → 415 |  |
| PASS | A /api/chat text/plain | wrong content type → 415 |  |
| PASS | A /api/chat application/x-www-form-urlencoded | wrong content type → 415 |  |
| PASS | A /api/transcribe application/json | wrong content type → 415 |  |
| PASS | A /api/transcribe audio/mpeg | wrong content type → 415 |  |
| PASS | A /api/contact oversized | body over the limit (9216 bytes) → 413 |  |
| PASS | A /api/chat oversized | body over the limit (9216 bytes) → 413 |  |
| PASS | A /api/transcribe oversized | body over the limit (2097162 bytes) → 413 |  |
| PASS | A /api/contact GET | GET on a POST route → 405 with Allow: POST |  |
| PASS | A /api/chat GET | GET on a POST route → 405 with Allow: POST |  |
| PASS | A /api/transcribe GET | GET on a POST route → 405 with Allow: POST |  |
| PASS | A /api/chat session missing | no valid chat session → 401 (503 if the chat is not configured), no model call |  |
| PASS | A /api/chat session empty | no valid chat session → 401 (503 if the chat is not configured), no model call |  |
| PASS | A /api/chat session garbage | no valid chat session → 401 (503 if the chat is not configured), no model call |  |
| PASS | A /api/chat session forged (right shape, wrong signature) | no valid chat session → 401 (503 if the chat is not configured), no model call |  |
| PASS | A /api/chat session expired | no valid chat session → 401 (503 if the chat is not configured), no model call |  |
| PASS | A /api/transcribe session missing | no valid chat session → 401 (503 if not configured), no Whisper call |  |
| PASS | A /api/transcribe session forged | no valid chat session → 401 (503 if not configured), no Whisper call |  |
| PASS | A /api/contact no stamp | a contact post without the time-trap stamp and Turnstile token → 400/503, nothing is sent |  |
| PASS | E /api/cron | not served (404 or the app shell), no file or secret content |  |
| PASS | E /api/cron/anything | not served (404 or the app shell), no file or secret content |  |
| PASS | E /api/admin | not served (404 or the app shell), no file or secret content |  |
| PASS | E /api/admin/users | not served (404 or the app shell), no file or secret content |  |
| PASS | E /api/nothing | not served (404 or the app shell), no file or secret content |  |
| PASS | E /.env | not served (404 or the app shell), no file or secret content |  |
| PASS | E /.git/config | not served (404 or the app shell), no file or secret content |  |
| PASS | E /package.json | not served (404 or the app shell), no file or secret content |  |
| PASS | E /vercel.json | not served (404 or the app shell), no file or secret content |  |
| PASS | E /supabase/migrations/0001_contact_messages.sql | not served (404 or the app shell), no file or secret content |  |
| PASS | E /api/contact bad JSON | malformed JSON gives a short generic JSON error, no stack, path or provider name |  |
| PASS | E /api/chat bad JSON | malformed JSON gives a short generic JSON error, no stack, path or provider name |  |
| PASS | E /api/transcribe bad JSON | malformed JSON gives a short generic JSON error, no stack, path or provider name |  |
| PASS | E /api/chat-token bad JSON | malformed JSON gives a short generic JSON error, no stack, path or provider name |  |
| PASS | E /api/contact-token bad JSON | malformed JSON gives a short generic JSON error, no stack, path or provider name |  |
| PASS | S title | index has title |  |
| PASS | S meta description | index has meta description |  |
| **FAIL** | S canonical | index has canonical | missing |
| PASS | S og:image | index has og:image |  |
| PASS | S og:title | index has og:title |  |
| PASS | S lang attribute | index has lang attribute |  |
| PASS | S robots | robots.txt present and valid |  |
| PASS | S sitemap | sitemap.xml present (or robots.txt does not promise one) |  |

## Raw results (status and the headers that matter, response bodies cut to 120 characters)

```
GET /
  -> 200 {"strict-transport-security":"max-age=63072000; includeSubDomains; preload","content-security-policy":"default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' blob: https://challenges.cloudflare.com; media-src 'self' blob:; worker-src 'self' blob:; frame-src https://challenges.cloudflare.com; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'","cross-origin-opener-policy":"same-origin","x-content-type-options":"nosniff","referrer-policy":"strict-origin-when-cross-origin","permissions-policy":"camera=(), geolocation=(), microphone=(self), payment=(), usb=()","x-frame-options":"DENY","server":"Vercel","access-control-allow-origin":"*"}
GET /robots.txt
  -> 200 {"strict-transport-security":"max-age=63072000; includeSubDomains; preload","content-security-policy":"default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' blob: https://challenges.cloudflare.com; media-src 'self' blob:; worker-src 'self' blob:; frame-src https://challenges.cloudflare.com; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'","cross-origin-opener-policy":"same-origin","x-content-type-options":"nosniff","referrer-policy":"strict-origin-when-cross-origin","permissions-policy":"camera=(), geolocation=(), microphone=(self), payment=(), usb=()","x-frame-options":"DENY","server":"Vercel","access-control-allow-origin":"*"}
GET /does-not-exist
  -> 404 {"strict-transport-security":"max-age=63072000; includeSubDomains; preload","content-security-policy":"default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' blob: https://challenges.cloudflare.com; media-src 'self' blob:; worker-src 'self' blob:; frame-src https://challenges.cloudflare.com; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'","cross-origin-opener-policy":"same-origin","x-content-type-options":"nosniff","referrer-policy":"strict-origin-when-cross-origin","permissions-policy":"camera=(), geolocation=(), microphone=(self), payment=(), usb=()","x-frame-options":"DENY","server":"Vercel"}
GET /assets/main-D2tuaq5o.js
  -> 200 {"strict-transport-security":"max-age=63072000; includeSubDomains; preload","content-security-policy":"default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' blob: https://challenges.cloudflare.com; media-src 'self' blob:; worker-src 'self' blob:; frame-src https://challenges.cloudflare.com; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'","cross-origin-opener-policy":"same-origin","x-content-type-options":"nosniff","referrer-policy":"strict-origin-when-cross-origin","permissions-policy":"camera=(), geolocation=(), microphone=(self), payment=(), usb=()","x-frame-options":"DENY","server":"Vercel","access-control-allow-origin":"*"}
POST /api/contact (Origin https://evil.example)
  -> 403 {"content-type":"application/json; charset=utf-8"}  body: {"ok":false,"error":"forbidden"}
POST /api/chat (Origin https://evil.example)
  -> 403 {"content-type":"application/json; charset=utf-8"}  body: {"ok":false,"error":"forbidden"}
POST /api/transcribe (Origin https://evil.example)
  -> 403 {"content-type":"application/json; charset=utf-8"}  body: {"ok":false,"error":"forbidden"}
OPTIONS /api/chat (preflight from evil origin)
  -> 405 {"allow":"POST"}
POST /api/chat (session missing)
  -> 401 {}  body: {"ok":false,"error":"session","reason":"missing"}
POST /api/chat (session empty)
  -> 401 {}  body: {"ok":false,"error":"session","reason":"missing"}
POST /api/chat (session garbage)
  -> 401 {}  body: {"ok":false,"error":"session","reason":"invalid"}
POST /api/chat (session forged (right shape, wrong signature))
  -> 401 {}  body: {"ok":false,"error":"session","reason":"invalid"}
POST /api/chat (session expired)
  -> 401 {}  body: {"ok":false,"error":"session","reason":"invalid"}
POST /api/transcribe (session missing)
  -> 401 {}  body: {"ok":false,"error":"session","reason":"missing"}
POST /api/transcribe (session forged)
  -> 401 {}  body: {"ok":false,"error":"session","reason":"invalid"}
POST /api/contact (no stamp, no Turnstile token)
  -> 400 {}  body: {"ok":false,"error":"stale_form"}
GET /api/cron
  -> 404 {"content-type":"text/plain; charset=utf-8"}  body: The page could not be found NOT_FOUND bom1::tlmtg-17950332
GET /api/cron/anything
  -> 404 {"content-type":"text/plain; charset=utf-8"}  body: The page could not be found NOT_FOUND bom1::x6cdk-17950332
GET /api/admin
  -> 404 {"content-type":"text/plain; charset=utf-8"}  body: The page could not be found NOT_FOUND bom1::flvgw-17950332
GET /api/admin/users
  -> 404 {"content-type":"text/plain; charset=utf-8"}  body: The page could not be found NOT_FOUND bom1::x6cdk-17950332
GET /api/nothing
  -> 404 {"content-type":"text/plain; charset=utf-8"}  body: The page could not be found NOT_FOUND bom1::k6lk4-17950332
GET /.env
  -> 404 {"content-type":"text/plain; charset=utf-8"}  body: The page could not be found NOT_FOUND bom1::f27p5-17950332
GET /.git/config
  -> 404 {"content-type":"text/plain; charset=utf-8"}  body: The page could not be found NOT_FOUND bom1::tlmtg-17950332
GET /package.json
  -> 404 {"content-type":"text/plain; charset=utf-8"}  body: The page could not be found NOT_FOUND bom1::7qkw2-17950332
GET /vercel.json
  -> 404 {"content-type":"text/plain; charset=utf-8"}  body: The page could not be found NOT_FOUND bom1::tlmtg-17950332
GET /supabase/migrations/0001_contact_messages.sql
  -> 404 {"content-type":"text/plain; charset=utf-8"}  body: The page could not be found NOT_FOUND bom1::f27p5-17950332
```
