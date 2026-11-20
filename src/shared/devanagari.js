// P12-UX: Devanagari → Roman transliteration, rule based and dependency free.
//
// Why: Whisper has no "Roman Urdu" language code. Roman Urdu spoken with the language left on auto is often
// detected as Hindi and written in Devanagari ("umer kaun hai" → "उमर कौन है?"). The chat input must show readable
// Roman text, so /api/transcribe passes a transcript that contains Devanagari through this function (and only
// then). The result is APPROXIMATE (vowel length and spelling vary in Roman Urdu), and it is screened afterwards
// like any other visitor text. Urdu in Arabic script never goes through here.
//
// Rules: independent vowels, matras, consonants (nukta forms included), virama (no vowel), anusvara / chandrabindu
// (n, or m before a lip consonant), visarga (h), digits, danda. The inherent "a" of a consonant is dropped at the
// end of a word and in the usual medial position (rahte, not rahate). A few proper nouns from the portfolio keep
// their own spelling. Other Devanagari signs are dropped, so no Devanagari is ever left in the output.

/** Input longer than this is cut first (the chat limit is 500 characters; this only bounds the work). */
export const MAX_INPUT = 2000;

export const hasDevanagari = (text) => /[ऀ-ॿ]/.test(String(text ?? ''));

const VOWELS = { अ: 'a', आ: 'aa', इ: 'i', ई: 'ee', उ: 'u', ऊ: 'oo', ऋ: 'ri', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au', ऑ: 'o', ऍ: 'e', ऎ: 'e', ऒ: 'o' };
const MATRAS = { 'ा': 'a', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o', 'ॅ': 'e', 'ॆ': 'e', 'ॊ': 'o' };
const CONSONANTS = {
  क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'ng',
  च: 'ch', छ: 'chh', ज: 'j', झ: 'jh', ञ: 'n',
  ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n',
  त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n',
  प: 'p', फ: 'f', ब: 'b', भ: 'bh', म: 'm',
  य: 'y', र: 'r', ल: 'l', ळ: 'l', व: 'v', श: 'sh', ष: 'sh', स: 's', ह: 'h',
};
// base + nukta (U+093C) → Roman; the precomposed letters U+0958 to U+095F are decomposed by NFD first.
const NUKTA = { क: 'q', ख: 'kh', ग: 'gh', ज: 'z', ड: 'r', ढ: 'rh', फ: 'f', य: 'y' };
const DIGITS = { '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9' };
const VIRAMA = '्';
const NUKTA_MARK = '़';
const LIPS = new Set(['प', 'फ', 'ब', 'भ', 'म']);

/** Proper nouns of the portfolio (public): Devanagari spellings → the Latin spelling used everywhere else. */
const NOUNS = new Map(
  [
    ['उमर', 'Umer'], ['उमेर', 'Umer'], ['उमार', 'Umer'], ['उमैर', 'Umer'],
    ['फारूक', 'Farooq'], ['फारुक', 'Farooq'], ['फ़ारूक', 'Farooq'], ['फ़ारुक', 'Farooq'], ['फारूख', 'Farooq'],
  ].map(([k, v]) => [k.normalize('NFD'), v]),
);

const isConsonant = (ch) => Object.hasOwn(CONSONANTS, ch);

/** One Devanagari word → units [{ roman, inherent }]; `inherent` marks a consonant that still carries its "a". */
function unitsOf(word) {
  const chars = [...word];
  const units = [];
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (isConsonant(ch)) {
      let roman = CONSONANTS[ch];
      if (chars[i + 1] === NUKTA_MARK) {
        roman = NUKTA[ch] ?? roman;
        i += 1;
      }
      const next = chars[i + 1];
      if (next === VIRAMA) {
        units.push({ roman, inherent: false, consonant: true });
        i += 1;
      } else if (next !== undefined && Object.hasOwn(MATRAS, next)) {
        units.push({ roman: roman + MATRAS[next], inherent: false, consonant: true, vowel: true });
        i += 1;
      } else {
        units.push({ roman, inherent: true, consonant: true });
      }
    } else if (Object.hasOwn(VOWELS, ch)) {
      units.push({ roman: VOWELS[ch], inherent: false, vowel: true });
    } else if (ch === 'ं' || ch === 'ँ') {
      const following = chars[i + 1];
      const lip = following !== undefined && LIPS.has(following);
      units.push({ roman: lip ? 'm' : 'n', inherent: false, nasal: true });
    } else if (ch === 'ः') {
      units.push({ roman: 'h', inherent: false });
    } else if (Object.hasOwn(DIGITS, ch)) {
      units.push({ roman: DIGITS[ch], inherent: false });
    } else if (ch === 'ॐ') {
      units.push({ roman: 'om', inherent: false, vowel: true });
    }
    // anything else (nukta alone, accents, signs): dropped
  }
  return units;
}

/** The inherent "a" is silent at the end of a word, and in the middle between a syllable and a following vowelled one. */
function spell(units) {
  let out = '';
  for (let i = 0; i < units.length; i += 1) {
    const u = units[i];
    if (!u.inherent) {
      out += u.roman;
      continue;
    }
    const prev = units[i - 1];
    const silent = i === units.length - 1 || (Boolean(prev) && Boolean(prev.vowel || prev.inherent) && Boolean(units[i + 1]?.vowel));
    out += silent ? u.roman : `${u.roman}a`;
  }
  return out;
}

/** A Devanagari run (one word) → Roman. `word` is already NFD. */
function romanWord(word) {
  return NOUNS.get(word) ?? spell(unitsOf(word));
}

/**
 * Transcript text → Roman text. Latin letters, digits and punctuation pass through unchanged; every Devanagari
 * word is transliterated; "।" and "॥" become ".". Input over MAX_INPUT characters is cut first; the result never
 * contains Devanagari. Not a string → ''.
 */
export function devanagariToRoman(text) {
  if (typeof text !== 'string' || !text) return '';
  const source = text.slice(0, MAX_INPUT).normalize('NFD').replace(/[।॥]/g, '.');
  return source.replace(/[ऀ-ॿ]+/g, (run) => romanWord(run)).replace(/\s+/g, ' ').trim();
}
