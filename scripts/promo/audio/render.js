// P9.3 promo audio, rendered offline in the browser (OfflineAudioContext, 48 kHz, stereo, exactly
// 45.000 s = 2 160 000 samples per stem). Opened by scripts/promo/render-audio.mjs through the Vite
// dev server (render.html); never part of the site build. Every sound is synthesised here or by the
// site's own score voices (src/explore/music.js): no samples, no third-party audio.
//   music     the score (score.mjs): Karplus-Strong guitar, whistle, harmonica, kick, tambourine,
//             shaker, anvil, drone and pad, through the spring reverb
//   sfx       one sound per cue in docs/promo/cues.json, starting on its frame's exact sample
//   ambience  sea wash, wind and night crickets
import { anvilBuf, bellBuf, kickBuf, pluck, shakerBuf, springImpulse, tambBuf, voice } from '../../../src/explore/music.js';
import { midiToFreq } from '../../../src/explore/music-core.js';
import { LENGTH, SILENCE_FROM, buildScore } from './score.mjs';

export const RATE = 48000;
export const SAMPLES = Math.round(LENGTH * RATE); // 2 160 000
const FPS = 24;
const frameTime = (f) => f / FPS; // seconds; × 48000 = f × 2000 samples exactly

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noise(ctx, seconds, seed, pink = 0) {
  const rnd = seeded(seed);
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i += 1) {
    const w = rnd() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    d[i] = w * (1 - pink) + last * 3 * pink;
  }
  return buf;
}

const offline = () => new OfflineAudioContext({ numberOfChannels: 2, length: SAMPLES, sampleRate: RATE });

/** Hard silence from SILENCE_FROM, with a 60 ms fade before it (no click). */
function endGate(ctx, node) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(1, SILENCE_FROM - 0.06);
  g.gain.linearRampToValueAtTime(0, SILENCE_FROM);
  node.connect(g).connect(ctx.destination);
  return g;
}

// ── music ──
async function renderMusic() {
  const ctx = offline();
  const bus = ctx.createGain();
  bus.gain.value = 0.9;
  endGate(ctx, bus);
  const reverb = ctx.createConvolver();
  reverb.buffer = springImpulse(ctx);
  const wet = ctx.createGain();
  wet.gain.value = 0.3;
  reverb.connect(wet).connect(bus);
  const send = ctx.createGain();
  send.gain.value = 0.45;
  send.connect(reverb);
  const pan = (x) => {
    const p = ctx.createStereoPanner();
    p.pan.value = x;
    p.connect(bus);
    p.connect(send);
    return p;
  };
  const guitarOut = pan(-0.18);
  const leadOut = pan(0.04);
  const harpOut = pan(0.22);
  const drumOut = pan(0);
  const breath = noise(ctx, 2, 7, 0.4);
  const whistle = voice(ctx, leadOut, { type: 'sine', vibrato: 7, breath: 0.08, noise: breath });
  const harmonica = voice(ctx, harpOut, { type: 'sawtooth', filter: 1500, vibrato: 4, breath: 0.25, noise: breath });
  const plucks = new Map();
  const buffers = { kick: kickBuf(ctx), tambourine: tambBuf(ctx), shaker: shakerBuf(ctx), anvil: anvilBuf(ctx), bell: bellBuf(ctx) };
  const shot = (buf, t, gain, dest, rate = 1) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(dest);
    src.start(t);
  };
  const sustained = (e, type, level, cutoff) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, e.t);
    g.gain.linearRampToValueAtTime(level, e.t + e.fadeIn);
    g.gain.setValueAtTime(level, Math.max(e.t + e.fadeIn, e.until - 2.2));
    g.gain.linearRampToValueAtTime(0, e.until);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    f.connect(g).connect(drumOut);
    for (const [i, m] of e.midi.entries()) {
      for (const detune of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = midiToFreq(m);
        o.detune.value = detune + i * 1.5;
        o.connect(f);
        o.start(e.t);
        o.stop(e.until + 0.05);
      }
    }
  };
  for (const e of buildScore()) {
    if (e.kind === 'guitar') {
      if (!plucks.has(e.midi)) plucks.set(e.midi, pluck(ctx, midiToFreq(e.midi)));
      const src = ctx.createBufferSource();
      src.buffer = plucks.get(e.midi);
      src.playbackRate.setValueAtTime(1.006, e.t);
      src.playbackRate.linearRampToValueAtTime(1, e.t + 0.06);
      const g = ctx.createGain();
      g.gain.value = e.vel * 0.42;
      src.connect(g).connect(guitarOut);
      src.start(e.t);
    } else if (e.kind === 'whistle') whistle.note(e.t, e.midi, e.seconds, e.from, 0.12);
    else if (e.kind === 'harmonica') harmonica.note(e.t, e.midi, e.seconds, e.from, 0.1);
    else if (e.kind === 'kick') shot(buffers.kick, e.t, e.gain, drumOut);
    else if (e.kind === 'tambourine') shot(buffers.tambourine, e.t, e.gain, drumOut);
    else if (e.kind === 'shaker') shot(buffers.shaker, e.t, e.gain, drumOut);
    else if (e.kind === 'anvil') shot(buffers.anvil, e.t, e.gain, send);
    else if (e.kind === 'bell') shot(buffers.bell, e.t, e.gain, send);
    else if (e.kind === 'boom') {
      shot(buffers.kick, e.t, e.gain, drumOut, 0.6);
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(55, e.t);
      o.frequency.exponentialRampToValueAtTime(38, e.t + 1.4);
      const g = ctx.createGain();
      g.gain.setValueAtTime(e.gain * 0.5, e.t);
      g.gain.exponentialRampToValueAtTime(0.0001, e.t + 1.8);
      o.connect(g).connect(drumOut);
      o.start(e.t);
      o.stop(e.t + 1.9);
    } else if (e.kind === 'drone') sustained(e, 'sawtooth', 0.05, 420);
    else if (e.kind === 'pad') sustained(e, 'sawtooth', 0.04, 900);
  }
  const out = await ctx.startRendering();
  return out;
}

