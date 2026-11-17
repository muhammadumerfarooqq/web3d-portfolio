// P9.5 promo render (run by hand, after promo.jsx has built aftereffects/promo.aep in AE 2022):
//   node scripts/promo/render.mjs
// 1. aerender renders the project's Render Queue (the "PROMO_MASTER (render this)" item that promo.jsx
//    adds) to the PNG sequence aftereffects/render/promo_#####.png.
// 2. ffmpeg muxes the frames with aftereffects/audio/mix.wav into:
//      aftereffects/promo-4k.mp4        3840×2160 24 fps H.264 High CRF 16 slow, AAC 320k (git-ignored)
//      public/media/promo-1080.mp4      1920×1080 Lanczos, CRF 21 slow, AAC 192k (committed, ≤ 20 MB)
//      public/media/promo-poster.jpg    the frame at 0:42
// 3. Prints each output's duration and size. Large outputs never go in git (see .gitignore).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const AE = join(ROOT, 'aftereffects');
const AERENDER = 'C:\\Program Files\\Adobe\\Adobe After Effects 2022\\Support Files\\aerender.exe';
const PROJECT = join(AE, 'promo.aep');
const FRAMES = join(AE, 'render');
const MIX = join(AE, 'audio', 'mix.wav');
const MASTER = join(AE, 'promo-4k.mp4');
const MEDIA = join(ROOT, 'public', 'media');
const WEB = join(MEDIA, 'promo-1080.mp4');
const POSTER = join(MEDIA, 'promo-poster.jpg');
const WEB_LIMIT = 20 * 1024 * 1024;

const mb = (file) => `${(statSync(file).size / 1048576).toFixed(1)} MB`;
const fail = (msg) => {
  console.error(`render: ${msg}`);
  process.exit(1);
};
const ffmpeg = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-stats', '-y', ...args], { stdio: 'inherit' });
const duration = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());

for (const [tool, args] of [['ffmpeg', ['-version']], ['ffprobe', ['-version']]]) {
  if (spawnSync(tool, args).status !== 0) fail(`${tool} not found on PATH`);
}
if (!existsSync(AERENDER)) fail(`aerender not found: ${AERENDER}`);
if (!existsSync(PROJECT)) fail('aftereffects/promo.aep is missing (run promo.jsx in After Effects 2022 first)');
if (!existsSync(MIX)) fail('aftereffects/audio/mix.wav is missing (node scripts/promo/render-audio.mjs)');

// 1. aerender: the Render Queue as promo.jsx set it up (frame sequence into aftereffects/render/).
//    AE 2022 has no "PNG Sequence" template, so frames may be TIFF; both are accepted.
//    Rendered in chunks of CHUNK frames, each in a fresh aerender process with multi-frame rendering OFF,
//    so memory is released between chunks (4K + many effects ran out of RAM/VRAM in one pass).
//    Existing frames are kept and skipped (resume); pass --clean to start over.
const TOTAL = 1080, CHUNK = 120;
const t0 = Date.now();
if (process.argv.includes('--clean')) rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
const FRAME_RE = /^promo_(\d{5})\.(png|tif)$/;
const have = () => new Set(readdirSync(FRAMES).filter((f) => FRAME_RE.test(f)).map((f) => Number(f.match(FRAME_RE)[1])));
let done = have();
for (let s0 = 0; s0 < TOTAL && !process.argv.includes('--encode-only'); s0 += CHUNK) {
  const e0 = Math.min(TOTAL - 1, s0 + CHUNK - 1);
  let first = -1;
  for (let f = s0; f <= e0; f++) if (!done.has(f)) { first = f; break; }
  if (first < 0) continue;                                   // chunk already rendered
  console.log(`aerender: frames ${first}-${e0} …`);
  const ae = spawnSync(AERENDER, ['-project', PROJECT, '-rqindex', '1', '-s', String(first), '-e', String(e0),
    '-mfr', 'OFF', '100', '-v', 'ERRORS_AND_PROGRESS'], { stdio: 'inherit' });
  done = have();
  const missing = [];
  for (let f = first; f <= e0; f++) if (!done.has(f)) missing.push(f);
  if (missing.length) fail(`aerender left ${missing.length} frames missing in ${first}-${e0} (first: ${missing[0]}, exit ${ae.status}). Close other apps (Chrome, VS Code) and re-run: it resumes.`);
}
const frames = readdirSync(FRAMES).filter((f) => FRAME_RE.test(f)).sort();
if (frames.length < TOTAL) fail(`only ${frames.length}/${TOTAL} frames in aftereffects/render/`);
const EXT = frames[0].match(FRAME_RE)[2];
const start = Number(frames[0].slice(6, 11));
console.log(`aerender: ${frames.length} ${EXT.toUpperCase()} frames ready (${((Date.now() - t0) / 60000).toFixed(1)} min)`);

// 2. ffmpeg: 4K master, 1080p web file, poster
const input = ['-framerate', '24', '-start_number', String(start), '-i', join(FRAMES, `promo_%05d.${EXT}`), '-i', MIX, '-map', '0:v', '-map', '1:a', '-shortest'];
const h264 = (crf, scale) => ['-vf', `${scale}format=yuv420p`, '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', String(crf), '-r', '24', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart'];
// Film grain makes every frame unique noise, so CRF 16 gave a 1.9 GB master. CRF 23 keeps it visually clean;
// the web file uses a two-pass target bitrate so it always lands under ~20 MB (45 s x 3.36 Mbit/s = 18.9 MB).
console.log('ffmpeg: 4K master …');
ffmpeg([...input, ...h264(23, ''), '-c:a', 'aac', '-b:a', '320k', MASTER]);
mkdirSync(MEDIA, { recursive: true });
console.log('ffmpeg: 1080p web file (two-pass, 3.2 Mbit/s) …');
const vWeb = ['-vf', 'scale=1920:1080:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-b:v', '3200k', '-r', '24'];
ffmpeg(['-framerate', '24', '-start_number', String(start), '-i', join(FRAMES, `promo_%05d.${EXT}`), ...vWeb, '-pass', '1', '-passlogfile', join(FRAMES, 'x264pass'), '-an', '-f', 'mp4', process.platform === 'win32' ? 'NUL' : '/dev/null']);
ffmpeg([...input, ...vWeb, '-pass', '2', '-passlogfile', join(FRAMES, 'x264pass'), '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', WEB]);
ffmpeg(['-ss', '42', '-i', WEB, '-frames:v', '1', '-q:v', '3', POSTER]);

// 3. report
for (const file of [MASTER, WEB]) console.log(`${file.slice(ROOT.length + 1)}: ${duration(file).toFixed(3)} s, ${mb(file)}`);
console.log(`${POSTER.slice(ROOT.length + 1)}: ${mb(POSTER)}`);
if (statSync(WEB).size > WEB_LIMIT) console.warn('WARNING: promo-1080.mp4 is over 20 MB: raise the CRF (e.g. 23) and re-run the ffmpeg step');
console.log(`done in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
