import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Room {
  id: string;
  companyId: string;
  branchId: string;
  code: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  branchName?: string;
  isOccupied?: boolean;
  activeSession?: {
    id: string;
    classId: string;
    className: string;
    startDate: string;
  } | null;
}

export interface CreateRoomDto {
  branchId: string;
  code: string;
  description?: string;
}

export interface UpdateRoomDto {
  code?: string;
  description?: string;
  isActive?: boolean;
}

@Injectable({ providedIn: 'root' })
export class RoomService {
  private base = `${environment.apiUrl}/api/rooms`;

  constructor(private http: HttpClient) {}

  list(branchId?: string): Observable<Room[]> {
    let params = new HttpParams();
    if (branchId) params = params.set('branchId', branchId);
    return this.http.get<Room[]>(this.base, { params });
  }

  listActive(branchId?: string): Observable<Room[]> {
    let params = new HttpParams();
    if (branchId) params = params.set('branchId', branchId);
    return this.http.get<Room[]>(`${this.base}/active`, { params });
  }

  getById(id: string): Observable<Room> {
    return this.http.get<Room>(`${this.base}/${id}`);
  }

  create(dto: CreateRoomDto): Observable<Room> {
    return this.http.post<Room>(this.base, dto);
  }

  update(id: string, dto: UpdateRoomDto): Observable<Room> {
    return this.http.patch<Room>(`${this.base}/${id}`, dto);
  }

  delete(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.base}/${id}`);
  }
}