// ── sfx: one synthesised sound per cue ──
async function renderSfx(cues) {
  const ctx = offline();
  const bus = ctx.createGain();
  endGate(ctx, bus);
  const rnd = seeded(931);
  const white = noise(ctx, 3, 11, 0);
  const anvil = anvilBuf(ctx);
  const env = (g, t, peak, attack, decay) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  };
  const burst = (t, { type = 'bandpass', freq = 1000, q = 1, gain = 0.3, attack = 0.002, decay = 0.08, pan = 0, rate = 1 }) => {
    const src = ctx.createBufferSource();
    src.buffer = white;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    env(g, t, gain, attack, decay);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(bus);
    src.start(t, rnd() * 2, attack + decay + 0.05);
  };
  const tone = (t, { freq, to = freq, type = 'sine', gain = 0.2, attack = 0.002, decay = 0.2, pan = 0 }) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to !== freq) o.frequency.exponentialRampToValueAtTime(to, t + attack + decay);
    const g = ctx.createGain();
    env(g, t, gain, attack, decay);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p).connect(bus);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  };
  const SOUND = {
    projector(t, k) {
      // shutter clatter at 18 Hz for half a second, plus a mains hum
      for (let i = 0; i < 9; i += 1) burst(t + i / 18, { type: 'bandpass', freq: 2600, q: 3, gain: 0.25 * k * (1 - i / 12), decay: 0.018 });
      tone(t, { freq: 100, gain: 0.05 * k, attack: 0.02, decay: 0.5 });
    },
    stamp(t, k) {
      tone(t, { freq: 90, to: 38, gain: 0.8 * k, attack: 0.003, decay: 0.32 });
      burst(t, { type: 'lowpass', freq: 380, q: 0.7, gain: 0.7 * k, decay: 0.14 });
      burst(t + 0.004, { type: 'highpass', freq: 2400, q: 0.6, gain: 0.25 * k, decay: 0.05 }); // paper slap
    },
    typewriter(t, k) {
      burst(t, { type: 'bandpass', freq: 2300 + rnd() * 600, q: 4, gain: 0.32 * k, decay: 0.022, pan: (rnd() - 0.5) * 0.3 });
      tone(t + 0.003, { freq: 3800 + rnd() * 500, gain: 0.025 * k, decay: 0.04 });
    },
    paper(t, k) {
      burst(t, { type: 'bandpass', freq: 3200, q: 0.8, gain: 0.2 * k, attack: 0.08, decay: 0.28, rate: 0.7 });
    },
    anvil(t, k, p = 0) {
      const src = ctx.createBufferSource();
      src.buffer = anvil;
      src.playbackRate.value = 2 ** (p / 12) * 0.5; // an octave down: a heavier ring
      const g = ctx.createGain();
      g.gain.value = 0.55 * k;
      src.connect(g).connect(bus);
      src.start(t);
      burst(t, { type: 'highpass', freq: 3000, q: 0.7, gain: 0.25 * k, decay: 0.03 }); // the hammer
    },
    pin(t, k) {
      burst(t, { type: 'highpass', freq: 3500, q: 1, gain: 0.3 * k, decay: 0.015 });
      tone(t, { freq: 2900, gain: 0.06 * k, decay: 0.09 });
      tone(t + 0.035, { freq: 140, to: 90, gain: 0.25 * k, decay: 0.06 }); // into the board
    },
    ratchet(t, k) {
      burst(t, { type: 'bandpass', freq: 3100, q: 5, gain: 0.35 * k, decay: 0.008 });
    },
    woodblock(t, k, p = 0) {
      const f = 820 * 2 ** (p / 12);
      tone(t, { freq: f, gain: 0.45 * k, decay: 0.07 });
      tone(t, { freq: f * 2.76, gain: 0.12 * k, decay: 0.035 });
    },
    whistle(t, k) {
      // the steam whistle: a minor-ish chord of reedy tones with breath, bending up, 1.5 s
      for (const [ratio, pan] of [[1, -0.2], [1.19, 0], [1.5, 0.2]]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        const f0 = 392 * ratio;
        o.frequency.setValueAtTime(f0 * 0.94, t);
        o.frequency.exponentialRampToValueAtTime(f0, t + 0.18);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = f0 * 2;
        bp.Q.value = 1.5;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.16 * k, t + 0.12);
        g.gain.setValueAtTime(0.16 * k, t + 1.1);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
        const p = ctx.createStereoPanner();
        p.pan.value = pan;
        o.connect(bp).connect(g).connect(p).connect(bus);
        o.start(t);
        o.stop(t + 1.7);
      }
      burst(t, { type: 'highpass', freq: 2500, q: 0.5, gain: 0.08 * k, attack: 0.1, decay: 1.3 });
    },
    chuff(t, k) {
      burst(t, { type: 'lowpass', freq: 520, q: 0.8, gain: 0.5 * k, attack: 0.01, decay: 0.2 });
      burst(t, { type: 'highpass', freq: 2200, q: 0.5, gain: 0.12 * k, attack: 0.02, decay: 0.25 });
    },
    hooves(t, k) {
      tone(t, { freq: 130, to: 80, gain: 0.5 * k, decay: 0.07 });
      burst(t, { type: 'lowpass', freq: 600, q: 0.7, gain: 0.35 * k, decay: 0.06 });
    },
    chime(t, k, p = 0) {
      const f = 1046.5 * 2 ** (p / 12);
      for (const [r, a, d] of [[1, 1, 0.9], [2.01, 0.35, 0.5], [3.02, 0.15, 0.3]]) tone(t, { freq: f * r, gain: 0.14 * k * a, attack: 0.002, decay: d, pan: 0.15 });
    },
    firework(t, k) {
      tone(t, { freq: 70, to: 40, gain: 0.7 * k, decay: 0.45 });
      burst(t, { type: 'lowpass', freq: 300, q: 0.7, gain: 0.5 * k, decay: 0.3 });
      for (let i = 0; i < 7; i += 1) burst(t + 0.18 + i * 0.06 + rnd() * 0.04, { type: 'highpass', freq: 3500, q: 0.7, gain: 0.14 * k, decay: 0.03, pan: (rnd() - 0.5) * 0.8 });
    },
    spur(t, k) {
      for (let i = 0; i < 6; i += 1) tone(t + (i ? i * 0.045 + rnd() * 0.02 : 0), { freq: 4200 + rnd() * 2200, gain: 0.07 * k, decay: 0.18, pan: 0.2 }); // the first ping on the frame
    },
  };
  for (const c of cues.sfx) SOUND[c.sound](frameTime(c.frame), c.gain, c.pitch ?? 0);
  return ctx.startRendering();
}

