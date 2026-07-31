/**
 * Clock-time helpers shared by anything that reads or writes a class schedule.
 *
 * Times are stored as "HH:MM" or "HH:MM:SS" and compared as minutes-from-
 * midnight — never as Date objects, which drag a timezone into a value that has
 * no date attached and shifts a 10:00 class by the UTC offset.
 */

/** Minutes from midnight, or null when the value isn't a clock time. */
export function timeToMinutes(time: string | null | undefined): number | null {
  const [hRaw, mRaw] = (time || '').split(':');
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/** "14:05" from 845. */
export function minutesToTime(mins: number): string {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * "2:00 PM" from "14:00" / "14:00:00".
 *
 * Digits stay Latin even in Arabic — these sit beside Latin-digit dates and
 * phone numbers, and Arabic-Indic numerals would read and sort inconsistently
 * against them. Only the marker is localised.
 */
export function to12h(time: string | null | undefined, am: string, pm: string): string {
  const mins = timeToMinutes(time);
  if (mins === null) return (time || '').slice(0, 5);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? am : pm}`;
}

/** "1h 30m" / "45m" — how long a gap is, for deciding what fits in it. */
export function formatDuration(mins: number, hourLabel: string, minLabel: string): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}${hourLabel} ${m}${minLabel}`;
  if (h) return `${h}${hourLabel}`;
  return `${m}${minLabel}`;
}
