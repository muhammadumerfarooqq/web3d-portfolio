// P11 F4: regenerate docs/VIVA_CHEATSHEET.md from docs/LIMITATIONS.md. `node scripts/security/viva-cheatsheet.mjs`.
// Every row whose status is OPEN or ACCEPTED becomes one line: ID, status, the limitation, the FIRST sentence of
// its viva defence copied word for word (nothing is invented or rephrased), and its planned fix. The full
// defence and the impact stay in LIMITATIONS.md under the same ID. SOLVED rows are not listed.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const text = readFileSync(join(ROOT, 'docs', 'LIMITATIONS.md'), 'utf8').replace(/\r\n/g, '\n');
const rows = [];
let skipped = 0;
for (const line of text.split('\n')) {
  if (!/^\| L\d+ \|/.test(line) || !line.endsWith(' |')) continue;
  const cells = line.slice(2, -2).split(' | ');
  if (cells.length !== 7) {
    skipped += 1;
    continue;
  }
  const [id, limitation, , , defence, fix, status] = cells;
  if (!['OPEN', 'ACCEPTED'].includes(status.trim())) continue;
  let first = defence.trim().split(/(?<=[.!?])\s+(?=[A-Z*`(])/)[0];
  if (first.length > 330) first = `${first.slice(0, 327).replace(/\s+\S*$/, '')}…`;
  const cell = (s) => s.replace(/\|/g, '/');
  rows.push([id, status.trim(), cell(limitation), cell(first), cell(fix.trim())]);
}
const date = new Date().toISOString().slice(0, 10);
const out = [
  '# Viva cheat sheet: every open or accepted limitation',
  '',
  `Generated ${date} by \`node scripts/security/viva-cheatsheet.mjs\` from \`docs/LIMITATIONS.md\` (${rows.length} rows with status OPEN or ACCEPTED). The defence column is the FIRST sentence of that row's viva defence, copied word for word, nothing added; the full defence and the impact are in LIMITATIONS.md under the same ID. SOLVED rows are not listed. If a defence there is not true any more, fix LIMITATIONS.md and run the script again.`,
  '',
  '**How to use it:** when the examiner asks "what does not work, or what is weak?", pick the row, say the limitation, say the defence, say the planned fix. Never claim something this table does not say.',
  '',
  '| ID | Status | Limitation | Viva defence (first sentence) | Planned fix |',
  '|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.join(' | ')} |`),
];
writeFileSync(join(ROOT, 'docs', 'VIVA_CHEATSHEET.md'), `${out.join('\n')}\n`);
console.log(`docs/VIVA_CHEATSHEET.md: ${rows.length} rows${skipped ? `, ${skipped} row(s) skipped (unexpected column count)` : ''}`);
