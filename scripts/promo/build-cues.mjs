// P9.3: writes docs/promo/cues.json from docs/promo/STORYBOARD.md's beat sheet (the text is copied
// exactly from the storyboard; every fact is in /content, see each cue's "source"). Run:
//   node scripts/promo/build-cues.mjs
// The fireworks pops are computed from the same burst plan as src/explore/fireworks.js (planBursts,
// mirrored here and checked by tests/promo-p93.test.js) and from the F8 shot's fireworks event in
// docs/promo/shots.json, so the sound lands on the bursts in the footage.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BAR, BEAT, DURATION, FPS, validateCues } from './cue-schema.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'docs', 'promo', 'cues.json');
const bar = (n) => (n - 1) * BAR; // first frame of bar n (1-based)

/** Mirror of planBursts() in src/explore/fireworks.js (burst times in seconds after the show starts). */
export function burstTimes(count = 8, seed = 1) {
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  return Array.from({ length: count }, (_, i) => {
    const t = 0.2 + i * 0.62 + rnd() * 0.25;
    rnd(); // offset x
    rnd(); // offset y
    rnd(); // offset z
    rnd(); // speed
    return t;
  });
}

export function buildCues(shotsJson) {
  const scenes = [
    { id: 'cold-open', title: 'Cold open', bars: [1, 2] },
    { id: 'office', title: '01 · The Office (WANTED)', bars: [3, 4] },
    { id: 'workshop', title: '02 · The Workshop (skills)', bars: [5, 7] },
    { id: 'bounties', title: '03 · The Bounty Board (projects)', bars: [8, 11] },
    { id: 'railway', title: '04 · The Railway (journey)', bars: [12, 14] },
    { id: 'town', title: '05 · The Town (the portfolio)', bars: [15, 16] },
    { id: 'end-card', title: 'End card', bars: [17, 18] },
  ].map((s) => ({ ...s, startFrame: bar(s.bars[0]), endFrame: bar(s.bars[1] + 1) }));

  const music = [
    { id: 'drone', bars: [1, 2], description: 'Cold open: low drone and the sea; a plucked guitar pickup on the last two beats of bar 2 into bar 3.' },
    { id: 'whistle', bars: [3, 4], description: 'The whistled melody enters over sparse guitar picking (A minor).' },
    { id: 'anvil', bars: [5, 7], description: 'Melody continues; an anvil on every beat (the SFX stem adds one pitched anvil per skill word), tambourine.' },
    { id: 'band', bars: [8, 11], description: 'Full band: guitar, whistle and harmonica answers, kick and tambourine, spring reverb.' },
    { id: 'railway', bars: [12, 14], description: 'Driving train rhythm: ratchet-like shaker sixteenths, woodblock on the stations, harmonica; the train whistle on the cut to F6.' },
    { id: 'town', bars: [15, 16], description: 'Gallop rhythm under the split screen, badge chimes, fireworks; the deepest hit on CASE CLOSED.' },
    { id: 'resolve', bars: [17, 18], description: 'Resolves to A minor; a low pad rings out; silence on the final frame.' },
  ].map((m) => ({ ...m, startFrame: bar(m.bars[0]), endFrame: bar(m.bars[1] + 1) }));

  const f = (id) => `aftereffects/footage/${id}/${id}_[####].png`;
  const shots = [
    { id: 'F1', scene: 'cold-open', track: 'V1', startFrame: 15, endFrame: 90, sourceIn: 0, footageFrames: 96, capture: 'explore', time: 'night', description: 'Low over the sea towards the lit town, lighthouse in frame, the boat rowing in' },
    { id: 'F2', scene: 'cold-open', track: 'V1', startFrame: 90, endFrame: 120, sourceIn: 12, footageFrames: 48, capture: 'explore', time: 'night', description: 'Close on the rowboat: oars pulling, splashes, the sheriff rowing' },
    { id: 'F3', scene: 'workshop', track: 'V1', startFrame: 270, endFrame: 330, sourceIn: 6, footageFrames: 72, capture: 'explore', time: 'golden-hour', description: "Slow dolly past the Blacksmith's Workshop with dust (cut against the skill words every beat)" },
    { id: 'F4', scene: 'bounties', track: 'V1', startFrame: 420, endFrame: 465, sourceIn: 15, footageFrames: 60, capture: 'explore', time: 'night', description: 'Push-in on the Bounty Board' },
    { id: 'F5', scene: 'bounties', track: 'V1', startFrame: 600, endFrame: 660, sourceIn: 6, footageFrames: 72, capture: 'browser', time: 'day-theme', description: 'Classic projects gallery: chip clicks, Flip, a modal opening' },
    { id: 'F6', scene: 'railway', track: 'V1', startFrame: 780, endFrame: 840, sourceIn: 36, footageFrames: 96, capture: 'explore', time: 'night', description: 'The train pulling into Byte Island Station, steam and headlamp' },
    { id: 'F9', scene: 'town', track: 'V1', startFrame: 840, endFrame: 900, sourceIn: 0, footageFrames: 60, capture: 'browser', time: 'day-theme', description: 'Split screen, left: the Classic hero and WANTED poster scroll' },
    { id: 'F7', scene: 'town', track: 'V2', startFrame: 840, endFrame: 900, sourceIn: 6, footageFrames: 72, capture: 'explore', time: 'golden-hour', description: 'Split screen, right: tracking shot, the sheriff gallops on the horse down the main street' },
    { id: 'F8', scene: 'town', track: 'V1', startFrame: 900, endFrame: 960, sourceIn: 6, footageFrames: 72, capture: 'explore', time: 'night', description: 'Fireworks over the town (the stars flying to the 8/8 counter are an After Effects overlay)' },
    { id: 'F10', scene: 'end-card', track: 'V1', startFrame: 960, endFrame: 1080, sourceIn: 0, footageFrames: 120, capture: 'explore', time: 'night', description: 'Slow aerial pull-back over the whole island' },
  ].map((s) => ({ ...s, footage: f(s.id) }));

  // Footage lengths come from shots.json (the capture spec) when given; they must agree.
  if (shotsJson) {
    for (const s of shots) {
      const spec = shotsJson.shots.find((x) => x.id === s.id) ?? shotsJson.browser?.find((x) => x.id === s.id);
      if (spec && spec.frames !== s.footageFrames) throw new Error(`${s.id}: shots.json has ${spec.frames} frames, the storyboard ${s.footageFrames}`);
    }
  }

  const SB = 'docs/promo/STORYBOARD.md';
  const text = [];
  const sfx = [];
  const say = (frame, layer, t, source = SB, endFrame) => text.push({ frame, ...(endFrame ? { endFrame } : {}), layer, text: t, source });
  const hit = (frame, sound, gain, pitch) => sfx.push({ frame, sound, gain, ...(pitch === undefined ? {} : { pitch }) });
  /** Typewriter strokes: one per visible character, every `gap` frames. */
  const typewriter = (frame, line, gap = 2) => {
    let k = 0;
    for (const ch of line) {
      if (ch.trim() && ch !== '·') hit(frame + k * gap, 'typewriter', 0.55 + (k % 3) * 0.08);
      k += 1;
    }
  };

  // Persistent overlay: chapter counter and the railroad line's stations (storyboard, "The one idea").
  const chapters = [['office', '01 OFFICE'], ['workshop', '02 WORKSHOP'], ['bounties', '03 BOUNTIES'], ['railway', '04 RAILWAY'], ['town', '05 THE TOWN']];
  const scene = (id) => scenes.find((s) => s.id === id);

  // ── cold open (bars 1–2) ──
  hit(0, 'projector', 0.7);
  hit(15, 'projector', 0.45); // the flicker into F1
  hit(60, 'stamp', 0.9);
  say(60, 'title', 'BYTE ISLAND', SB, 120);
  say(64, 'subtitle', 'A NEW SHERIFF ARRIVES IN TOWN', SB, 120);
  typewriter(64, 'A NEW SHERIFF ARRIVES IN TOWN');
  hit(90, 'projector', 0.35); // fast cut to F2

  chapters.forEach(([id, label], i) => {
    const s = scene(id);
    say(s.startFrame, 'chapter', `CH ${String(i + 1).padStart(2, '0')}/05`, SB, s.endFrame);
    say(s.startFrame, 'rail-station', label, SB, s.endFrame);
  });

  // ── 01 · the office (bars 3–4) ──
  hit(120, 'paper', 0.6);
  hit(135, 'stamp', 1);
  say(135, 'wanted', 'WANTED', 'index.html (Classic hero poster)', 240);
  say(150, 'name', 'MUHAMMAD UMER FAROOQ', 'content/profile.md', 240);
  typewriter(150, 'MUHAMMAD UMER FAROOQ');
  hit(195, 'paper', 0.45);
  say(195, 'role', 'ASSOCIATE AI ENGINEER · KARACHI', 'content/profile.md (title, location)', 240);
  hit(210, 'paper', 0.4);
  say(210, 'tagline', 'I build AI that people actually use, and make it feel alive in 3D.', 'content/profile.md (headline)', 240);
  hit(225, 'stamp', 0.95);
  say(225, 'stamp', 'CASE FILE No. 021', 'index.html (Case file No. 021)', 240);

  // ── 02 · the workshop (bars 5–7) ──
  hit(240, 'stamp', 0.7);
  say(240, 'header', 'TOOLS OF THE TRADE', SB, 270);
  const words = ['LLMs & RAG', 'COMPUTER VISION', 'PYTHON · FASTAPI', 'THREE.JS', 'BLENDER', 'AFTER EFFECTS', 'REACT · NEXT.JS', 'DOCKER · VERCEL'];
  const scale = [0, 2, 3, 5, 7, 8, 10, 12]; // A natural minor, up the scale
  words.forEach((w, i) => {
    const at = 270 + i * BEAT;
    say(at, 'word', w, 'content/skills.md', at + BEAT);
    hit(at, 'anvil', 0.8, scale[i]);
  });

  // ── 03 · the bounty board (bars 8–11) ──
  hit(420, 'projector', 0.45);
  hit(465, 'stamp', 0.6);
  say(465, 'header', "CASES I'VE CLOSED", SB, 600);
  const posters = [
    ['TALEEM360 · REWARD: 1ST OF 70+ TEAMS', 'content/achievements.md (Best FYDP, 1st of 70+ teams)'],
    ['KNODESK RAG · REWARD: 10+ BUSINESSES', 'content/projects/knodesk-rag.md'],
    ['SALES PIPELINE · REWARD: 25+ DAILY USERS', 'content/projects/sales-pipeline.md (25+ employees every day)'],
    ['NED REGULATIONS AI · RECALL@5 = 1.000', 'content/projects/ned-rag-assistant.md'],
  ];
  posters.forEach(([p, source], i) => {
    const at = 480 + i * 2 * BEAT;
    say(at, 'poster', p, source, at + 2 * BEAT);
    hit(at, 'pin', 0.7);
    say(at + BEAT, 'stamp', 'CASE CLOSED', SB, at + 2 * BEAT);
    hit(at + BEAT, 'stamp', 0.9);
  });
  hit(600, 'projector', 0.45);

  // ── 04 · the railway (bars 12–14) ──
  const stations = [
    ['AUG 2023 · NED UNIVERSITY · BS CS & IT', 'content/education.md (August 2023)'],
    ['2ND YEAR · 2ND IN CLASS · GPA 3.83', 'content/achievements.md'],
    ['AUG 2026 · AXISERO · ASSOCIATE AI ENGINEER', 'content/experience.md'],
    ['OCT 2026 · BEST FYDP · 1ST OF 70+', 'content/achievements.md (24 October 2026)'],
  ];
  const stationFrames = stations.map((_, i) => 675 + i * 2 * BEAT);
  stations.forEach(([s, source], i) => {
    say(stationFrames[i], 'station', s, source, i < 3 ? stationFrames[i + 1] : 780);
    hit(stationFrames[i], 'woodblock', 0.75, i * 2);
  });
  for (let fr = 660; fr < 780; fr += 5) if (!stationFrames.includes(fr)) hit(fr, 'ratchet', 0.3 + (fr % 15 === 0 ? 0.1 : 0));
  hit(780, 'whistle', 0.8);
  hit(780, 'projector', 0.4);
  [786, 797, 810, 826].forEach((fr, i) => hit(fr, 'chuff', 0.55 - i * 0.1));

  // ── 05 · the town (bars 15–16) ──
  hit(840, 'projector', 0.35);
  say(840, 'header', 'TWO WAYS IN', SB, 900);
  say(855, 'split-left', 'CLASSIC · THE CASE FILE', SB, 900);
  say(855, 'split-right', 'EXPLORE · BYTE ISLAND', SB, 900);
  for (let stride = 840; stride < 900; stride += 10) [0, 2, 4].forEach((d, k) => hit(stride + d, 'hooves', [0.5, 0.4, 0.6][k]));
  hit(900, 'projector', 0.35);
  const chimes = [0, 3, 5, 7, 10, 12, 15, 17]; // A minor pentatonic, up
  chimes.forEach((p, i) => hit(900 + i * 4, 'chime', 0.5, p));
  say(930, 'counter', '8/8 STARS', 'src/explore (8 buildings, 8 stars)', 960);
  // Fireworks: bursts from the footage (F8's fireworks event + planBursts), inside F8's edit window.
  const f8 = shots.find((s) => s.id === 'F8');
  const fwAt = shotsJson?.shots.find((s) => s.id === 'F8')?.events?.find((e) => e.type === 'fireworks')?.at ?? 0;
  for (const t of burstTimes()) {
    const shotFrame = Math.round((fwAt + t) * FPS);
    const film = f8.startFrame + shotFrame - f8.sourceIn;
    if (film >= f8.startFrame && film < f8.endFrame && film !== 945) hit(film, 'firework', 0.7);
  }
  hit(945, 'stamp', 1);
  say(945, 'stamp', 'CASE CLOSED', SB, 960);

  // ── end card (bars 17–18) ──
  say(975, 'end-title', 'UMER', 'content/profile.md', DURATION);
  say(990, 'end-name', 'MUHAMMAD UMER FAROOQ · AI ENGINEER', 'content/profile.md', DURATION);
  say(1005, 'end-url', '{liveUrl}', 'production domain (liveUrl)', DURATION);
  say(1020, 'end-email', 'mumerfarooq.ned@gmail.com', 'content/profile.md (links.email)', DURATION);
  say(1035, 'end-cta', 'RIDE TO THE ISLAND →', SB, DURATION);
  hit(1035, 'spur', 0.55);

  text.sort((a, b) => a.frame - b.frame || a.layer.localeCompare(b.layer));
  sfx.sort((a, b) => a.frame - b.frame || a.sound.localeCompare(b.sound));

  return validateCues({
    title: 'The Case File of Umer (P9 promo film)',
    fps: FPS,
    duration: DURATION,
    bpm: 96,
    beatFrames: BEAT,
    barFrames: BAR,
    width: 3840,
    height: 2160,
    liveUrl: 'TBD',
    notes: [
      'Generated by scripts/promo/build-cues.mjs from docs/promo/STORYBOARD.md; do not edit by hand.',
      'Frames at 24 fps. Ranges are [startFrame, endFrame): endFrame is the first frame after.',
      'A beat is 15 frames, a bar 60 frames; every shot cuts on a beat.',
      'Shots: sourceIn is the first footage frame used; footageFrames is the captured length (handles included).',
      'Text "{liveUrl}" is replaced by liveUrl (the production domain, TBD) in the After Effects build.',
      'sfx pitch is in semitones (anvil, woodblock and chime climb a scale).',
    ],
    scenes,
    music,
    shots,
    text,
    sfx,
  });
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  let shotsJson = null;
  try {
    shotsJson = JSON.parse(readFileSync(join(ROOT, 'docs', 'promo', 'shots.json'), 'utf8'));
  } catch {
    shotsJson = null;
  }
  const cues = buildCues(shotsJson);
  writeFileSync(OUT, `${JSON.stringify(cues, null, 2)}\n`);
  console.log(`cues.json: ${cues.scenes.length} scenes, ${cues.shots.length} shots, ${cues.text.length} text cues, ${cues.sfx.length} sfx cues`);
}
