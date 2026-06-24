import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/services/api.service';

export type TelegramNotifyTarget = 'STUDENT' | 'PARENT' | 'BOTH';

export interface TelegramSettings {
  enabled: boolean;
  botConfigured: boolean;
  botUsername: string | null;
  notifyOnPresent: boolean;
  notifyOnAbsent: boolean;
  notifyTarget: TelegramNotifyTarget;
}

export interface TelegramSettingsWithTemplates extends TelegramSettings {
  templates: Record<string, string>;
}

export interface StudentTelegramLink {
  botConfigured: boolean;
  studentUrl: string | null;
  parentUrl: string | null;
  studentLinked: boolean;
  parentLinked: boolean;
}

@Injectable({ providedIn: 'root' })
export class TelegramService {
  private api = inject(ApiService);

  getSettings(): Observable<TelegramSettingsWithTemplates> {
    return this.api.get<TelegramSettingsWithTemplates>('telegram/settings');
  }

  updateSettings(patch: Partial<Pick<TelegramSettings, 'enabled' | 'notifyOnPresent' | 'notifyOnAbsent' | 'notifyTarget'>>): Observable<TelegramSettings> {
    return this.api.patch<TelegramSettings>('telegram/settings', patch);
  }

  updateTemplates(templates: Record<string, string>): Observable<{ templates: Record<string, string> }> {
    return this.api.put<{ templates: Record<string, string> }>('telegram/templates', { templates });
  }

  /** Save the bot token, register the webhook, and enable the bot. */
  setBot(botToken: string): Observable<TelegramSettings> {
    return this.api.post<TelegramSettings>('telegram/bot', { botToken });
  }

  /** One-click: claim a platform-owned bot from the pool and enable Telegram. */
  enableWithPooledBot(): Observable<TelegramSettings> {
    return this.api.post<TelegramSettings>('telegram/enable', {});
  }

  /** Disconnect the current bot (releases a pooled bot) so a teacher can use their own. */
  disconnect(): Observable<TelegramSettings> {
    return this.api.post<TelegramSettings>('telegram/disconnect', {});
  }

  getStudentLink(studentId: string): Observable<StudentTelegramLink> {
    return this.api.get<StudentTelegramLink>(`telegram/link/student/${studentId}`);
  }

  getStaffLink(employeeId: string): Observable<{ botConfigured: boolean; url: string | null; linked: boolean }> {
    return this.api.get<{ botConfigured: boolean; url: string | null; linked: boolean }>(`telegram/link/staff/${employeeId}`);
  }
}
