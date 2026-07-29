import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { SessionPaymentWithDetails } from '@shared/interfaces/session-payment.interface';

/** TRIAL: attended a free session without being enrolled in the class. */
export type AttendanceType = 'NORMAL' | 'SUBSTITUTION' | 'TRIAL';
/** TRIAL: sat in on a free session of a class they're not enrolled in. */
export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'SUBSTITUTED' | 'TRIAL';

export interface SessionAttendanceStudent {
  studentId: string;
  studentName: string;
  studentCode?: number | null;
  parentName?: string | null;
  parentPhone?: string | null;
  studentPhone?: string | null;
  isPresent: boolean;
  attendanceId?: string | null;
  attendanceType?: AttendanceType | null;
  /** When the student was marked in; null when they were absent. */
  checkedInAt?: string | null;
  homeClassName?: string | null;
  isEnrolled?: boolean;
  /** PER_SESSION: the student's existing charge for this session (null if none). */
  charge?: { status: string; amountDue: number; amountPaid: number } | null;
  /** How many of this class's most recent ended sessions the student missed in a row. */
  absentStreak?: number | null;
}

export interface StudentAttendanceRecord {
  sessionId: string;
  sessionStartDate: string;
  sessionEndDate?: string | null;
  sessionNumber?: number | null;
  classId: string;
  className: string;
  courseId?: string | null;
  courseName?: string | null;
  /** The session was a free (trial) one — nobody was billed for it. */
  isFree?: boolean;
  roomCode?: string | null;
  isPresent: boolean;
  status?: AttendanceStatus;
  substitutedInClassName?: string | null;
}

export interface QrCheckinResult {
  studentId: string;
  studentName: string;
  /** Sent back so an off-roster attendee (trial/substitution) can show its badge. */
  studentCode?: number | null;
  alreadyPresent: boolean;
  attendanceType?: AttendanceType;
  homeClassName?: string | null;
  sessionNumber?: number | null;
  code: string;
  message: string;
  /** PER_SESSION courses: the charge created by this check-in (PENDING → prompt to pay). */
  sessionCharge?: SessionPaymentWithDetails | null;
}

export interface ClassAttendanceSummary {
  sessionId: string;
  sessionStartDate: string;
  sessionEndDate?: string | null;
  sessionNumber?: number | null;
  roomCode?: string | null;
  totalStudents: number;
  presentCount: number;
  absentCount: number;
}

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private api = inject(ApiService);

  /** Get all enrolled students for a session with their attendance status */
  getBySession(sessionId: string): Observable<SessionAttendanceStudent[]> {
    return this.api.get<SessionAttendanceStudent[]>(`attendance/session/${sessionId}`);
  }

  /** Bulk save attendance for a session */
  saveForSession(sessionId: string, presentStudentIds: string[]): Observable<{ message: string; presentCount: number; sessionCharges?: SessionPaymentWithDetails[] }> {
    return this.api.post<{ message: string; presentCount: number; sessionCharges?: SessionPaymentWithDetails[] }>(
      `attendance/session/${sessionId}`,
      { presentStudentIds }
    );
  }

  /** Remove a single attendance record (e.g. undo a wrong substitution scan). */
  removeAttendee(sessionId: string, studentId: string): Observable<{ message: string; code: string }> {
    return this.api.delete<{ message: string; code: string }>(`attendance/session/${sessionId}/student/${studentId}`);
  }

  /** Mark a single student present by scanning their QR token. Idempotent. */
  checkinByQr(sessionId: string, qrToken: string): Observable<QrCheckinResult> {
    return this.api.post<QrCheckinResult>(
      `attendance/session/${sessionId}/checkin`,
      { qrToken }
    );
  }

  /** Get attendance history for a student */
  getByStudent(studentId: string): Observable<StudentAttendanceRecord[]> {
    return this.api.get<StudentAttendanceRecord[]>(`attendance/student/${studentId}`);
  }

  /** Get per-session attendance summary for a class */
  getByClass(classId: string): Observable<ClassAttendanceSummary[]> {
    return this.api.get<ClassAttendanceSummary[]>(`attendance/class/${classId}`);
  }
}
