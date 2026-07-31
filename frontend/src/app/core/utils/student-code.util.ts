import { Student } from '@shared/interfaces/student.interface';

/**
 * Whether to show the student's sequential code in the UI — i.e. whether they
 * have one.
 *
 * This used to also gate on the QR being "activated", a paid unlock that only
 * applied to TEACHER companies. That gate is gone: the QR is free for everyone
 * and the API reports every student's QR as live. Keeping the check was worse
 * than useless — students.ts hardcoded `qrActivated: true` while
 * monthly-subscriptions.ts still read the raw column, so 1,066 teacher-tenant
 * students showed their code on one page and not the other.
 *
 * If a per-student unlock ever comes back it should be decided in one place on
 * the server, not re-derived in the client from three fields.
 */
export function shouldShowStudentCode(
  student: Pick<Student, 'studentCode'> | null | undefined,
): boolean {
  return student?.studentCode != null;
}

/**
 * Pool card serials start above this. Mirrors CARD_SERIAL_BASE in the API — the
 * reserved range is what stops a card's number from ever colliding with a
 * student's own code.
 */
export const CARD_SERIAL_BASE = 100000;

/**
 * NEW pool cards print their number with a leading zero ("05") instead of the "A"
 * prefix, and live in a SECOND reserved range so the style is carried by the number
 * itself. Cards minted after the switch land here; the "A" cards already printed
 * (100000+) keep printing "A". Mirrors CARD_SERIAL_BASE_V2 in the API.
 */
export const CARD_SERIAL_BASE_V2 = 900000;

/**
 * A THIRD reserved range, printing a fixed three digits: 001, 005, 011, 099,
 * 100, 500.
 *
 * The earlier styles are not a fixed width — V2 prints "0" then the number, so 5
 * is "05" but 100 is "0100" — and an academy ordering a 500-card run wanted every
 * card the same length. Giving that its own range rather than a per-company
 * setting keeps formatStudentCode a pure function of the number, which is what
 * lets it be called from a dozen screens without any of them knowing whose card
 * it is. It also means no card already in a pocket changes meaning: only cards
 * minted into THIS range read the new way.
 *
 * Mirrors CARD_SERIAL_BASE_V3 in the API.
 */
export const CARD_SERIAL_BASE_V3 = 800000;

/**
 * A code as a human should SEE it.
 *
 * A card's number is stored as an integer in a reserved range but prints short and
 * unmistakable: an old card (100005) prints "A5", a new one (900005) prints "05".
 * Organic student codes print as they are.
 */
export function formatStudentCode(code: string | number | null | undefined): string {
  if (code == null || code === '') return '';
  const n = Number(code);
  if (!Number.isFinite(n)) return String(code);
  if (n >= CARD_SERIAL_BASE_V2) return `0${n - CARD_SERIAL_BASE_V2}`;
  // Fixed three digits — checked before the "A" range, which starts lower.
  if (n >= CARD_SERIAL_BASE_V3) return String(n - CARD_SERIAL_BASE_V3).padStart(3, '0');
  return n > CARD_SERIAL_BASE ? `A${n - CARD_SERIAL_BASE}` : String(n);
}

/**
 * A code as TYPED, turned back into the integer the API stores.
 *
 * The prefix is not decoration — it IS the reserved range: "A5" means card 5 =
 * 100005, "05" means card 5 = 900005, and neither may resolve to the student whose
 * own code is 5. A value already at/above a base (a full number, or the old
 * "A-100001" long form) is taken as absolute rather than shifted a second time.
 */
export function normalizeStudentCode(code: string | number | null | undefined): string {
  const raw = String(code ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const n = Number(digits);
  if (/^[Aa]/.test(raw) && n < CARD_SERIAL_BASE) return String(CARD_SERIAL_BASE + n);
  if (/^0\d/.test(raw) && n < CARD_SERIAL_BASE) return String(CARD_SERIAL_BASE_V2 + n);
  return digits;
}
