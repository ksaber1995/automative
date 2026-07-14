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
 * A code as a human should SEE it.
 *
 * A card's number is stored as 100005 but prints as "A5" — nobody wants to read
 * six digits off a card, and the "A" is what makes it unmistakably a card rather
 * than a student's own code. Organic codes print as they are.
 */
export function formatStudentCode(code: string | number | null | undefined): string {
  if (code == null || code === '') return '';
  const n = Number(code);
  if (!Number.isFinite(n)) return String(code);
  return n > CARD_SERIAL_BASE ? `A${n - CARD_SERIAL_BASE}` : String(n);
}

/**
 * A code as TYPED, turned back into the integer the API stores.
 *
 * The leading "A" is not decoration — it IS the reserved range: "A5" means card
 * 5, which is student_code 100005, and must never resolve to the student whose
 * own code is 5. Cards printed before the short form ("A-100001") already carry
 * the full number, so a value that is already in the reserved range is taken as
 * absolute rather than shifted a second time.
 */
export function normalizeStudentCode(code: string | number | null | undefined): string {
  const raw = String(code ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const n = Number(digits);
  return /^[Aa]/.test(raw) && n < CARD_SERIAL_BASE ? String(CARD_SERIAL_BASE + n) : digits;
}
