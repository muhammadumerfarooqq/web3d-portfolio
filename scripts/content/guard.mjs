// PII guard: content must never contain phone numbers, CNIC numbers or email addresses
// (content/README.md). The same files feed the public site and, in P5, the chatbot index.
import { ContentError } from './load.mjs';

const RULES = [
  // Pakistani mobile numbers: 03xx-xxxxxxx, 03xx xxx xxxx, +92 3xx…, 0092 3xx…
  { kind: 'phone number', pattern: /(?:\+92|0092)[\s.-]?3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}\b/g },
  { kind: 'phone number', pattern: /(?<![\d+])03\d{2}[\s.-]?\d{3}[\s.-]?\d{4}\b/g },
  // CNIC: 5-7-1 digits
  { kind: 'CNIC number', pattern: /\b\d{5}-\d{7}-\d\b/g },
  // Email addresses
  { kind: 'email address', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
];

// Generic phone shapes: a digit run with separators holding 10+ digits ("+1 (555) 010-0199").
const GENERIC_PHONE = /\+?\(?\d[\d\s().-]{8,}\d/g;
const digitCount = (s) => (s.match(/\d/g) ?? []).length;

function position(text, index) {
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  const column = index - before.lastIndexOf('\n');
  return { line, column };
}

/** Findings in one text: [{ kind, line, column }]. Matched values are never returned (no PII in logs). */
export function scanText(text) {
  const findings = [];
  const seen = new Set();
  const add = (kind, index) => {
    if (seen.has(index)) return;
    seen.add(index);
    findings.push({ kind, ...position(text, index) });
  };
  for (const { kind, pattern } of RULES) {
    for (const m of text.matchAll(pattern)) add(kind, m.index);
  }
  for (const m of text.matchAll(GENERIC_PHONE)) {
    if (digitCount(m[0]) >= 10) add('phone number', m.index);
  }
  return findings.sort((a, b) => a.line - b.line || a.column - b.column);
}

/** Throw if any source contains PII. `sources` = [{ file, raw }]. */
export function assertNoPii(sources) {
  const problems = [];
  for (const { file, raw } of sources) {
    for (const f of scanText(raw)) problems.push(`${file}:${f.line}:${f.column}: looks like a ${f.kind}`);
  }
  if (problems.length) {
    throw new ContentError(
      `PII guard: personal data must not be published (content/README.md).\n${problems.join('\n')}`,
    );
  }
}
