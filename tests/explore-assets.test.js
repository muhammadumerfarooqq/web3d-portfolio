// P3.1 / P3.2: every node / material name the Explore code hooks exists in the GLBs, the avatar has
// the clips and morph targets the controller plays, and the train has the wheels the arrival spins.
// Files are read through the same constants the app uses (TOWN_URL, AVATAR_URL, TRAIN_URL), so a
// re-export re-runs these checks against it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { AVATAR, AVATAR_URL, MATERIALS, NODES, TOWN_JSON_URL, TOWN_URL, TRAIN, TRAIN_JSON_URL, TRAIN_URL, isLanternNode } from '../src/explore/config.js';
import { Texture } from 'three/webgpu';
import { upgradeMaterial, createMaterialUniforms } from '../src/explore/materials.js';

const publicFile = (url) => new URL(`../public${url}`, import.meta.url);

function readGlbJson(file) {
  const b = readFileSync(file);
  expect(b.subarray(0, 4).toString('latin1')).toBe('glTF');
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
}

/** Only extensions the self-hosted loader stack handles (Draco, WebP, core KHR material extensions). */
const SUPPORTED_EXT = ['KHR_draco_mesh_compression', 'EXT_texture_webp', 'KHR_materials_emissive_strength', 'KHR_materials_specular', 'KHR_texture_transform'];

describe('town GLB (TOWN_URL): the baked final', () => {
  const j = readGlbJson(publicFile(TOWN_URL));
  const nodes = j.nodes.map((n) => n.name);
  const mats = new Map(j.materials.map((m) => [m.name, m]));

  it('is the baked town, not the placeholder', () => {
    expect(TOWN_URL).toBe('/models/town.glb');
    expect(nodes.filter((n) => n.endsWith('_baked')).length).toBeGreaterThanOrEqual(11);
  });

  it.each(Object.entries(MATERIALS))('material group "%s" exists by name', (_group, names) => {
    for (const n of names) expect(mats.has(n), n).toBe(true);
  });

  it('every Baked_<Group> material carries its albedo × AO atlas; emissive, ground and sea materials do not', () => {
    for (const n of MATERIALS.baked) expect(mats.get(n).pbrMetallicRoughness?.baseColorTexture, n).toBeTruthy();
    for (const n of [...MATERIALS.emissive, ...MATERIALS.ground, ...MATERIALS.water]) expect(mats.get(n).pbrMetallicRoughness?.baseColorTexture, n).toBeFalsy();
  });

  it('the sea, ground, street, dock and lighthouse lamp nodes exist', () => {
    for (const n of [NODES.sea, NODES.ground, NODES.street, NODES.dock, NODES.lighthouseLamp]) expect(nodes, n).toContain(n);
  });

  it('lanterns (street, dock, building), flags and chimney anchors resolve by name', () => {
    const lanterns = nodes.filter(isLanternNode);
    expect(lanterns.length).toBeGreaterThanOrEqual(12);
    expect(lanterns.filter((n) => n.startsWith('dock_lamp')).length).toBe(2);
    expect(lanterns.some((n) => /post/.test(n))).toBe(false);
    for (const p of NODES.flagPrefixes) expect(nodes.some((n) => n.startsWith(p)), p).toBe(true);
    for (const n of NODES.smoke) expect(nodes, n).toContain(n);
    for (const p of NODES.noCollide) expect(nodes.some((n) => n.startsWith(p)), p).toBe(true);
  });

  it('is Y-up metres with emissive strength on the glowing materials', () => {
    for (const n of MATERIALS.emissive) expect(mats.get(n).emissiveFactor?.some((v) => v > 0), n).toBe(true);
  });

  it('uses only extensions the self-hosted loader stack handles', () => {
    for (const e of j.extensionsRequired ?? []) expect(SUPPORTED_EXT, e).toContain(e);
  });
});

