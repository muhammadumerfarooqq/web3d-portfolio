// Minimal sRGB ↔ OKLCH conversion (Björn Ottosson's OKLab) for testing CSS gradients that
// interpolate "in oklch". No dependencies.

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToRgb(hex) {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
}

export function rgbToOklch([r, g, b]) {
  const [lr, lg, lb] = [r, g, b].map(toLinear);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(a, bb);
  const H = ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return [L, C, H];
}

export function oklchToRgb([L, C, H]) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  // Clip to the sRGB gamut (a simple stand-in for CSS gamut mapping).
  return lin.map((c) => Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, c))))));
}

// CSS Color 4: interpolate in OKLCH, hue along the shorter arc.
export function mixOklch(c1, c2, t) {
  const [L1, C1, H1] = c1;
  const [L2, C2, H2] = c2;
  let dh = H2 - H1;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  return [L1 + (L2 - L1) * t, C1 + (C2 - C1) * t, (H1 + dh * t + 360) % 360];
}

/** Parse "#RRGGBB p%" stops from a gradient/stop-list string. */
export function parseStops(value) {
  const stops = [...value.matchAll(/(#[0-9a-fA-F]{6})\s+(\d+(?:\.\d+)?)%/g)].map(([, hex, pos]) => ({
    hex,
    pos: Number(pos) / 100,
  }));
  if (stops.length < 2) throw new Error(`No colour stops in: ${value}`);
  return stops;
}

/** n evenly spaced samples along the stop list, interpolated in OKLCH. Returns sRGB [0..1] + OKLCH. */
export function sampleGradient(stops, n = 11) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let k = stops.findIndex((s) => s.pos >= t);
    if (k <= 0) k = Math.max(1, k);
    const a = stops[k - 1];
    const b = stops[k];
    const local = b.pos === a.pos ? 0 : Math.min(1, Math.max(0, (t - a.pos) / (b.pos - a.pos)));
    const lch = mixOklch(rgbToOklch(hexToRgb(a.hex)), rgbToOklch(hexToRgb(b.hex)), local);
    out.push({ t, rgb: oklchToRgb(lch), lch });
  }
  return out;
}

export function relativeLuminance([r, g, b]) {
  const [lr, lg, lb] = [r, g, b].map(toLinear);
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

export function contrastRgb(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const toHex = (rgb) => `#${rgb.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`;
