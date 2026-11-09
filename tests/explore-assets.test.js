// P3.1: every node / material name the Explore code hooks exists in the GLBs, and the avatar has the
// clips and morph targets the controller plays. The town is read through the same constant the app
// uses (TOWN_URL), so swapping in the baked final re-runs these checks against it.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { AVATAR, AVATAR_URL, MATERIALS, NODES, TOWN_JSON_URL, TOWN_URL } from '../src/explore/config.js';

const publicFile = (url) => new URL(`../public${url}`, import.meta.url);

function readGlbJson(file) {
  const b = readFileSync(file);
  expect(b.subarray(0, 4).toString('latin1')).toBe('glTF');
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
}

describe('town GLB (TOWN_URL)', () => {
  const j = readGlbJson(publicFile(TOWN_URL));
  const nodes = j.nodes.map((n) => n.name);
  const mats = new Set(j.materials.map((m) => m.name));

  it.each(Object.entries(MATERIALS))('material group "%s" exists by name', (_group, names) => {
    for (const n of names) expect(mats.has(n), n).toBe(true);
  });

  it('the sea, ground and street nodes exist', () => {
    for (const n of [NODES.sea, NODES.ground, NODES.street]) expect(nodes, n).toContain(n);
  });

  it('lanterns, flags, signs and chimney anchors resolve by name', () => {
    const lanterns = nodes.filter((n) => (n.startsWith('lamp') && !n.startsWith('lamp_post')) || n.endsWith('_lantern'));
    expect(lanterns.length).toBeGreaterThanOrEqual(8);
    for (const p of NODES.flagPrefixes) expect(nodes.some((n) => n.startsWith(p)), p).toBe(true);
    expect(nodes.some((n) => n.endsWith(NODES.signSuffix))).toBe(true);
    for (const n of NODES.smoke) expect(nodes, n).toContain(n);
    for (const p of NODES.noCollide) expect(nodes.some((n) => n.startsWith(p)), p).toBe(true);
  });

  it('is Y-up metres with emissive strength on the glowing materials', () => {
    const emissive = j.materials.filter((m) => MATERIALS.emissive.includes(m.name));
    expect(emissive.length).toBe(MATERIALS.emissive.length);
    for (const m of emissive) expect(m.emissiveFactor?.some((v) => v > 0), m.name).toBe(true);
  });
});

describe('town.json (TOWN_JSON_URL)', () => {
  it('has a spawn and the eight zones', () => {
    const town = JSON.parse(readFileSync(publicFile(TOWN_JSON_URL), 'utf8'));
    expect(town.landmarks.spawn.pos).toHaveLength(3);
    const zones = Object.values(town.landmarks).filter((l) => l && l.zone).map((l) => l.zone);
    expect(zones.sort()).toEqual(['about', 'achievements', 'chat', 'contact', 'journey', 'projects', 'promo', 'skills']);
  });
});

describe('avatar GLB (AVATAR_URL)', () => {
  const j = readGlbJson(publicFile(AVATAR_URL));
  it('has every clip the controller plays', () => {
    const clips = j.animations.map((a) => a.name);
    for (const c of AVATAR.clips) expect(clips, c).toContain(c);
  });
  it('has the Blink, Smile and Mouth_Open morph targets', () => {
    const targets = j.meshes.flatMap((m) => m.extras?.targetNames ?? []);
    for (const t of AVATAR.morphs) expect(targets, t).toContain(t);
  });
});

// The baked final (blender/export/town.glb) is swapped in later under the same names. Until then this
// records which hooks it already satisfies, so the swap cannot silently lose the glow or the sea.
const BAKED = new URL('../blender/export/town.glb', import.meta.url);
describe.skipIf(!existsSync(BAKED))('baked town v6 compatibility (blender/export/town.glb)', () => {
  const j = readGlbJson(BAKED);
  const nodes = new Set(j.nodes.map((n) => n.name));
  const mats = new Set(j.materials.map((m) => m.name));
  it('keeps the emissive, ground and water materials and the sea/ground/street nodes', () => {
    for (const n of [...MATERIALS.emissive, ...MATERIALS.street, 'Sand', 'Sea', 'Water']) expect(mats.has(n), n).toBe(true);
    for (const n of [NODES.sea, NODES.ground, NODES.street]) expect(nodes.has(n), n).toBe(true);
  });
  it('uses only extensions the self-hosted loader stack handles (Draco, WebP)', () => {
    const supported = ['KHR_draco_mesh_compression', 'EXT_texture_webp', 'KHR_materials_emissive_strength', 'KHR_materials_specular', 'KHR_texture_transform'];
    for (const e of j.extensionsRequired ?? []) expect(supported, e).toContain(e);
  });
});
