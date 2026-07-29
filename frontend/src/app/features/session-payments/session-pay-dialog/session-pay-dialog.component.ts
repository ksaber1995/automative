import { Component, EventEmitter, Output, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';

import { SessionPaymentsService } from '../session-payments.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ReceiptService } from '../../../core/services/receipt.service';
import { AmountPipe } from '../../../shared/pipes/amount.pipe';
import { SessionPaymentWithDetails } from '@shared/interfaces/session-payment.interface';

/**
 * Reusable pay-confirmation popup for PER_SESSION attendance. Feed it the charges
 * returned by the attendance endpoints via `enqueue()`. It shows one PENDING
 * charge at a time (Pay / Skip), and toasts COVERED charges.
 *
 * When the course offers prepaid packages, the dialog has two modes the cashier
 * can toggle between: pay THIS session, or buy the next N-session package
 * (which also back-covers this pending charge). Returning package customers
 * (their previous bundle ran out) default to the package mode.
 */
@Component({
  selector: 'app-session-pay-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, TranslateModule,
    DialogModule, ButtonModule, InputNumberModule, DatePickerModule, TextareaModule,
    AmountPipe,
  ],
  templateUrl: './session-pay-dialog.component.html',
})
export class SessionPayDialogComponent {
  private service = inject(SessionPaymentsService);
  private notify = inject(NotificationService);
  private receiptService = inject(ReceiptService);
  private translate = inject(TranslateService);

  /** Emitted after a charge is settled (paid or covered by a package). */
  @Output() settled = new EventEmitter<void>();

  queue = signal<SessionPaymentWithDetails[]>([]);
  current = computed(() => this.queue()[0] ?? null);
  currentName = computed(() => {
    const c = this.current();
    return c ? `${c.studentName}` : '';
  });
  visible = signal(false);

  /** SESSION = pay this one session; PACKAGE = buy the next prepaid bundle. */
  mode = signal<'SESSION' | 'PACKAGE'>('SESSION');
  amount = signal<number | null>(null);
  payDate = signal<Date>(new Date());
  notes = signal('');
  submitting = signal(false);

  /**
   * Enqueue charges from an attendance response. PENDING charges open the dialog;
   * COVERED charges (paid by a prepaid package) just show an info toast.
   */
  enqueue(charges: (SessionPaymentWithDetails | null | undefined)[]): void {
    const pending: SessionPaymentWithDetails[] = [];
    for (const c of charges) {
      if (!c) continue;
      if (c.paymentStatus === 'COVERED') {
        const remaining = c.packageRemaining;
        this.notify.info(
          this.translate.instant('SESSION_PAYMENTS.COVERED_TOAST', {
            name: `${c.studentName}`,
            remaining: remaining != null ? remaining : '',
          })
        );
      } else if (c.paymentStatus === 'PENDING') {
        pending.push(c);
      }
    }
    if (pending.length) {
      this.queue.update(q => [...q, ...pending]);
      if (!this.visible()) this.loadCurrent();
    }
  }

  private loadCurrent(): void {
    const c = this.current();
    if (!c) { this.visible.set(false); return; }
    // Returning package customers (bought a bundle before, now out of credit)
    // default to buying the next bundle; everyone else defaults to per-session.
    const packageMode = !!c.coursePackageSize && !!c.hadPackage;
    this.setMode(packageMode ? 'PACKAGE' : 'SESSION', c);
    this.payDate.set(new Date());
    this.notes.set('');
    this.visible.set(true);
  }

  setMode(mode: 'SESSION' | 'PACKAGE', charge?: SessionPaymentWithDetails): void {
    const c = charge ?? this.current();
    if (!c) return;
    this.mode.set(mode);
    // PACKAGE buys a fresh bundle, so it costs the whole package price.
    // SESSION settles what is still owed on THIS charge: a student who already
    // paid 50 of 100 is asked for 50, not 100 again. (The dashboard's package
    // top-up has always defaulted to the remainder — only this one didn't.)
    this.amount.set(mode === 'PACKAGE'
      ? (c.coursePackagePrice ?? 0)
      : Math.max(0, (c.amountDue ?? 0) - (c.amountPaid || 0)));
  }

  private advance(): void {
    this.queue.update(q => q.slice(1));
    if (this.current()) this.loadCurrent();
    else this.visible.set(false);
  }

  /** Leave the current charge as an unpaid due and move on. */
  skip(): void {
    this.advance();
  }

  /**
   * Confirm: pay this session, or buy the package (covers this charge too).
   * Printing is OPT-IN — most collections are never printed.
   */
  pay(print = false): void {
    if (this.mode() === 'PACKAGE') {
      this.buyPackage(print);
      return;
    }
    const c = this.current();
    if (!c || this.amount() == null) return;
    this.submitting.set(true);
    this.service.recordPayment(c.id, {
      amount: this.amount() as number,
      paymentDate: this.formatDate(this.payDate()),
      notes: this.notes() || undefined,
    }).subscribe({
      next: (res: any) => {
        this.submitting.set(false);
        this.notify.success(this.translate.instant('SESSION_PAYMENTS.PAY_SUCCESS'));
        this.settled.emit();
        if (print) this.receiptService.openPrint(res?.receipt);
        this.advance();
      },
      error: () => { this.submitting.set(false); },
    });
  }

  buyPackage(print = false): void {
    const c = this.current();
    if (!c) return;
    this.submitting.set(true);
    this.service.buyPackage({
      enrollmentId: c.enrollmentId,
      amount: this.amount() != null ? (this.amount() as number) : undefined,
      notes: this.notes() || undefined,
    }).subscribe({
      next: (res: any) => {
        this.submitting.set(false);
        this.notify.success(this.translate.instant('SESSION_PAYMENTS.PACKAGE_SUCCESS'));
        this.settled.emit();
        if (print) this.receiptService.openPrint(res?.receipt);
        this.advance();
      },
      error: () => { this.submitting.set(false); },
    });
  }

  onHide(): void {
    // Closing the dialog leaves remaining charges as dues.
    this.queue.set([]);
    this.visible.set(false);
  }

  private formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
