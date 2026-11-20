// P7: the pure ordering logic shared by the admin API, the admin page and the public gallery.
// - validateOrder: a saved order may only hold known slugs, each at most once (the API refuses anything else).
// - mergeOrder: the saved order first (known slugs only), then every project that was not saved, in its
//   built-in order, so a project added to /content later still appears.
// - move: move one entry up or down (the keyboard buttons) or to a position (drag and drop).
// - applyRanks: give projects a `rank` from the saved order; the gallery's "Featured" sort uses it when present.

/** { ok: true, order } or { ok: false, reason }. */
export function validateOrder(order, validSlugs) {
  if (!Array.isArray(order) || order.length === 0 || order.length > validSlugs.length) return { ok: false, reason: 'shape' };
  const known = new Set(validSlugs);
  const seen = new Set();
  for (const slug of order) {
    if (typeof slug !== 'string' || !known.has(slug)) return { ok: false, reason: 'unknown' };
    if (seen.has(slug)) return { ok: false, reason: 'duplicate' };
    seen.add(slug);
  }
  return { ok: true, order: [...order] };
}

/** Saved slugs (known ones, first occurrence only) followed by the slugs that were never saved, in default order. */
export function mergeOrder(saved, defaults) {
  const known = new Set(defaults);
  const out = [];
  for (const slug of Array.isArray(saved) ? saved : []) if (known.has(slug) && !out.includes(slug)) out.push(slug);
  for (const slug of defaults) if (!out.includes(slug)) out.push(slug);
  return out;
}

/** A new array with the item at `from` moved to `to` (both clamped to the list). */
export function move(list, from, to) {
  if (from < 0 || from >= list.length) return [...list];
  const target = Math.max(0, Math.min(list.length - 1, to));
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

/** Sets `rank` (0-based) on each project that is in the saved order; others keep no rank. Returns how many were ranked. */
export function applyRanks(projects, saved) {
  const ranks = new Map((Array.isArray(saved) ? saved : []).filter((s) => typeof s === 'string').map((slug, i) => [slug, i]));
  let n = 0;
  for (const p of projects) {
    if (ranks.has(p.slug)) {
      p.rank = ranks.get(p.slug);
      n += 1;
    } else delete p.rank;
  }
  return n;
}
