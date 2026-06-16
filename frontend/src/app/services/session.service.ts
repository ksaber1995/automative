import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Session {
  id: string;
  companyId: string;
  branchId: string;
  roomId: string;
  classId: string;
  sessionNumber: number | null;
  startDate: string;
  endDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  roomCode?: string;
  roomDescription?: string | null;
  className?: string;
  courseName?: string;
  branchName?: string;
  durationMinutes?: number | null;
}

export interface StartSessionDto {
  roomId: string;
  classId: string;
  branchId: string;
  notes?: string;
  sessionNumber?: number;
}

export interface EndSessionDto {
  notes?: string;
}

@Injectable({ providedIn: 'root' })
export class SessionService {
  private base = `${environment.apiUrl}/api/sessions`;

  constructor(private http: HttpClient) {}

  list(filters?: { branchId?: string; classId?: string; roomId?: string }): Observable<Session[]> {
    let params = new HttpParams();
    if (filters?.branchId) params = params.set('branchId', filters.branchId);
    if (filters?.classId) params = params.set('classId', filters.classId);
    if (filters?.roomId) params = params.set('roomId', filters.roomId);
    return this.http.get<Session[]>(this.base, { params });
  }

  listActive(branchId?: string): Observable<Session[]> {
    let params = new HttpParams();
    if (branchId) params = params.set('branchId', branchId);
    return this.http.get<Session[]>(`${this.base}/active`, { params });
  }

  getById(id: string): Observable<Session> {
    return this.http.get<Session>(`${this.base}/${id}`);
  }

  start(dto: StartSessionDto): Observable<Session> {
    return this.http.post<Session>(`${this.base}/start`, dto);
  }

  end(id: string, dto?: EndSessionDto): Observable<Session> {
    return this.http.patch<Session>(`${this.base}/${id}/end`, dto || {});
  }

  nextNumber(classId: string): Observable<{ sessionNumber: number }> {
    const params = new HttpParams().set('classId', classId);
    return this.http.get<{ sessionNumber: number }>(`${this.base}/next-number`, { params });
  }

  update(id: string, body: { sessionNumber?: number; notes?: string }): Observable<Session> {
    return this.http.patch<Session>(`${this.base}/${id}`, body);
  }
}
