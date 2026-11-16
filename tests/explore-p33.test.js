// P3.3: the horse (asset, facing, state machine, riding maths, street graph against the real building
// footprints), the boat arrival's once-only rule, and the procedural score (look-ahead scheduler, mood
// crossfade, node reuse) with a mocked AudioContext.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Box3, Vector3 } from 'three';
import { AVATAR, AVATAR_URL, HORSE, HORSE_JSON_URL, HORSE_URL, TOWN_JSON_URL } from '../src/explore/config.js';
import { buildStreetGraph, findPath, pathLength } from '../src/explore/horse-path.js';
import { createHorseMachine } from '../src/explore/horse-machine.js';
import { GAITS, createRide, gaitFor, parseGaitSpeeds, rideStep, turnRadius, yawRate } from '../src/explore/horse-ride.js';
import { SCORE, createMoodMixer, createScheduler, indexScore, midiToFreq } from '../src/explore/music-core.js';
import { glbJson, meshBounds, nodePositions } from './helpers/glb-bounds.js';
import { ROOT } from './helpers/build-site.js';

const pub = (url) => join(ROOT, 'public', url);
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const src = (f) => strip(readFileSync(join(ROOT, 'src', 'explore', f), 'utf8'));

describe('horse asset (HORSE_URL) and the avatar clips it needs', () => {
  const j = glbJson(pub(HORSE_URL));
  const meta = JSON.parse(readFileSync(pub(HORSE_JSON_URL), 'utf8'));

  it('has Idle, Walk, Trot, Gallop and HeadShake, Draco-compressed, supported extensions only', () => {
    const clips = j.animations.map((a) => a.name);
    for (const c of HORSE.clips) expect(clips, c).toContain(c);
    expect(meta.clips.sort()).toEqual([...HORSE.clips].sort());
    expect(j.extensionsUsed).toContain('KHR_draco_mesh_compression');
    for (const e of j.extensionsRequired ?? []) expect(['KHR_draco_mesh_compression'], e).toContain(e);
  });

  it('faces +Z in three.js (Blender −Y), so the code needs no yaw correction', () => {
    const p = nodePositions(pub(HORSE_URL), ['head', 'tail', 'f_hoof.L', 'h_hoof.L', 'root']);
    expect(p.head.z).toBeGreaterThan(p.tail.z + 1);
    expect(p['f_hoof.L'].z).toBeGreaterThan(p['h_hoof.L'].z);
    expect(Math.abs(p.root.y)).toBeLessThan(0.05); // origin at the hooves
    expect(HORSE.forwardYaw).toBe(0);
  });

  it('horse.json gives the rider bone and offset, the whistle clips and the gait speeds', () => {
    expect(meta.rider.attach_bone).toBe('spine');
    expect(meta.rider.root_offset_three).toHaveLength(3);
    expect(j.nodes.some((n) => n.name === meta.rider.attach_bone)).toBe(true);
    expect(meta.rider.avatar_clip).toBe('Ride');
    expect(meta.whistle).toEqual({ avatar_clip: 'Whistle', horse_reply_clip: 'HeadShake' });
    expect(parseGaitSpeeds(meta)).toEqual({ Walk: 1.6, Trot: 3.5, Gallop: 8 });
  });

  it('the avatar has Whistle and Ride', () => {
    const clips = glbJson(pub(AVATAR_URL)).animations.map((a) => a.name);
    for (const c of ['Whistle', 'Ride']) {
      expect(clips, c).toContain(c);
      expect(AVATAR.clips).toContain(c);
    }
  });
});

