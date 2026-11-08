// Vite plugin (build only): <link rel="preload"> for the two above-the-fold font files (Syne + Inter,
// latin subset), found by name in the bundle so the hashed URLs stay correct. Loading them before
// first paint avoids the font-swap layout shift under the intro word and hero (Lighthouse CLS) and
// SplitText re-splitting when the fonts arrive. Same-origin files only; no inline code.
const PRELOAD = [/^assets\/syne-latin-wght-normal-[\w-]+\.woff2$/, /^assets\/inter-latin-wght-normal-[\w-]+\.woff2$/];

export function fontPreloadPlugin() {
  return {
    name: 'portfolio-font-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        if (!ctx.bundle || !ctx.filename.replaceAll('\\', '/').endsWith('/index.html') || ctx.filename.includes('admin')) return [];
        const files = Object.keys(ctx.bundle).filter((name) => PRELOAD.some((re) => re.test(name)));
        return files.map((name) => ({
          tag: 'link',
          attrs: { rel: 'preload', href: `/${name}`, as: 'font', type: 'font/woff2', crossorigin: '' },
          injectTo: 'head',
        }));
      },
    },
  };
}
