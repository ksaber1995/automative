import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';

export interface Session {
  id: string;
  companyId: string;
  branchId: string;
  roomId: string | null;
  classId: string;
  sessionNumber: number | null;
  startDate: string;
  endDate: string | null;
  started: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  roomCode?: string | null;
  roomDescription?: string | null;
  className?: string;
  courseName?: string;
  branchName?: string;
  durationMinutes?: number | null;
  /** When filtering history by a student: was that student present this session? (null otherwise) */
  studentPresent?: boolean | null;
  /** Students checked in so far (active-sessions list only). */
  presentCount?: number | null;
}

/** A student's currently-running session, returned by activeForStudent (or null). */
export interface ActiveSessionInfo {
  sessionId: string;
  classId: string;
  className: string;
  courseName: string;
  roomCode?: string | null;
  sessionNumber?: number | null;
}

/** The session a scanned student should be checked into (active or imminent). */
export interface CheckinTargetInfo extends ActiveSessionInfo {
  /** true when matched by schedule (about to start) rather than already running. */
  upcoming: boolean;
}

export interface StartSessionTeacher {
  employeeId: string;
  role?: 'PRIMARY' | 'SUBSTITUTE' | 'ASSISTANT';
  status?: 'PRESENT' | 'ABSENT';
  notes?: string | null;
}

export interface StartSessionDto {
  roomId?: string;
  classId: string;
  branchId: string;
  notes?: string;
  sessionNumber?: number;
  teachers?: StartSessionTeacher[];
}

@Injectable({ providedIn: 'root' })
export class SessionService {
  private api = inject(ApiService);

  list(filters?: { branchId?: string; classId?: string; roomId?: string; courseId?: string; studentId?: string; attendance?: string }): Observable<Session[]> {
    return this.api.get<Session[]>('sessions', filters);
  }

  listActive(branchId?: string): Observable<Session[]> {
    return this.api.get<Session[]>('sessions/active', branchId ? { branchId } : undefined);
  }

  /** The student's currently-running session, or null if none is in progress. */
  activeForStudent(studentId: string): Observable<ActiveSessionInfo | null> {
    return this.api.get<ActiveSessionInfo | null>(`sessions/active-for-student/${studentId}`);
  }

  /**
   * The session a scanned student should be checked into — their running
   * session, or a class scheduled to be in progress / start within 30 min
   * (prepared on demand). localDate/localTime are the client's local clock.
   * Returns null when there's nothing to take attendance for.
   */
  checkinTarget(studentId: string, localDate: string, localTime: string): Observable<CheckinTargetInfo | null> {
    return this.api.get<CheckinTargetInfo | null>(`sessions/checkin-target/${studentId}`, { localDate, localTime });
  }

  getById(id: string): Observable<Session> {
    return this.api.get<Session>(`sessions/${id}`);
  }

  start(dto: StartSessionDto): Observable<Session> {
    return this.api.post<Session>('sessions/start', dto);
  }

  /** Create a session with started=false for pre-attendance */
  prepare(classId: string, branchId: string): Observable<Session> {
    return this.api.post<Session>('sessions/prepare', { classId, branchId });
  }

  /**
   * Opt-in auto start/end: ask the server to start sessions whose schedule says
   * they're in progress now, and end ones whose scheduled end has passed. No-op
   * unless the company enabled `autoManageSessions`. localDate/localTime are the
   * client's local clock so the schedule comparison uses the academy's timezone.
   */
  autoSchedule(localDate: string, localTime: string): Observable<{ enabled: boolean; started: number; ended: number }> {
    return this.api.post<{ enabled: boolean; started: number; ended: number }>('sessions/auto-schedule', { localDate, localTime });
  }

  end(id: string, notes?: string, endDate?: string): Observable<Session> {
    return this.api.patch<Session>(`sessions/${id}/end`, { notes, endDate });
  }

  /** Suggested next session number for a class's course (prefills the Start dialog). */
  nextNumber(classId: string): Observable<{ sessionNumber: number }> {
    return this.api.get<{ sessionNumber: number }>('sessions/next-number', { classId });
  }

  /** Edit a session's number (and/or notes) after it was started. */
  update(id: string, body: { sessionNumber?: number; notes?: string }): Observable<Session> {
    return this.api.patch<Session>(`sessions/${id}`, body);
  }
}
