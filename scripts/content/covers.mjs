// Generative project covers: inline SVG built at build time, deterministic from the slug, with one
// visual language per (first) category. Colours come only from CSS classes (theme variables), and
// the SVG has no ids, gradients, filters or URLs, so it can be cloned and needs no external assets.
// P2.5: printed / woodcut look. The CSS gives every shape an ink outline and a two-colour fill from
// the case-file palette (rust, brass, forest, dusk, clay); corners are hard (rx 1) like cut blocks.
import { raw } from './html.mjs';

const W = 400;
const H = 250;

// FNV-1a hash → mulberry32 PRNG: same slug, same cover, every build.
function seededRandom(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (n) => Math.round(n * 10) / 10;
const rect = (x, y, w, h, cls, rx = 1) => `<rect class="${cls}" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${rx}"/>`;
const circle = (x, y, r, cls) => `<circle class="${cls}" cx="${r1(x)}" cy="${r1(y)}" r="${r1(r)}"/>`;
const line = (x1, y1, x2, y2, cls) => `<line class="${cls}" x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}"/>`;
const poly = (points, cls) => `<polygon class="${cls}" points="${points.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' ')}"/>`;

/** AI & RAG: documents → chunks → vector constellation. */
function aiRag(rand) {
  const parts = [];
  // Documents
  for (let d = 0; d < 3; d++) {
    const x = 28 + d * 14;
    const y = 52 + d * 16;
    parts.push(rect(x, y, 70, 92, d === 2 ? 'cv-panel' : 'cv-panel cv-faint', 1));
    for (let l = 0; l < 6; l++) parts.push(rect(x + 10, y + 14 + l * 12, 24 + rand() * 26, 3.5, 'cv-ink', 1));
  }
  // Chunks
  const chunks = [];
  for (let i = 0; i < 9; i++) {
    const x = 150 + (i % 3) * 26 + rand() * 4;
    const y = 72 + Math.floor(i / 3) * 34 + rand() * 4;
    chunks.push([x + 9, y + 9]);
    parts.push(rect(x, y, 18, 18, rand() > 0.6 ? 'cv-fill-a' : 'cv-panel', 1));
  }
  parts.push(line(132, 125, 146, 125, 'cv-line cv-dash'));
  // Constellation
  const pts = Array.from({ length: 13 }, () => [262 + rand() * 116, 38 + rand() * 174]);
  for (const [i, p] of pts.entries()) {
    const near = pts
      .map((q, j) => [j, Math.hypot(p[0] - q[0], p[1] - q[1])])
      .filter(([j]) => j !== i)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 2);
    for (const [j] of near) if (j > i) parts.push(line(p[0], p[1], pts[j][0], pts[j][1], 'cv-line'));
  }
  for (const c of chunks.filter((_, i) => i % 3 === 2)) {
    const target = pts[Math.floor(rand() * pts.length)];
    parts.push(line(c[0] + 9, c[1], target[0], target[1], 'cv-line cv-dash'));
  }
  for (const [i, [x, y]] of pts.entries()) {
    if (i % 4 === 0) parts.push(circle(x, y, 10, 'cv-halo'));
    parts.push(circle(x, y, i % 4 === 0 ? 4.5 : 2.6, i % 3 === 0 ? 'cv-fill-b' : 'cv-fill-a'));
  }
  return parts.join('');
}

