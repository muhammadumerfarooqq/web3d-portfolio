// P10 Urdu UI (lazy chunk; never part of the Explore chunk or the main entry). Walks the page once and swaps every
// known English UI string (text nodes and aria-label / placeholder / title / alt) for its Urdu text from
// ur.json (a separate chunk, fetched only when Urdu is chosen); English is restored from the remembered originals.
// Long portfolio content (projects, about, skills) is not in the dictionary and stays English. Text is set with
// nodeValue / setAttribute only: no HTML strings.
import en from './en.json';
import { LANGS, LANG_KEY, setDocumentLang, setTranslator } from './index.js';
import { buildIndex, translate } from './translate.js';
import { track } from '../ui/analytics.js';
import { writePref } from '../ui/prefs.js';

const index = buildIndex(en);
const ATTRS = ['aria-label', 'placeholder', 'title', 'alt'];
const SKIP = 'script, style, noscript, textarea, [data-chat-log], [data-i18n-skip]';
const nodes = new Map(); // text node → its English text
const attrs = new Map(); // element → { attribute: English value }
let ur = null;

const loadUrdu = async () => (ur ??= (await import('./ur.json')).default);

function eachTextNode(fn) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const found = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) found.push(n);
  for (const n of found) if (n.nodeValue.trim() && !n.parentElement?.closest(SKIP)) fn(n);
}

function toUrdu() {
  // A reveal that split its text into lines or characters must be put back first, or the Urdu would be cut apart
  // (and an auto-split would bring the English back on resize).
  window.dispatchEvent(new CustomEvent('i18nrevert')); // motion.js puts split reveals back
  eachTextNode((node) => {
    const english = nodes.get(node) ?? node.nodeValue;
    const text = translate(english, index, ur);
    if (text !== null) {
      nodes.set(node, english);
      node.nodeValue = text;
    }
  });
  for (const el of document.querySelectorAll('[aria-label], [placeholder], [title], [alt]')) {
    if (el.closest(SKIP)) continue;
    for (const name of ATTRS) {
      if (!el.hasAttribute(name)) continue;
      const stored = attrs.get(el) ?? {};
      const english = stored[name] ?? el.getAttribute(name);
      const text = translate(english, index, ur);
      if (text !== null) {
        attrs.set(el, { ...stored, [name]: english });
        el.setAttribute(name, text);
      }
    }
  }
}

function toEnglish() {
  for (const [node, english] of nodes) node.nodeValue = english;
  for (const [el, stored] of attrs) for (const [name, english] of Object.entries(stored)) el.setAttribute(name, english);
  nodes.clear();
  attrs.clear();
}

/** Switch the page to 'en' or 'ur' (Urdu loads its dictionary first). Remembers the choice unless save is false. */
export async function applyLang(lang, { save = true, count = false } = {}) {
  const next = LANGS.includes(lang) ? lang : 'en';
  if (next === 'ur') {
    const dict = await loadUrdu();
    setTranslator((text) => translate(text, index, dict) ?? text);
    toUrdu();
  } else {
    setTranslator(null);
    toEnglish();
  }
  setDocumentLang(document.documentElement, next);
  for (const b of document.querySelectorAll('[data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === next));
  if (save) writePref(LANG_KEY, next, LANGS); // a known value only (en | ur); a blocked storage changes nothing
  if (count && next === 'ur') track('lang_ur');
  window.dispatchEvent(new CustomEvent('langchange', { detail: { lang: next } }));
  return next;
}

