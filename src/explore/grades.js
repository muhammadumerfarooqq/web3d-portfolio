// Colour grades for the procedural 3D LUTs (pure, unit-tested). Display-space RGB in, RGB out.
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (v) => v * v * (3 - 2 * v);

export const GRADES = {
  /** Golden hour: warm highlights, slightly violet shadows, gentle contrast. */
  day([r, g, b]) {
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const sh = (1 - lum) ** 2;
    const hi = lum ** 2;
    let out = [r * 1.05 + sh * 0.025 + hi * 0.06, g * 1.0 + sh * 0.01 + hi * 0.035, b * 0.9 + sh * 0.045 - hi * 0.02];
    const l2 = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
    out = out.map((c) => l2 + (c - l2) * 1.1);
    return out.map((c) => clamp01(c)).map((c) => c + (smooth(c) - c) * 0.25);
  },
  /** Night: teal-indigo shadows, amber highlights, stronger S-curve. */
  night([r, g, b]) {
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const sh = (1 - lum) ** 2;
    const hi = lum ** 1.5;
    let out = [r + sh * -0.01 + hi * 0.09, g + sh * 0.045 + hi * 0.03, b + sh * 0.085 - hi * 0.06];
    const l2 = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
    out = out.map((c) => l2 + (c - l2) * 1.18);
    return out.map((c) => clamp01(c)).map((c) => c + (smooth(c) - c) * 0.38);
  },
};

