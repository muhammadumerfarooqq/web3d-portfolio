// P9.3 promo score: "The Case File of Umer", an original spaghetti-western cue in A minor at 96 bpm,
// exactly 18 bars (45.0 s). Pure data + timing (unit-tested in Node); scripts/promo/audio/render.js
// synthesises it with the site's own voices (src/explore/music.js). The melody was written for this
// film; it quotes no film theme. Sections follow docs/promo/cues.json "music".
// Times: a step is a sixteenth note (0.15625 s), a bar is 16 steps (2.5 s = 60 frames at 24 fps).

export const BPM = 96;
export const STEP = 60 / BPM / 4;
export const BAR_SECONDS = STEP * 16;
export const LENGTH = 18 * BAR_SECONDS; // 45.0 s
/** Seconds at bar (1-based) and step (0–15, fractional allowed). */
export const at = (bar, step = 0) => ((bar - 1) * 16 + step) * STEP;

// Chord per bar (index = bar - 1). Voicings [bass, fifth, tones…] in MIDI.
export const CHORDS = ['Am', 'Am', 'Am', 'F', 'Am', 'G', 'E', 'Am', 'F', 'G', 'E', 'Am', 'Dm', 'E', 'Am', 'E', 'Am', 'Am'];
const VOICING = {
  Am: [45, 52, 57, 60, 64],
  F: [41, 48, 53, 57, 60],
  G: [43, 50, 55, 59, 62],
  E: [40, 47, 52, 56, 59],
  Dm: [38, 45, 50, 53, 57],
};

/** Whistled melody: [bar, step, midi, length in steps, slide-from midi | null]. */
const WHISTLE = [
  // bars 3–4: the theme enters
  [3, 0, 76, 4, 74], [3, 4, 69, 2, null], [3, 6, 72, 2, null], [3, 8, 76, 6, null], [3, 14, 74, 2, null],
  [4, 0, 72, 4, null], [4, 4, 69, 6, null], [4, 10, 67, 2, null], [4, 12, 69, 4, null],
  // bars 5–7: it climbs over the anvil
  [5, 0, 76, 6, 74], [5, 6, 74, 2, null], [5, 8, 72, 4, null], [5, 12, 71, 4, null],
  [6, 0, 74, 4, null], [6, 4, 71, 4, null], [6, 8, 67, 6, null], [6, 14, 69, 2, null],
  [7, 0, 71, 4, null], [7, 4, 68, 4, null], [7, 8, 64, 4, null], [7, 12, 71, 4, 69],
  // bars 8–11: full band, an octave lift
  [8, 0, 81, 6, 79], [8, 6, 79, 2, null], [8, 8, 76, 4, null], [8, 12, 72, 4, null],
  [9, 0, 77, 6, null], [9, 6, 76, 2, null], [9, 8, 72, 4, null], [9, 12, 69, 4, null],
  [10, 0, 74, 4, null], [10, 4, 79, 4, 77], [10, 8, 71, 4, null], [10, 12, 74, 4, null],
  [11, 0, 76, 8, null], [11, 8, 74, 2, null], [11, 10, 72, 2, null], [11, 12, 71, 4, null],
  // bars 15–16: the town; the theme returns, answered by the badge chimes
  [15, 0, 81, 4, 79], [15, 4, 76, 4, null], [15, 8, 72, 4, null], [15, 12, 76, 4, null],
  [16, 0, 71, 6, null], [16, 6, 76, 2, null], [16, 8, 80, 4, 79], [16, 12, 83, 3, null],
  // bar 17: resolve, held
  [17, 0, 81, 14, 79],
];

/** Harmonica: answers in the band section, the lead on the railway. */
const HARMONICA = [
  [8, 13, 64, 3, null], [9, 13, 67, 3, null], [10, 13, 66, 3, 65], [11, 14, 68, 2, null],
  [12, 0, 69, 2, null], [12, 2, 72, 2, null], [12, 4, 76, 4, 74], [12, 8, 72, 2, null], [12, 10, 69, 2, null], [12, 12, 72, 4, null],
  [13, 0, 74, 2, null], [13, 2, 77, 2, null], [13, 4, 81, 4, 79], [13, 8, 77, 2, null], [13, 10, 74, 2, null], [13, 12, 77, 4, null],
  [14, 0, 76, 6, 74], [14, 6, 71, 2, null], [14, 8, 68, 4, null], [14, 12, 71, 4, null],
];

