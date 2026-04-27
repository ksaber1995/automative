import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';

export interface Session {
  id: string;
  companyId: string;
  branchId: string;
  roomId: string;
  classId: string;
  startDate: string;
  endDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  roomCode?: string;
  roomDescription?: string | null;
  className?: string;
  classCode?: string;
  courseName?: string;
  branchName?: string;
  durationMinutes?: number | null;
}

export interface StartSessionDto {
  roomId: string;
  classId: string;
  branchId: string;
  notes?: string;
}

@Injectable({ providedIn: 'root' })
export class SessionService {
  private api = inject(ApiService);

  list(filters?: { branchId?: string; classId?: string; roomId?: string }): Observable<Session[]> {
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

  end(id: string, notes?: string, endDate?: string): Observable<Session> {
    return this.api.patch<Session>(`sessions/${id}/end`, { notes, endDate });
  }
}
