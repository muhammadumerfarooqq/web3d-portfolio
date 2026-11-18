// P9.5 Bounty Board posters (lazy chunk: loaded the first time the sheriff comes near the board).
// The board in town.glb has 9 blank poster panels (baked into Props_baked, untouched). This module
// paints one case-file poster per panel on a canvas at load: aged paper, "BOUNTY", the project title,
// the reward line and a rust CASE CLOSED stamp. The text is the SAME content Classic renders: it is
// read from the gallery cards already in the page, in content order (data-order), so nothing is
// duplicated in the bundle. Each canvas becomes a mipmapped sRGB texture on a thin plane placed 4 mm in
// front of its panel (slots in config.js, verified against the decoded glb in tests). The material is
// lit by the scene (MeshStandardNodeMaterial, no emissive), so the posters read under the lantern at
// night and fall dark away from it like the rest of the board. 9 × 324×256 RGBA + mips = 3.98 MB.
// All noise is seeded, so a capture renders the same posters every time. No innerHTML anywhere.
import { CanvasTexture, Group, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshStandardNodeMaterial, PlaneGeometry, SRGBColorSpace } from 'three/webgpu';
import { BOUNTY_POSTERS } from './config.js';

export const INK = '#2A1D14';
export const RUST = '#8C3A1E';
const STAMP = '#A8432A';
const SEED = 20261117;

export const FONTS = ['400 34px Ultra', '900 28px Rokkitt', '800 13px Rokkitt', '700 14px "Courier Prime"'];
const FACE = {
  bounty: (s) => `400 ${s}px Ultra, Rokkitt, Georgia, serif`,
  head: (s) => `900 ${s}px Rokkitt, Georgia, serif`,
  label: (s) => `800 ${s}px Rokkitt, Georgia, serif`,
  mono: (s) => `700 ${s}px "Courier Prime", "Courier New", monospace`,
};

/** GPU bytes of one RGBA8 texture with its full mip chain. */
export function textureBytes(width, height) {
  let w = width;
  let h = height;
  let bytes = 0;
  for (;;) {
    bytes += w * h * 4;
    if (w === 1 && h === 1) return bytes;
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
}

/** Seeded PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const textOf = (root, selector) => (root.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();

/**
 * The projects as the Classic gallery shows them, in content order. The gallery may have reordered
 * its DOM (sort / filter), so the order comes from each card's data-order, not from the DOM.
 */
export function readProjects(root = document, limit = BOUNTY_POSTERS.slots.length) {
  return [...root.querySelectorAll('[data-project][data-order]')]
    .map((li) => ({
      order: Number(li.dataset.order),
      title: textOf(li, '.project-card__title'),
      kind: textOf(li, '.project-card__bounty').replace(/^Bounty\s*·\s*/i, ''),
      reward: textOf(li, '.project-card__reward [data-searchable]'),
      tagline: textOf(li, '.project-card__tagline'),
      // P4: the card's own cover photo (same-origin /images/… only; generated SVG covers have none)
      image: /^\/images\/[\w./-]+\.(?:webp|jpe?g|png)$/.test(li.querySelector('.project-card__img')?.getAttribute('src') ?? '') ? li.querySelector('.project-card__img').getAttribute('src') : '',
    }))
    .filter((p) => p.title && Number.isFinite(p.order))
    .sort((a, b) => a.order - b.order)
    .slice(0, limit);
}

/** "AI Voice Agent — KnoDesk" → headline "AI VOICE AGENT", sub "KNODESK"; no reward → the tagline. */
export function posterCopy(project) {
  const [head, ...rest] = project.title.split(/\s+[—–]\s+/);
  return {
    kicker: project.kind.toUpperCase(),
    headline: head.toUpperCase(),
    sub: rest.join(' · ').toUpperCase(),
    reward: project.reward || project.tagline,
    stamp: 'CASE CLOSED',
    image: project.image ?? '',
  };
}

/** A photo print on the poster: cover-cropped into the box, aged a little, with an ink border. */
function photo(ctx, img, box) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const scale = Math.max(box.w / iw, box.h / ih);
  const sw = box.w / scale;
  const sh = box.h / scale;
  ctx.save();
  if (ih > iw) {
    // P5: a portrait image (phone screenshot) is shown whole, centred on a blurred sepia copy of itself
    if ('filter' in ctx) ctx.filter = 'blur(5px) sepia(0.6) saturate(0.7)';
    ctx.globalAlpha = 0.6;
    ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, box.x, box.y, box.w, box.h);
    ctx.globalAlpha = 1;
    if ('filter' in ctx) ctx.filter = 'sepia(0.4) contrast(1.05) saturate(0.85)';
    const s = Math.min(box.w / iw, box.h / ih);
    const dw = iw * s;
    const dh = ih * s;
    ctx.drawImage(img, box.x + (box.w - dw) / 2, box.y + (box.h - dh) / 2, dw, dh);
  } else {
    if ('filter' in ctx) ctx.filter = 'sepia(0.4) contrast(1.05) saturate(0.85)';
    ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, box.x, box.y, box.w, box.h);
  }
  if ('filter' in ctx) ctx.filter = 'none';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(box.x + 0.75, box.y + 0.75, box.w - 1.5, box.h - 1.5);
  ctx.restore();
}

