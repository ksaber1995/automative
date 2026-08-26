import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

/** The receipt stub every payment response carries when a slip was issued. */
export interface ReceiptStub {
  id: string;
  receiptNumber: number;
  publicToken: string;
}

/** Which kind of money a receipt was issued against — mirrors ReceiptSource on the API. */
export type ReceiptSourceType = 'MONTHLY' | 'SESSION' | 'PACKAGE' | 'ENROLLMENT' | 'MASTER';

@Injectable({ providedIn: 'root' })
export class ReceiptService {
  private api = inject(ApiService);

  /**
   * The receipts already issued for one payment, newest first.
   *
   * Reprinting always goes through this: it returns the SAME slip — same
   * number, same QR, same frozen snapshot — so asking for a receipt twice can
   * never mint a second one. An empty array means none was ever issued (the
   * payment predates receipts, or printing was skipped), which the caller
   * reports rather than papering over.
   */
  bySource(sourceType: ReceiptSourceType, sourceId: string): Observable<ReceiptStub[]> {
    return this.api.get<ReceiptStub[]>('receipts', { sourceType, sourceId });
  }

  /**
   * Open a receipt and go straight to the printer — or straight to the PDF.
   *
   * A new tab rather than an in-page dialog: `window.print()` prints the WHOLE
   * document, so printing from a dialog would put the dashboard behind it on the
   * paper. The receipt page owns the print stylesheet and nothing else is on it.
   *
   * Same URL the QR encodes, so the slip and the scan always agree. 'download'
   * lands on the same page but auto-saves the PDF copy instead of opening the
   * print dialog — the digital slip to send over WhatsApp instead of paper.
   */
  open(receipt: ReceiptStub | null | undefined, mode: 'print' | 'download'): void {
    if (!receipt?.publicToken) return;
    window.open(`/r/${receipt.publicToken}?${mode === 'download' ? 'download=1' : 'print=1'}`, '_blank');
  }

  openPrint(receipt: ReceiptStub | null | undefined): void {
    this.open(receipt, 'print');
  }

  openDownload(receipt: ReceiptStub | null | undefined): void {
    this.open(receipt, 'download');
  }

  /** The shareable link for a receipt (no auto-print) — what the QR resolves to. */
  url(receipt: ReceiptStub | null | undefined): string {
    if (!receipt?.publicToken) return '';
    return `${window.location.origin}/r/${receipt.publicToken}`;
  }
}
