// P9.3 promo audio: renders the original score, SFX and ambience offline (scripts/promo/audio/render.js
// in Chrome through the Vite dev server), then writes 24-bit 48 kHz stereo WAVs of exactly 45.000 s:
//   aftereffects/audio/music.wav, sfx.wav, ambience.wav, mix.wav      (git-ignored)
// Loudness: the mix is measured with ffmpeg (loudnorm analysis, EBU R128 / ITU-R BS.1770), one gain
// brings it to about −14 LUFS integrated and is applied to every stem as well; the mix then passes a
// look-ahead peak limiter so the true peak stays at or below −1 dBTP (the stems are the same gain,
// before the limiter, for the After Effects mix). Numbers go to docs/promo/audio-report.json.
//   node scripts/promo/render-audio.mjs
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const ROOT = join(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'aftereffects', 'audio');
const RATE = 48000;
const SAMPLES = 45 * RATE;
const TARGET_LUFS = -14;
const CEILING_DBTP = -1;

export function wav24(left, right) {
  const n = left.length;
  const data = Buffer.alloc(n * 6);
  for (let i = 0; i < n; i += 1) {
    for (const [c, ch] of [[0, left], [1, right]]) {
      const v = Math.max(-1, Math.min(1, ch[i]));
      const s = Math.round(v < 0 ? v * 0x800000 : v * 0x7fffff);
      data.writeIntLE(s, i * 6 + c * 3, 3);
    }
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 6, 28);
  h.writeUInt16LE(6, 32);
  h.writeUInt16LE(24, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

function wavFloat(left, right) {
  const n = left.length;
  const data = Buffer.alloc(n * 8);
  for (let i = 0; i < n; i += 1) {
    data.writeFloatLE(left[i], i * 8);
    data.writeFloatLE(right[i], i * 8 + 4);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(3, 20); // IEEE float
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 8, 28);
  h.writeUInt16LE(8, 32);
  h.writeUInt16LE(32, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** ffmpeg loudnorm analysis of a file (its stderr, which ends with the JSON block). */
function loudness(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  return r.stderr;
}
function parseLoudnorm(stderr) {
  const json = JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1));
  return { I: Number(json.input_i), TP: Number(json.input_tp), LRA: Number(json.input_lra) };
}
function analyse(left, right, tmp) {
  const file = join(tmp, `a${Math.random().toString(36).slice(2)}.wav`);
  writeFileSync(file, wavFloat(left, right));
  const out = loudness(file);
  rmSync(file, { force: true });
  return out;
}

const db = (x) => 20 * Math.log10(x);
const peak = (chs) => chs.reduce((m, ch) => ch.reduce((a, v) => Math.max(a, Math.abs(v)), m), 0);

/**
 * Look-ahead peak limiter (stereo-linked): 4× linear-interpolated peak estimate (catches most
 * inter-sample overs), 1.5 ms look-ahead with a smooth attack, 120 ms release.
 */
export function limit(left, right, ceiling) {
  const n = left.length;
  const need = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    let p = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    if (i + 1 < n) {
      for (let k = 1; k < 4; k += 1) {
        const t = k / 4;
        p = Math.max(p, Math.abs(left[i] + (left[i + 1] - left[i]) * t), Math.abs(right[i] + (right[i + 1] - right[i]) * t));
      }
    }
    need[i] = p > ceiling ? ceiling / p : 1;
  }
  const look = Math.round(0.0015 * RATE);
  const rel = Math.exp(-1 / (0.12 * RATE));
  // minimum over the look-ahead window (sliding), then attack ramp and release
  const target = new Float32Array(n);
  const dq = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    while (dq.length && need[dq[dq.length - 1]] >= need[i]) dq.pop();
    dq.push(i);
    while (dq[0] > i + look) dq.shift();
    target[i] = need[dq[0]];
  }
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  let g = 1;
  for (let i = 0; i < n; i += 1) {
    g = target[i] < g ? target[i] : target[i] + (g - target[i]) * rel;
    outL[i] = left[i] * g;
    outR[i] = right[i] * g;
  }
  return [outL, outR];
}

