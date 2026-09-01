import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';

export interface WaAccount {
  status: 'NOT_CONNECTED' | 'CONNECTING' | 'ACTIVE' | 'ERROR' | string;
  wabaId: string | null;
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  connectedAt: string | null;
}

export interface WaSettings {
  autoSendOnCheckin: boolean;
  autoSendOnAbsence: boolean;
  absenceWarningThreshold: number;
  autoSendAbsenceWarning: boolean;
  crmAutoOutreach: boolean;
  crmAutoDrip: boolean;
  crmStopOnReply: boolean;
}

export interface WaTemplate {
  id: string;
  key: string;
  metaTemplateName: string | null;
  category: string;
  language: string;
  body: string;
  isActive: boolean;
}

export interface WaConversation {
  id: string;
  contactPhone: string;
  contactName: string | null;
  studentId: string | null;
  leadId: string | null;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  unreadCount: number;
}

export interface WaMessage {
  id: string;
  direction: 'OUT' | 'IN';
  type: string;
  templateKey: string | null;
  body: string | null;
  status: string | null;
  createdAt: string;
}

/** Canonical template keys a tenant can configure. */
export const WA_TEMPLATE_KEYS = [
  'CHECKIN', 'ABSENCE', 'ABSENCE_WARNING', 'PAYMENT_DELAY', 'EXAM_RESULTS',
  'CRM_OUTREACH', 'CRM_FOLLOWUP', 'CRM_REENGAGE',
];

/** Which keys are marketing (vs utility). */
export const WA_MARKETING_KEYS = ['CRM_OUTREACH', 'CRM_FOLLOWUP', 'CRM_REENGAGE'];

@Injectable({ providedIn: 'root' })
export class WhatsappService {
  private api = inject(ApiService);

  getAccount(): Observable<WaAccount> { return this.api.get<WaAccount>('wa/account'); }
  disconnect(): Observable<{ message: string; code: string }> { return this.api.post('wa/account/disconnect', {}); }

  getSettings(): Observable<WaSettings> { return this.api.get<WaSettings>('wa/settings'); }
  updateSettings(dto: Partial<WaSettings>): Observable<WaSettings> { return this.api.put<WaSettings>('wa/settings', dto); }

  listTemplates(): Observable<WaTemplate[]> { return this.api.get<WaTemplate[]>('wa/templates'); }
  upsertTemplate(key: string, dto: Partial<WaTemplate>): Observable<WaTemplate> { return this.api.put<WaTemplate>(`wa/templates/${key}`, dto); }

  listConversations(): Observable<WaConversation[]> { return this.api.get<WaConversation[]>('wa/conversations'); }
  getMessages(id: string): Observable<WaMessage[]> { return this.api.get<WaMessage[]>(`wa/conversations/${id}/messages`); }

  /** Ids for Meta's Embedded Signup dialog. 501 when the platform has no Meta app yet. */
  connectStart(): Observable<WaConnectConfig> { return this.api.post<WaConnectConfig>('wa/connect/start', {}); }

  /** Hand Meta's authorisation code to the API, which trades it for the tenant's token. */
  connectComplete(dto: { code: string; wabaId?: string; phoneNumberId?: string }): Observable<WaAccount> {
    return this.api.post<WaAccount>('wa/connect/complete', dto);
  }

  send(dto: WaSendRequest): Observable<WaMessage> { return this.api.post<WaMessage>('wa/send', dto); }

  /** May this tenant send the parent link from the PLATFORM (Netrofit) number? */
  parentLinkCapability(): Observable<{ available: boolean; reason: string | null }> {
    return this.api.get<{ available: boolean; reason: string | null }>('wa/parent-link');
  }

  /** Send the student's public-page link to the parent from the platform number. */
  sendParentLink(studentId: string): Observable<{ sent: boolean; messageId: string | null; to: string }> {
    return this.api.post<{ sent: boolean; messageId: string | null; to: string }>('wa/parent-link', { studentId });
  }
}

export interface WaConnectConfig {
  appId: string;
  configId: string;
  graphVersion: string;
}

export interface WaSendRequest {
  to?: string;
  text?: string;
  templateKey?: string;
  templateParams?: string[];
  studentId?: string;
  leadId?: string;
}
