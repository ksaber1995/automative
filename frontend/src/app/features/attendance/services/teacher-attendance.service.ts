import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';

export type TeacherAttendanceRole = 'PRIMARY' | 'SUBSTITUTE' | 'ASSISTANT';
export type TeacherAttendanceStatus = 'PRESENT' | 'ABSENT';

export interface TeacherAttendanceEntry {
  employeeId: string;
  role: TeacherAttendanceRole;
  status: TeacherAttendanceStatus;
  notes?: string | null;
}

export interface SessionTeacherAttendanceRow {
  id: string;
  sessionId: string;
  employeeId: string;
  employeeFirstName: string;
  employeeLastName: string;
  employeePosition: string | null;
  role: TeacherAttendanceRole;
  status: TeacherAttendanceStatus;
  notes: string | null;
  createdAt: string;
}

export interface TeacherAttendanceHistoryRow extends Omit<SessionTeacherAttendanceRow, 'createdAt'> {
  sessionStartDate: string;
  sessionEndDate: string | null;
  durationMinutes: number | null;
  branchId: string | null;
  branchName: string | null;
  classId: string | null;
  className: string | null;
  classCode: string | null;
  courseName: string | null;
  roomCode: string | null;
  /** True when this session has been covered by a salary payment. */
  paid?: boolean;
}

export interface TeacherHistoryFilters {
  branchId?: string;
  employeeId?: string;
  classId?: string;
  startDate?: string;
  endDate?: string;
}

@Injectable({ providedIn: 'root' })
export class TeacherAttendanceService {
  private api = inject(ApiService);

  getBySession(sessionId: string): Observable<SessionTeacherAttendanceRow[]> {
    return this.api.get<SessionTeacherAttendanceRow[]>(`attendance/teachers/session/${sessionId}`);
  }

  saveForSession(sessionId: string, teachers: TeacherAttendanceEntry[]): Observable<{ message: string; count: number }> {
    return this.api.post<{ message: string; count: number }>(
      `attendance/teachers/session/${sessionId}`,
      { teachers },
    );
  }

  getHistory(filters?: TeacherHistoryFilters): Observable<TeacherAttendanceHistoryRow[]> {
    return this.api.get<TeacherAttendanceHistoryRow[]>('attendance/teachers', filters);
  }
}
