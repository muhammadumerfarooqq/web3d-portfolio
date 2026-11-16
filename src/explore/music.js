// The Byte Island score (lazy chunk; WebAudio only, no audio files). Twangy Karplus-Strong guitar
// through a generated spring-reverb impulse, a whistled melody (sine with vibrato and slides),
// harmonica phrases (filtered saw with breath and bends), slow kick, tambourine and shaker, and now
// and then a distant church bell or an anvil. DAY (golden hour, 84 bpm, fuller) and NIGHT (66 bpm,
// campfire guitar and harmonica; the crickets come from the ambience bus) crossfade on day/night.
// CPU: a 50 ms timer schedules 200 ms ahead (music-core.js); plucks are rendered once per note and
// cached; the whistle and harmonica voices are persistent nodes, re-pitched and gated per note.
import { SCORE, createMoodMixer, createScheduler, indexScore, midiToFreq } from './music-core.js';

let seed = 12345;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;

/** Karplus-Strong pluck (1.6 s, mono), slightly bright for the spaghetti-western twang. */
function pluck(ctx, freq) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 1.6);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const n = Math.max(2, Math.round(sr / freq));
  const line = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i += 1) {
    // a pick near the bridge: noise, lightly low-passed
    prev = prev * 0.35 + rnd() * 0.65;
    line[i] = prev;
  }
  const decay = 0.9965;
  let idx = 0;
  for (let i = 0; i < len; i += 1) {
    const a = line[idx];
    const b = line[(idx + 1) % n];
    const y = (a + b) * 0.5 * decay;
    line[idx] = y;
    d[i] = a;
    idx = (idx + 1) % n;
  }
  return buf;
}

/** Spring-reverb impulse: dense decaying noise with a "boing" chirp and early taps (stereo, 2.4 s). */
function springImpulse(ctx) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 2.4);
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c += 1) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i += 1) {
      const t = i / sr;
      const chirp = 0.6 + 0.4 * Math.sin(2 * Math.PI * (90 + 160 * t) * t + c);
      d[i] = rnd() * Math.exp(-t / 0.6) * chirp * 0.6;
    }
    for (let k = 1; k < 7; k += 1) {
      const at = Math.floor(sr * (0.031 * k + c * 0.004));
      for (let j = 0; j < 220 && at + j < len; j += 1) d[at + j] += rnd() * 0.5 * Math.exp(-k * 0.5) * Math.exp(-j / 60);
    }
  }
  return buf;
}

/** One-shot percussion, rendered once. */
function render(ctx, seconds, fn) {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(sr * seconds), sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i += 1) d[i] = fn(i / sr);
  return buf;
}
const kickBuf = (ctx) => {
  let ph = 0;
  return render(ctx, 0.35, (t) => {
    ph += (2 * Math.PI * (45 + 80 * Math.exp(-t * 18))) / ctx.sampleRate;
    return Math.sin(ph) * Math.exp(-t * 9) * 0.9;
  });
};
const shakerBuf = (ctx) => render(ctx, 0.06, (t) => rnd() * Math.exp(-t * 70) * (t < 0.006 ? t / 0.006 : 1));
const tambBuf = (ctx) => render(ctx, 0.22, (t) => (rnd() * 0.5 + Math.sin(2 * Math.PI * 6800 * t) * 0.25 + Math.sin(2 * Math.PI * 8900 * t) * 0.2) * Math.exp(-t * 22));
const bellBuf = (ctx) =>
  render(ctx, 3.5, (t) => [1, 2, 2.76, 5.4, 8.9].reduce((s, r, i) => s + Math.sin(2 * Math.PI * 196 * r * t) * Math.exp(-t * (0.8 + i * 0.9)) / (i + 1.4), 0) * 0.4);
const anvilBuf = (ctx) => render(ctx, 1.2, (t) => [1, 2.7, 5.1, 8.2].reduce((s, r, i) => s + Math.sin(2 * Math.PI * 880 * r * t) * Math.exp(-t * (4 + i * 3)) / (i + 1), 0) * 0.3);

/** A persistent pitched voice (whistle / harmonica): osc → (filter) → gate gain; notes re-pitch it. */
function voice(ctx, out, { type, filter, vibrato, breath, noise }) {
  const osc = ctx.createOscillator();
  osc.type = type;
  const gate = ctx.createGain();
  gate.gain.value = 0;
  let node = osc;
  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filter;
    f.Q.value = 1.2;
    osc.connect(f);
    node = f;
  }
  node.connect(gate).connect(out);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.4;
  const depth = ctx.createGain();
  depth.gain.value = vibrato;
  lfo.connect(depth).connect(osc.frequency);
  // breath: looped noise through a band-pass, following the gate
  const air = ctx.createBufferSource();
  air.buffer = noise;
  air.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = type === 'sine' ? 3200 : 1500;
  bp.Q.value = 0.8;
  const airGain = ctx.createGain();
  airGain.gain.value = 0;
  air.connect(bp).connect(airGain).connect(out);
  osc.start();
  lfo.start();
  air.start();
  return {
    note(time, midi, seconds, from, level) {
      const f = midiToFreq(midi);
      osc.frequency.cancelScheduledValues(time);
      if (from) {
        osc.frequency.setValueAtTime(midiToFreq(from), time);
        osc.frequency.setTargetAtTime(f, time + 0.02, 0.05); // slide / bend up to the note
      } else osc.frequency.setTargetAtTime(f, time, 0.012);
      const g = gate.gain;
      g.cancelScheduledValues(time);
      g.setValueAtTime(g.value, time);
      g.linearRampToValueAtTime(level, time + 0.04);
      g.setValueAtTime(level * 0.85, time + Math.max(0.05, seconds - 0.08));
      g.linearRampToValueAtTime(0, time + seconds);
      const a = airGain.gain;
      a.cancelScheduledValues(time);
      a.setValueAtTime(0, time);
      a.linearRampToValueAtTime(level * breath, time + 0.03);
      a.linearRampToValueAtTime(0, time + seconds);
    },
    stop() {
      for (const n of [osc, lfo, air]) n.stop();
    },
  };
}

