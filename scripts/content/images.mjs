// P4 content images: one source file → optimised WebP at 1600 px and 800 px (longest side, never
// upscaled), metadata stripped (no EXIF / GPS from phone photos). PDFs (certificates) are rasterised
// first with PyMuPDF (local Python, `python -I`). ffmpeg does the scaling and WebP encoding (libwebp).
//   node scripts/content/images.mjs <source file> <output base, e.g. public/images/projects/tiny-village>
// writes <base>-1600.webp and <base>-800.webp. The raw sources stay in content-inbox/ (git-ignored).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const SIZES = [1600, 800];

function rasterisePdf(pdf, png) {
  const code = 'import sys, fitz\nd = fitz.open(sys.argv[1])\np = d[0]\nz = 3000 / max(p.rect.width, p.rect.height)\np.get_pixmap(matrix=fitz.Matrix(z, z), alpha=False).save(sys.argv[2])\n';
  execFileSync('python', ['-I', '-c', code, pdf, png], { stdio: 'inherit' });
}

export function makeWebp(source, base) {
  const src = resolve(source);
  mkdirSync(dirname(resolve(base)), { recursive: true });
  let input = src;
  let tmp = null;
  // Detect PDFs by their signature, not the extension (a renamed certificate is still a PDF).
  if (readFileSync(src).subarray(0, 5).toString('latin1') === '%PDF-') {
    tmp = mkdtempSync(join(tmpdir(), 'pdf-'));
    input = join(tmp, 'page.png');
    rasterisePdf(src, input);
  }
  try {
    return SIZES.map((size) => {
      const out = `${resolve(base)}-${size}.webp`;
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-map_metadata', '-1', '-vf', `scale='if(gt(iw,ih),min(${size},iw),-2)':'if(gt(iw,ih),-2,min(${size},ih))':flags=lanczos`, '-c:v', 'libwebp', '-quality', '82', '-compression_level', '6', '-frames:v', '1', out], { stdio: 'inherit' });
      return { out, kb: Math.round(statSync(out).size / 1024) };
    });
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const [source, base] = process.argv.slice(2);
  if (!source || !base) {
    console.error('usage: node scripts/content/images.mjs <source> <output base>');
    process.exit(1);
  }
  for (const { out, kb } of makeWebp(source, base)) console.log(`${out}: ${kb} KB`);
}
