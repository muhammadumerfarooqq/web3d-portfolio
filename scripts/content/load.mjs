// Loads /content at build time. Front matter is split with a strict "---\n…\n---" match and parsed
// as plain YAML (core schema, no custom tags, no aliases). Nothing in a content file is ever
// executed: language-tagged fences such as "---js" are rejected, unlike gray-matter, which evals them.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseDocument } from 'yaml';
import { FILE_SCHEMAS, projectSchema } from '../../src/shared/content-schema.js';

export class ContentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContentError';
  }
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const TAGGED_FENCE = /^---[ \t]*[^\s-]/; // "---js", "--- javascript", "---coffee", …
const UPPERCASE_FILE = /^[A-Z0-9_]+\.md$/;

function parseYaml(source, file) {
  const doc = parseDocument(source, { schema: 'core', customTags: [], merge: false, uniqueKeys: true, prettyErrors: true });
  const problem = doc.errors[0] ?? doc.warnings[0]; // warnings include unresolved tags like !!js/function
  if (problem) {
    const line = problem.linePos?.[0]?.line ? problem.linePos[0].line + 1 : '?';
    throw new ContentError(`${file}:${line}: invalid front matter: ${problem.message.split('\n')[0]}`);
  }
  try {
    return doc.toJS({ maxAliasCount: 0 }); // aliases disabled: no entity-expansion tricks
  } catch (error) {
    throw new ContentError(`${file}: invalid front matter: ${error.message}`);
  }
}

/** Split and parse one markdown file. Never evaluates code. */
export function parseContentFile(raw, file) {
  const text = raw.replace(/^\uFEFF/, '');
  if (TAGGED_FENCE.test(text)) {
    const fence = text.split(/\r?\n/, 1)[0];
    throw new ContentError(`${file}:1: language-tagged front matter "${fence}" is not allowed; use plain "---" YAML`);
  }
  const match = text.match(FRONT_MATTER);
  if (!match) throw new ContentError(`${file}:1: missing front matter (expected "---", YAML, then "---")`);
  const data = parseYaml(match[1], file);
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ContentError(`${file}: front matter must be a YAML mapping`);
  }
  const bodyStartLine = match[0].split(/\r?\n/).length; // 1-based line where the body starts
  return { data, body: text.slice(match[0].length), bodyStartLine };
}

function formatIssues(file, error) {
  return error.issues
    .map((issue) => `${file}: ${issue.path.length ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('\n');
}

export function validate(schema, data, file) {
  const result = schema.safeParse(data);
  if (!result.success) throw new ContentError(formatIssues(file, result.error));
  return result.data;
}

/**
 * Read every renderable content file. Skips UPPERCASE files (README, OPEN_QUESTIONS) and cv/.
 * Returns validated data plus the raw sources (for the PII guard).
 */
export function loadContent(root) {
  const dir = join(root, 'content');
  const rel = (path) => relative(root, path).split('\\').join('/');
  const sources = [];
  const content = { projects: [] };

  for (const name of readdirSync(dir).filter((f) => f.endsWith('.md') && !UPPERCASE_FILE.test(f)).sort()) {
    const path = join(dir, name);
    const file = rel(path);
    const schema = FILE_SCHEMAS[name];
    if (!schema) throw new ContentError(`${file}: unknown content file (no schema); see content/README.md`);
    const raw = readFileSync(path, 'utf8');
    const { data, body, bodyStartLine } = parseContentFile(raw, file);
    sources.push({ file, raw });
    content[name.replace(/\.md$/, '')] = { ...validate(schema, data, file), body, bodyStartLine, file };
  }

  const projectsDir = join(dir, 'projects');
  for (const name of readdirSync(projectsDir).filter((f) => f.endsWith('.md') && !UPPERCASE_FILE.test(f)).sort()) {
    const path = join(projectsDir, name);
    const file = rel(path);
    const raw = readFileSync(path, 'utf8');
    const { data, body, bodyStartLine } = parseContentFile(raw, file);
    const project = validate(projectSchema, data, file);
    if (project.slug !== name.replace(/\.md$/, '')) throw new ContentError(`${file}: slug must match the file name`);
    sources.push({ file, raw });
    content.projects.push({ ...project, body, bodyStartLine, file });
  }

  for (const required of Object.keys(FILE_SCHEMAS)) {
    if (!content[required.replace(/\.md$/, '')]) throw new ContentError(`content/${required} is missing`);
  }
  content.projects.sort((a, b) => a.order - b.order);
  return { content, sources };
}

/** Every anchor that content renders; duplicates fail the build. */
export function collectAnchors(content) {
  const anchors = [];
  for (const key of Object.keys(FILE_SCHEMAS)) anchors.push(content[key.replace(/\.md$/, '')].anchor);
  for (const item of content.achievements.items) anchors.push(item.anchor);
  for (const project of content.projects) if (!project.draft) anchors.push(project.anchor);
  const seen = new Set();
  for (const a of anchors) {
    if (seen.has(a)) throw new ContentError(`duplicate anchor "#${a}" in content`);
    seen.add(a);
  }
  return anchors;
}