// ── ambience: sea wash, wind, crickets (night: the cold open and the end card) ──
async function renderAmbience() {
  const ctx = offline();
  const bus = ctx.createGain();
  endGate(ctx, bus);
  const pinkL = noise(ctx, 6, 21, 0.6);
  const pinkR = noise(ctx, 6, 22, 0.6);
  // level curve: strong in the cold open and end card, low under the band
  const curve = [[0, 0.0], [1.2, 1], [5, 1], [6.5, 0.35], [40, 0.35], [41.5, 0.9], [44.6, 0.7]];
  const level = ctx.createGain();
  level.gain.setValueAtTime(curve[0][1], 0);
  for (const [t, v] of curve.slice(1)) level.gain.linearRampToValueAtTime(v, t);
  level.connect(bus);
  for (const [buf, pan, rate, phase] of [[pinkL, -0.5, 1, 0], [pinkR, 0.5, 0.97, 1.7]]) {
    // sea: low-passed noise swelling every ~6 s
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = rate;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 650;
    const swell = ctx.createGain();
    swell.gain.value = 0.16;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.16;
    const depth = ctx.createGain();
    depth.gain.value = 0.11;
    lfo.connect(depth).connect(swell.gain);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(lp).connect(swell).connect(p).connect(level);
    src.start(0, phase);
    lfo.start(phase);
    // wind: a high band, slowly moving
    const w = ctx.createBufferSource();
    w.buffer = buf;
    w.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1300;
    bp.Q.value = 1.2;
    const wg = ctx.createGain();
    wg.gain.value = 0.025;
    w.connect(bp).connect(wg).connect(p);
    w.start(0, phase + 2);
  }
  // crickets in the night scenes only
  const carrier = ctx.createOscillator();
  carrier.type = 'triangle';
  carrier.frequency.value = 4600;
  const chirp = ctx.createGain();
  chirp.gain.value = 0;
  const chirpLfo = ctx.createOscillator();
  chirpLfo.type = 'square';
  chirpLfo.frequency.value = 28;
  const chirpDepth = ctx.createGain();
  chirpDepth.gain.value = 0.5;
  chirpLfo.connect(chirpDepth).connect(chirp.gain);
  const night = ctx.createGain();
  for (const [t, v] of [[0, 0], [1.5, 0.018], [5, 0.018], [5.6, 0], [40, 0], [41.5, 0.016], [44.5, 0.012]]) night.gain.linearRampToValueAtTime(v, t);
  carrier.connect(chirp).connect(night).connect(bus);
  carrier.start(0);
  chirpLfo.start(0);
  return ctx.startRendering();
}

function toBase64(f32) {
  const bytes = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

window.renderPromo = async (cues) => {
  const out = {};
  for (const [name, fn] of [['music', renderMusic], ['sfx', () => renderSfx(cues)], ['ambience', renderAmbience]]) {
    const buf = await fn();
    if (buf.length !== SAMPLES || buf.sampleRate !== RATE) throw new Error(`${name}: ${buf.length} samples at ${buf.sampleRate} Hz`);
    out[name] = [toBase64(buf.getChannelData(0)), toBase64(buf.getChannelData(1))];
  }
  return { rate: RATE, samples: SAMPLES, stems: out };
};
window.promoAudioReady = true;
