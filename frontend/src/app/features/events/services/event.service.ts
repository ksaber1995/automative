import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import {
  EventModel,
  EventCreateDto,
  EventUpdateDto,
  EventPL,
} from '@shared/interfaces/event.interface';

@Injectable({ providedIn: 'root' })
export class EventService {
  private api = inject(ApiService);

  getAll(filters?: { branchId?: string; status?: string }): Observable<EventModel[]> {
    return this.api.get<EventModel[]>('events', filters);
  }

  getById(id: string): Observable<EventModel> {
    return this.api.get<EventModel>(`events/${id}`);
  }

  create(dto: EventCreateDto): Observable<EventModel> {
    return this.api.post<EventModel>('events', dto);
  }

  update(id: string, dto: EventUpdateDto): Observable<EventModel> {
    return this.api.patch<EventModel>(`events/${id}`, dto);
  }

  delete(id: string): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`events/${id}`);
  }

  getPL(id: string): Observable<EventPL> {
    return this.api.get<EventPL>(`events/${id}/pl`);
  }
}
