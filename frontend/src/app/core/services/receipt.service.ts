import { Injectable } from '@angular/core';

/** The receipt stub every payment response carries when a slip was issued. */
export interface ReceiptStub {
  id: string;
  receiptNumber: number;
  publicToken: string;
}

@Injectable({ providedIn: 'root' })
export class ReceiptService {
  /**
   * Open a receipt and go straight to the printer.
   *
   * A new tab rather than an in-page dialog: `window.print()` prints the WHOLE
   * document, so printing from a dialog would put the dashboard behind it on the
   * paper. The receipt page owns the print stylesheet and nothing else is on it.
   *
   * Same URL the QR encodes, so the slip and the scan always agree.
   */
  openPrint(receipt: ReceiptStub | null | undefined): void {
    if (!receipt?.publicToken) return;
    window.open(`/r/${receipt.publicToken}?print=1`, '_blank');
  }

  /** The shareable link for a receipt (no auto-print) — what the QR resolves to. */
  url(receipt: ReceiptStub | null | undefined): string {
    if (!receipt?.publicToken) return '';
    return `${window.location.origin}/r/${receipt.publicToken}`;
  }
}
