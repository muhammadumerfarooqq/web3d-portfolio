// P9.3 promo film assets: the cue sheet (single source of timing), the scripted footage spec, capture
// determinism, the offline audio (length, cue alignment, loudness record) and the guarantee that the
// dev-only capture tooling never reaches the production bundle.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CatmullRomCurve3, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { burstTimes, buildCues } from '../scripts/promo/build-cues.mjs';
import { BEAT, DURATION, SHOT_IDS, cueSheetSchema, frameToSample, validateCues } from '../scripts/promo/cue-schema.mjs';
import { validateShots } from '../scripts/promo/shot-schema.mjs';
import { LENGTH, SILENCE_FROM, STEP, at, buildScore } from '../scripts/promo/audio/score.mjs';
import { planBursts } from '../src/explore/fireworks.js';
import { SEA_LEVEL } from '../src/explore/config.js';
import { groundSampler } from './helpers/draco-mesh.js';
import { meshBounds } from './helpers/glb-bounds.js';
import { build } from 'vite';

const ROOT = join(import.meta.dirname, '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const json = (...p) => JSON.parse(read(...p));
const cues = json('docs', 'promo', 'cues.json');
const shots = json('docs', 'promo', 'shots.json');
const clone = (x) => JSON.parse(JSON.stringify(x));

describe('cue sheet (docs/promo/cues.json)', () => {
  it('is valid: 24 fps, 1080 frames, 96 bpm (beat 15, bar 60), scenes and music tile the film', () => {
    const c = validateCues(cues);
    expect([c.fps, c.duration, c.bpm, c.beatFrames, c.barFrames]).toEqual([24, 1080, 96, 15, 60]);
    expect(c.scenes.map((s) => s.id)).toEqual(['cold-open', 'office', 'workshop', 'bounties', 'railway', 'town', 'end-card']);
    expect(c.liveUrl).toBe('umerfarooq-ai.vercel.app');
    expect(c.text.some((t) => t.text === '{liveUrl}' && t.layer === 'end-url')).toBe(true);
  });

  it('is exactly what the generator writes from the storyboard and shots.json (never hand-edited)', () => {
    expect(buildCues(shots)).toEqual(cues);
  });

  it('every frame is inside the film, every shot F1–F10 is covered once, cuts land on beats, no overlaps per track', () => {
    for (const list of [cues.scenes, cues.shots, cues.music]) for (const r of list) expect(r.startFrame >= 0 && r.endFrame <= DURATION && r.startFrame < r.endFrame).toBe(true);
    for (const t of cues.text) expect(t.frame >= 0 && t.frame < DURATION && (t.endFrame ?? t.frame) <= DURATION).toBe(true);
    for (const s of cues.sfx) expect(s.frame >= 0 && s.frame < DURATION).toBe(true);
    expect(cues.shots.map((s) => s.id).sort()).toEqual([...SHOT_IDS].sort());
    for (const s of cues.shots) expect(s.startFrame % BEAT + (s.endFrame % BEAT)).toBe(0);
    for (const track of ['V1', 'V2']) {
      const list = cues.shots.filter((s) => s.track === track).sort((a, b) => a.startFrame - b.startFrame);
      for (let i = 1; i < list.length; i += 1) expect(list[i].startFrame).toBeGreaterThanOrEqual(list[i - 1].endFrame);
    }
  });

  it('the schema rejects overlaps, frames out of range, a missing shot and a sound in the final second', () => {
    const overlap = clone(cues);
    overlap.shots.find((s) => s.id === 'F2').startFrame = 75;
    expect(cueSheetSchema.safeParse(overlap).success).toBe(false);
    const late = clone(cues);
    late.sfx.push({ frame: 1080, sound: 'stamp', gain: 1 });
    expect(cueSheetSchema.safeParse(late).success).toBe(false);
    const missing = clone(cues);
    missing.shots = missing.shots.filter((s) => s.id !== 'F7');
    expect(cueSheetSchema.safeParse(missing).success).toBe(false);
    const tail = clone(cues);
    tail.sfx.push({ frame: 1070, sound: 'spur', gain: 0.5 });
    expect(cueSheetSchema.safeParse(tail).success).toBe(false);
  });

  it('has every storyboard hit: stamps, typewriter, an anvil per skill word, a pin and a CASE CLOSED per poster, 8 chimes, …', () => {
    const count = (sound) => cues.sfx.filter((s) => s.sound === sound).length;
    const words = cues.text.filter((t) => t.layer === 'word');
    expect(words.map((w) => w.text)).toEqual(['LLMs & RAG', 'COMPUTER VISION', 'PYTHON · FASTAPI', 'THREE.JS', 'BLENDER', 'AFTER EFFECTS', 'REACT · NEXT.JS', 'DOCKER · VERCEL']);
    for (const w of words) expect(cues.sfx.some((s) => s.sound === 'anvil' && s.frame === w.frame)).toBe(true);
    const posters = cues.text.filter((t) => t.layer === 'poster');
    expect(posters).toHaveLength(4);
    for (const p of posters) {
      expect(cues.sfx.some((s) => s.sound === 'pin' && s.frame === p.frame)).toBe(true);
      expect(cues.sfx.some((s) => s.sound === 'stamp' && s.frame === p.frame + BEAT)).toBe(true);
    }
    expect(count('chime')).toBe(8);
    expect(count('woodblock')).toBe(4);
    expect(count('whistle')).toBe(1);
    expect(count('spur')).toBe(1);
    expect(count('typewriter')).toBeGreaterThan(30);
    expect(count('ratchet')).toBeGreaterThan(15);
    expect(count('hooves')).toBeGreaterThan(10);
    expect(count('firework')).toBeGreaterThanOrEqual(2);
    expect(count('projector')).toBeGreaterThanOrEqual(5);
    expect(cues.sfx.find((s) => s.frame === 945 && s.sound === 'stamp').gain).toBe(1); // the deepest hit
  });

  it('the firework pops come from the same burst plan as the 3D fireworks in F8', () => {
    expect(burstTimes().map((t) => +t.toFixed(9))).toEqual(planBursts().map((b) => +b.t.toFixed(9)));
    const f8 = cues.shots.find((s) => s.id === 'F8');
    const fwAt = shots.shots.find((s) => s.id === 'F8').events.find((e) => e.type === 'fireworks').at;
    for (const pop of cues.sfx.filter((s) => s.sound === 'firework')) {
      const shotSeconds = (pop.frame - f8.startFrame + f8.sourceIn) / 24;
      expect(planBursts().some((b) => Math.abs(fwAt + b.t - shotSeconds) <= 0.5 / 24)).toBe(true);
    }
  });

  it('on-screen facts come from /content (numbers, the email, the case number)', () => {
    const content = ['about.md', 'achievements.md', 'education.md', 'experience.md', 'profile.md', 'skills.md'].map((f) => read('content', f)).join('\n') + read('content', 'projects', 'ned-rag-assistant.md') + read('content', 'projects', 'knodesk-rag.md') + read('content', 'projects', 'sales-pipeline.md');
    for (const fact of ['70+', '10+ businesses', '25+ employees', 'Recall@5 = 1.000', '3.83', 'Associate AI Engineer', 'Karachi', 'mumerfarooq.ned@gmail.com', 'August 2023', 'Aug 2026', '24 October 2026']) expect(content, fact).toContain(fact);
    expect(read('index.html')).toContain('Case file No. 021');
    const all = cues.text.map((t) => t.text).join('\n');
    expect(all).not.toMatch(/\+92|\b03\d{2}[\s-]?\d{7}\b/); // never a phone number
  });
});

describe('scripted footage (docs/promo/shots.json)', () => {
  let ground;
  let boxes;
  beforeAll(async () => {
    ground = await groundSampler(join(ROOT, 'public', 'models', 'town.glb'));
    boxes = Object.entries(meshBounds(join(ROOT, 'public', 'models', 'town.glb'))).filter(([name]) => !/^(ground|sea|street|Props_baked|Rocks_baked|ruts|rails)$/.test(name)); // merged scatter meshes span the town
  }, 30000);

  it('is valid and its lengths match the cue sheet (F1 4.0 s, F2 2.0 s, … F10 5.0 s)', () => {
    validateShots(shots);
    for (const s of [...shots.shots, ...shots.browser]) expect(s.frames, s.id).toBe(cues.shots.find((c) => c.id === s.id).footageFrames);
    const seconds = Object.fromEntries([...shots.shots, ...shots.browser].map((s) => [s.id, s.frames / 24]));
    expect(seconds).toEqual({ F1: 4, F2: 2, F3: 3, F4: 2.5, F5: 3, F6: 4, F7: 3, F8: 3, F9: 2.5, F10: 5 });
    expect(shots.shots.find((s) => s.id === 'F3').time).toBe('golden-hour');
    expect(shots.shots.find((s) => s.id === 'F7').time).toBe('golden-hour');
    for (const id of ['F1', 'F2', 'F4', 'F6', 'F8', 'F10']) expect(shots.shots.find((s) => s.id === id).time).toBe('night');
  });

  const sample = (cam) => {
    const pos = new CatmullRomCurve3(cam.position.map((p) => new Vector3(...p)), false, 'centripetal');
    return Array.from({ length: 41 }, (_, i) => pos.getPointAt(i / 40));
  };
  const INSIDE = 120; // the detailed sea square (createSea size 240): the rendered world

  it('every camera path stays inside the island bounds, above the ground and the swell, and outside every building', () => {
    for (const s of shots.shots.filter((x) => x.camera.type === 'path')) {
      for (const p of sample(s.camera)) {
        expect(Math.abs(p.x) <= INSIDE && Math.abs(p.z) <= INSIDE && p.y < 80, `${s.id} ${p.toArray()}`).toBe(true);
        const g = ground(p.x, p.z);
        const floor = g === null || g < SEA_LEVEL ? SEA_LEVEL + 1.2 : g + 0.8; // swell crests reach ~0.8 m
        expect(p.y, `${s.id} clearance at ${p.toArray().map((v) => v.toFixed(1))}`).toBeGreaterThan(floor);
        for (const [name, box] of boxes) expect(box.containsPoint(p), `${s.id} inside ${name}`).toBe(false);
      }
      for (const l of s.camera.lookAt) expect(Math.abs(l[0]) <= INSIDE && Math.abs(l[2]) <= INSIDE).toBe(true);
    }
  });

  it('follow shots and placements stay on the island (the gallop runs down the main street, x ≈ 0)', () => {
    for (const s of shots.shots) {
      if (s.player) expect(ground(s.player.pos[0], s.player.pos[1]), s.id).toBeGreaterThan(SEA_LEVEL);
      for (const e of s.events) if (e.type === 'gallop') for (const [x, z] of e.waypoints) expect(Math.abs(x) < 1.5 && ground(x, z) > SEA_LEVEL).toBe(true);
      if (s.camera.type === 'follow') expect(Math.hypot(...s.camera.offset)).toBeLessThan(10);
    }
    const f2 = shots.shots.find((s) => s.id === 'F2').camera;
    expect(f2.height).toBeGreaterThan(SEA_LEVEL + 1.2); // never inside a crest
  });
});

describe('capture determinism and tooling', () => {
  it('two runs of one shot gave identical frames at preview size (docs/promo/determinism.json)', () => {
    const { shots: runs } = json('docs', 'promo', 'determinism.json');
    expect(Object.keys(runs)).toEqual(expect.arrayContaining(['F2', 'F5'])); // an Explore shot and a browser shot
    for (const d of Object.values(runs)) {
      expect(d.size).toBe('960x540');
      expect(d.frames).toBeGreaterThanOrEqual(12);
      expect(d.runA).toHaveLength(d.frames);
    }
    // Explore (virtual clock, seeded random, WebGPU): bit-identical.
    expect(runs.F2.runA).toEqual(runs.F2.runB);
    expect(runs.F2.identical).toBe(true);
    // Browser shots: Chrome's compositor rasterises transformed layers and text with sub-pixel noise,
    // and the case modal's opening tween can start a frame apart (an async image decode against the
    // fake clock). Measured tolerance: most frames ≥ 40 dB PSNR, never below 30 dB (LIMITATIONS L166).
    expect(runs.F5.psnrDb.min).toBeGreaterThanOrEqual(30);
    expect(runs.F5.psnrDb.framesBelow40).toBeLessThanOrEqual(4);
  });

  it('capture mode pins time, randomness, size and tier, and steps exactly 1/24 s', () => {
    const c = read('src', 'explore', 'capture-mode.js');
    expect(c).toMatch(/export const FRAME_MS = 1000 \/ 24;/);
    expect(c).toMatch(/const now = \(\) => base \+ frame \* FRAME_MS;/); // computed, never accumulated
    expect(c).toMatch(/performance\.now = now;/);
    expect(c).toMatch(/Math\.random = seededRandom\(/);
    expect(c).toMatch(/window\.setTimeout = /);
    expect(c).toMatch(/window\.requestAnimationFrame = /);
    expect(c).toMatch(/onSubmittedWorkDone/); // GPU done before the driver reads the frame
    expect(c).toMatch(/tier: SPEC\.tier,/);
    expect(read('src', 'explore', 'index.js')).toMatch(/let quality = import\.meta\.env\.DEV && dev \? dev\.tier : readQuality\(\);/);
    expect(shots.tier).toBe('ULTRA');
    const css = read('src', 'explore', 'capture.css');
    expect(css).toMatch(/\.xp > :not\(\.xp-canvas\)/);
    expect(css).toMatch(/cursor: none !important/);
    const driver = read('scripts', 'capture', 'capture.mjs');
    expect(driver).toMatch(/channel: 'chrome'/);
    expect(driver).toMatch(/deviceScaleFactor: 1/);
    expect(read('scripts', 'capture', 'browser-shots.mjs')).toMatch(/context\.clock\.install/);
  });

  it('every capture hook in Explore and the mode shell sits behind import.meta.env.DEV', () => {
    const index = read('src', 'explore', 'index.js');
    const all = index.split('\n');
    const lines = all.map((l, i) => [l, all[i - 1] ?? '']).filter(([l]) => /\bdev\b(?!Capture)/.test(l) && !/^\s*\/\//.test(l));
    expect(lines.length).toBeGreaterThanOrEqual(7);
    // each line names the guard itself, or is the first statement inside `if (import.meta.env.DEV && dev) {`
    for (const [l, prev] of lines) if (!l.includes('import.meta.env.DEV')) expect(prev, l).toMatch(/if \(import\.meta\.env\.DEV && dev\) \{$/);
    const mode = read('src', 'ui', 'mode.js');
    for (const l of mode.split('\n').filter((x) => /devCapture/.test(x) && !/^\s*let devCapture = null;$/.test(x))) expect(l, l).toMatch(/import\.meta\.env\.DEV/);
    expect(read('.gitignore')).toMatch(/^aftereffects\/footage\/$/m);
    expect(read('.gitignore')).toMatch(/^aftereffects\/audio\/\*\.wav$/m);
    expect(read('.gitignore')).toMatch(/^aftereffects\/render\/$/m);
  });

  it('the production build contains no capture code and no ?capture handling', async () => {
    // A real production build (vitest sets NODE_ENV=test, which would keep import.meta.env.DEV true).
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    let outputs;
    try {
      const result = await build({ root: ROOT, configFile: join(ROOT, 'vite.config.js'), logLevel: 'silent', mode: 'production', build: { write: false } });
      outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output);
    } finally {
      process.env.NODE_ENV = before;
    }
    const files = outputs.map((o) => o.fileName);
    expect(files.some((f) => /capture|promo|shots/i.test(f)), files.join(', ')).toBe(false);
    const code = outputs.filter((o) => /\.(js|html|css)$/.test(o.fileName)).map((o) => String(o.code ?? o.source)).join('\n');
    for (const needle of ['__capture', 'capture-mode', 'devCapture', "get('capture')", 'get("capture")', 'capture=', 'createCaptureMode', 'shots.json', 'data-capture', 'onSubmittedWorkDone', 'promo/']) expect(code.includes(needle), needle).toBe(false);
  }, 120000);
});

describe('original score, SFX and ambience', () => {
  it('the score is exactly 18 bars at 96 bpm (45.000 s) and silent on the final frame', () => {
    expect(STEP).toBe(0.15625);
    expect(LENGTH).toBe(45);
    expect(at(19)).toBe(45);
    const ev = buildScore();
    for (const e of ev) {
      expect(e.t).toBeGreaterThanOrEqual(0);
      expect(e.t + (e.seconds ?? 0)).toBeLessThan(SILENCE_FROM);
      if (e.until) expect(e.until).toBeLessThanOrEqual(SILENCE_FROM);
    }
    // sections: drone first, whistle from bar 3, anvil only in bars 5–7, railway shaker in 12–14
    expect(Math.min(...ev.filter((e) => e.kind === 'whistle').map((e) => e.t))).toBe(at(3));
    for (const e of ev.filter((x) => x.kind === 'anvil')) expect(e.t >= at(5) && e.t < at(8)).toBe(true);
    for (const e of ev.filter((x) => x.kind === 'shaker')) expect(e.t >= at(12) && e.t < at(15)).toBe(true);
    expect(ev.some((e) => e.kind === 'boom' && Math.abs(e.t - 945 / 24) < 1e-9)).toBe(true);
  });

  it('a cue frame maps to an exact sample (2000 samples per frame at 48 kHz)', () => {
    for (const s of cues.sfx) expect(frameToSample(s.frame)).toBe(s.frame * 2000);
    expect(read('scripts', 'promo', 'audio', 'render.js')).toMatch(/for \(const c of cues\.sfx\) SOUND\[c\.sound\]\(frameTime\(c\.frame\), c\.gain, c\.pitch \?\? 0\);/);
  });

  it('the licence names the generating files, and they exist', () => {
    const licence = read('aftereffects', 'LICENCE-AUDIO.md');
    expect(licence).toMatch(/Muhammad Umer Farooq/);
    expect(licence).toMatch(/no third-party samples/i);
    for (const f of ['scripts/promo/audio/render.js', 'scripts/promo/audio/score.mjs', 'scripts/promo/render-audio.mjs', 'src/explore/music.js', 'src/explore/music-core.js', 'docs/promo/cues.json']) {
      expect(licence).toContain(f);
      expect(existsSync(join(ROOT, f)), f).toBe(true);
    }
  });

  it('the recorded render hit the targets: 45.000 s, about −14 LUFS, true peak ≤ −1 dBTP', () => {
    const r = json('docs', 'promo', 'audio-report.json');
    expect([r.sampleRate, r.bitDepth, r.channels]).toEqual([48000, 24, 2]);
    for (const f of ['music.wav', 'sfx.wav', 'ambience.wav', 'mix.wav']) {
      expect(r.files[f].samples).toBe(2160000);
      expect(r.files[f].samplePeakDbfs).toBeLessThan(0);
    }
    expect(Math.abs(r.files['mix.wav'].integratedLufs + 14)).toBeLessThanOrEqual(0.5);
    expect(r.files['mix.wav'].truePeakDbtp).toBeLessThanOrEqual(-1);
  });

  // The WAVs are git-ignored: these run only where they have been rendered.
  const sfxWav = join(ROOT, 'aftereffects', 'audio', 'sfx.wav');
  it.skipIf(!existsSync(sfxWav))('the WAVs are 24-bit 48 kHz stereo, exactly 45.000 s, and every isolated SFX starts within 1 ms of its frame', () => {
    for (const name of ['music', 'sfx', 'ambience', 'mix']) {
      const b = readFileSync(join(ROOT, 'aftereffects', 'audio', `${name}.wav`));
      expect([b.toString('ascii', 0, 4), b.readUInt16LE(20), b.readUInt16LE(22), b.readUInt32LE(24), b.readUInt16LE(34)]).toEqual(['RIFF', 1, 2, 48000, 24]);
      expect(b.readUInt32LE(40) / 6).toBe(2160000);
    }
    const b = readFileSync(sfxWav);
    const sample = (i) => Math.max(Math.abs(b.readIntLE(44 + i * 6, 3)), Math.abs(b.readIntLE(44 + i * 6 + 3, 3))) / 0x800000;
    let checked = 0;
    cues.sfx.forEach((c, k) => {
      const prev = cues.sfx.slice(0, k).at(-1);
      if (prev && c.frame - prev.frame < 12) return; // needs silence before it
      const s = c.frame * 2000;
      let quiet = 0;
      for (let i = Math.max(0, s - 2400); i < s - 48; i += 1) quiet = Math.max(quiet, sample(i));
      if (quiet > 3e-5) return; // a tail still ringing
      let onset = -1;
      for (let i = Math.max(0, s - 480); i < s + 480; i += 1) {
        if (sample(i) > 3e-5) {
          onset = i;
          break;
        }
      }
      expect(Math.abs(onset - s), `${c.sound} at frame ${c.frame}`).toBeLessThanOrEqual(48); // 1 ms
      checked += 1;
    });
    expect(checked).toBeGreaterThanOrEqual(8);
  });
});
