// P3.1 bundle budgets (real Vite build, in memory): Classic's entry stays about the same size and
// Explore is a lazy chunk within its budget. Sizes are gzip level 9.
import { describe, it, expect, beforeAll } from 'vitest';
import { gzipSync } from 'node:zlib';
import { buildSite } from './helpers/build-site.js';

/** Classic entry before Explore existed (P2.5b, gzip -9 of assets/main-*.js). */
const CLASSIC_BASELINE_GZ = 77201;
const CLASSIC_GROWTH_LIMIT = 5 * 1024;
const EXPLORE_LIMIT_GZ = 350 * 1024;

const gz = (code) => gzipSync(Buffer.from(code), { level: 9 }).length;

describe('bundle budgets', () => {
  let outputs;
  beforeAll(async () => {
    ({ outputs } = await buildSite());
  }, 180_000);

  const chunks = () => outputs.filter((o) => o.type === 'chunk');
  const main = () => chunks().find((c) => c.isEntry && c.fileName.startsWith('assets/main-'));
  const explore = () => chunks().find((c) => c.fileName.startsWith('assets/explore-'));

  it('Explore is a separate chunk that Classic only imports dynamically', () => {
    expect(explore(), 'explore chunk').toBeTruthy();
    expect(main().imports).not.toContain(explore().fileName);
    expect(main().dynamicImports).toContain(explore().fileName);
    // three.js, the WebGPU renderer and three-mesh-bvh are not in Classic's entry
    expect(main().code).not.toMatch(/WebGPURenderer|MeshBVH/);
  });

  it('Classic entry grows by at most 5 KB gz over the P2.5b baseline', () => {
    const size = gz(main().code);
    expect(size - CLASSIC_BASELINE_GZ, `Classic entry ${size} B gz`).toBeLessThanOrEqual(CLASSIC_GROWTH_LIMIT);
  });

  it('the Explore chunk is within 350 KB gz (JS only, models excluded)', () => {
    const size = gz(explore().code);
    expect(size, `Explore chunk ${(size / 1024).toFixed(1)} KB gz`).toBeLessThanOrEqual(EXPLORE_LIMIT_GZ);
  });

  it('the Draco decoder is not bundled a second time (it is served once from public/draco)', () => {
    const assets = outputs.filter((o) => o.type === 'asset').map((o) => o.fileName);
    expect(assets.filter((f) => /^assets\/draco/.test(f))).toEqual([]);
  });
});
