// P3.1 Explore engine: pure maths and rules (no GPU, no DOM).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BoxGeometry, PlaneGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import { angleDelta, approach, castDown, damp, inputVector, resolveCapsule, sampleGrid, softWall, stepUpHeight, worldMove } from '../src/explore/controller-math.js';
import { AdaptiveResolution, isIntegratedGpu, lowerTier, pickTier, tierSettings } from '../src/explore/quality.js';
import { DAY, NIGHT, ease, startTransition, stepTransition, timeOfDay } from '../src/explore/time-of-day.js';
import { ZONE_ANCHORS, arrowAngle, loadZones, nearestZone, nextUnvisited } from '../src/explore/zones.js';
import { createProgress } from '../src/explore/loader-progress.js';
import { GRADES } from '../src/explore/grades.js';
import { PLAYER, TIER_SETTINGS, TIERS } from '../src/explore/config.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

/** A flat floor at y = 0, a wall at x ∈ [2, 3], and a 0.3 m step at z ∈ [-3, -2]. */
function testWorld() {
  const floor = new PlaneGeometry(40, 40).rotateX(-Math.PI / 2);
  const wall = new BoxGeometry(1, 4, 10).translate(2.5, 2, 0);
  const step = new BoxGeometry(4, 0.3, 1).translate(-5, 0.15, -2.5);
  const geometry = mergeGeometries([floor.toNonIndexed(), wall.toNonIndexed(), step.toNonIndexed()], false);
  return new MeshBVH(geometry, { indirect: true });
}

