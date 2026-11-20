// P10: the pure part of the translator. `en` is the flat key → English map (src/i18n/en.json), `ur` the same keys in
// Urdu. buildIndex() lets a piece of English UI text be found again from the text alone (whitespace-insensitive),
// including strings with {n} / {name} placeholders; translate() returns the Urdu text or null.
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function buildIndex(en) {
  const exact = new Map();
  const templates = [];
  for (const [key, text] of Object.entries(en)) {
    if (/\{[a-z]+\}/.test(text)) {
      const names = [];
      const pattern = escapeRe(norm(text)).replace(/\\\{([a-z]+)\\\}/g, (_, name) => {
        names.push(name);
        return '(.+?)';
      });
      templates.push({ key, names, re: new RegExp(`^${pattern}$`) });
    } else exact.set(norm(text), key);
  }
  return { exact, templates };
}

/** The Urdu for one English string, or null when it is not a known UI string. Leading and trailing spaces are kept. */
export function translate(text, index, ur) {
  const raw = String(text);
  const s = norm(raw);
  if (!s) return null;
  let out = null;
  const key = index.exact.get(s);
  if (key && ur[key]) out = ur[key];
  else {
    for (const t of index.templates) {
      const m = t.re.exec(s);
      if (m && ur[t.key]) {
        out = ur[t.key].replace(/\{([a-z]+)\}/g, (_, name) => m[t.names.indexOf(name) + 1] ?? '');
        break;
      }
    }
  }
  if (out === null) return null;
  return `${/^\s/.test(raw) ? ' ' : ''}${out}${/\s$/.test(raw) ? ' ' : ''}`;
}
