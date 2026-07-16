/**
 * Text matching for the app's search boxes.
 *
 * A naive `haystack.includes(term)` fails on this data in three ways:
 *
 *  - Names are stored as parts and very often carry a middle name, so looking
 *    for the term as ONE contiguous run misses the obvious search: "احمد علي"
 *    never matches "احمد محمد علي", because the middle name sits between them.
 *    People search by the names they remember, not by the stored word order.
 *  - Arabic writes the same name several ways — أ/إ/آ vs ا, ة vs ه, ى vs ي,
 *    optional harakat, tatweel. Someone typing the plain form must still find
 *    the decorated one.
 *  - Codes and phone numbers get typed with Arabic-Indic digits (٠-٩) as
 *    readily as latin ones.
 *
 * Stored values are also not clean: names carry stray leading/trailing spaces,
 * so whitespace is collapsed on both sides rather than trusted.
 */

/** Harakat (fatha…sukun), superscript alef, and tatweel — decoration, never identity. */
const ARABIC_MARKS = /[ً-ْٰـ]/g;

/** Fold text to a comparable form: no marks, unified letters, latin digits, single spaces. */
export function normalizeSearchText(value: unknown): string {
  return String(value ?? '')
    .replace(ARABIC_MARKS, '')
    .replace(/[أإآٱ]/g, 'ا')                      // أ إ آ ٱ -> ا
    .replace(/ى/g, 'ي')                                          // ى -> ي
    .replace(/ة/g, 'ه')                                          // ة -> ه
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))  // ٠-٩ -> 0-9
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))  // ۰-۹ -> 0-9
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when EVERY word of `term` appears somewhere in `fields`, in any order.
 * Word-wise rather than contiguous, so a first+last search still finds someone
 * filed under first+middle+last, and word order does not matter.
 */
export function matchesSearchTokens(term: string, fields: unknown[]): boolean {
  const words = normalizeSearchText(term).split(' ').filter(Boolean);
  if (!words.length) return true;
  const haystack = fields.map(normalizeSearchText).filter(Boolean).join(' ');
  return words.every((word) => haystack.includes(word));
}
