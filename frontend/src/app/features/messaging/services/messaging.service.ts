import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';

export interface MessagingSettings {
  messagingStatus: 'DISABLED' | 'PENDING' | 'ACTIVE' | 'REJECTED' | 'REVOKED';
  absenceWarningThreshold: number;
  autoSendAbsence: boolean;
  autoSendPaymentDelay: boolean;
  autoSendAbsenceWarning: boolean;
  autoSendExamResults: boolean;
}

export interface MessagingQuota {
  month: string;
  messagesSent: number;
  quotaLimit: number;
  activatedStudents: number;
}

export interface MessageLogItem {
  id: string;
  type: string;
  recipientPhone: string;
  recipientName: string;
  studentId: string;
  body: string;
  status: string;
  sentAt: string;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class MessagingService {
  private api = inject(ApiService);

  getSettings(): Observable<MessagingSettings> {
    return this.api.get<MessagingSettings>('messaging/settings');
  }

  updateSettings(body: Partial<MessagingSettings>): Observable<{ message: string }> {
    return this.api.put<{ message: string }>('messaging/settings', body);
  }

  requestActivation(): Observable<{ messagingStatus: string }> {
    return this.api.post<{ messagingStatus: string }>('messaging/request', {});
  }

  getQuota(): Observable<MessagingQuota> {
    return this.api.get<MessagingQuota>('messaging/quota');
  }

  send(type: string, studentId: string, variables?: Record<string, string>): Observable<{ message: string; logId: string }> {
    return this.api.post<{ message: string; logId: string }>('messaging/send', { type, studentId, variables });
  }

  sendBulk(type: string, studentIds: string[], variables?: Record<string, string>): Observable<{ sent: number; skipped: number; failed: number }> {
    return this.api.post<{ sent: number; skipped: number; failed: number }>('messaging/send-bulk', { type, studentIds, variables });
  }

  listLog(filters?: { type?: string; status?: string; limit?: number; offset?: number }): Observable<{ items: MessageLogItem[]; total: number }> {
    return this.api.get<{ items: MessageLogItem[]; total: number }>('messaging/log', filters);
  }
}
