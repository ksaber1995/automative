import { Student } from '@shared/interfaces/student.interface';

/**
 * Is the student's QR "live"? Mirrors the backend isQrLive + the QR dialog's
 * qrLive(): activated and not past its expiration (no expiration = lifelong).
 */
export function isStudentQrLive(student: Pick<Student, 'qrActivated' | 'qrExpiration'> | null | undefined): boolean {
  if (!student?.qrActivated) return false;
  if (!student.qrExpiration) return true;
  return new Date(student.qrExpiration) >= new Date(new Date().toISOString().slice(0, 10));
}

/**
 * Whether to show the student's sequential code in the UI. The code is always
 * assigned in the DB, but it's only revealed once the QR is usable: for TEACHER
 * companies that means the QR must be activated; for academies the QR is free
 * (always live) so the code shows as soon as it exists.
 */
export function shouldShowStudentCode(
  student: Pick<Student, 'studentCode' | 'qrActivated' | 'qrExpiration'> | null | undefined,
  isTeacher: boolean,
): boolean {
  if (student?.studentCode == null) return false;
  return !isTeacher || isStudentQrLive(student);
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
