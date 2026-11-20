// P10 i18n core: tiny and shared (Classic's lazy chat / contact chunks import it; the Explore chunk does not).
// English is the default and lives in the HTML and in the JS messages themselves; nothing is loaded for it.
// When the page is in Urdu, src/i18n/apply.js (a lazy chunk) installs a translator: tr("<English UI text>") then
// returns the Urdu text (exact strings and {n} / {name} templates, see src/i18n/en.json); otherwise it returns
// the text unchanged. It never throws.
export const LANGS = ['en', 'ur'];
export const LANG_KEY = 'lang';

let translator = null;

export function setTranslator(fn) {
  translator = typeof fn === 'function' ? fn : null;
}

export function tr(text) {
  try {
    return translator ? translator(String(text ?? '')) : text;
  } catch {
    return text;
  }
}

export const currentLang = (html = globalThis.document?.documentElement) => (html?.getAttribute?.('lang') === 'ur' ? 'ur' : 'en');

/** <html lang dir>: Urdu is right to left. */
export function setDocumentLang(html, lang) {
  const next = lang === 'ur' ? 'ur' : 'en';
  html.setAttribute('lang', next);
  html.setAttribute('dir', next === 'ur' ? 'rtl' : 'ltr');
  return next;
}
