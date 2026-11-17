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

// 1. aerender: the Render Queue as promo.jsx set it up (PNG sequence into aftereffects/render/)
const t0 = Date.now();
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
console.log('aerender: rendering the Render Queue of promo.aep …');
const ae = spawnSync(AERENDER, ['-project', PROJECT, '-v', 'ERRORS_AND_PROGRESS'], { stdio: 'inherit' });
if (ae.status !== 0) fail(`aerender exited with ${ae.status}`);
const pngs = readdirSync(FRAMES).filter((f) => /^promo_\d{5}\.png$/.test(f)).sort();
if (!pngs.length) fail('aerender wrote no frames to aftereffects/render/');
const start = Number(pngs[0].slice(6, 11));
console.log(`aerender: ${pngs.length} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

// 2. ffmpeg: 4K master, 1080p web file, poster
const input = ['-framerate', '24', '-start_number', String(start), '-i', join(FRAMES, 'promo_%05d.png'), '-i', MIX, '-map', '0:v', '-map', '1:a', '-shortest'];
const h264 = (crf, scale) => ['-vf', `${scale}format=yuv420p`, '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', String(crf), '-r', '24', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart'];
console.log('ffmpeg: 4K master …');
ffmpeg([...input, ...h264(16, 'scale=3840:2160:flags=lanczos,'), '-c:a', 'aac', '-b:a', '320k', MASTER]);
mkdirSync(MEDIA, { recursive: true });
console.log('ffmpeg: 1080p web file …');
ffmpeg([...input, ...h264(21, 'scale=1920:1080:flags=lanczos,'), '-c:a', 'aac', '-b:a', '192k', WEB]);
ffmpeg(['-ss', '42', '-i', WEB, '-frames:v', '1', '-q:v', '3', POSTER]);

// 3. report
for (const file of [MASTER, WEB]) console.log(`${file.slice(ROOT.length + 1)}: ${duration(file).toFixed(3)} s, ${mb(file)}`);
console.log(`${POSTER.slice(ROOT.length + 1)}: ${mb(POSTER)}`);
if (statSync(WEB).size > WEB_LIMIT) console.warn('WARNING: promo-1080.mp4 is over 20 MB: raise the CRF (e.g. 23) and re-run the ffmpeg step');
console.log(`done in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
