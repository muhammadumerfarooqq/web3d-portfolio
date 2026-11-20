# Live site security check

Run by `node scripts/security/live-check.mjs https://umerfarooq-ai.vercel.app --write` on 2026-11-19 17:33 UTC against **https://umerfarooq-ai.vercel.app**.

Every request is refused before any paid or side-effecting call (origin, content type, size, method or session token): no contact email, no database row, no Gemini / Groq / Whisper call. No secret is needed or printed.

**Result: 110/111 checks passed.** Failed: P7 admin page.

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
| PASS | P7 GET /api/admin/messages no token | admin API without a token → 401 (404 only before the P7 deploy), nothing returned |  |
| PASS | P7 GET /api/admin/messages forged token | a token Supabase never issued (even one whose payload claims aal2) → 401 |  |
| PASS | P7 GET /api/admin/messages cross-origin | cross-origin → 403 (404 only before the P7 deploy), no CORS headers |  |
| PASS | P7 PATCH /api/admin/messages no token | admin API without a token → 401 (404 only before the P7 deploy), nothing returned |  |
| PASS | P7 PATCH /api/admin/messages forged token | a token Supabase never issued (even one whose payload claims aal2) → 401 |  |
| PASS | P7 PATCH /api/admin/messages cross-origin | cross-origin → 403 (404 only before the P7 deploy), no CORS headers |  |
| PASS | P7 GET /api/admin/projects-order no token | admin API without a token → 401 (404 only before the P7 deploy), nothing returned |  |
| PASS | P7 GET /api/admin/projects-order forged token | a token Supabase never issued (even one whose payload claims aal2) → 401 |  |
| PASS | P7 GET /api/admin/projects-order cross-origin | cross-origin → 403 (404 only before the P7 deploy), no CORS headers |  |
| PASS | P7 POST /api/admin/projects-order no token | admin API without a token → 401 (404 only before the P7 deploy), nothing returned |  |
| PASS | P7 POST /api/admin/projects-order forged token | a token Supabase never issued (even one whose payload claims aal2) → 401 |  |
| PASS | P7 POST /api/admin/projects-order cross-origin | cross-origin → 403 (404 only before the P7 deploy), no CORS headers |  |
| PASS | P7 POST /api/admin/mfa/enroll no token | admin API without a token → 401 (404 only before the P7 deploy), nothing returned |  |
| PASS | P7 POST /api/admin/mfa/enroll forged token | a token Supabase never issued (even one whose payload claims aal2) → 401 |  |
| PASS | P7 POST /api/admin/mfa/enroll cross-origin | cross-origin → 403 (404 only before the P7 deploy), no CORS headers |  |
| PASS | P7 POST /api/admin/mfa/verify no token | admin API without a token → 401 (404 only before the P7 deploy), nothing returned |  |
| PASS | P7 POST /api/admin/mfa/verify forged token | a token Supabase never issued (even one whose payload claims aal2) → 401 |  |
| PASS | P7 POST /api/admin/mfa/verify cross-origin | cross-origin → 403 (404 only before the P7 deploy), no CORS headers |  |
| PASS | P7 login bad body | a login body that fails validation → 400 before the rate limiter, Turnstile or Supabase is touched |  |
| PASS | P7 login GET | GET on the login route → 405 |  |
| PASS | P7 cron no secret | /api/cron/keepalive without the secret → 401 (404 only before the P7 deploy) |  |
| PASS | P7 cron wrong secret | a wrong cron secret → 401 (404 only before the P7 deploy) |  |
| PASS | P7 public order | GET /api/project-order is public and returns slugs only ({ ok, order }) |  |
| **FAIL** | P7 admin page | /admin is served noindex (X-Robots-Tag header and meta) with no data in it | 200 null |
| PASS | P10 collect GET | GET /api/collect → 405 (404 only before the P10 deploy) |  |
| PASS | P10 collect cross-origin | a cross-origin POST is refused (403) and counts nothing, no CORS headers |  |
| PASS | P10 collect no origin | a POST with no Origin or Referer is refused |  |
| PASS | P10 collect type | a form-encoded POST → 415 |  |
| PASS | P10 collect oversized | a body over 200 bytes → 413 |  |
| PASS | P10 collect unknown event | an unknown event is ignored: 204 with no body, nothing counted |  |
| PASS | P10 collect junk | a body that is not JSON is ignored the same way (204, empty) |  |
| PASS | P10 admin stats no token | /api/admin/stats without a token → 401 (404 only before the deploy) |  |
| PASS | E /api/cron | not served (404, 429 from the firewall, or the app shell), no file or secret content |  |
| PASS | E /api/cron/anything | not served (404, 429 from the firewall, or the app shell), no file or secret content |  |
| PASS | E /api/admin | not served (404, 429 from the firewall, or the app shell), no file or secret content |  |
| PASS | E /api/admin/users | not served (404, 429 from the firewall, or the app shell), no file or secret content |  |
| PASS | E /api/admin/../../.env | not served (404, 429 from the firewall, or the app shell), no file or secret content |  |
| PASS | E /api/nothing | not served (404, 429 from the firewall, or the app shell), no file or secret content |  |
| PASS | E /.env | not served (404, 429 from the firewall, or the app shell), no file or secret content |  |
| PASS | E /.git/config | not served (404, 429 from the firewall, or the app shell), no file or secret content |  |
| PASS | E /package.json | not served (404, 429 from the firewall, or the app shell), no file or secret content |  |
| PASS | E /vercel.json | not served (404, 429 from the firewall, or the app shell), no file or secret content |  |
| PASS | E /supabase/migrations/0001_contact_messages.sql | not served (404, 429 from the firewall, or the app shell), no file or secret content |  |
| PASS | E /api/contact bad JSON | malformed JSON gives a short generic JSON error, no stack, path or provider name |  |
| PASS | E /api/chat bad JSON | malformed JSON gives a short generic JSON error, no stack, path or provider name |  |
| PASS | E /api/transcribe bad JSON | malformed JSON gives a short generic JSON error, no stack, path or provider name |  |
| PASS | E /api/chat-token bad JSON | malformed JSON gives a short generic JSON error, no stack, path or provider name |  |
| PASS | E /api/contact-token bad JSON | malformed JSON gives a short generic JSON error, no stack, path or provider name |  |
| PASS | S title | index has title |  |
| PASS | S meta description | index has meta description |  |
| PASS | S canonical | index has canonical |  |
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
GET /assets/main-j9UJN8rY.js
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
GET /api/admin/messages (no token)
  -> 404 {"cache-control":"public, max-age=0, must-revalidate"}  body: The page could not be found