describe('controller maths', () => {
  it('input is normalised on diagonals and keeps analog magnitude', () => {
    const d = inputVector({ forward: true, right: true });
    expect(close(Math.hypot(d.x, d.z), 1)).toBe(true);
    expect(inputVector({ x: 0.5, y: 0 }).magnitude).toBeCloseTo(0.5);
    expect(inputVector({}).magnitude).toBe(0);
  });

  it('camera-relative movement: yaw 0 looks down −Z, right is +X', () => {
    const fwd = worldMove({ x: 0, z: 1 }, 0);
    expect(close(fwd.x, 0) && close(fwd.z, -1)).toBe(true);
    const right = worldMove({ x: 1, z: 0 }, 0);
    expect(close(right.x, 1) && close(right.z, 0)).toBe(true);
    const turned = worldMove({ x: 0, z: 1 }, Math.PI / 2); // camera turned left 90°
    expect(close(turned.x, -1) && close(turned.z, 0, 1e-9)).toBe(true);
  });

  it('damping is frame-rate independent', () => {
    let a = 0;
    for (let i = 0; i < 60; i += 1) a = approach(a, 1, 8, 1 / 60);
    let b = 0;
    for (let i = 0; i < 30; i += 1) b = approach(b, 1, 8, 1 / 30);
    expect(Math.abs(a - b)).toBeLessThan(1e-9);
    expect(damp(8, 0)).toBe(0);
  });

  it('angleDelta takes the short way round', () => {
    expect(angleDelta(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(-0.2);
    expect(angleDelta(-3, 3)).toBeCloseTo(6 - Math.PI * 2);
  });
});

describe('capsule vs BVH collision (three-mesh-bvh)', () => {
  const bvh = testWorld();
  const R = PLAYER.radius;
  const H = PLAYER.height;

  it('a capsule sunk into the floor is pushed up to rest on it', () => {
    const feet = new Vector3(0, -0.2, 0);
    const { segment, groundNormalY } = resolveCapsule(bvh, feet.clone().setY(feet.y + R), feet.clone().setY(feet.y + H - R), R);
    expect(segment.start.y - R).toBeCloseTo(0, 2);
    expect(groundNormalY).toBeCloseTo(1, 3);
  });

  it('a capsule overlapping the wall is pushed out sideways, not up', () => {
    const feet = new Vector3(2.0 - R + 0.1, 0.02, 0);
    const { segment } = resolveCapsule(bvh, feet.clone().setY(feet.y + R), feet.clone().setY(feet.y + H - R), R);
    expect(segment.start.x).toBeLessThanOrEqual(2.0 - R + 1e-3);
  });

  it('a capsule in open air is untouched', () => {
    const feet = new Vector3(-8, 5, 8);
    const { segment, groundNormalY } = resolveCapsule(bvh, feet.clone().setY(feet.y + R), feet.clone().setY(feet.y + H - R), R);
    expect(segment.start.distanceTo(new Vector3(-8, 5 + R, 8))).toBeLessThan(1e-9);
    expect(groundNormalY).toBe(-1);
  });

  it('castDown finds the floor and the step top', () => {
    expect(castDown(bvh, new Vector3(0, 5, 0), 10).point.y).toBeCloseTo(0, 5);
    expect(castDown(bvh, new Vector3(-5, 5, -2.5), 10).point.y).toBeCloseTo(0.3, 5);
    expect(castDown(bvh, new Vector3(0, 5, 0), 1)).toBeNull();
  });

  it('step assist climbs a 0.3 m step but not a 4 m wall', () => {
    const rise = stepUpHeight(bvh, new Vector3(-5, 0, -1.6), 0, -1, R, PLAYER.stepHeight);
    expect(rise).toBeCloseTo(0.3, 3);
    expect(stepUpHeight(bvh, new Vector3(1.4, 0, 0), 1, 0, R, PLAYER.stepHeight)).toBe(0);
    expect(stepUpHeight(bvh, new Vector3(0, 0, 0), 0, 0, R, PLAYER.stepHeight)).toBe(0);
  });
});

describe('island soft wall and height grid', () => {
  it('pushes back towards the centre only when the water is deep', () => {
    const shallow = softWall({ x: 30, z: 0 }, () => 0.05);
    expect(shallow).toMatchObject({ x: 0, z: 0 });
    const deep = softWall({ x: 30, z: 0 }, () => 1.2);
    expect(deep.x).toBeLessThan(0);
    expect(Math.abs(deep.z)).toBeLessThan(1e-9);
  });

  it('samples a height grid bilinearly and returns null outside it', () => {
    const grid = new Float32Array([0, 1, 2, 3]); // 2×2 over [-1, 1]²
    expect(sampleGrid(grid, 2, 1, 0, 0)).toBeCloseTo(1.5);
    expect(sampleGrid(grid, 2, 1, -1, -1)).toBe(0);
    expect(sampleGrid(grid, 2, 1, 5, 0)).toBeNull();
  });
});

describe('quality tiers', () => {
  it('auto-selects conservatively and never picks ULTRA', () => {
    expect(pickTier({ software: true, backend: 'webgpu', deviceMemory: 32, cores: 16 })).toBe('LOW');
    expect(pickTier({ saveData: true })).toBe('LOW');
    expect(pickTier({ mobile: true, deviceMemory: 4, cores: 8 })).toBe('LOW');
    expect(pickTier({ backend: 'webgpu', deviceMemory: 16, cores: 12 })).toBe('HIGH');
    expect(pickTier({ backend: 'webgpu', deviceMemory: 16, cores: 12, integrated: true })).toBe('MEDIUM');
    expect(pickTier({ backend: 'webgl', deviceMemory: 16, cores: 12 })).toBe('MEDIUM');
    for (const args of [{}, { backend: 'webgpu', deviceMemory: 64, cores: 64 }]) expect(pickTier(args)).not.toBe('ULTRA');
  });

  it('recognises integrated GPUs from adapter strings', () => {
    expect(isIntegratedGpu('intel gen-12lp')).toBe(true);
    expect(isIntegratedGpu('ANGLE (Intel, Intel(R) UHD Graphics Direct3D11)')).toBe(true);
    expect(isIntegratedGpu('nvidia ampere')).toBe(false);
  });

  it('LOW is tone mapping + fog + cheap bloom only; effects grow with the tier', () => {
    const low = tierSettings('LOW');
    expect(low.bloom).toBe('cheap');
    for (const k of ['ao', 'ssr', 'dof', 'godrays', 'lensflare', 'lut', 'grain', 'ca', 'smaa']) expect(low[k], k).toBe(false);
    const count = (t) => ['ao', 'ssr', 'dof', 'godrays', 'lensflare', 'lut', 'grain', 'ca', 'smaa'].filter((k) => TIER_SETTINGS[t][k]).length;
    for (let i = 1; i < TIERS.length; i += 1) expect(count(TIERS[i])).toBeGreaterThanOrEqual(count(TIERS[i - 1]));
    expect(TIER_SETTINGS.ULTRA.lanterns).toBeGreaterThan(TIER_SETTINGS.MEDIUM.lanterns);
  });

  it('the WebGL2 backend drops god rays (and SSR below ULTRA); unknown tiers fall back to LOW', () => {
    expect(tierSettings('ULTRA', 'webgl').godrays).toBe(false);
    expect(tierSettings('HIGH', 'webgl').ssr).toBe(false);
    expect(tierSettings('ULTRA', 'webgl').ssr).toBe(true);
    expect(tierSettings('HIGH', 'webgpu').ssr).toBe(true);
    expect(tierSettings('<script>').tier).toBe('LOW');
    expect(lowerTier('HIGH')).toBe('MEDIUM');
    expect(lowerTier('LOW')).toBe('LOW');
  });

  it('adaptive resolution lowers the scale when slow, recovers when fast, and asks for a lower tier at the floor', () => {
    const a = new AdaptiveResolution({ target: 55, min: 0.55, window: 1, downAfter: 3 });
    let r;
    for (let i = 0; i < 30 * 8; i += 1) r = a.update(1 / 30); // 30 fps for 8 s
    expect(a.scale).toBeCloseTo(0.55, 5);
    const b = new AdaptiveResolution({ target: 55, min: 0.55, window: 1, downAfter: 3 });
    let asked = false;
    for (let i = 0; i < 20 * 12; i += 1) asked = b.update(1 / 20).wantLowerTier || asked; // 20 fps
    expect(asked).toBe(true);
    const c = new AdaptiveResolution({ target: 55, min: 0.55, window: 1 });
    c.scale = 0.6;
    for (let i = 0; i < 90 * 15; i += 1) r = c.update(1 / 90); // 0.6 → 1 in 0.04 steps: ten 1 s windows
    expect(c.scale).toBe(1);
    expect(r.wantLowerTier).toBe(false);
  });
});

describe('time of day', () => {
  it('t = 0 is golden hour, t = 1 is night, and values interpolate', () => {
    expect(timeOfDay(0).sunIntensity).toBeCloseTo(DAY.sunIntensity);
    expect(timeOfDay(1).lanternIntensity).toBe(NIGHT.lanternIntensity);
    const mid = timeOfDay(0.5);
    expect(mid.fogDensity).toBeCloseTo((DAY.fogDensity + NIGHT.fogDensity) / 2);
    expect(timeOfDay(NaN).t).toBe(0);
    expect(timeOfDay(7).t).toBe(1);
  });

  it('golden hour is low and warm, never flat noon; the light never dips below the horizon', () => {
    const day = timeOfDay(0);
    expect(day.sunDir[1]).toBeLessThan(0.35); // low sun → long shadows
    expect(day.sunColor[0]).toBeGreaterThan(day.sunColor[2]); // warm
    for (let t = 0; t <= 1; t += 0.05) {
      const s = timeOfDay(t).sunDir;
      expect(s[1]).toBeGreaterThan(0.05);
      expect(Math.hypot(...s)).toBeCloseTo(1, 5);
    }
  });

  it('the switch takes about 2 s with an eased curve', () => {
    let s = startTransition(0, 1);
    let time = 0;
    while (!s.done && time < 5) {
      s = stepTransition(s, 1 / 60, 2);
      time += 1 / 60;
    }
    expect(time).toBeGreaterThan(1.95);
    expect(time).toBeLessThan(2.05);
    expect(s.t).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5);
    expect(ease(0.1)).toBeLessThan(0.1);
  });
});

describe('zones from town.json', () => {
  const town = JSON.parse(readFileSync(new URL('../public/models/town.json', import.meta.url), 'utf8'));
  const { spawn, zones } = loadZones(town);

  it('reads the spawn and all eight zones, each mapped to a Classic anchor', () => {
    expect(spawn.pos).toEqual(town.landmarks.spawn.pos);
    expect(zones.map((z) => z.zone).sort()).toEqual(Object.keys(ZONE_ANCHORS).sort());
    for (const z of zones) expect(z.anchor).toBe(ZONE_ANCHORS[z.zone]);
  });

  it('triggers on the door position, nearest first', () => {
    const office = zones.find((z) => z.zone === 'about');
    expect(nearestZone(office.door, zones, PLAYER.zoneRadius).zone).toBe('about');
    expect(nearestZone(spawn.pos, zones, PLAYER.zoneRadius)).toBeNull();
    const npc = zones.find((z) => z.zone === 'chat');
    expect(nearestZone(npc.door, zones, PLAYER.zoneRadius).zone).toBe('chat');
  });

  it('the edge arrow points to the nearest unvisited zone, and stops when all are visited', () => {
    const visited = new Set();
    const first = nextUnvisited(spawn.pos, zones, visited);
    expect(first).not.toBeNull();
    for (const z of zones) visited.add(z.zone);
    expect(nextUnvisited(spawn.pos, zones, visited)).toBeNull();
    expect(arrowAngle([0, 0, 0], [0, 0, -10], 0)).toBeCloseTo(0); // straight ahead
    expect(arrowAngle([0, 0, 0], [10, 0, 0], 0)).toBeCloseTo(Math.PI / 2); // to the right
  });

  it('ignores landmarks without a known zone or with bad coordinates', () => {
    const { zones: z } = loadZones({ landmarks: { a: { zone: 'evil', door: [0, 0, 0], center: [0, 0, 0] }, b: { zone: 'about', door: ['x'], center: [0, 0, 0] }, c: null } });
    expect(z).toEqual([]);
    expect(loadZones(null).zones).toEqual([]);
  });
});

describe('loader progress', () => {
  it('weights files, handles unknown sizes and never goes backwards', () => {
    const p = createProgress({ town: 70, avatar: 20, build: 10 });
    expect(p.update('town', 50, 100)).toBe(35);
    expect(p.update('avatar', 10, 0)).toBe(35); // unknown total → no jump
    expect(p.update('town', 10, 100)).toBe(35); // never backwards
    p.done('town');
    p.done('avatar');
    expect(p.value()).toBe(90);
    expect(p.done('build')).toBe(100);
    expect(p.update('nope', 1, 1)).toBe(100);
  });
});

describe('procedural colour grades (3D LUTs)', () => {
  const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  it('stay in range for every input', () => {
    for (const grade of [GRADES.day, GRADES.night]) {
      for (const c of [[0, 0, 0], [1, 1, 1], [1, 0, 0], [0.2, 0.5, 0.9]]) for (const v of grade(c)) expect(v).toBeGreaterThanOrEqual(0) && expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('night pushes shadows teal-blue and highlights orange; day warms highlights', () => {
    const shadow = GRADES.night([0.1, 0.1, 0.1]);
    expect(shadow[2]).toBeGreaterThan(shadow[0]);
    const high = GRADES.night([0.8, 0.8, 0.8]);
    expect(high[0]).toBeGreaterThan(high[2]);
    const dayHigh = GRADES.day([0.8, 0.8, 0.8]);
    expect(dayHigh[0]).toBeGreaterThan(dayHigh[2]);
    expect(lum(GRADES.day([0.5, 0.5, 0.5]))).toBeGreaterThan(0.3);
  });
});
