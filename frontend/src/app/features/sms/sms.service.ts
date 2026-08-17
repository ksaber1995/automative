import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/services/api.service';

/** Whether this tenant may send, and what they have spent this month. */
export interface SmsStatus {
  /** Entitled AND not expired. The only flag the UI should branch on. */
  active: boolean;
  activated: boolean;
  expiration: string | null;
  sentThisMonth: number;
  /** Billable segments — Arabic doubles these for the same wording. */
  segmentsThisMonth: number;
}

export interface SmsTemplate {
  type: string;
  /** Send this kind automatically. */
  enabled: boolean;
  body: string;
  /** Still the shipped wording — nobody has edited it. */
  isDefault: boolean;
  segments: number;
  unicode: boolean;
  length: number;
}

export interface SmsMessage {
  id: string;
  type: string;
  toPhone: string;
  body: string;
  segments: number;
  status: 'SENT' | 'FAILED' | string;
  error: string | null;
  studentName: string | null;
  createdAt: string | null;
}

export interface SmsSendResult {
  sent: number;
  failed: number;
  results: { studentId: string; name: string; sent: boolean; message: string }[];
}

@Injectable({ providedIn: 'root' })
export class SmsService {
  private api = inject(ApiService);

  getStatus(): Observable<SmsStatus> {
    return this.api.get<SmsStatus>('sms/status');
  }

  getSettings(): Observable<{ templates: SmsTemplate[] }> {
    return this.api.get<{ templates: SmsTemplate[] }>('sms/settings');
  }

  updateSettings(
    templates: { type: string; enabled?: boolean; body?: string | null }[],
  ): Observable<{ templates: SmsTemplate[] }> {
    return this.api.put<{ templates: SmsTemplate[] }>('sms/settings', { templates });
  }

  send(studentIds: string[], body: string, toParent: boolean): Observable<SmsSendResult> {
    return this.api.post<SmsSendResult>('sms/send', { studentIds, body, toParent });
  }

  listMessages(limit = 100): Observable<{ messages: SmsMessage[] }> {
    return this.api.get<{ messages: SmsMessage[] }>(`sms/messages?limit=${limit}`);
  }
}
