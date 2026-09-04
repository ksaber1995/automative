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

/** One ask for a new run of cards, and where the vendor's decision stands. */
export interface QrCardRequest {
  id: string;
  count: number;
  notes: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'REFUSED';
  createdAt: string;
  decidedAt: string | null;
}

@Injectable({ providedIn: 'root' })
export class QrCardService {
  private api = inject(ApiService);

  list(status?: 'free' | 'linked' | 'unprinted' | 'printed'): Observable<QrCard[]> {
    return this.api.get<QrCard[]>('qr-cards', status ? { status } : undefined);
  }

  /**
   * Ask the vendor for a new run of cards. Minting, printing and print tracking
   * all live on the vendor side now — the tenant's only lever is this request,
   * and the server allows one PENDING ask at a time (409 REQUEST_PENDING).
   */
  requestCards(count: number, notes: string | null): Observable<QrCardRequest> {
    return this.api.post<QrCardRequest>('qr-cards/requests', { count, notes });
  }

  /** The tenant's own asks, newest first, so the page can show where each stands. */
  listRequests(): Observable<QrCardRequest[]> {
    return this.api.get<QrCardRequest[]>('qr-cards/requests');
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

  /**
   * "Are you nearly out of cards?" — the pool page downloads the whole pool to
   * count it, which is far too much for a nudge on every page load, and is
   * vendor-only anyway. This is three numbers.
   *
   * `warn` is decided by the server (both switches plus the threshold), so no
   * caller re-implements the rule.
   */
  poolStatus(): Observable<CardPoolStatus> {
    return this.api.get<CardPoolStatus>('qr-cards/pool-status');
  }
}

/** What the tenant is told about their own pool. No card data, just counts. */
export interface CardPoolStatus {
  /** The only flag to branch on: the nudge is on for them AND they are low. */
  warn: boolean;
  /** Cards nobody holds yet — what is left to give out. */
  remaining: number;
  threshold: number;
  /** The nudge is switched on for this tenant (whether or not they are low). */
  enabled: boolean;
}