/** Load a same-origin cover image for a poster (bounded wait; null on failure or outside a browser). */
function defaultImage(src) {
  if (!src || typeof Image === 'undefined') return Promise.resolve(null);
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  const done = img.decode().then(() => img, () => null);
  return Promise.race([done, new Promise((r) => setTimeout(() => r(null), 4000))]);
}

/**
 * When there are fewer public projects than panels (a draft is hidden from Classic), the next panel
 * is an open case pointing at the Telegraph Office (the contact building).
 * No stamp: the case is open.
 */
export const OPEN_CASE = { kicker: 'OPEN CASE', headline: 'YOUR PROJECT HERE', sub: '', label: 'TO CLAIM', reward: 'Wire the Telegraph Office', stamp: null };

/** Greedy word wrap; `overflow` when it needs more lines than allowed or a word is too wide. */
export function wrap(measure, text, width, maxLines) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (!line || measure(next) <= width) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.includes(' ') && measure(`${last}…`) > width) last = last.replace(/\s+\S+$/, '');
    kept[maxLines - 1] = `${last}…`;
    return { lines: kept, overflow: true };
  }
  return { lines, overflow: lines.some((l) => measure(l) > width) };
}

/** The largest size (max → min) whose wrap fits; the smallest one (truncated) otherwise. */
function fit(ctx, face, text, width, maxLines, max, min) {
  let out = null;
  for (let size = max; size >= min; size -= 1) {
    ctx.font = face(size);
    out = { size, ...wrap((s) => ctx.measureText(s).width, text, width, maxLines) };
    if (!out.overflow) return out;
  }
  return out;
}

