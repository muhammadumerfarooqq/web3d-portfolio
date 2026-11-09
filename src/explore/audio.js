// Procedural audio (WebAudio, no files): layered wind, distant sea swell, night crickets, footsteps by
// surface (sand / wood / stone) and UI blips. Created lazily on the first user gesture, follows the
// global sound preference ("soundchange"), and suspends while the tab is hidden.

function noiseBuffer(ctx, seconds = 2) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i += 1) {
    // slightly pinked noise
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = white * 0.6 + last * 3;
  }
  return buffer;
}

export function createAudio({ enabled }) {
  let ctx = null;
  let master = null;
  let on = enabled;
  const layers = {};
  let buffer = null;

  function ensure() {
    if (ctx || !on) return Boolean(ctx);
    const AC = window.AudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    buffer = noiseBuffer(ctx);

    const loop = (filterType, freq, q, gain) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(filter).connect(g).connect(master);
      src.start();
      return { src, filter, gain: g };
    };
    // Wind: two band-passed layers with slow LFOs on level and colour.
    layers.windLow = loop('bandpass', 380, 0.7, 0.18);
    layers.windHigh = loop('bandpass', 1400, 1.4, 0.05);
    for (const [layer, rate, depth] of [[layers.windLow, 0.07, 0.1], [layers.windHigh, 0.11, 0.04]]) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const amt = ctx.createGain();
      amt.gain.value = depth;
      lfo.connect(amt).connect(layer.gain.gain);
      lfo.start();
      layer.lfo = lfo;
    }
    // Sea: low-passed noise with a slow swell.
    layers.sea = loop('lowpass', 520, 0.5, 0.0);
    const swell = ctx.createOscillator();
    swell.frequency.value = 0.09;
    const swellAmt = ctx.createGain();
    swellAmt.gain.value = 0.05;
    swell.connect(swellAmt).connect(layers.sea.gain.gain);
    swell.start();
    layers.sea.lfo = swell;
    // Crickets: a high carrier gated by a fast chirp LFO and a slower pulse.
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
    const level = ctx.createGain();
    level.gain.value = 0;
    carrier.connect(chirp).connect(level).connect(master);
    carrier.start();
    chirpLfo.start();
    layers.crickets = { level, nodes: [carrier, chirpLfo] };
    master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.8);
    return true;
  }

  function burst({ type, freq, q = 1, gain = 0.25, decay = 0.09, pitch = 0, at = 0 }) {
    if (!ensure() || ctx.state !== 'running') return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = 1 + pitch;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime + at;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    src.connect(filter).connect(g).connect(master);
    src.start(t, Math.random() * 1.5, decay + 0.05);
  }

  return {
    /** Call from a user gesture (click / key). */
    unlock() {
      if (!on) return;
      ensure();
      ctx?.resume?.();
    },
    setEnabled(value) {
      on = value;
      if (on) {
        ensure();
        ctx?.resume?.();
        master?.gain.setTargetAtTime(0.9, ctx.currentTime, 0.3);
      } else if (ctx) {
        master.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
      }
    },
    get enabled() {
      return on;
    },
    /** Per-frame mix: night 0…1, distance to the shore, wind 0…1. */
    update(night, shoreProximity, wind = 1) {
      if (!ctx) return;
      const t = ctx.currentTime;
      layers.windLow.gain.gain.setTargetAtTime(0.12 + 0.1 * wind, t, 0.5);
      layers.sea.gain.gain.setTargetAtTime(0.03 + 0.16 * shoreProximity, t, 0.5);
      layers.crickets.level.gain.setTargetAtTime(0.022 * night, t, 0.8);
    },
    footstep(surface) {
      if (surface === 'wood') burst({ type: 'bandpass', freq: 900, q: 2.5, gain: 0.32, decay: 0.07, pitch: Math.random() * 0.2 });
      else if (surface === 'stone') burst({ type: 'highpass', freq: 2200, q: 0.8, gain: 0.18, decay: 0.05, pitch: 0.3 });
      else burst({ type: 'lowpass', freq: 750, q: 0.6, gain: 0.22, decay: 0.11, pitch: Math.random() * 0.15 });
    },
    blip(high = false) {
      if (!ensure() || ctx.state !== 'running') return;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = high ? 1320 : 880;
      const g = ctx.createGain();
      const t = ctx.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + 0.14);
    },
    /** A shaped tone for the lazily loaded systems (badge chime, train whistle, fireworks): a sine/
     *  triangle at freq (optional glide to `to`), attack, hold and release in seconds, starting `at`
     *  seconds from now. Silent when sound is off. */
    tone({ freq, to = freq, type = 'sine', gain = 0.06, attack = 0.01, hold = 0, release = 0.25, at = 0, vibrato = 0 }) {
      if (!ensure() || ctx.state !== 'running') return;
      const o = ctx.createOscillator();
      o.type = type;
      const t = ctx.currentTime + at;
      o.frequency.setValueAtTime(freq, t);
      if (to !== freq) o.frequency.exponentialRampToValueAtTime(to, t + attack + hold + release);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + attack);
      g.gain.setValueAtTime(gain, t + attack + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
      if (vibrato) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 5.5;
        const amt = ctx.createGain();
        amt.gain.value = vibrato;
        lfo.connect(amt).connect(o.frequency);
        lfo.start(t);
        lfo.stop(t + attack + hold + release + 0.05);
      }
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + attack + hold + release + 0.05);
    },
    /** A filtered noise burst (chuffs, steam, firework crackle). */
    noise(opts) {
      burst(opts);
    },
    suspend() {
      ctx?.suspend?.();
    },
    resume() {
      if (on) ctx?.resume?.();
    },
    dispose() {
      if (!ctx) return;
      for (const l of Object.values(layers)) {
        l.src?.stop?.();
        l.lfo?.stop?.();
        for (const n of l.nodes ?? []) n.stop?.();
      }
      ctx.close?.();
      ctx = null;
    },
  };
}