async function main() {
  const cues = JSON.parse(readFileSync(join(ROOT, 'docs', 'promo', 'cues.json'), 'utf8'));
  const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.js'), logLevel: 'error', server: { port: 5182, host: '127.0.0.1' } });
  await server.listen();
  const url = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const t0 = Date.now();
  let result;
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('[page]', String(e)));
    await page.goto(`${url}/scripts/promo/audio/render.html`);
    await page.waitForFunction(() => window.promoAudioReady === true, null, { timeout: 60000 });
    result = await page.evaluate((c) => window.renderPromo(c), cues);
  } finally {
    await browser.close();
    await server.close();
  }
  const renderSeconds = (Date.now() - t0) / 1000;
  const decode = (b64) => {
    const b = Buffer.from(b64, 'base64');
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  };
  const stems = {};
  for (const [name, [l, r]] of Object.entries(result.stems)) stems[name] = [decode(l), decode(r)];
  for (const [name, [l, r]] of Object.entries(stems)) if (l.length !== SAMPLES || r.length !== SAMPLES) throw new Error(`${name}: ${l.length} samples`);

  const tmp = join(tmpdir(), 'promo-audio');
  mkdirSync(tmp, { recursive: true });
  const sum = (c) => {
    const out = new Float32Array(SAMPLES);
    for (const [l, r] of Object.values(stems)) {
      const ch = c ? r : l;
      for (let i = 0; i < SAMPLES; i += 1) out[i] += ch[i];
    }
    return out;
  };
  const raw = [sum(0), sum(1)];
  const before = parseLoudnorm(analyse(raw[0], raw[1], tmp));
  let ceilingDb = CEILING_DBTP - 0.6; // sample-peak ceiling; lowered if inter-sample overs remain
  let gainDb = TARGET_LUFS - before.I;
  let limited;
  let mix;
  let after;
  for (let pass = 0; pass < 8; pass += 1) {
    const g = 10 ** (gainDb / 20);
    const ceiling = 10 ** (ceilingDb / 20);
    // every stem at the same gain through the same peak limiter (no stem clips), then the mix of
    // those stems through it once more
    limited = Object.fromEntries(Object.entries(stems).map(([name, [l, r]]) => [name, limit(l.map((v) => v * g), r.map((v) => v * g), ceiling)]));
    const m = [new Float32Array(SAMPLES), new Float32Array(SAMPLES)];
    for (const [l, r] of Object.values(limited)) {
      for (let i = 0; i < SAMPLES; i += 1) {
        m[0][i] += l[i];
        m[1][i] += r[i];
      }
    }
    mix = limit(m[0], m[1], ceiling);
    after = parseLoudnorm(analyse(mix[0], mix[1], tmp));
    if (Math.abs(after.I - TARGET_LUFS) < 0.3 && after.TP <= CEILING_DBTP) break;
    if (after.TP > CEILING_DBTP) ceilingDb -= after.TP - CEILING_DBTP + 0.1;
    gainDb += TARGET_LUFS - after.I;
  }
  if (after.TP > CEILING_DBTP) throw new Error(`true peak ${after.TP} dBTP is above ${CEILING_DBTP}`);
  mkdirSync(OUT, { recursive: true });
  const report = { note: 'Written by scripts/promo/render-audio.mjs (WAVs are git-ignored). Stems: the same gain and the same look-ahead peak limiter each (ceilingDbfs); mix.wav = their sum through the same limiter.', date: new Date().toISOString().slice(0, 10), sampleRate: RATE, bitDepth: 24, channels: 2, renderSeconds: +renderSeconds.toFixed(1), gainDb: +gainDb.toFixed(2), ceilingDbfs: +ceilingDb.toFixed(2), rawMix: before, files: {} };
  for (const [name, [gl, gr]] of Object.entries(limited)) {
    writeFileSync(join(OUT, `${name}.wav`), wav24(gl, gr));
    const st = parseLoudnorm(loudness(join(OUT, `${name}.wav`)));
    report.files[`${name}.wav`] = { samples: gl.length, seconds: gl.length / RATE, samplePeakDbfs: +db(peak([gl, gr])).toFixed(2), truePeakDbtp: st.TP, integratedLufs: st.I };
  }
  writeFileSync(join(OUT, 'mix.wav'), wav24(mix[0], mix[1]));
  const final = parseLoudnorm(loudness(join(OUT, 'mix.wav')));
  report.files['mix.wav'] = { samples: mix[0].length, seconds: mix[0].length / RATE, samplePeakDbfs: +db(peak(mix)).toFixed(2), integratedLufs: final.I, truePeakDbtp: final.TP, loudnessRangeLu: final.LRA };
  writeFileSync(join(ROOT, 'docs', 'promo', 'audio-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  rmSync(tmp, { recursive: true, force: true });
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
