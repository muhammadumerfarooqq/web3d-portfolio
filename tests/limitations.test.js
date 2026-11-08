import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const url = new URL('../docs/LIMITATIONS.md', import.meta.url);
const STATUS = /^(?:OPEN|ACCEPTED|SOLVED in P\d+(?:\.\d+[a-z]?)?)(?: \([^)]+\))?$/;

describe('docs/LIMITATIONS.md', () => {
  it('exists and is linked from the README', () => {
    expect(existsSync(url)).toBe(true);
    expect(readFileSync(new URL('../README.md', import.meta.url), 'utf8')).toContain('docs/LIMITATIONS.md');
  });

  const rows = readFileSync(url, 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^\| L\d+ \|/.test(line))
    .map((line) => line.slice(1, -1).split(' | ').map((cell) => cell.trim()));

  it('has rows with all seven columns and unique IDs', () => {
    expect(rows.length).toBeGreaterThan(40);
    for (const row of rows) expect(row, row[0]).toHaveLength(7);
    const ids = rows.map((r) => r[0]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every status is OPEN, ACCEPTED or "SOLVED in P<n>"', () => {
    for (const row of rows) expect(row[6], row[0]).toMatch(STATUS);
  });
});
