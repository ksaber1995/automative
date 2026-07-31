/**
 * The Excellent…Weak scale used when a company marks homework by rating instead
 * of by number.
 *
 * A rating IS a number underneath — Excellent is 5, Weak is 1 — so nothing about
 * how a result is stored, reported or shown on the student page changes. Only the
 * control the teacher touches does. That is also why the scale lives here rather
 * than in either screen: the settings preview and the marking panel must agree on
 * the mapping, or a teacher would pick "Good" and see a different label back.
 */

/** Rating homework is always out of this, so a stored mark maps back exactly. */
export const HOMEWORK_RATING_MAX = 5;

export interface HomeworkRating {
  value: number;
  labelKey: string;
}

/** Best first — the order they are offered in, and read in. */
export const HOMEWORK_RATINGS: HomeworkRating[] = [
  { value: 5, labelKey: 'HOMEWORK_RATING.EXCELLENT' },
  { value: 4, labelKey: 'HOMEWORK_RATING.VERY_GOOD' },
  { value: 3, labelKey: 'HOMEWORK_RATING.GOOD' },
  { value: 2, labelKey: 'HOMEWORK_RATING.FAIR' },
  { value: 1, labelKey: 'HOMEWORK_RATING.WEAK' },
];

/**
 * The label for a stored mark, or null when it isn't one of the five — a mark
 * recorded before the company switched to ratings stays a number rather than
 * being forced into the nearest band.
 */
export function ratingLabelKey(grade: string | number | null | undefined): string | null {
  if (grade === null || grade === undefined || grade === '') return null;
  const n = typeof grade === 'number' ? grade : parseFloat(grade);
  if (!Number.isFinite(n)) return null;
  return HOMEWORK_RATINGS.find((r) => r.value === n)?.labelKey ?? null;
}
