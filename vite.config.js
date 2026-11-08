import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentPlugin } from './scripts/content/plugin.mjs';
import { fontPreloadPlugin } from './scripts/font-preload.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));

// Multi-page build: the portfolio (/) and the admin dashboard (/admin).
// contentPlugin renders /content into index.html only (static HTML, works with JS off).
export default defineConfig({
  plugins: [contentPlugin(), tailwindcss(), fontPreloadPlugin()],
  build: {
    // Never inline assets as data: URIs (small font subsets would be); a strict CSP serves
    // fonts and images from 'self' only.
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        admin: resolve(root, 'admin/index.html'),
      },
    },
  },
});
