// P5: everything that checks the chat's input and output without a model.
// - screenInput: a small heuristic list of prompt-injection phrasings (English, Roman Urdu, Urdu script) and
//   of requests for private contact data; Prompt Guard 2 runs on top of it (api/_lib/llm.js).
// - filterAnswer: strips phone numbers and non-public emails, keeps only allow-listed links (same-page
//   anchors, Umer's GitHub and LinkedIn), normalises citation brackets and maps [n] to the sources that
//   were really used (renumbered 1..k, duplicates of one page merged).

export const PUBLIC_EMAIL = 'mumerfarooq.ned@gmail.com';

const INJECTION = [
  /\b(?:ignore|disregard|forget|override|bypass)\b.{0,40}\b(?:instructions?|rules?|prompts?|guidelines|directions|above|previous|prior|system)\b/i,
  /\b(?:system|hidden|developer|initial|original)\s+(?:prompt|message|instructions?)\b/i,
  /\b(?:reveal|print|show|repeat|output|leak|display|tell me|give me|paste|write out)\b.{0,40}\b(?:your|the)\s+(?:instructions|prompt|rules|configuration|context)\b/i,
  /\b(?:you are now|from now on you|act as|pretend (?:to be|you are)|roleplay as|jailbreak|developer mode|DAN mode)\b/i,
  /<\/?(?:system|instructions?|context)>|<<<|>>>|\[\/?INST\]|###\s*(?:system|instruction)/i,
  /\b(?:pichli|pehli|purani|tamam|saari)\s+(?:hidayat|instructions?|baatein)\b.{0,30}\b(?:ignore|bhool|nazar ?andaz|chhor)/i,
  /\b(?:system|sistem)\s+prompt\b.{0,30}\b(?:dikhao|batao|likho)\b/i,
  /ہدایات.{0,30}(?:نظر\s?انداز|بھول|چھوڑ)|سسٹم\s?پرامپٹ|پرامپٹ.{0,20}(?:دکھا|بتا)/,
];
// Requests for private data (phone, address, CNIC, passwords). A bare word such as "mobile" or "phone" is NOT
// enough ("a mobile app", "phone calls" are harmless, and so is "what number did you get in class?"): the
// screen needs a private-data phrase, or a private noun asked for (possessive or request word next to it).
const NOUN = String.raw`(?:phone|mobile|cell(?:\s?phone)?|whats\s?app|telephone|fone?|contact|number|home|house|ghar|address|cnic|passport|password|passcode)`;
const OWNER = String.raw`(?:your|his|umer['’]s|ur|aap\s?ka|aap\s?ki|aapka|aapki|apna|apni|tumhara|tumhari|uska|uski|umer\s?ka|umer\s?ki|inka|inki|unka|unki)`;
const ASK = String.raw`(?:give|share|send|tell|text|provide|need|want|dedo|de\s?do|dein|batao|bata\s?do|bataiye|bhejo|bhej\s?do|chahiye|chahie|share\s?karo)`;
const PRIVATE = [
  // fixed phrases that only ever mean private data. No leading word boundary on "<phone> number": a speech
  // transcript can glue words together ("Umarphone number").
  /(?:phone|mobile|cell(?:\s?phone)?|whats\s?app|telephone|fone?)\s?(?:number|no\.?|num|nmbr|nambar|#)/i,
  /\b(?:contact\s?(?:number|no\.?)|home\s+address|house\s+address|residential\s+address|cnic|national\s+id|id\s+card|passport\s+number|passwords?|passcode|private\s+(?:data|details|info\w*)|personal\s+(?:phone|address|details))\b/i,
  // a possessive next to a private noun: "your phone", "umer ka number", "uska address"
  new RegExp(String.raw`\b${OWNER}\s+(?:\w+\s+)?${NOUN}\b`, 'i'),
  // a request word next to a private noun: "give me the number", "number batao", "send whatsapp"
  new RegExp(String.raw`\b${ASK}\b.{0,25}\b(?:phone|mobile|whats\s?app|telephone|fone?|number|address|cnic|password)\b`, 'i'),
  new RegExp(String.raw`\b(?:phone|mobile|whats\s?app|telephone|fone?|number|address|cnic)\b.{0,15}\b${ASK}\b`, 'i'),
  // Roman Urdu "number do" (give the number) only at the end of the question: a bare "do" is also English ("Do you ...")
  /\b(?:phone|mobile|whats\s?app|telephone|fone?|number|address|cnic)\s+do\s*(?:na|ji|please|plz|pls)?\s*[.!?]*\s*$/i,
  // Urdu script: the phrase itself, or an owner word + noun, or the noun + a request word
  /(?:فون|موبائل|واٹس\s?ایپ|ٹیلیفون)\s?(?:نمبر|نمبرز)|گھر کا پتہ?|گھر کا ایڈریس|شناختی\s?کارڈ|پاس\s?ورڈ|سی\s?این\s?آئی\s?سی|ذاتی\s?(?:معلومات|تفصیلات|نمبر)/,
  /(?:آپ|ان|اُن|عمر)\s?(?:کا|کی|کے)\s+(?:فون|موبائل|واٹس\s?ایپ|نمبر|پتہ|ایڈریس)/,
  /(?:فون|موبائل|واٹس\s?ایپ|نمبر|ایڈریس|پتہ)\s+(?:بتا|بھیج|دیں|دو|دیجئے|دیجیے|شیئر)/,
];

/** 'injection' | 'private' | null for one piece of visitor text. */
export function screenInput(text) {
  const s = String(text ?? '');
  if (INJECTION.some((r) => r.test(s))) return 'injection';
  if (PRIVATE.some((r) => r.test(s))) return 'private';
  return null;
}

// Phone shapes (same as the content PII guard) and emails.
const PHONES = [/(?:\+92|0092)[\s.-]?3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}\b/g, /(?<![\d+])03\d{2}[\s.-]?\d{3}[\s.-]?\d{4}\b/g, /\b\d{5}-\d{7}-\d\b/g];
const GENERIC_PHONE = /\+?\(?\d[\d\s().-]{8,}\d/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const URL = /\bhttps?:\/\/[^\s<>()\]]+|\bwww\.[^\s<>()\]]+/gi;
const ALLOWED_LINKS = [/^https?:\/\/(?:www\.)?github\.com\/muhammadumerfarooqq(?:[/?#][^\s]*)?$/i, /^https?:\/\/(?:www\.)?linkedin\.com\/in\/mumerfarooq04\/?(?:[?#][^\s]*)?$/i];

export const isAllowedLink = (url) => ALLOWED_LINKS.some((r) => r.test(url.replace(/[.,;:!?]+$/, '')));

/** Remove private data and foreign links from model output (defence in depth; the index has none). */
export function scrub(text) {
  let s = String(text ?? '');
  // markdown links: keep the label, keep the URL only if allowed
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => (url.startsWith('#') || isAllowedLink(url) ? `${label} (${url})` : label));
  for (const r of PHONES) s = s.replace(r, '[removed]');
  s = s.replace(GENERIC_PHONE, (m) => ((m.match(/\d/g) ?? []).length >= 10 ? '[removed]' : m));
  s = s.replace(EMAIL, (m) => (m.toLowerCase() === PUBLIC_EMAIL ? m : '[removed]'));
  s = s.replace(URL, (m) => (isAllowedLink(m) ? m : '[link removed]'));
  return s.replace(/\(\s*\[link removed\]\s*\)/g, '').replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * Normalise citations and keep only valid ones. hits = the context entries (1-based in the prompt).
 * Returns { text, sources: [{ title, anchor }] } with [n] renumbered to the order sources first appear.
 */
export function mapCitations(text, hits) {
  let s = String(text ?? '')
    .replace(/[【［]\s*(\d+(?:\s*[,，、]\s*\d+)*)\s*[】］]/g, '[$1]')
    .replace(/\[(\d+(?:\s*,\s*\d+)+)\]/g, (_, list) => list.split(/\s*,\s*/).map((n) => `[${n}]`).join(''));
  const order = [];
  const byAnchor = new Map();
  s = s.replace(/\[(\d{1,2})\]/g, (_, n) => {
    const hit = hits[Number(n) - 1];
    if (!hit) return '';
    if (!byAnchor.has(hit.anchor)) {
      byAnchor.set(hit.anchor, order.length + 1);
      order.push({ title: hit.title, anchor: hit.anchor });
    }
    return `[${byAnchor.get(hit.anchor)}]`;
  });
  // one source cited twice in a row ("[1][1]") reads as one
  s = s.replace(/(\[\d+\])(?:\1)+/g, '$1').replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
  return { text: s, sources: order };
}

export function filterAnswer(text, hits) {
  return mapCitations(scrub(text), hits);
}
