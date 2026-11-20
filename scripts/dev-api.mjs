// P4/P5: local API without the Vercel CLI. `npm run dev` (and `vite preview`) route /api/contact,
// /api/contact-token, /api/chat, /api/chat-token and /api/transcribe (P6) to the SAME handlers Vercel runs, with .env loaded into a private object that is
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
  const { createChatHandler } = await import('../api/chat.js');
  const { createChatTokenHandler } = await import('../api/chat-token.js');
  const { createTranscribeHandler } = await import('../api/transcribe.js');
  const { createAdminHandler } = await import('../api/admin/[...path].js');
  const { createKeepaliveHandler } = await import('../api/cron/keepalive.js');
  const { createProjectOrderHandler } = await import('../api/project-order.js');
  const { createCollectHandler } = await import('../api/collect.js');
  const contact = createContactHandler({ env });
  const token = createTokenHandler({ env });
  const chat = createChatHandler({ env });
  const chatToken = createChatTokenHandler({ env });
  const transcribe = createTranscribeHandler({ env });
  const adminApi = createAdminHandler({ env });
  const keepalive = createKeepaliveHandler({ env });
  const projectOrder = createProjectOrderHandler({ env });
  const collect = createCollectHandler({ env });
  return (req, res, next) => {
    const path = (req.url ?? '').split('?')[0];
    if (path === '/api/contact') return void contact(req, res);
    if (path === '/api/contact-token') return void token(req, res);
    if (path === '/api/chat') return void chat(req, res); // P5
    if (path === '/api/chat-token') return void chatToken(req, res); // P5
    if (path === '/api/transcribe') return void transcribe(req, res); // P6
    if (path === '/api/admin' || path.startsWith('/api/admin/')) return void adminApi(req, res); // P7
    if (path === '/api/cron/keepalive') return void keepalive(req, res); // P7
    if (path === '/api/project-order') return void projectOrder(req, res); // P7
    if (path === '/api/collect') return void collect(req, res); // P10
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
