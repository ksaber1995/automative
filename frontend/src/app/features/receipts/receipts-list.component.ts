import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { InputTextModule } from 'primeng/inputtext';
import { TranslateModule } from '@ngx-translate/core';
import { AmountPipe } from '../../shared/pipes/amount.pipe';
import { ApiService } from '../../core/services/api.service';
import { ReceiptService } from '../../core/services/receipt.service';
import { PaymentReceipt } from '../public/receipt/receipt.component';

/**
 * Every receipt this tenant has issued, newest first — the reprint desk.
 *
 * A slip gets lost, or a payment was confirmed without printing (the common
 * case, since printing is the deliberate button). This finds it again and
 * prints the SAME receipt: same number, same QR, same frozen snapshot. It never
 * mints a new one, so reprinting can't inflate the numbering or produce two
 * different-looking slips for one payment.
 */
@Component({
  selector: 'app-receipts-list',
  standalone: true,
  imports: [
    CommonModule, FormsModule, CardModule, TableModule, ButtonModule,
    TagModule, TooltipModule, InputTextModule, TranslateModule, AmountPipe,
  ],
  templateUrl: './receipts-list.component.html',
})
export class ReceiptsListComponent implements OnInit {
  private api = inject(ApiService);
  private receiptService = inject(ReceiptService);

  items = signal<PaymentReceipt[]>([]);
  loading = signal(true);
  search = '';

  ngOnInit() { this.load(); }

  load() {
    this.loading.set(true);
    const params: any = {};
    if (this.search.trim()) params.search = this.search.trim();
    this.api.get<PaymentReceipt[]>('receipts', params).subscribe({
      next: (rows) => { this.items.set(rows); this.loading.set(false); },
      error: () => { this.loading.set(false); },
    });
  }

  clearSearch() {
    if (!this.search) return;
    this.search = '';
    this.load();
  }

  /** Reprint: same receipt, same number, same QR. */
  print(r: PaymentReceipt) {
    this.receiptService.openPrint(r);
  }

  /** Open the receipt without going to the printer — what the QR resolves to. */
  view(r: PaymentReceipt) {
    window.open(`/r/${r.publicToken}`, '_blank');
  }

  kindKey(r: PaymentReceipt): string { return `RECEIPT.KIND.${r.sourceType}`; }

  statusSeverity(r: PaymentReceipt): 'success' | 'warn' | 'danger' {
    if (r.voidedAt) return 'danger';
    return r.isFullPayment ? 'success' : 'warn';
  }

  statusKey(r: PaymentReceipt): string {
    if (r.voidedAt) return 'RECEIPT.VOIDED';
    return r.isFullPayment ? 'RECEIPT.PAID_IN_FULL' : 'RECEIPT.PARTIAL';
  }
}
