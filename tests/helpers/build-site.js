// Runs the real Vite build in memory (write: false) so tests can inspect the built HTML.
import { build } from 'vite';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

let pending = null;

export function buildSite() {
  pending ??= (async () => {
    const result = await build({
      root: ROOT,
      configFile: `${ROOT}vite.config.js`,
      logLevel: 'silent',
      build: { write: false },
    });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output);
    const source = (name) => {
      const file = outputs.find((o) => o.fileName === name);
      if (!file) throw new Error(`${name} missing from build output`);
      return String(file.source);
    };
    return { indexHtml: source('index.html'), adminHtml: source('admin/index.html'), outputs };
  })();
  return pending;
}
