// Vite plugin: three's DRACOLoader resolves its decoder with `new URL('../libs/draco/…', import.meta.url)`,
// which makes Vite emit a second copy of the decoder (≈ 300 KB) next to the one we self-host in
// public/draco/. This rewrites those defaults to the self-hosted, same-origin files, so the decoder
// exists exactly once in dist/ and is only fetched if a Draco-compressed mesh is actually decoded.
// (src/explore/config.js also calls setDecoderPath('/draco/') explicitly.)
const DRACO_URL = /new URL\(\s*'\.\.\/libs\/draco\/(?:gltf\/)?([\w.]+)'\s*,\s*import\.meta\.url\s*\)\.toString\(\)/g;

export function dracoPathPlugin() {
  return {
    name: 'portfolio-draco-path',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/examples/jsm/loaders/DRACOLoader.js')) return null;
      const out = code.replace(DRACO_URL, (_, file) => JSON.stringify(`/draco/${file}`));
      return out === code ? null : { code: out, map: null };
    },
  };
}
