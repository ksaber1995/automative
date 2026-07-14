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
 * Normalise a code a human typed or a scanner pushed into the box.
 *
 * Pool cards print their number with an "A-" prefix (A-100001) so it can never be
 * mistaken for — or typed as — an organic student code. The code itself is still
 * an integer in the database, so strip the prefix (and any stray spaces or dashes)
 * before it goes to the API, which expects digits.
 */
export function normalizeStudentCode(code: string | number | null | undefined): string {
  return String(code ?? '').replace(/\D/g, '');
}
