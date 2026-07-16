/**
 * Calendar-day helpers.
 *
 * Almost every date this app sends is a CALENDAR DAY, not an instant: the day a
 * payment was collected, a birth date, the day a class starts. The API stores
 * them as DATE columns and the pickers hand back a local-midnight `Date`.
 *
 * `toISOString()` converts to UTC first, so for any timezone EAST of UTC (Egypt
 * is +3) local midnight on the 25th is 21:00 on the 24th in UTC, and
 * `toISOString().split('T')[0]` yields the PREVIOUS day. Pick the 25th, store
 * the 24th. Building the string from local components keeps the day the user
 * actually chose, in every timezone.
 */

/** The local calendar day of `value` as YYYY-MM-DD. Non-Date values pass through. */
export function toLocalYmd(value: Date): string;
export function toLocalYmd<T>(value: T): T;
export function toLocalYmd(value: any): any {
  if (!(value instanceof Date) || isNaN(value.getTime())) return value;
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Today's LOCAL calendar day as YYYY-MM-DD. `new Date().toISOString()` would
 * report yesterday between midnight and 03:00 in Egypt, since UTC has not
 * ticked over yet.
 */
export function todayYmd(): string {
  return toLocalYmd(new Date());
}