/** Computer Vision: face-landmark mesh dots inside a scan frame. */
function vision(rand) {
  const parts = [];
  const cx = 200 + (rand() - 0.5) * 30;
  const cy = 128;
  const jitter = () => (rand() - 0.5) * 3;
  const outline = Array.from({ length: 19 }, (_, i) => {
    const t = Math.PI * (0.05 + (i / 18) * 0.9);
    return [cx - Math.cos(t) * 62 + jitter(), cy - 18 + Math.sin(t) * 82 + jitter()];
  });
  const ring = (x, y, rx, ry, n) =>
    Array.from({ length: n }, (_, i) => [x + Math.cos((i / n) * Math.PI * 2) * rx + jitter(), y + Math.sin((i / n) * Math.PI * 2) * ry + jitter()]);
  const leftEye = ring(cx - 26, cy - 14, 11, 5, 6);
  const rightEye = ring(cx + 26, cy - 14, 11, 5, 6);
  const brows = [...Array.from({ length: 5 }, (_, i) => [cx - 40 + i * 7, cy - 30 - Math.sin((i / 4) * Math.PI) * 5]), ...Array.from({ length: 5 }, (_, i) => [cx + 12 + i * 7, cy - 30 - Math.sin((i / 4) * Math.PI) * 5])];
  const nose = [[cx, cy - 10], [cx, cy + 2], [cx - 7, cy + 14], [cx + 7, cy + 14], [cx, cy + 16]];
  const mouth = ring(cx, cy + 38, 20, 7, 10);
  const groups = [outline, leftEye, rightEye, mouth];
  for (const g of groups) g.forEach((p, i) => i && parts.push(line(g[i - 1][0], g[i - 1][1], p[0], p[1], 'cv-line')));
  for (const g of [leftEye, rightEye, mouth]) parts.push(line(g.at(-1)[0], g.at(-1)[1], g[0][0], g[0][1], 'cv-line'));
  // Triangulate a few landmarks to the outline
  const inner = [...leftEye, ...rightEye, ...nose, ...mouth];
  for (let i = 0; i < 16; i++) {
    const a = inner[Math.floor(rand() * inner.length)];
    const b = outline[Math.floor(rand() * outline.length)];
    parts.push(line(a[0], a[1], b[0], b[1], 'cv-line cv-faint'));
  }
  for (const [x, y] of [...outline, ...brows, ...nose]) parts.push(circle(x, y, 2.2, 'cv-fill-a'));
  for (const [x, y] of [...leftEye, ...rightEye, ...mouth]) parts.push(circle(x, y, 2.4, 'cv-fill-b'));
  // Scan frame + line
  const fx = cx - 92;
  const fy = 22;
  const fw = 184;
  const fh = 206;
  for (const [x, y, dx, dy] of [[fx, fy, 1, 1], [fx + fw, fy, -1, 1], [fx, fy + fh, 1, -1], [fx + fw, fy + fh, -1, -1]]) {
    parts.push(line(x, y, x + dx * 22, y, 'cv-frame'), line(x, y, x, y + dy * 22, 'cv-frame'));
  }
  parts.push(rect(fx + 6, cy + 10 + rand() * 30, fw - 12, 2, 'cv-fill-b cv-faint', 1));
  return parts.join('');
}

/** Full-Stack: layered UI wireframes stacked in depth. */
function fullStack(rand) {
  const parts = [];
  for (let layer = 0; layer < 3; layer++) {
    const x = 70 + layer * 34;
    const y = 104 - layer * 30;
    const w = 200;
    const h = 120;
    const cls = layer === 2 ? '' : ' cv-faint';
    parts.push(`<g transform="matrix(1 -0.16 0 1 0 ${r1(layer * 6)})">`);
    parts.push(rect(x, y, w, h, `cv-panel${cls}`, 1));
    parts.push(rect(x, y, w, 16, `cv-fill-a${cls}`, 1));
    for (let d = 0; d < 3; d++) parts.push(circle(x + 10 + d * 9, y + 8, 2.4, 'cv-ink'));
    parts.push(rect(x + 8, y + 24, 38, h - 32, `cv-soft${cls}`, 1));
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 2; col++) {
        const bx = x + 54 + col * 70;
        const by = y + 26 + row * 30;
        parts.push(rect(bx, by, 62, 22, `cv-soft${cls}`, 1));
        parts.push(rect(bx + 6, by + 7, 18 + rand() * 30, 3.5, 'cv-ink', 1));
      }
    }
    if (layer === 2) {
      for (let b = 0; b < 6; b++) {
        const bh = 8 + rand() * 30;
        parts.push(rect(x + 56 + b * 12, y + h - 8 - bh, 7, bh, b % 2 ? 'cv-fill-b' : 'cv-fill-a', 1));
      }
    }
    parts.push('</g>');
  }
  return parts.join('');
}

