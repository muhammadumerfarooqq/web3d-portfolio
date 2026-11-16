// The Byte Island score, pure parts (unit-tested with a mocked AudioContext): the look-ahead step
// scheduler, the day/night mood crossfader and the composition itself as note data. Synthesis lives
// in music.js. The melodies are original (written for this site in A minor; no film theme quoted).
// Steps are sixteenth notes; a bar is 16 steps; each mood loops 8 bars.

export const midiToFreq = (m) => 440 * 2 ** ((m - 69) / 12);

/**
 * Look-ahead scheduler (the "two clocks" pattern): a coarse timer calls tick(), which schedules every
 * step that falls inside [now, now + lookAhead) at its exact audio time, so timing never depends on
 * timer jitter or frame rate. onStep(step, time, stepDuration).
 */
export function createScheduler({ now, bpm, steps, lookAhead = 0.2, onStep }) {
  let next = 0;
  let count = 0;
  let running = false;
  let tempo = bpm;
  const dur = () => 60 / tempo / 4;
  return {
    get running() {
      return running;
    },
    get step() {
      return count;
    },
    get stepDuration() {
      return dur();
    },
    start(at = now()) {
      next = at;
      count = 0;
      running = true;
    },
    stop() {
      running = false;
    },
    setBpm(b) {
      tempo = b;
    },
    /** Schedule everything due before now + lookAhead; returns how many steps were scheduled. */
    tick() {
      if (!running) return 0;
      const until = now() + lookAhead;
      let n = 0;
      // A long stall (tab hidden, debugger): skip ahead instead of firing a burst of late notes.
      if (next < now() - 0.5) next = now() + 0.05;
      while (next < until) {
        onStep(count % steps, next, dur());
        next += dur();
        count += 1;
        n += 1;
      }
      return n;
    },
  };
}

/** Two gains (day / night) into `out`; set(mood) crossfades linearly over `fade` seconds. */
export function createMoodMixer({ ctx, out, moods = ['day', 'night'] }) {
  const gains = {};
  for (const m of moods) {
    gains[m] = ctx.createGain();
    gains[m].gain.value = 0;
    gains[m].connect(out);
  }
  let mood = null;
  return {
    gains,
    get mood() {
      return mood;
    },
    set(next, fade = 2.5) {
      if (!(next in gains)) return false;
      const t = ctx.currentTime;
      for (const [k, g] of Object.entries(gains)) {
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(k === next ? 1 : 0, t + fade);
      }
      mood = next;
      return true;
    },
  };
}

// ── the composition ──
// Chord voicings: [bass, fifth, chord tones…] (MIDI).
const CH = {
  Am: [45, 52, 57, 60, 64],
  G: [43, 50, 55, 59, 62],
  F: [41, 48, 53, 57, 60],
  E: [40, 47, 52, 56, 59],
  Dm: [50, 45, 57, 62, 65],
};

/** Travis-style picking for one bar: alternating bass and chord tones (step, midi, velocity). */
function pickBar(bar, chord, sparse) {
  const [bass, fifth, a, b, c] = CH[chord];
  const s = bar * 16;
  if (sparse) return [[s, bass, 0.7], [s + 6, b, 0.4], [s + 10, c, 0.35], [s + 13, a, 0.3]];
  return [[s, bass, 0.9], [s + 4, b, 0.5], [s + 6, c, 0.45], [s + 8, fifth, 0.8], [s + 10, a, 0.45], [s + 12, b, 0.5], [s + 14, c, 0.4]];
}

const DAY_CHORDS = ['Am', 'G', 'F', 'E', 'Am', 'Dm', 'E', 'Am'];
const NIGHT_CHORDS = ['Am', 'Am', 'Dm', 'Am', 'F', 'E', 'Am', 'Am'];

export const SCORE = {
  day: {
    bpm: 84,
    steps: 128,
    chords: DAY_CHORDS,
    guitar: DAY_CHORDS.flatMap((c, i) => pickBar(i, c, false)),
    // [step, midi, length in steps, slide-from midi | null]
    whistle: [
      [0, 76, 6, 74], [6, 74, 2, null], [8, 72, 4, null], [12, 69, 4, null],
      [16, 71, 4, null], [20, 74, 4, null], [24, 79, 6, 77], [30, 76, 2, null],
      [32, 77, 8, null], [40, 76, 4, null], [44, 72, 4, null],
      [48, 71, 8, null], [56, 68, 4, null], [60, 71, 4, null],
      [64, 69, 4, null], [68, 72, 4, null], [72, 76, 4, null], [76, 81, 4, 79],
      [80, 77, 6, null], [86, 76, 2, null], [88, 74, 8, null],
      [96, 76, 4, null], [100, 74, 2, null], [102, 72, 2, null], [104, 71, 8, null],
      [112, 69, 10, null],
    ],
    // harmonica answers while the whistle holds (bend-from midi or null)
    harmonica: [[120, 64, 2, null], [122, 67, 2, null], [124, 69, 4, 68], [56, 64, 4, 63]],
    kick: [0, 8, 16, 24, 32, 40, 48, 56, 58, 64, 72, 80, 88, 96, 104, 112, 120, 122],
    tambourine: Array.from({ length: 16 }, (_, i) => i * 8 + 4),
    shaker: Array.from({ length: 64 }, (_, i) => i * 2),
    bell: [[0, 'bell'], [76, 'anvil']], // every other loop
  },
  night: {
    bpm: 66,
    steps: 128,
    chords: NIGHT_CHORDS,
    guitar: NIGHT_CHORDS.flatMap((c, i) => pickBar(i, c, true)),
    whistle: [],
    harmonica: [
      [32, 69, 4, 67], [36, 72, 4, null], [40, 74, 8, null], [48, 72, 4, null], [52, 69, 10, null],
      [96, 76, 6, 74], [102, 74, 2, null], [104, 72, 4, null], [108, 71, 4, null], [112, 69, 14, null],
    ],
    kick: [],
    tambourine: [],
    shaker: [],
    bell: [[64, 'bell']],
  },
};

/** Index a mood's events by step for O(1) lookup in the scheduler callback. */
export function indexScore(mood) {
  const at = Array.from({ length: mood.steps }, () => ({ guitar: [], whistle: null, harmonica: null, kick: false, tambourine: false, shaker: false, bell: null }));
  for (const [s, m, v] of mood.guitar) at[s].guitar.push([m, v]);
  for (const [s, m, len, from] of mood.whistle) at[s].whistle = { midi: m, len, from };
  for (const [s, m, len, from] of mood.harmonica) at[s].harmonica = { midi: m, len, from };
  for (const s of mood.kick) at[s].kick = true;
  for (const s of mood.tambourine) at[s].tambourine = true;
  for (const s of mood.shaker) at[s].shaker = true;
  for (const [s, kind] of mood.bell) at[s].bell = kind;
  return at;
}
