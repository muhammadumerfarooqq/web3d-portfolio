// P12-CV: CV text -> the redacted markdown the chatbot indexes (content/cv/cv.md).
//   pdftotext -enc UTF-8 -layout content-inbox/cv.pdf cv.txt
//   node scripts/rag/cv-redact.mjs cv.txt > content/cv/cv.md        (prints counts to stderr, never the removed values)
// The public CV PDF may carry the phone number (Umer allows it in that one file); the KNOWLEDGE BASE, the prompts and
// the answers never may. So every phone number (any format: +92 / 0092 / 0315 / "315 1210038" / any run of 9+ digits),
// every national ID number and every street-address line is removed here; the email and the public links stay.
// `redactCv` is pure (unit-tested); the CLI only reads a file and writes markdown.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const BULLET = /^[\s]*[•·●▪◦•·�*-]\s+/u;
const DIGITS = (s) => s.replace(/\D/g, '').length;

/** Remove phones, ID numbers and address lines. Returns { text, removed: { phones, ids, addresses } } (counts only). */
export function redactCv(input) {
  let text = String(input ?? '').replace(/\r\n?/g, '\n');
  const removed = { phones: 0, ids: 0, addresses: 0 };

  // national ID (CNIC 12345-1234567-1, with or without dashes/spaces)
  text = text.replace(/\b\d{5}[-\s]?\d{7}[-\s]?\d\b/g, () => {
    removed.ids += 1;
    return '';
  });
  // a labelled phone, whatever follows ("Phone: 0315 1210038", "Tel / WhatsApp +92 …")
  text = text.replace(/\b(?:phone|mobile|cell|tel(?:ephone)?|whats\s?app|contact no\.?)\s*[:#-]?\s*[+()\d][\d\s().-]*/gi, () => {
    removed.phones += 1;
    return '';
  });
  // any digit run with phone punctuation holding 9 or more digits (international, local, grouped any way)
  text = text.replace(/(?:\+|00)?\(?\d[\d\s().-]{7,}\d/g, (m) => {
    if (DIGITS(m) < 9) return m;
    removed.phones += 1;
    return '';
  });
  // a leftover "+92" / "0092" / "0315" country or network prefix whose digits were split off
  text = text.replace(/(?:\+|00)92\b|\b0?3\d{2}\b(?=\s*[•·|,])/g, () => {
    removed.phones += 1;
    return '';
  });
  // street-address lines
  text = text
    .split('\n')
    .filter((line) => {
      if (/\b(?:address|residence)\s*:|\b(?:house|flat|plot|apartment)\s*(?:no\.?|#)?\s*\d|\b(?:street|st\.|block|sector|phase|society)\b.*\d/i.test(line)) {
        removed.addresses += 1;
        return false;
      }
      return true;
    })
    .join('\n');
  // separators left dangling by a removal ("Karachi, Pakistan •  • email")
  text = text.replace(/(\S)[ 	]*([•·|�])[ 	]*(?:[•·|�][ 	]*)+/gu, '$1 $2 ').replace(/[ 	]+[•·|�][ 	]*$/gmu, ''); // (a bullet at the START of a line is a list marker: kept)
  return { text, removed };
}

const SEP = /\s*[•·|�]\s*/u;

/** Plain layout text (pdftotext -layout) -> readable markdown: headings, bullets, one paragraph per wrapped block. */
export function cvToMarkdown(text) {
  const out = [];
  let previous = 'blank';
  const lines = text.split('\n').map((l) => l.replace(/\s+$/g, ''));
  for (const raw of lines) {
    if (!raw.trim()) {
      if (previous !== 'blank') out.push('');
      previous = 'blank';
      continue;
    }
    // "LEFT      right-aligned date" -> "LEFT (date)"
    const cols = raw.trim().split(/\s{3,}/);
    let line = cols.length === 2 && /\d{4}|Present/.test(cols[1]) ? `${cols[0]} (${cols[1]})` : cols.join(' ');
    line = line.replace(/\s+/g, ' ').trim();
    if (/^MUHAMMAD UMER FAROOQ$/i.test(line)) continue; // the name is the prefix of every chunk anyway
    const heading = /^[A-Z][A-Z &/,]{3,}(?: \([^)]*\))?$/.test(line);
    if (heading) {
      if (out.length && out.at(-1) !== '') out.push('');
      const [, name, date] = /^([A-Z &/,]+?)(?: \(([^)]*)\))?$/.exec(line);
      const title = name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bAnd\b/, 'and').replace(/\bAi\b/, 'AI').replace(/\bCv\b/, 'CV');
      out.push(`## ${title}${date ? ` (${date})` : ''}`, '');
      previous = 'heading';
      continue;
    }
    if (BULLET.test(raw)) {
      out.push(`- ${line.replace(BULLET, '').replace(/^[•·�-]\s*/u, '')}`);
      previous = 'bullet';
      continue;
    }
    // a wrapped continuation of the previous bullet or paragraph
    if ((previous === 'bullet' || previous === 'text') && /^\s{2,}/.test(raw) && out.length && out.at(-1) !== '') {
      out[out.length - 1] += ` ${line}`;
      continue;
    }
    out.push(line.includes('•') || line.includes('�') ? line.split(SEP).filter(Boolean).join(' · ') : line);
    previous = 'text';
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/rag/cv-redact.mjs <cv-text-file> > content/cv/cv.md');
    process.exit(1);
  }
  const { text, removed } = redactCv(readFileSync(file, 'utf8'));
  process.stdout.write(cvToMarkdown(text));
  console.error(`redacted: ${removed.phones} phone number(s), ${removed.ids} ID number(s), ${removed.addresses} address line(s)`);
}
