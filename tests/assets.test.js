import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';

const file = (path) => new URL(`../${path}`, import.meta.url);
const head = (path, n) => readFileSync(file(path)).subarray(0, n);

describe('avatar assets', () => {
  it('public/models/avatar.glb exists, is ≤ 3 MB and starts with the glTF magic', () => {
    expect(existsSync(file('public/models/avatar.glb'))).toBe(true);
    expect(statSync(file('public/models/avatar.glb')).size).toBeLessThanOrEqual(3 * 1024 * 1024);
    expect(head('public/models/avatar.glb', 4).toString('latin1')).toBe('glTF');
    expect(head('public/models/avatar.glb', 8).readUInt32LE(4)).toBe(2); // glTF 2.0
  });

  it('blender/avatar.blend exists and is a Blender file (plain or zstd-compressed)', () => {
    expect(existsSync(file('blender/avatar.blend'))).toBe(true);
    const bytes = head('blender/avatar.blend', 7);
    const plain = bytes.toString('latin1') === 'BLENDER';
    const zstd = bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd;
    expect(plain || zstd).toBe(true);
  });
});
