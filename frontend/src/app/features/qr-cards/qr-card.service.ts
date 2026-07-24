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
  /** When this card went to the printer; null = still waiting to be printed. */
  printedAt?: string | null;
  printed?: boolean;
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

  list(status?: 'free' | 'linked' | 'unprinted' | 'printed'): Observable<QrCard[]> {
    return this.api.get<QrCard[]>('qr-cards', status ? { status } : undefined);
  }

  /**
   * Stamp a print run as sent to the printer. Always pass the exact ids that were
   * downloaded — omitting them marks everything currently unprinted, which would
   * wrongly swallow any cards generated since the download.
   */
  markPrinted(ids: string[]): Observable<{ marked: number }> {
    return this.api.post<{ marked: number }>('qr-cards/mark-printed', { ids });
  }

  /** Undo a mark, for a run that never actually reached the printer. */
  unmarkPrinted(ids: string[]): Observable<{ marked: number }> {
    return this.api.post<{ marked: number }>('qr-cards/unmark-printed', { ids });
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
