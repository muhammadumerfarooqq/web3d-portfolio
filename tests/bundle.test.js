// Bundle budgets (real Vite build, in memory). Sizes are gzip level 9.
//  - Classic's entry (main + every chunk it imports statically) stays within +5 KB of P2.5b.
//  - Explore is lazy: what loads when Explore starts (the explore chunk + its static imports that
//    Classic does not already have, e.g. three.js) is within 350 KB.
//  - P3.2's case files, train and fireworks are further lazy chunks, never in either entry.
import { describe, it, expect, beforeAll } from 'vitest';
import { gzipSync } from 'node:zlib';
import { buildSite } from './helpers/build-site.js';

/** Classic entry before Explore existed (P2.5b, gzip -9 of assets/main-*.js). */
const CLASSIC_BASELINE_GZ = 77201;
const CLASSIC_GROWTH_LIMIT = 5 * 1024;
const EXPLORE_LIMIT_GZ = 350 * 1024;
const LAZY_LIMIT_GZ = 24 * 1024;
const LAZY = ['case-files', 'train', 'fireworks'];

const gz = (code) => gzipSync(Buffer.from(code), { level: 9 }).length;

describe('bundle budgets', () => {
  let outputs;
  beforeAll(async () => {
    ({ outputs } = await buildSite());
  }, 180_000);

  const chunks = () => outputs.filter((o) => o.type === 'chunk');
  const byName = (f) => chunks().find((c) => c.fileName === f);
  const main = () => chunks().find((c) => c.isEntry && c.fileName.startsWith('assets/main-'));
  const explore = () => chunks().find((c) => c.fileName.startsWith('assets/explore-'));
  const lazy = (name) => chunks().find((c) => c.fileName.startsWith(`assets/${name}-`));
  /** A chunk plus everything it imports statically, transitively. */
  const closure = (chunk, seen = new Set()) => {
    if (!chunk || seen.has(chunk.fileName)) return seen;
    seen.add(chunk.fileName);
    for (const f of chunk.imports) closure(byName(f), seen);
    return seen;
  };
  const size = (files) => [...files].reduce((n, f) => n + gz(byName(f).code), 0);

  it('Explore is a separate chunk that Classic only imports dynamically', () => {
    expect(explore(), 'explore chunk').toBeTruthy();
    const classic = closure(main());
    expect(classic.has(explore().fileName)).toBe(false);
    expect(main().dynamicImports).toContain(explore().fileName);
    // three.js, the WebGPU renderer and three-mesh-bvh are not in anything Classic loads up front
    for (const f of classic) expect(byName(f).code, f).not.toMatch(/WebGPURenderer|MeshBVH/);
  });

  it('Classic entry (main + its static imports) grows by at most 5 KB gz over the P2.5b baseline', () => {
    const total = size(closure(main()));
    expect(total - CLASSIC_BASELINE_GZ, `Classic entry ${total} B gz`).toBeLessThanOrEqual(CLASSIC_GROWTH_LIMIT);
  });

  it('what Explore loads on start is within 350 KB gz (JS only, models excluded)', () => {
    const classic = closure(main());
    const start = [...closure(explore())].filter((f) => !classic.has(f));
    const total = size(start);
    expect(total, `Explore start ${(total / 1024).toFixed(1)} KB gz (${start.map((f) => f.replace('assets/', '')).join(' + ')})`).toBeLessThanOrEqual(EXPLORE_LIMIT_GZ);
  });

  it.each(LAZY)('%s is its own lazy chunk (dynamic only) and small', (name) => {
    const chunk = lazy(name);
    expect(chunk, name).toBeTruthy();
    expect(closure(explore()).has(chunk.fileName), `${name} must not load with Explore`).toBe(false);
    expect(closure(main()).has(chunk.fileName)).toBe(false);
    expect(explore().dynamicImports).toContain(chunk.fileName);
    expect(gz(chunk.code), `${name} ${gz(chunk.code)} B gz`).toBeLessThanOrEqual(LAZY_LIMIT_GZ);
  });

  it('the Draco decoder is not bundled a second time (it is served once from public/draco)', () => {
    const assets = outputs.filter((o) => o.type === 'asset').map((o) => o.fileName);
    expect(assets.filter((f) => /^assets\/draco/.test(f))).toEqual([]);
  });
});