export function createMusic({ ctx, out, noise, night = true }) {
  const plucks = new Map();
  const getPluck = (m) => {
    if (!plucks.has(m)) plucks.set(m, pluck(ctx, midiToFreq(m)));
    return plucks.get(m);
  };
  const reverb = ctx.createConvolver();
  reverb.buffer = springImpulse(ctx);
  const wet = ctx.createGain();
  wet.gain.value = 0.32;
  reverb.connect(wet).connect(out);
  const mixer = createMoodMixer({ ctx, out });
  const sends = {};
  for (const [mood, g] of Object.entries(mixer.gains)) {
    // each mood also feeds the shared spring reverb
    const send = ctx.createGain();
    send.gain.value = mood === 'night' ? 0.55 : 0.4;
    g.connect(send).connect(reverb);
    sends[mood] = send;
  }
  const buffers = { kick: kickBuf(ctx), shaker: shakerBuf(ctx), tambourine: tambBuf(ctx), bell: bellBuf(ctx), anvil: anvilBuf(ctx) };
  const voices = {};
  for (const mood of ['day', 'night']) {
    voices[mood] = {
      whistle: voice(ctx, mixer.gains[mood], { type: 'sine', vibrato: 7, breath: 0.08, noise }),
      harmonica: voice(ctx, mixer.gains[mood], { type: 'sawtooth', filter: 1500, vibrato: 4, breath: 0.25, noise }),
    };
  }
  const shot = (buf, time, gain, dest, rate = 1) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(dest);
    src.start(time);
  };

  const loops = {};
  for (const mood of ['day', 'night']) {
    const score = SCORE[mood];
    const at = indexScore(score);
    let loop = 0;
    const dest = mixer.gains[mood];
    loops[mood] = createScheduler({
      now: () => ctx.currentTime,
      bpm: score.bpm,
      steps: score.steps,
      onStep: (step, time, dur) => {
        if (step === 0) loop += 1;
        const e = at[step];
        for (const [m, v] of e.guitar) {
          // pick twang: a hair sharp, settling in 60 ms
          const src = ctx.createBufferSource();
          src.buffer = getPluck(m);
          src.playbackRate.setValueAtTime(1.006, time);
          src.playbackRate.linearRampToValueAtTime(1, time + 0.06);
          const g = ctx.createGain();
          g.gain.value = v * (mood === 'night' ? 0.32 : 0.38);
          src.connect(g).connect(dest);
          src.start(time);
        }
        if (e.whistle) voices[mood].whistle.note(time, e.whistle.midi, e.whistle.len * dur, e.whistle.from, 0.16);
        if (e.harmonica) voices[mood].harmonica.note(time, e.harmonica.midi, e.harmonica.len * dur, e.harmonica.from, 0.09);
        if (e.kick) shot(buffers.kick, time, 0.5, dest);
        if (e.tambourine) shot(buffers.tambourine, time, 0.12, dest);
        if (e.shaker) shot(buffers.shaker, time, step % 4 === 2 ? 0.1 : 0.05, dest);
        if (e.bell && loop % 2 === 0) shot(buffers[e.bell], time, e.bell === 'bell' ? 0.14 : 0.08, sends[mood]);
      },
    });
  }

  let timer = 0;
  let fadeTimer = 0;
  const tick = () => {
    for (const l of Object.values(loops)) l.tick();
  };
  const run = () => {
    clearInterval(timer);
    timer = setInterval(tick, 50);
  };
  function setMood(isNight, fade = 2.5) {
    const next = isNight ? 'night' : 'day';
    if (mixer.mood === next) return;
    const other = isNight ? 'day' : 'night';
    if (!loops[next].running) loops[next].start(ctx.currentTime + 0.08);
    mixer.set(next, mixer.mood ? fade : 0.8);
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => loops[other].stop(), (fade + 0.3) * 1000);
  }
  setMood(night);
  run();
  tick();

  return {
    setMood,
    get mood() {
      return mixer.mood;
    },
    pause() {
      clearInterval(timer);
    },
    resume() {
      run();
    },
    dispose() {
      clearInterval(timer);
      clearTimeout(fadeTimer);
      for (const l of Object.values(loops)) l.stop();
      for (const v of Object.values(voices)) for (const x of Object.values(v)) x.stop();
      for (const g of Object.values(mixer.gains)) g.disconnect();
      wet.disconnect();
    },
  };
}
