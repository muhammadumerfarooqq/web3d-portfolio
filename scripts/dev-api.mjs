// P4: local API without the Vercel CLI. `npm run dev` (and `vite preview`) route /api/contact and
// /api/contact-token to the SAME handlers Vercel runs, with .env loaded into a private object that is
// handed to the handlers only (never to process.env, never to the browser: Vite exposes VITE_* only).
// `vite preview` also sends the vercel.json headers (CSP and all), so the production policy can be
// verified locally.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from 'vite';

/** Headers vercel.json applies to every route ("/(.*)"), as a plain object. */
export function vercelHeaders(root) {
  const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
  const all = config.headers?.find((h) => h.source === '/(.*)')?.headers ?? [];
  return Object.fromEntries(all.map((h) => [h.key, h.value]));
}

async function routes(root, mode) {
  const env = loadEnv(mode, root, '');
  const { createContactHandler } = await import('../api/contact.js');
  const { createTokenHandler } = await import('../api/contact-token.js');
  const contact = createContactHandler({ env });
  const token = createTokenHandler({ env });
  return (req, res, next) => {
    const path = (req.url ?? '').split('?')[0];
    if (path === '/api/contact') return void contact(req, res);
    if (path === '/api/contact-token') return void token(req, res);
    next();
  };
}

export function devApiPlugin(root) {
  return {
    name: 'portfolio-dev-api',
    async configureServer(server) {
      server.middlewares.use(await routes(root, server.config.mode));
    },
    async configurePreviewServer(server) {
      const headers = vercelHeaders(root);
      server.middlewares.use((req, res, next) => {
        for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
        next();
      });
      server.middlewares.use(await routes(root, server.config.mode));
    },
  };
}
