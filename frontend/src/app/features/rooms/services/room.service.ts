import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';

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
  private api = inject(ApiService);

  list(branchId?: string): Observable<Room[]> {
    return this.api.get<Room[]>('rooms', branchId ? { branchId } : undefined);
  }

  listActive(branchId?: string): Observable<Room[]> {
    return this.api.get<Room[]>('rooms/active', branchId ? { branchId } : undefined);
  }

  getById(id: string): Observable<Room> {
    return this.api.get<Room>(`rooms/${id}`);
  }

  create(dto: CreateRoomDto): Observable<Room> {
    return this.api.post<Room>('rooms', dto);
  }

  update(id: string, dto: UpdateRoomDto): Observable<Room> {
    return this.api.patch<Room>(`rooms/${id}`, dto);
  }

  delete(id: string): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`rooms/${id}`);
  }
}
