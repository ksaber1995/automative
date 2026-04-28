import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';

export interface SessionAttendanceStudent {
  studentId: string;
  studentFirstName: string;
  studentLastName: string;
  isPresent: boolean;
  attendanceId?: string | null;
}

export interface StudentAttendanceRecord {
  sessionId: string;
  sessionStartDate: string;
  sessionEndDate?: string | null;
  classId: string;
  className: string;
  classCode: string;
  roomCode?: string | null;
  isPresent: boolean;
}

export interface ClassAttendanceSummary {
  sessionId: string;
  sessionStartDate: string;
  sessionEndDate?: string | null;
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

  /** Get attendance history for a student */
  getByStudent(studentId: string): Observable<StudentAttendanceRecord[]> {
    return this.api.get<StudentAttendanceRecord[]>(`attendance/student/${studentId}`);
  }

  /** Get per-session attendance summary for a class */
  getByClass(classId: string): Observable<ClassAttendanceSummary[]> {
    return this.api.get<ClassAttendanceSummary[]>(`attendance/class/${classId}`);
  }
}