describe('material upgrade pass on the baked names', () => {
  const u = createMaterialUniforms();
  const fake = (name, extra = {}) => ({ name, color: null, roughness: 0.8, metalness: 0, side: 0, transparent: false, opacity: 1, ...extra });
  const map = new Texture();

  it('baked materials keep their map untouched (the same object comes back)', () => {
    for (const n of MATERIALS.baked.filter((x) => x !== 'Baked_Dock')) {
      const m = fake(n, { map });
      expect(upgradeMaterial(m, u), n).toBe(m);
    }
  });

  it('the dock keeps its atlas and only gains a wet sheen (roughness node)', () => {
    const out = upgradeMaterial(fake('Baked_Dock', { map }), u);
    expect(out.map).toBe(map);
    expect(out.roughnessNode).toBeTruthy();
    expect(out.name).toBe('Baked_Dock');
  });

  it('ground, emissive and misc materials are upgraded to node materials; unknown names pass through', () => {
    for (const n of [...MATERIALS.ground, ...MATERIALS.emissive, ...MATERIALS.misc]) expect(upgradeMaterial(fake(n), u).isNodeMaterial, n).toBe(true);
    const other = fake('Something_Else');
    expect(upgradeMaterial(other, u)).toBe(other);
  });
});

describe('town.json (TOWN_JSON_URL)', () => {
  const town = JSON.parse(readFileSync(publicFile(TOWN_JSON_URL), 'utf8'));

  it('spawns at the end of the dock and has the eight zones, chat at the Saloon', () => {
    expect(town.landmarks.spawn.pos).toHaveLength(3);
    expect(town.landmarks.spawn.pos[2]).toBeGreaterThan(town.landmarks.dock.center[2]);
    const zones = Object.values(town.landmarks).filter((l) => l && l.zone).map((l) => l.zone);
    expect(zones.sort()).toEqual(['about', 'achievements', 'chat', 'contact', 'journey', 'projects', 'promo', 'skills']);
    expect(town.landmarks.saloon.zone).toBe('chat');
    expect(town.landmarks.dock.zone).toBeNull();
    expect(town.landmarks.lighthouse.zone).toBeNull();
  });

  it('the station carries the train block the arrival uses', () => {
    const t = town.landmarks.station.train;
    for (const k of ['rail_z', 'rail_top_y', 'enter_from_x', 'stop_x', 'exit_to_x']) expect(typeof t[k], k).toBe('number');
    expect(t.enter_from_x).toBeLessThan(t.stop_x);
    expect(t.exit_to_x).toBeGreaterThan(t.stop_x);
  });
});

describe('avatar GLB (AVATAR_URL)', () => {
  const j = readGlbJson(publicFile(AVATAR_URL));
  it('has every clip the controller plays, including Whistle and Ride', () => {
    const clips = j.animations.map((a) => a.name);
    for (const c of AVATAR.clips) expect(clips, c).toContain(c);
    expect(AVATAR.clips).toEqual(expect.arrayContaining(['Whistle', 'Ride', 'Wave']));
  });
  it('has the Blink, Smile and Mouth_Open morph targets', () => {
    const targets = j.meshes.flatMap((m) => m.extras?.targetNames ?? []);
    for (const t of AVATAR.morphs) expect(targets, t).toContain(t);
  });
  it('is Draco-compressed and uses only supported extensions', () => {
    expect(j.extensionsUsed).toContain('KHR_draco_mesh_compression');
    for (const e of j.extensionsRequired ?? []) expect(SUPPORTED_EXT, e).toContain(e);
  });
});

describe('train GLB (TRAIN_URL) and train.json', () => {
  const j = readGlbJson(publicFile(TRAIN_URL));
  const meta = JSON.parse(readFileSync(publicFile(TRAIN_JSON_URL), 'utf8'));
  const nodes = j.nodes.map((n) => n.name);

  it('has the Train root and every wheel train.json lists, each with a positive radius', () => {
    expect(nodes).toContain(TRAIN.root);
    expect(meta.wheels.length).toBeGreaterThanOrEqual(8);
    for (const w of meta.wheels) {
      expect(w.name.startsWith(TRAIN.wheelPrefix), w.name).toBe(true);
      expect(nodes, w.name).toContain(w.name);
      expect(w.radius).toBeGreaterThan(0);
    }
    expect(nodes.filter((n) => n.startsWith(TRAIN.wheelPrefix)).length).toBe(meta.wheels.length);
  });

  it('has the smoke stack, headlamp and emitter positions the arrival uses', () => {
    for (const n of ['loco_stack', 'loco_headlamp']) expect(nodes, n).toContain(n);
    for (const k of ['smoke_emitter', 'headlamp', 'whistle_at']) expect(meta[k], k).toHaveLength(3);
    expect(meta.travel_axis).toBe('+X');
  });

  it('uses only supported extensions', () => {
    for (const e of j.extensionsRequired ?? []) expect(SUPPORTED_EXT, e).toContain(e);
  });
});
