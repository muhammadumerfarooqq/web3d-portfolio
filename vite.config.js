import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// Multi-page build: the portfolio (/) and the admin dashboard (/admin).
export default defineConfig({
  plugins: [tailwindcss()],
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
