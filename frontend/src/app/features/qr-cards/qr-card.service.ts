import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/services/api.service';

/** One pre-printed card: a QR (token) plus the serial printed on it. */
export interface QrCard {
  id: string;
  serial: number;
  token: string;
  studentId: string | null;
  studentName: string | null;
  studentCode: number | null;
  assignedAt: string | null;
  createdAt: string;
}

export interface QrCardLinkResult extends QrCard {
  /** True when that card was already on this student — nothing changed. */
  alreadyLinked: boolean;
}

@Injectable({ providedIn: 'root' })
export class QrCardService {
  private api = inject(ApiService);

  /** Mint a batch of blank cards, numbered on from the last print run. */
  generate(count: number): Observable<QrCard[]> {
    return this.api.post<QrCard[]>('qr-cards/generate', { count });
  }

  list(status?: 'free' | 'linked'): Observable<QrCard[]> {
    return this.api.get<QrCard[]>('qr-cards', status ? { status } : undefined);
  }

  /** Hand a card to a student: by scanned token, or by the serial printed on it. */
  link(studentId: string, by: { token?: string; serial?: number }): Observable<QrCardLinkResult> {
    return this.api.post<QrCardLinkResult>('qr-cards/link', { studentId, ...by });
  }

  /** Put a card back in the pool (lost, or given to the wrong person). */
  unlink(id: string): Observable<QrCard> {
    return this.api.post<QrCard>(`qr-cards/${id}/unlink`, {});
  }

  byStudent(studentId: string): Observable<QrCard[]> {
    return this.api.get<QrCard[]>(`qr-cards/student/${studentId}`);
  }
}