/** Games & 3D: isometric low-poly forms. */
function games(rand) {
  const parts = [];
  const iso = (gx, gy, gz) => [200 + (gx - gy) * 26, 150 + (gx + gy) * 15 - gz];
  const cells = [];
  for (let gx = -2; gx <= 2; gx++) for (let gy = -2; gy <= 2; gy++) if (rand() > 0.35) cells.push([gx, gy, 10 + rand() * 60]);
  cells.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  // Ground grid
  for (let i = -3; i <= 3; i++) {
    parts.push(line(...iso(i - 0.5, -3.5, 0), ...iso(i - 0.5, 3.5, 0), 'cv-line cv-faint'));
    parts.push(line(...iso(-3.5, i - 0.5, 0), ...iso(3.5, i - 0.5, 0), 'cv-line cv-faint'));
  }
  for (const [gx, gy, h] of cells) {
    const s = 0.42;
    const [ax, ay] = iso(gx - s, gy - s, h);
    const [bx, by] = iso(gx + s, gy - s, h);
    const [cx, cy] = iso(gx + s, gy + s, h);
    const [dx, dy] = iso(gx - s, gy + s, h);
    if (rand() > 0.78) {
      // Low-poly pyramid
      const [px, py] = iso(gx, gy, h + 30);
      parts.push(poly([[dx, dy], [cx, cy], [px, py]], 'cv-face-l'), poly([[cx, cy], [bx, by], [px, py]], 'cv-face-r'));
    } else {
      parts.push(poly([[ax, ay], [bx, by], [cx, cy], [dx, dy]], 'cv-face-t'));
    }
    parts.push(poly([[dx, dy], [cx, cy], [cx, cy + h], [dx, dy + h]], 'cv-face-l'));
    parts.push(poly([[cx, cy], [bx, by], [bx, by + h], [cx, cy + h]], 'cv-face-r'));
  }
  return parts.join('');
}

/** Motion & Video: film strip and speed lines. */
function motion(rand) {
  const parts = [];
  for (let i = 0; i < 14; i++) {
    const y = 20 + rand() * 210;
    const x = rand() * 160;
    parts.push(rect(x, y, 60 + rand() * 180, 2.2, i % 3 ? 'cv-fill-a cv-faint' : 'cv-fill-b', 1));
  }
  parts.push('<g transform="rotate(-12 200 125)">');
  parts.push(rect(20, 82, 360, 86, 'cv-panel', 1));
  for (let f = 0; f < 5; f++) parts.push(rect(34 + f * 68, 98, 58, 54, f === 2 ? 'cv-fill-a' : 'cv-soft', 1));
  for (let h = 0; h < 15; h++) parts.push(rect(30 + h * 23.5, 86, 10, 6, 'cv-ink', 1), rect(30 + h * 23.5, 158, 10, 6, 'cv-ink', 1));
  parts.push('</g>');
  return parts.join('');
}

const LANGUAGES = {
  'AI & RAG': ['ai', aiRag],
  'Computer Vision': ['vision', vision],
  'Full-Stack': ['stack', fullStack],
  'Games & 3D': ['games', games],
  'Motion & Video': ['motion', motion],
};

/** Inline SVG cover for a project without images. Decorative: aria-hidden. */
export function renderCover(project) {
  const [kind, draw] = LANGUAGES[project.categories[0]] ?? LANGUAGES['AI & RAG'];
  const rand = seededRandom(project.slug);
  // Themed background + two soft glows (plain shapes: no gradients, so no ids).
  const backdrop = [
    rect(0, 0, W, H, 'cv-bg', 0),
    circle(80 + rand() * 240, 40 + rand() * 60, 150, 'cv-glow'),
    circle(120 + rand() * 200, 190 + rand() * 40, 120, 'cv-glow2'),
  ].join('');
  const body = backdrop + draw(rand);
  return raw(
    `<svg class="cover-art cover--${kind}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${body}</svg>`,
  );
}
