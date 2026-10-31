import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { contrastRgb, hexToRgb, parseStops, sampleGradient, toHex } from './helpers/oklch.js';

// Comments are stripped first: they may mention selectors (e.g. [data-theme="light"]) and must
// not be mistaken for the start of a block.
const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

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
  it('reads different values for the two themes', () => {
    const dark = hexToken(themeBlock('[data-theme="dark"]'), '--bg');
    const light = hexToken(themeBlock('[data-theme="light"]'), '--bg');
    expect(dark).toBe('#07060F');
    expect(light).toBe('#F7F5FF');
  });
});

describe.each([
  ['dark', '[data-theme="dark"]'],
  ['light', '[data-theme="light"]'],
])('%s theme tokens meet WCAG AA', (_name, selector) => {
  const body = themeBlock(selector);
  const tokens = Object.fromEntries(
    ['--bg', '--surface', '--surface-2', '--text', '--text-muted', '--accent-text'].map((n) => [n, hexToken(body, n)]),
  );

  it.each([
    ['--text', '--bg'],
    ['--text', '--surface'],
    ['--text', '--surface-2'],
    ['--text-muted', '--bg'],
    ['--text-muted', '--surface'],
    ['--text-muted', '--surface-2'],
    ['--accent-text', '--bg'],
  ])('%s on %s ≥ 4.5:1', (fg, bg) => {
    const ratio = contrast(tokens[fg], tokens[bg]);
    expect(ratio, `${fg} ${tokens[fg]} on ${bg} ${tokens[bg]} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });
});

// A1: display gradients are interpolated in OKLCH and stay legible as large text on --bg.
describe.each([
  ['dark', '[data-theme="dark"]'],
  ['light', '[data-theme="light"]'],
])('%s display gradient (OKLCH)', (_name, selector) => {
  const body = themeBlock(selector);
  const bg = hexToken(body, '--bg');
  const stopsValue = body.match(/--aurora-stops:\s*([^;]+);/)[1];
  const samples = sampleGradient(parseStops(stopsValue), 11);

  it.each(samples.map((s, i) => [i, s]))('sample %i is ≥ 3:1 on --bg (WCAG large-text AA)', (_i, sample) => {
    const ratio = contrastRgb(sample.rgb, hexToRgb(bg));
    expect(ratio, `${toHex(sample.rgb)} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
  });

  it('has no muddy olive band (yellow-green hue at low lightness)', () => {
    const olive = samples.filter(({ lch: [L, , H] }) => H >= 80 && H <= 140 && L < 0.7).map((s) => toHex(s.rgb));
    expect(olive).toEqual([]);
  });
});

describe('gradient interpolation', () => {
  const raw = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

  it('uses OKLCH where supported, with an sRGB fallback', () => {
    expect(raw).toMatch(/@supports \(background-image: linear-gradient\(in oklch, red, blue\)\)/);
    expect(raw).toMatch(/--aurora: linear-gradient\(in oklch 115deg, var\(--aurora-stops\)\)/);
    expect(raw).toMatch(/--aurora: linear-gradient\(115deg, var\(--aurora-stops\)\)/);
  });
});
