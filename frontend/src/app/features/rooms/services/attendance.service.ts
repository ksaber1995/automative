import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';

export type AttendanceType = 'NORMAL' | 'SUBSTITUTION';
export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'SUBSTITUTED';

export interface SessionAttendanceStudent {
  studentId: string;
  studentFirstName: string;
  studentLastName: string;
  parentName?: string | null;
  parentPhone?: string | null;
  studentPhone?: string | null;
  isPresent: boolean;
  attendanceId?: string | null;
  attendanceType?: AttendanceType | null;
  homeClassName?: string | null;
  isEnrolled?: boolean;
}

export interface StudentAttendanceRecord {
  sessionId: string;
  sessionStartDate: string;
  sessionEndDate?: string | null;
  sessionNumber?: number | null;
  classId: string;
  className: string;
  roomCode?: string | null;
  isPresent: boolean;
  status?: AttendanceStatus;
  substitutedInClassName?: string | null;
}

export interface QrCheckinResult {
  studentId: string;
  studentFirstName: string;
  studentLastName: string;
  alreadyPresent: boolean;
  attendanceType?: AttendanceType;
  homeClassName?: string | null;
  sessionNumber?: number | null;
  code: string;
  message: string;
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
  saveForSession(sessionId: string, presentStudentIds: string[]): Observable<{ message: string; presentCount: number }> {
    return this.api.post<{ message: string; presentCount: number }>(
      `attendance/session/${sessionId}`,
      { presentStudentIds }
    );
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