describe('horse state machine (whistle → travel → arrive → idle → mount → ride → dismount)', () => {
  const run = (m, s, dt = 1 / 30) => {
    const ev = [];
    for (let t = 0; t < s; t += dt) ev.push(...m.step(dt));
    return ev;
  };

  it('runs the whole cycle in order', () => {
    const m = createHorseMachine();
    expect(m.state).toBe('absent');
    expect(m.whistle({ reachable: true })).toEqual({ ok: true });
    expect(m.state).toBe('called');
    expect(run(m, 1.2)).toContain('depart');
    expect(m.state).toBe('travel');
    expect(m.mount({ near: true })).toBe(false); // not while it is still on its way
    m.arrived();
    expect(m.state).toBe('greet');
    const ev = run(m, 2);
    expect(ev).toContain('greeting');
    expect(ev).toContain('greeted');
    expect(m.state).toBe('idle');
    expect(m.mount({ near: false })).toBe(false);
    expect(m.mount({ near: true })).toBe(true);
    expect(run(m, 0.6)).toContain('mounted');
    expect(m.state).toBe('ridden');
    expect(m.riding).toBe(true);
    expect(m.dismount({ speed: 6 })).toBe(false); // not at a gallop
    expect(m.dismount({ speed: 0.4 })).toBe(true);
    expect(run(m, 0.6)).toContain('dismounted');
    expect(m.state).toBe('idle');
  });

  it('unreachable (the dock): whistle refuses and nothing changes; riding refuses too', () => {
    const m = createHorseMachine();
    expect(m.whistle({ reachable: false })).toEqual({ ok: false, reason: 'unreachable' });
    expect(m.state).toBe('absent');
    m.whistle({ reachable: true });
    expect(m.whistle({ reachable: true }).reason).toBe('coming');
    run(m, 1.2);
    m.arrived();
    run(m, 2);
    m.mount({ near: true });
    run(m, 0.6);
    expect(m.whistle({ reachable: true }).reason).toBe('riding');
  });

  it('opening a case file while riding dismounts at once; idling long enough wanders, then settles', () => {
    const m = createHorseMachine({ wanderAfter: 3, wander: 1 });
    m.whistle({ reachable: true });
    run(m, 1.2);
    m.arrived();
    run(m, 2);
    m.mount({ near: true });
    run(m, 0.6);
    expect(m.forceDismount()).toBe(true);
    expect(m.state).toBe('idle');
    expect(run(m, 3.1)).toContain('wander');
    run(m, 1.1);
    expect(m.state).toBe('idle');
    expect(m.whistle({ reachable: true }).ok).toBe(true); // whistle again from somewhere else
  });
});

describe('riding maths', () => {
  const speeds = { Walk: 1.6, Trot: 3.5, Gallop: 8 };
  const press = (st, input, seconds, dt = 1 / 60) => {
    for (let t = 0; t < seconds; t += dt) rideStep(st, input, dt);
    return st;
  };

  it('W steps Walk → Trot → Gallop and the speed settles on each gait speed from horse.json', () => {
    const st = createRide(speeds);
    press(st, { forward: true }, 0.01);
    press(st, {}, 3);
    expect(st.level).toBe(1);
    expect(st.speed).toBeCloseTo(1.6, 2);
    expect(st.gait).toBe('Walk');
    press(st, { forward: true }, 0.01);
    press(st, {}, 3);
    expect(st.speed).toBeCloseTo(3.5, 2);
    expect(st.gait).toBe('Trot');
    press(st, { forward: true }, 0.5);
    press(st, {}, 4);
    expect(st.level).toBe(3);
    expect(st.speed).toBeCloseTo(8, 2);
    expect(st.gait).toBe('Gallop');
    press(st, { forward: true }, 2);
    expect(st.level).toBe(3); // no gait above Gallop
  });

  it('S slows a gait at a time, and held at a stand backs up at walk speed (forward again on release)', () => {
    const st = createRide(speeds);
    press(st, { forward: true }, 0.5);
    press(st, {}, 3);
    expect(st.level).toBe(2);
    press(st, { back: true }, 0.01);
    press(st, {}, 3);
    expect(st.level).toBe(1);
    press(st, { back: true }, 0.01);
    press(st, {}, 3);
    expect(st.speed).toBeCloseTo(0, 2);
    press(st, { back: true }, 3);
    expect(st.level).toBe(-1);
    expect(st.speed).toBeCloseTo(-1.6, 2);
    press(st, {}, 2);
    expect(st.speed).toBeCloseTo(0, 2);
  });

  it('the turn radius grows with speed, and the yaw rate is v / R (pivot on the spot)', () => {
    expect(turnRadius(0)).toBe(1);
    expect(turnRadius(1.6)).toBeLessThan(turnRadius(3.5));
    expect(turnRadius(3.5)).toBeLessThan(turnRadius(8));
    for (const v of [1.6, 3.5, 8]) expect(yawRate(v, 1)).toBeCloseTo(Math.min(1.4, v / turnRadius(v)), 6);
    expect(yawRate(0, 1)).toBe(1);
    expect(yawRate(-1.6, 1)).toBeLessThan(0); // backing up reverses the steering
    expect(GAITS).toEqual(['Idle', 'Walk', 'Trot', 'Gallop']);
    expect(gaitFor(0.1, speeds)).toBe('Idle');
    expect(gaitFor(7, speeds)).toBe('Gallop');
  });

  it('no jumping on horseback, and riding stays on land (water halts the horse)', () => {
    const index = src('index.js');
    expect(index).toMatch(/\} else if \(riding\) \{[\s\S]{0,600}?input\.take\('jump'\);/);
    const horse = src('horse.js');
    // P3.4: the whole footprint must stay on dry land (horse-land.js), not just the origin.
    expect(horse).toMatch(/if \(!bodyDry\(nx, nz, yaw\)\) return false;/);
    expect(horse).toMatch(/resolveCapsule\(bvh, segA, segB, HORSE\.radius\)/);
  });
});