NOT_FOUND

bom1::kdnsk-1795109598790-eafb6cc1555d

PATCH /api/admin/messages (no token)
  -> 404 {"cache-control":"public, max-age=0, must-revalidate"}  body: The page could not be found

NOT_FOUND

bom1::ptl9j-1795109598992-215a11879b3f

GET /api/admin/projects-order (no token)
  -> 404 {"cache-control":"public, max-age=0, must-revalidate"}  body: The page could not be found

NOT_FOUND

bom1::zphd9-1795109599214-1dfa81ca59d8

POST /api/admin/projects-order (no token)
  -> 404 {"cache-control":"public, max-age=0, must-revalidate"}  body: The page could not be found

NOT_FOUND

bom1::fqgp9-1795109599434-9798e17acbc6

POST /api/admin/mfa/enroll (no token)
  -> 404 {"cache-control":"public, max-age=0, must-revalidate"}  body: The page could not be found

NOT_FOUND

bom1::gr785-1795109599638-3a27a464d787

POST /api/admin/mfa/verify (no token)
  -> 404 {"cache-control":"public, max-age=0, must-revalidate"}  body: The page could not be found

NOT_FOUND

bom1::zv5cx-1795109599855-a6b4d8bd06c3

GET /api/cron
  -> 404 {"content-type":"text/plain; charset=utf-8"}  body: The page could not be found NOT_FOUND bom1::zmb6l-17951096
GET /api/cron/anything
  -> 429 {"content-type":"text/plain; charset=utf-8"}  body: Too Many Requests Too Many Requests bom1::ptl9j-17951096011
GET /api/admin
  -> 429 {"content-type":"text/plain; charset=utf-8"}  body: Too Many Requests Too Many Requests bom1::tzc7h-17951096011
GET /api/admin/users
  -> 429 {"content-type":"text/plain; charset=utf-8"}  body: Too Many Requests Too Many Requests bom1::zv5cx-17951096012
GET /api/admin/../../.env
  -> 404 {"content-type":"text/plain; charset=utf-8"}  body: The page could not be found NOT_FOUND bom1::gr785-17951096
GET /api/nothing
  -> 429 {"content-type":"text/plain; charset=utf-8"}  body: Too Many Requests Too Many Requests bom1::pqp79-17951096014
GET /.env
  -> 404 {"content-type":"text/plain; charset=utf-8"}  body: The page could not be found NOT_FOUND bom1::zv5cx-17951096
GET /.git/config
  -> 404 {"content-type":"text/plain; charset=utf-8"}  body: The page could not be found NOT_FOUND bom1::zmb6l-17951096
GET /package.json
  -> 404 {"content-type":"text/plain; charset=utf-8"}  body: The page could not be found NOT_FOUND bom1::gr785-17951096
GET /vercel.json
  -> 404 {"content-type":"text/plain; charset=utf-8"}  body: The page could not be found NOT_FOUND bom1::z8gjx-17951096
GET /supabase/migrations/0001_contact_messages.sql
  -> 404 {"content-type":"text/plain; charset=utf-8"}  body: The page could not be found NOT_FOUND bom1::tzc7h-17951096
```
