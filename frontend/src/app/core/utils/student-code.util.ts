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
