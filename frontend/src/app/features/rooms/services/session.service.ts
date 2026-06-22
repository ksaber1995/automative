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
