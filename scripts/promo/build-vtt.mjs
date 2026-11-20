// P10 captions for the promo film, English and Urdu, from docs/promo/captions.json (the on-screen text of the
// film with short [sound] notes; the cue times follow docs/promo/cues.json and the storyboard). Writes
//   public/captions/promo.en.vtt   and   public/captions/promo.ur.vtt   (UTF-8)
// Cues are sequential: no two overlap. The Urdu file starts with a NOTE that a native speaker must review it.
//   node scripts/promo/build-vtt.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');

const stamp = (seconds) => {
  const ms = Math.round(seconds * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
};

const HEADER = {
  en: 'WEBVTT - The Case File of Umer (promo film, English)',
  ur: 'WEBVTT - The Case File of Umer (promo film, Urdu / اردو)\n\nNOTE\nREVIEW NEEDED by native speaker: this Urdu was written for the project and must be read and corrected before submission.',
};

/** The VTT text for one language ('en' | 'ur') from the parsed captions.json. */
export function buildVtt(captions, lang) {
  const body = captions.cues.map((c, i) => `${i + 1}\n${stamp(c.from)} --> ${stamp(c.to)}\n${c[lang].replaceAll('{liveUrl}', captions.liveUrl)}`);
  return `${HEADER[lang]}\n\n${body.join('\n\n')}\n`;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const captions = JSON.parse(readFileSync(join(ROOT, 'docs', 'promo', 'captions.json'), 'utf8'));
  mkdirSync(join(ROOT, 'public', 'captions'), { recursive: true });
  for (const lang of ['en', 'ur']) {
    writeFileSync(join(ROOT, 'public', 'captions', `promo.${lang}.vtt`), buildVtt(captions, lang), 'utf8');
    console.log(`public/captions/promo.${lang}.vtt: ${captions.cues.length} cues`);
  }
}
