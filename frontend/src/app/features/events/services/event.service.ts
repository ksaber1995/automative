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

  // ─── Event subscriptions ──────────────────────────────────────────────────
  listSubscriptions(eventId: string): Observable<EventSubscription[]> {
    return this.api.get<EventSubscription[]>(`events/${eventId}/subscriptions`);
  }

  createSubscription(eventId: string, dto: EventSubscriptionCreateDto): Observable<EventSubscription> {
    return this.api.post<EventSubscription>(`events/${eventId}/subscriptions`, dto);
  }

  deleteSubscription(id: string): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`events/subscriptions/${id}`);
  }

  // ─── Event expenses (read) ────────────────────────────────────────────────
  listExpenses(eventId: string): Observable<EventExpense[]> {
    return this.api.get<EventExpense[]>(`events/${eventId}/expenses`);
  }

  // ─── Event refunds ────────────────────────────────────────────────────────
  listRefunds(eventId: string): Observable<EventRefund[]> {
    return this.api.get<EventRefund[]>(`events/${eventId}/refunds`);
  }

  createRefund(eventId: string, dto: EventRefundCreateDto): Observable<EventRefund> {
    return this.api.post<EventRefund>(`events/${eventId}/refunds`, dto);
  }
}

export interface EventSubscription {
  id: string;
  companyId: string;
  eventId: string;
  branchId: string | null;
  studentId: string | null;
  studentName: string | null;
  externalFirstName: string | null;
  externalLastName: string | null;
  externalAge: number | null;
  externalMobile: string | null;
  amount: number;
  paymentDate: string;
  paymentMethod: string | null;
  notes: string | null;
  revenueId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventSubscriptionCreateDto {
  studentId?: string | null;
  externalFirstName?: string;
  externalLastName?: string;
  externalAge?: number;
  externalMobile?: string;
  amount: number;
  paymentDate: string;
  paymentMethod?: string;
  notes?: string;
}

export interface EventExpense {
  id: string;
  eventId: string;
  branchId: string | null;
  type: string;
  category: string;
  amount: number;
  description: string | null;
  date: string;
  vendor: string | null;
  invoiceNumber: string | null;
  notes: string | null;
  totalPaid: number;
  paymentCount: number;
  createdAt: string;
}

export interface EventRefund {
  id: string;
  eventId: string;
  studentId: string | null;
  studentName: string | null;
  amount: number;
  refundDate: string;
  type: 'FULL' | 'PARTIAL';
  reason: string | null;
  createdAt: string;
}

export interface EventRefundCreateDto {
  amount: number;
  refundDate: string;
  type?: 'FULL' | 'PARTIAL';
  reason?: string;
  studentId?: string | null;
}
