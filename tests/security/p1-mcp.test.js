import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import viteConfig from '../../vite.config.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

const raw = readFileSync(new URL('../../.mcp.json', import.meta.url), 'utf8');

// Package runners whose next non-flag argument is a package spec that must be pinned.
const RUNNERS = ['uvx', 'npx'];
const EXACT_PIN = /^(@[\w.-]+\/)?[\w.-]+@\d+\.\d+\.\d+$/;

// Returns the package spec each runner invocation in a server entry would fetch.
function packageSpecs(server) {
  const tokens = [server.command, ...(server.args ?? [])];
  const specs = [];
  tokens.forEach((token, i) => {
    if (!RUNNERS.includes(token)) return;
    const spec = tokens.slice(i + 1).find((t) => !t.startsWith('-'));
    specs.push(spec);
  });
  return specs;
}

describe('C4/C5 local MCP tooling (.mcp.json)', () => {
  it('is valid JSON with a mcpServers object', () => {
    const config = JSON.parse(raw);
    expect(config.mcpServers).toBeTypeOf('object');
    expect(Object.keys(config.mcpServers).length).toBeGreaterThan(0);
  });

  it('contains no env values and nothing that looks like a secret', () => {
    const config = JSON.parse(raw);
    const names = Object.keys(config.mcpServers).sort();
    // Every registered server is scanned; a new entry must be added here on purpose.
    // Blender MCP retired 9-Nov-2026 (P2.3 decision record): After Effects is the only server.
    expect(names).toEqual(['aftereffects']);

    const caseSensitive = ['sk-', 'sk_', 'gsk_', 'AIza', 'AQ.', 'sb_secret_', 'eyJ'];
    const caseInsensitive = [/password/i, /token/i, /key=/i];
    for (const [name, server] of Object.entries(config.mcpServers)) {
      expect(server.env, `${name} must not have an env block`).toBeUndefined();

      const entry = JSON.stringify(server);
      for (const pattern of caseSensitive) {
        expect(entry.includes(pattern), `${name} must not contain "${pattern}"`).toBe(false);
      }
      for (const pattern of caseInsensitive) {
        expect(pattern.test(entry), `${name} must not match ${pattern}`).toBe(false);
      }
    }

    // Whole-file scan as well, in case a secret sits outside mcpServers.
    for (const pattern of caseSensitive) {
      expect(raw.includes(pattern), `.mcp.json must not contain "${pattern}"`).toBe(false);
    }
    for (const pattern of caseInsensitive) {
      expect(pattern.test(raw), `.mcp.json must not match ${pattern}`).toBe(false);
    }
  });

  it('pins every uvx/npx package to an exact version (name@x.y.z)', () => {
    const { mcpServers } = JSON.parse(raw);
    let checked = 0;
    for (const [name, server] of Object.entries(mcpServers)) {
      for (const spec of packageSpecs(server)) {
        expect(spec, `${name}: runner has no package argument`).toBeTypeOf('string');
        expect(spec, `${name}: "${spec}" must be pinned as name@x.y.z`).toMatch(EXACT_PIN);
        checked += 1;
      }
    }
    // Since the Blender MCP was retired no server uses uvx/npx, so `checked` may be 0; the rule
    // still applies to any future runner entry. Guard instead that the loop saw every server.
    expect(Object.keys(mcpServers).length).toBeGreaterThan(0);
    expect(checked).toBe(Object.values(mcpServers).flatMap(packageSpecs).length);
  });

  it('has no blender entry (Blender MCP retired 9-Nov-2026, attack surface removed)', () => {
    const { mcpServers } = JSON.parse(raw);
    expect(mcpServers.blender).toBeUndefined();
    expect(raw).not.toMatch(/mcp-for-blender/);
  });

  it('the pin checker rejects unpinned or range specs', () => {
    const bad = ['mcp-for-blender', 'mcp-for-blender@latest', 'pkg@^1.2.3', 'pkg@~1.2.3', 'pkg@1.2'];
    for (const spec of bad) expect(spec).not.toMatch(EXACT_PIN);
    expect(packageSpecs({ command: 'cmd', args: ['/c', 'uvx', 'mcp-for-blender'] })).toEqual(['mcp-for-blender']);
    expect(packageSpecs({ command: 'npx', args: ['-y', '@scope/pkg@1.0.0'] })).toEqual(['@scope/pkg@1.0.0']);
  });
});

describe('C5 local MCP tooling (After Effects)', () => {
  const AE_ROOT = 'D:/PROJECTS/tools/';
  const AE_ENTRY = '/after-effects-mcp/build/index.js';

  it('runs node with exactly one arg: the reviewed build under D:/PROJECTS/tools/', () => {
    const { aftereffects } = JSON.parse(raw).mcpServers;
    expect(Object.keys(aftereffects).sort()).toEqual(['args', 'command']);
    expect(aftereffects.command).toBe('node');
    expect(aftereffects.args).toHaveLength(1);

    const [script] = aftereffects.args;
    expect(script.startsWith(AE_ROOT), `${script} must live under ${AE_ROOT}`).toBe(true);
    expect(script.endsWith(AE_ENTRY), `${script} must end with ${AE_ENTRY}`).toBe(true);
    // No traversal out of the tools folder and no flags smuggled into node.
    expect(script.split('/')).not.toContain('..');
    expect(script.startsWith('-')).toBe(false);
  });
});

describe('C4 dev-only spike pages stay out of production', () => {
  it('vite.config.js build inputs do not include anything under spikes/', () => {
    const { build } = viteConfig;
    const input = build?.rolldownOptions?.input ?? build?.rollupOptions?.input;
    // Inputs are absolute paths; compare them relative to the repo root, with forward slashes.
    const paths = Object.values(input ?? {}).map((p) => relative(root, String(p)).split(sep).join('/'));

    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(p, `${p} must not be a spike page`).not.toMatch(/(^|\/)spikes\//);
    // The two real pages are still the only entries.
    expect([...paths].sort()).toEqual(['admin/index.html', 'index.html']);
  });
});