/** Guitar picking for one bar: [step, midi, velocity]. */
function pick(bar, chord, style) {
  const [bass, fifth, a, b, c] = VOICING[chord];
  if (style === 'sparse') return [[0, bass, 0.75], [6, b, 0.4], [10, c, 0.35], [13, a, 0.3]];
  if (style === 'drive') return [[0, bass, 0.9], [2, a, 0.4], [4, fifth, 0.7], [6, b, 0.4], [8, bass, 0.85], [10, c, 0.4], [12, fifth, 0.7], [14, b, 0.4]];
  if (style === 'strum') return [[0, bass, 0.9], [0.25, fifth, 0.7], [0.5, a, 0.6], [0.75, b, 0.55], [1, c, 0.5]];
  return [[0, bass, 0.9], [4, b, 0.5], [6, c, 0.45], [8, fifth, 0.8], [10, a, 0.45], [12, b, 0.5], [14, c, 0.4]];
}

const styleFor = (bar) => (bar <= 2 ? null : bar <= 4 ? 'sparse' : bar <= 11 ? 'travis' : bar <= 14 ? 'drive' : bar <= 16 ? 'travis' : bar === 17 ? 'strum' : null);

/** Every event of the score, sorted by time: { t, kind, … }. */
export function buildScore() {
  const ev = [];
  const push = (e) => ev.push(e);
  // drone (bars 1–2, fading under bar 3) and the end pad (bars 17–18)
  push({ t: 0, kind: 'drone', midi: [33, 40, 45], until: at(3, 8), fadeIn: 2.2 });
  push({ t: at(17), kind: 'pad', midi: [45, 52, 57, 60], until: LENGTH - 0.12, fadeIn: 0.8 });
  // guitar pickup into bar 3 (beats 3–4 of bar 2)
  [[8, 52], [10, 57], [12, 60], [14, 64]].forEach(([s, m], i) => push({ t: at(2, s), kind: 'guitar', midi: m, vel: 0.5 + i * 0.1 }));
  for (let bar = 1; bar <= 18; bar += 1) {
    const style = styleFor(bar);
    if (style) for (const [s, m, v] of pick(bar, CHORDS[bar - 1], style)) push({ t: at(bar, s), kind: 'guitar', midi: m, vel: v });
    // anvil on the beats (bars 5–7)
    if (bar >= 5 && bar <= 7) for (const s of [0, 4, 8, 12]) push({ t: at(bar, s), kind: 'anvil', gain: s === 0 ? 0.09 : 0.06 });
    // tambourine on 2 and 4 (bars 5–11, 15–16)
    if ((bar >= 5 && bar <= 11) || bar === 15 || bar === 16) for (const s of [4, 12]) push({ t: at(bar, s), kind: 'tambourine', gain: 0.13 });
    // kick: band (8–11) on 1 and 3, railway (12–14) four on the floor, town (15–16) a gallop
    if (bar >= 8 && bar <= 11) for (const s of [0, 8, bar === 11 ? 14 : 10]) push({ t: at(bar, s), kind: 'kick', gain: 0.55 });
    if (bar >= 12 && bar <= 14) for (const s of [0, 4, 8, 12]) push({ t: at(bar, s), kind: 'kick', gain: 0.5 });
    if (bar === 15 || bar === 16) for (const s of [0, 3, 6, 8, 11, 14]) push({ t: at(bar, s), kind: 'kick', gain: s % 8 === 0 ? 0.55 : 0.35 });
    // railway shaker sixteenths, accented like a rail joint
    if (bar >= 12 && bar <= 14) for (let s = 0; s < 16; s += 1) push({ t: at(bar, s), kind: 'shaker', gain: s % 4 === 0 ? 0.11 : s % 2 === 0 ? 0.07 : 0.045 });
  }
  for (const [bar, s, m, len, from] of WHISTLE) push({ t: at(bar, s), kind: 'whistle', midi: m, seconds: len * STEP, from });
  for (const [bar, s, m, len, from] of HARMONICA) push({ t: at(bar, s), kind: 'harmonica', midi: m, seconds: len * STEP, from });
  // the deepest hit under the giant CASE CLOSED stamp (frame 945 = bar 16, step 12) and the resolve
  push({ t: 945 / 24, kind: 'boom', gain: 0.9 });
  push({ t: at(17), kind: 'boom', gain: 0.6 });
  push({ t: at(17), kind: 'bell', gain: 0.12 });
  return ev.sort((a, b) => a.t - b.t);
}

/** The end: everything is silent from this time (the last frame, 1079/24 s, carries no sound). */
export const SILENCE_FROM = 1079 / 24;
