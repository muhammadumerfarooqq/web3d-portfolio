// P9.5 captions for the promo film: public/media/promo.en.vtt, built from docs/promo/cues.json.
// The on-screen text cues become captions (same frames); each music section and each run of a sound
// effect gets a short [music] / [sound] description for viewers who cannot hear the film.
//   node scripts/promo/build-vtt.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');

const MUSIC = {
  drone: 'low drone and the sea',
  whistle: 'a whistled western melody over guitar',
  anvil: 'the melody goes on, an anvil on every beat',
  band: 'the full western band comes in',
  railway: 'a driving train rhythm with harmonica',
  town: 'a gallop rhythm',
  resolve: 'the music resolves and rings out',
};
const SOUND = {
  projector: 'film projector whirs',
  stamp: 'stamp thuds',
  typewriter: 'typewriter clacks',
  paper: 'paper rustles',
  anvil: 'hammer on an anvil',
  pin: 'pin taps into the board',
  ratchet: 'ratchet clicks',
  woodblock: 'woodblock knocks',
  whistle: 'train whistle',
  chuff: 'steam train chuffs',
  hooves: 'galloping hooves',
  chime: 'badge chimes',
  firework: 'fireworks pop',
  spur: 'spurs jingle',
};

const stamp = (frame, fps) => {
  const ms = Math.round((frame / fps) * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
};

export function buildVtt(cues) {
  const { fps, duration } = cues;
  const end = Math.round(duration * fps);
  const out = [];
  for (const t of cues.text) out.push({ from: t.frame, to: t.endFrame, text: t.text.replaceAll('{liveUrl}', cues.liveUrl) });
  for (const m of cues.music) out.push({ from: m.startFrame, to: Math.min(m.endFrame, m.startFrame + 48), text: `[music: ${MUSIC[m.id] ?? m.description.split(/[:.]/)[0].toLowerCase()}]` });
  // runs of one sound (gaps under a second join), shown for at least a second
  const bySound = new Map();
  for (const s of cues.sfx) (bySound.get(s.sound) ?? bySound.set(s.sound, []).get(s.sound)).push(s.frame);
  for (const [sound, frames] of bySound) {
    let run = [frames[0], frames[0]];
    const flush = () => out.push({ from: run[0], to: Math.min(end, Math.max(run[1] + 12, run[0] + 24)), text: `[sound: ${SOUND[sound] ?? sound}]` });
    for (const f of frames.slice(1)) {
      if (f - run[1] < 24) run[1] = f;
      else {
        flush();
        run = [f, f];
      }
    }
    flush();
  }
  out.sort((a, b) => a.from - b.from || a.to - b.to);
  const body = out.map((c, i) => `${i + 1}\n${stamp(c.from, fps)} --> ${stamp(c.to, fps)}\n${c.text}`);
  return `WEBVTT - The Case File of Umer (promo film, English)\n\n${body.join('\n\n')}\n`;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const cues = JSON.parse(readFileSync(join(ROOT, 'docs', 'promo', 'cues.json'), 'utf8'));
  const vtt = buildVtt(cues);
  writeFileSync(join(ROOT, 'public', 'media', 'promo.en.vtt'), vtt);
  console.log(`promo.en.vtt: ${vtt.split('\n\n').length - 1} cues`);
}
