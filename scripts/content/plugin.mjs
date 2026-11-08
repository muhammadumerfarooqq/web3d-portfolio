// Vite plugin: renders /content into index.html at build (and dev) time.
//  1. transformIndexHtml swaps <!--content:NAME--> markers for static HTML (works with JS off).
//  2. virtual:content exports the public front matter as JSON (drafts removed).
//  3. Editing content/ triggers a full reload in dev.
// Only the root index.html is touched; admin/index.html never receives content.
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { assertNoPii } from './guard.mjs';
import { collectAnchors, ContentError, loadContent } from './load.mjs';
import { imageSize, publicData, renderSections } from './render.mjs';

const VIRTUAL_ID = 'virtual:content';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
const MARKER = /<!--\s*content:([a-z0-9-]+)\s*-->/g;
export const CV_PATH = '/cv/Muhammad_Umer_Farooq_CV_web.pdf';

/** Load, validate, guard and render everything once. */
export function buildContent(root) {
  const { content, sources } = loadContent(root);
  assertNoPii(sources);
  collectAnchors(content);

  const photoFile = join(root, 'public', content.profile.photo);
  if (!existsSync(photoFile)) throw new ContentError(`content/profile.md: photo ${content.profile.photo} not found in public/`);
  const cvHref = existsSync(join(root, 'public', CV_PATH)) ? CV_PATH : null;

  return {
    content,
    sections: renderSections(content, { photoSize: imageSize(photoFile), cvHref, root }),
    data: publicData(content),
    cvHref,
  };
}

/** Replace markers; unknown markers and unreplaced known blocks are errors. */
export function injectContent(htmlSource, sections) {
  const used = new Set();
  const out = htmlSource.replace(MARKER, (_, name) => {
    if (!(name in sections)) throw new ContentError(`index.html: unknown content marker <!--content:${name}-->`);
    used.add(name);
    return sections[name].toString();
  });
  const missing = Object.keys(sections).filter((name) => !used.has(name));
  if (missing.length) throw new ContentError(`index.html: missing content markers: ${missing.join(', ')}`);
  return out;
}

export function contentPlugin() {
  let root = process.cwd();
  let cache = null;
  const get = () => (cache ??= buildContent(root));

  return {
    name: 'portfolio-content',
    enforce: 'pre',

    configResolved(config) {
      root = config.root;
    },

    configureServer(server) {
      const dir = join(root, 'content');
      server.watcher.add(dir);
      server.watcher.on('all', (_event, file) => {
        if (!resolve(file).startsWith(resolve(dir) + sep) || !file.endsWith('.md')) return;
        cache = null;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload', path: '*' });
      });
    },

    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },

    load(id) {
      return id === RESOLVED_ID ? `export default ${JSON.stringify(get().data)};\n` : null;
    },

    transformIndexHtml: {
      order: 'pre',
      handler(htmlSource, ctx) {
        if (resolve(ctx.filename) !== resolve(root, 'index.html')) return htmlSource;
        return injectContent(htmlSource, get().sections);
      },
    },
  };
}