describe('street graph (from town.json) against the real building footprints', () => {
  const town = JSON.parse(readFileSync(pub(TOWN_JSON_URL), 'utf8'));
  const graph = buildStreetGraph(town);
  const bounds = meshBounds(pub('/models/town.glb'));
  const buildings = Object.entries(bounds).filter(([k]) => /^(Bank|Blacksmith|Lighthouse|PictureHouse|Saloon|SheriffOffice|Station|Telegraph)_baked$/.test(k));
  // The Bounty Board is merged into Props_baked; its footprint from blender/town/kit.py (frame 4.7 m
  // wide, 0.3 m deep) around the town.json centre.
  const b = town.landmarks.bounty.center;
  const board = ['BountyBoard', new Box3(new Vector3(b[0] - 2.35, 0, b[2] - 0.15), new Vector3(b[0] + 2.35, 4, b[2] + 0.15))];
  const distToBox = (x, z, box) => Math.hypot(Math.max(box.min.x - x, 0, x - box.max.x), Math.max(box.min.z - z, 0, z - box.max.z));
  const pos = new Map(graph.nodes.map((n) => [n.id, n]));

  it('derives every node from town.json landmarks (no fixed coordinates)', () => {
    expect(graph.nodes.length).toBeGreaterThanOrEqual(15);
    const code = src('horse-path.js');
    expect(code).not.toMatch(/add\('[^']+', -?\d+(?:\.\d+)?, -?\d+/); // no literal positions
  });

  it('no edge passes within the horse radius of a building (sampled every 0.25 m)', () => {
    expect(buildings.length).toBe(8);
    const R = HORSE.radius;
    const hits = [];
    for (const [a, c] of graph.edges) {
      const A = pos.get(a);
      const C = pos.get(c);
      const len = Math.hypot(C.x - A.x, C.z - A.z);
      for (let t = 0; t <= len; t += 0.25) {
        const x = A.x + ((C.x - A.x) * t) / len;
        const z = A.z + ((C.z - A.z) * t) / len;
        for (const [name, box] of [...buildings, board]) {
          if (distToBox(x, z, box) < R) hits.push(`${a}–${c} ${name}`);
        }
      }
    }
    expect([...new Set(hits)]).toEqual([]);
  });

  it('never goes onto the dock, and every node can reach every other', () => {
    const dock = bounds.Dock_baked;
    for (const n of graph.nodes) expect(n.x > dock.min.x - 0.2 && n.x < dock.max.x + 0.2 && n.z > dock.min.z && n.z < dock.max.z, n.id).toBe(false);
    for (const n of graph.nodes) expect(findPath(graph, 'north', n.id), n.id).toBeTruthy();
    const p = findPath(graph, 'dock-base', 'forecourt');
    expect(p[0]).toBe('dock-base');
    expect(p.at(-1)).toBe('forecourt');
    expect(pathLength(graph, p)).toBeGreaterThan(40);
  });
});

describe('boat arrival and opening: once-only rules', () => {
  it('the arrival runs only when explore.arrival is not "seen", and stores "seen" only after a first run', () => {
    const c = src('index.js');
    expect(c).toMatch(/if \(readPref\(ARRIVAL_KEY, ARRIVAL_VALUES, null\) !== 'seen'\) runArrival\(true\);/);
    expect(c).toMatch(/if \(first\) writePref\(ARRIVAL_KEY, 'seen', ARRIVAL_VALUES\);/);
    expect(c).toMatch(/replayArrival\(\) \{\s*runArrival\(false\);/);
  });

  it('the arrival is skippable (Skip focused, any key but Tab/modifiers, a click) and lasts about 9.5 s', () => {
    const c = src('arrival.js');
    // P3.4: 8 → 9.5 s, so the sheriff can stand, cross the boat and step up onto the dock.
    expect(c).toMatch(/export const ARRIVAL_SECONDS = 9\.5;/);
    expect(c).toMatch(/skipBtn\.focus\(/);
    expect(c).toMatch(/window\.addEventListener\('keydown', onKey, true\)/);
    expect(c).toMatch(/overlay\.addEventListener\('pointerdown', finish\)/);
    expect(c).toMatch(/SKIP_IGNORE = \['Tab', 'Shift', 'Control', 'Alt', 'Meta'\]/);
  });

  it('the opening is ~3.5 s and the hero stays rendered underneath (no display:none on main)', () => {
    const start = readFileSync(join(ROOT, 'src', 'ui', 'start.js'), 'utf8');
    expect(start).toMatch(/export const OPENING_SECONDS = 3\.6;/);
    const css = readFileSync(join(ROOT, 'src', 'styles', 'main.css'), 'utf8');
    expect(css).not.toMatch(/html\[data-boot[^\]]*\][^{]*main[^{]*\{[^}]*display:\s*none/);
  });
});

/** A minimal AudioContext stand-in that records what the score does. */
function mockAudio() {
  const calls = { osc: 0, buffers: 0, sources: 0 };
  const param = (v = 0) => ({
    value: v,
    events: [],
    setValueAtTime(x, t) {
      this.events.push(['set', x, t]);
    },
    linearRampToValueAtTime(x, t) {
      this.events.push(['ramp', x, t]);
    },
    setTargetAtTime(x, t) {
      this.events.push(['target', x, t]);
    },
    exponentialRampToValueAtTime(x, t) {
      this.events.push(['exp', x, t]);
    },
    cancelScheduledValues() {},
  });
  const node = (extra = {}) => ({ connect: (n) => n, disconnect() {}, ...extra });
  const ctx = {
    currentTime: 0,
    sampleRate: 4000,
    state: 'running',
    createGain: () => node({ gain: param(1) }),
    createOscillator: () => {
      calls.osc += 1;
      return node({ type: 'sine', frequency: param(440), start() {}, stop() {} });
    },
    createBiquadFilter: () => node({ type: '', frequency: param(), Q: param() }),
    createConvolver: () => node({ buffer: null }),
    createBufferSource: () => {
      calls.sources += 1;
      return node({ buffer: null, loop: false, playbackRate: param(1), start() {}, stop() {} });
    },
    createBuffer: (ch, len, sr) => {
      calls.buffers += 1;
      const data = Array.from({ length: ch }, () => new Float32Array(len));
      return { getChannelData: (c) => data[c], length: len, sampleRate: sr, numberOfChannels: ch };
    },
  };
  return { ctx, calls };
}

describe('score: look-ahead scheduler and mood crossfade (mocked AudioContext)', () => {
  afterEach(() => vi.useRealTimers());

  it('schedules exactly the steps inside the look-ahead window, at exact audio times', () => {
    let now = 0;
    const steps = [];
    const s = createScheduler({ now: () => now, bpm: 84, steps: 128, lookAhead: 0.2, onStep: (step, time) => steps.push([step, time]) });
    const dur = 60 / 84 / 4;
    s.start(0);
    s.tick();
    expect(steps.length).toBe(Math.ceil(0.2 / dur));
    for (let k = 1; k <= 20; k += 1) {
      now = k * 0.05; // a 50 ms timer
      s.tick();
    }
    expect(steps.at(-1)[1]).toBeLessThan(1.2);
    expect(steps.at(-1)[1]).toBeGreaterThan(1.2 - dur);
    for (let i = 1; i < steps.length; i += 1) expect(steps[i][1] - steps[i - 1][1]).toBeCloseTo(dur, 9);
    expect(steps.map(([n]) => n)).toEqual(steps.map((_, i) => i % 128));
  });

  it('after a stall it skips ahead instead of firing a burst of late notes; stop() stops', () => {
    let now = 0;
    let n = 0;
    const s = createScheduler({ now: () => now, bpm: 84, steps: 128, onStep: () => (n += 1) });
    s.start(0);
    s.tick();
    const before = n;
    now = 30; // tab hidden for 30 s
    s.tick();
    expect(n - before).toBeLessThan(5);
    s.stop();
    now = 31;
    expect(s.tick()).toBe(0);
  });

  it('the mood mixer crossfades day ↔ night with linear ramps over the fade time', () => {
    const { ctx } = mockAudio();
    const out = ctx.createGain();
    const mix = createMoodMixer({ ctx, out });
    ctx.currentTime = 10;
    mix.set('night', 2.5);
    expect(mix.mood).toBe('night');
    expect(mix.gains.night.gain.events.at(-1)).toEqual(['ramp', 1, 12.5]);
    expect(mix.gains.day.gain.events.at(-1)).toEqual(['ramp', 0, 12.5]);
    ctx.currentTime = 20;
    mix.set('day', 2.5);
    expect(mix.gains.day.gain.events.at(-1)).toEqual(['ramp', 1, 22.5]);
    expect(mix.set('noon')).toBe(false);
  });

  it('the composition: day 84 bpm with drums and whistle, night 66 bpm sparse with no drums, all in A minor', () => {
    expect(SCORE.day.bpm).toBe(84);
    expect(SCORE.night.bpm).toBe(66);
    expect(SCORE.night.kick).toEqual([]);
    expect(SCORE.night.whistle).toEqual([]);
    expect(SCORE.day.whistle.length).toBeGreaterThan(20);
    const scale = new Set([9, 11, 0, 2, 4, 5, 7, 8]); // A natural minor + G♯ (the E chord)
    for (const mood of [SCORE.day, SCORE.night]) {
      for (const [, m] of [...mood.whistle, ...mood.harmonica]) expect(scale.has(m % 12), String(m)).toBe(true);
      const at = indexScore(mood);
      expect(at).toHaveLength(mood.steps);
    }
    expect(midiToFreq(69)).toBe(440);
  });

  it('createMusic reuses its voices (no new oscillators per note) and caches plucks per pitch', async () => {
    vi.useFakeTimers();
    const { createMusic } = await import('../src/explore/music.js');
    const { ctx, calls } = mockAudio();
    const out = ctx.createGain();
    const noise = ctx.createBuffer(1, 400, 4000);
    const music = createMusic({ ctx, out, noise, night: false });
    expect(music.mood).toBe('day');
    const oscAfterInit = calls.osc;
    const buffersAfterInit = calls.buffers;
    for (let i = 0; i < 400; i += 1) {
      ctx.currentTime += 0.05;
      vi.advanceTimersByTime(50);
    }
    expect(calls.osc).toBe(oscAfterInit); // persistent whistle / harmonica voices
    const pitches = new Set(SCORE.day.guitar.map(([, m]) => m)).size + new Set(SCORE.night.guitar.map(([, m]) => m)).size;
    expect(calls.buffers - buffersAfterInit).toBeLessThanOrEqual(pitches); // one pluck per pitch, cached
    expect(calls.sources).toBeGreaterThan(50); // notes were scheduled
    music.setMood(true);
    expect(music.mood).toBe('night');
    music.dispose();
  });
});