function setSpacing(ctx, px) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`;
}

function paper(ctx, w, h, rnd) {
  const g = ctx.createLinearGradient(0, 0, w * 0.35, h);
  g.addColorStop(0, '#EFE3C4');
  g.addColorStop(1, '#DECB9F');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 6; i += 1) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 18 + rnd() * 60;
    const s = ctx.createRadialGradient(x, y, 0, x, y, r);
    s.addColorStop(0, 'rgba(150, 104, 52, 0.13)');
    s.addColorStop(1, 'rgba(150, 104, 52, 0)');
    ctx.fillStyle = s;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 900; i += 1) {
    ctx.fillStyle = `rgba(70, 44, 24, ${(0.04 + rnd() * 0.1).toFixed(3)})`;
    ctx.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 1, 1);
  }
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.38, w / 2, h / 2, Math.max(w, h) * 0.72);
  v.addColorStop(0, 'rgba(92, 56, 24, 0)');
  v.addColorStop(1, 'rgba(92, 56, 24, 0.42)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

export const STAMP_SIZE = [170, 48];

/** The CASE CLOSED stamp on its own small canvas (worn: seeded holes punched out of the ink). */
function stampCanvas(createCanvas, text, rnd) {
  const [w, h] = STAMP_SIZE;
  const c = createCanvas(w, h);
  const s = c.getContext('2d');
  s.strokeStyle = STAMP;
  s.fillStyle = STAMP;
  s.lineWidth = 3;
  s.strokeRect(2.5, 2.5, w - 5, h - 5);
  s.lineWidth = 1.2;
  s.strokeRect(7, 7, w - 14, h - 14);
  setSpacing(s, 1);
  const size = fit(s, FACE.head, text, w - 26, 1, 22, 12).size; // the text always sits inside the inner frame
  s.font = FACE.head(size);
  s.textAlign = 'center';
  s.textBaseline = 'middle';
  s.fillText(text, w / 2, h / 2 + 1.5);
  s.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 150; i += 1) {
    s.globalAlpha = 0.35 + rnd() * 0.65;
    s.beginPath();
    s.arc(rnd() * w, rnd() * h, 0.4 + rnd() * 1.4, 0, Math.PI * 2);
    s.fill();
  }
  return c;
}

/** Paint one poster (324 × 256 design units = texture pixels). Returns the lines drawn (for tests). */
export function drawPoster(ctx, w, h, copy, seed, createCanvas) {
  const rnd = rng(seed);
  const drawn = [];
  const text = (s, x, y) => {
    ctx.fillText(s, x, y);
    drawn.push(s);
  };
  paper(ctx, w, h, rnd);

  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.strokeRect(8.5, 8.5, w - 17, h - 17);
  ctx.lineWidth = 1;
  ctx.strokeRect(12.5, 12.5, w - 25, h - 25);

  // pin
  ctx.fillStyle = 'rgba(30, 18, 10, 0.35)';
  ctx.beginPath();
  ctx.ellipse(w / 2 + 1.5, 18.5, 5.5, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = RUST;
  ctx.beginPath();
  ctx.arc(w / 2, 16, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 222, 186, 0.7)';
  ctx.beginPath();
  ctx.arc(w / 2 - 1.8, 14.2, 1.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK;
  setSpacing(ctx, 3);
  const bounty = fit(ctx, FACE.bounty, 'BOUNTY', w - 70, 1, 36, 22);
  ctx.font = FACE.bounty(bounty.size);
  text('BOUNTY', w / 2 + 1.5, 56);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(28, 64.5);
  ctx.lineTo(w - 28, 64.5);
  ctx.stroke();
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  ctx.moveTo(28, 67.5);
  ctx.lineTo(w - 28, 67.5);
  ctx.stroke();

  let y = 82;
  const withPhoto = Boolean(copy.photo);
  if (withPhoto) {
    // the project's photo (P4) takes the kicker's place, between the rules and the title
    const box = { x: 30, y: 73, w: w - 60, h: 62 };
    photo(ctx, copy.photo, box);
    y = box.y + box.h + 1;
  } else {
    ctx.fillStyle = '#5B3A20';
    ctx.font = FACE.mono(11);
    setSpacing(ctx, 1);
    if (copy.kicker) text(`— ${copy.kicker} —`, w / 2, y);
  }

  ctx.fillStyle = INK;
  setSpacing(ctx, 0.5);
  const head = withPhoto ? fit(ctx, FACE.head, copy.headline, w - 44, 1, 24, 14) : fit(ctx, FACE.head, copy.headline, w - 44, 2, 30, 16);
  ctx.font = FACE.head(head.size);
  y += 4;
  for (const line of head.lines) {
    y += head.size * 0.95;
    text(line, w / 2, y);
  }
  if (copy.sub) {
    ctx.font = FACE.mono(withPhoto ? 11 : 12);
    setSpacing(ctx, 1);
    y += withPhoto ? 13 : 15;
    text(copy.sub, w / 2, y);
  }

  y += withPhoto ? 17 : 20;
  ctx.fillStyle = RUST;
  ctx.font = FACE.label(13);
  setSpacing(ctx, 3);
  text(copy.label ?? 'REWARD', w / 2 + 1.5, y);
  ctx.fillStyle = INK;
  setSpacing(ctx, 0);
  const room = Math.max(1, Math.min(3, Math.floor((h - 22 - y) / 15)));
  const reward = fit(ctx, FACE.mono, copy.reward, w - 52, room, 14, 10);
  ctx.font = FACE.mono(reward.size);
  for (const line of reward.lines) {
    y += reward.size * 1.18;
    text(line, w / 2, y);
  }

  // the stamp, slightly crooked, over the lower right (multiply: the ink beneath shows through)
  if (copy.stamp) {
    const stamp = stampCanvas(createCanvas, copy.stamp, rnd);
    ctx.save();
    // with a photo, the stamp goes across the photo's corner (the text below stays readable)
    ctx.translate(w * 0.66 + (rnd() - 0.5) * 8, (withPhoto ? 122 : h - 40) + (rnd() - 0.5) * 4);
    ctx.rotate(-0.17 + (rnd() - 0.5) * 0.06);
    ctx.globalAlpha = 0.86;
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(stamp, -STAMP_SIZE[0] / 2, -STAMP_SIZE[1] / 2);
    ctx.restore();
    drawn.push(copy.stamp);
  }
  return drawn;
}

const defaultCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

/** Wait (bounded) for the site fonts the posters use; canvas text falls back to serif otherwise. */
async function defaultFonts() {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  const all = Promise.all(FONTS.map((f) => document.fonts.load(f).catch(() => null)));
  await Promise.race([all, new Promise((r) => setTimeout(r, 2500))]);
}

/**
 * Build the posters. `center` is the board's town.json centre ([x, y, z]); `projects` come from
 * readProjects(). Fewer projects than panels: one OPEN_CASE poster, then blank panels.
 */
export async function createBountyPosters({ projects, center, createCanvas = defaultCanvas, loadFonts = defaultFonts, loadImage = defaultImage, anisotropy = 8 }) {
  await loadFonts?.();
  const { size, front, lift, texture, slots } = BOUNTY_POSTERS;
  const [tw, th] = texture;
  const group = new Group();
  group.name = 'explore_bounty_posters';
  const geometry = new PlaneGeometry(size[0], size[1]);
  const textures = [];
  const materials = [];
  const lines = [];
  const copies = projects.slice(0, slots.length).map(posterCopy);
  if (copies.length < slots.length) copies.push({ ...OPEN_CASE });
  // cover photos (P4), loaded before painting so the canvas is drawn once
  await Promise.all(copies.map(async (copy) => {
    copy.photo = copy.image ? await loadImage(copy.image) : null;
  }));
  copies.forEach((copy, i) => {
    const [dx, y, rz] = slots[i];
    const canvas = createCanvas(tw, th);
    lines.push(drawPoster(canvas.getContext('2d'), tw, th, copy, SEED + i * 7919, createCanvas));
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    map.generateMipmaps = true;
    map.minFilter = LinearMipmapLinearFilter;
    map.magFilter = LinearFilter;
    map.anisotropy = anisotropy;
    const material = new MeshStandardNodeMaterial({ map, roughness: 0.9, metalness: 0 });
    material.name = 'Bounty_Poster';
    const mesh = new Mesh(geometry, material);
    mesh.name = `bounty_poster_${i + 1}`;
    mesh.position.set(center[0] + dx, (center[1] ?? 0) + y, center[2] + front + lift);
    mesh.rotation.z = rz;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    textures.push(map);
    materials.push(material);
  });
  const bytes = textures.length * textureBytes(tw, th);
  return {
    group,
    textures,
    bytes,
    lines,
    dispose() {
      group.removeFromParent();
      geometry.dispose();
      for (const t of textures) t.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
