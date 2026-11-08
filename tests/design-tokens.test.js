import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

// "Sheriff of Byte Island" tokens (docs/DESIGN.md §3). Comments are stripped first: they may mention
// selectors (e.g. [data-theme="light"]) and must not be mistaken for the start of a block.
const raw = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
const mainCss = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Returns the declarations of the first block whose selector list contains `selector`.
function themeBlock(selector) {
  const blocks = css.matchAll(/([^{}]+)\{([^{}]*)\}/g);
  for (const [, selectors, body] of blocks) {
    if (selectors.includes(selector)) return body;
  }
  throw new Error(`No block for ${selector}`);
}

function hexToken(body, name) {
  const match = body.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!match) throw new Error(`${name} is not a 6-digit hex value`);
  return match[1];
}

// WCAG 2.x relative luminance and contrast ratio.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('contrast helper', () => {
  it('matches known WCAG values', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });
});

describe('token parser', () => {
  it('reads the brief palette for the two themes', () => {
    const night = themeBlock('[data-theme="dark"]');
    const day = themeBlock('[data-theme="light"]');
    // Day: ink #231C15, parchment #E9DCC0, poster #F3E9D2, rust #7E2F1A, forest #2F5D46
    expect(hexToken(day, '--text')).toBe('#231C15');
    expect(hexToken(day, '--bg')).toBe('#E9DCC0');
    expect(hexToken(day, '--surface')).toBe('#F3E9D2');
    expect(hexToken(day, '--rust')).toBe('#7E2F1A');
    expect(hexToken(day, '--forest')).toBe('#2F5D46');
    expect(hexToken(day, '--brass')).toBe('#B8862A');
    // Night: warm dark bg #14100C, poster #1E1812, lantern gold accent #D9A441
    expect(hexToken(night, '--bg')).toBe('#14100C');
    expect(hexToken(night, '--surface')).toBe('#1E1812');
    expect(hexToken(night, '--accent-text')).toBe('#D9A441');
  });
});

// Every text/background pair the components actually use must reach WCAG AA (4.5:1) in both themes.
const TEXT_PAIRS = [
  ['--text', '--bg'],
  ['--text', '--surface'],
  ['--text', '--surface-2'],
  ['--text-muted', '--bg'],
  ['--text-muted', '--surface'],
  ['--text-muted', '--surface-2'],
  ['--accent-text', '--bg'],
  ['--accent-text', '--surface'],
  ['--rust-text', '--bg'], // labels, stamps, links, "Case closed"
  ['--rust-text', '--surface'],
  ['--rust-text', '--surface-2'],
  ['--forest', '--bg'], // "Live" status and "Available for work"
  ['--forest', '--surface'],
  ['--dusk', '--surface'], // default status colour
  ['--strip-text', '--strip-bg'], // ink stat strip and skills ticker
  ['--strip-num', '--strip-bg'],
  ['--on-ink', '--ink'], // hovered chips, active filters, selected start option
  ['--stamp-ink', '--stamp-bg'], // rust call-to-action button
];

describe.each([
  ['night', '[data-theme="dark"]'],
  ['day', '[data-theme="light"]'],
])('%s theme tokens meet WCAG', (_name, selector) => {
  const body = themeBlock(selector);
  const value = (name) => hexToken(body, name);

  it.each(TEXT_PAIRS)('%s on %s ≥ 4.5:1', (fg, bg) => {
    const ratio = contrast(value(fg), value(bg));
    expect(ratio, `${fg} ${value(fg)} on ${bg} ${value(bg)} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });

  // WCAG 1.4.11 (non-text contrast, 3:1): the ink line around controls, the focus ring, the track.
  it.each([
    ['--border-strong', '--bg'],
    ['--border-strong', '--surface'],
    ['--focus', '--bg'],
    ['--focus', '--surface'],
    ['--rust', '--surface'],
    ['--forest', '--surface'],
    ['--dusk', '--surface'],
    ['--clay', '--surface'],
  ])('%s on %s ≥ 3:1 (UI components)', (fg, bg) => {
    const ratio = contrast(value(fg), value(bg));
    expect(ratio, `${fg} ${value(fg)} on ${bg} ${value(bg)} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
  });

  // The fixed #231C15 ink on a brass fill (highlight marks, the lightbox zoom, the CC toggle).
  it('dark ink on the brass fill ≥ 4.5:1', () => {
    expect(contrast('#231C15', value('--brass'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the brass accent is decoration only in the day theme', () => {
  it('is never used as text colour (3:1 only against the dark strip and night paper)', () => {
    // Day brass on the poster is 2.7:1: fine for a top bar or a shadow, not for text.
    const textUses = mainCss.match(/[^-]color:\s*var\(--brass\)/g) ?? [];
    expect(textUses).toEqual([]);
  });
});

describe('the Sheriff of Byte Island look has no leftovers from the old one', () => {
  const files = readdirSync(new URL('../src/styles/', import.meta.url)).filter((f) => f.endsWith('.css'));
  const all = files.map((f) => readFileSync(new URL(`../src/styles/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')).join('\n');

  it('uses the four case-file fonts and none of the old three', () => {
    expect(css).toMatch(/--font-display:\s*'Rokkitt'/);
    expect(css).toMatch(/--font-poster:\s*'Ultra'/);
    expect(css).toMatch(/--font-mono:\s*'Courier Prime'/);
    expect(css).toMatch(/--font-body:\s*'Source Serif 4'/);
    expect(all).not.toMatch(/Syne|JetBrains|\bInter\b/);
  });

  it('has no glassmorphism, aurora gradients, gradient text or neon glow', () => {
    expect(all).not.toMatch(/backdrop-filter/);
    expect(all).not.toMatch(/--aurora|--glass|--violet|--magenta|--cyan|--mint|--amber|--glow-|--hairline/);
    expect(all).not.toMatch(/background-clip:\s*text/);
    expect(all).not.toMatch(/-webkit-text-fill-color:\s*transparent/);
    expect(all).not.toMatch(/conic-gradient/);
    expect(all).not.toMatch(/filter:\s*blur/);
  });

  it('uses hard offset shadows (no blur radius) except the single night lantern', () => {
    const shadows = [...all.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1]);
    for (const value of shadows) {
      // "<x> <y> 0 …" (zero blur) or var()/none/inset hairlines
      const bad = /(?:^|,)\s*(?!inset)-?\d+px\s+-?\d+px\s+(?!0\b)\d+px/.test(value);
      expect(bad, `blurred shadow: ${value}`).toBe(false);
    }
    expect(css.match(/--lantern:\s*0 0 \d+px/g)?.length).toBe(1);
  });

  it('radii stay at 2px', () => {
    for (const name of ['--radius-sm', '--radius-md', '--radius-lg']) expect(css).toMatch(new RegExp(`${name}:\\s*2px`));
  });

  it('keeps day and night, with a system-preference default left to theme-init.js', () => {
    expect(css).toMatch(/\[data-theme="light"\]/);
    expect(css).toMatch(/\[data-theme="dark"\]/);
  });
});
