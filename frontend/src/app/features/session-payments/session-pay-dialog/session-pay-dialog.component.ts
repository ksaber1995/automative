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

  /**
   * SESSION = pay this one session; PACKAGE = buy the NEXT prepaid bundle;
   * SETTLE = collect what is still owed on the bundle already covering this
   * session. SETTLE exists because COVERED stopped meaning "paid": a tenant
   * converted from monthly billing has unpaid bills that became unpaid bundles.
   */
  mode = signal<'SESSION' | 'PACKAGE' | 'SETTLE'>('SESSION');
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
        // A covered session is only settled if the bundle covering it was paid
        // for. When it was not, this student owes money and toasting "covered"
        // would tell the desk the opposite — so it goes in the queue instead.
        if (this.bundleOwes(c) > 0) {
          pending.push(c);
          continue;
        }
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

  /** What the bundle covering this charge still owes; 0 when it was paid upfront. */
  bundleOwes(c: SessionPaymentWithDetails): number {
    if (c.paymentStatus !== 'COVERED' || !c.packageId) return 0;
    return Math.max(0, (c.pkgAmountDue ?? 0) - (c.pkgAmountPaid ?? 0));
  }

  /** True while the open charge is covered by a bundle nobody has paid for. */
  settlingBundle = computed(() => {
    const c = this.current();
    return !!c && this.bundleOwes(c) > 0;
  });

  private loadCurrent(): void {
    const c = this.current();
    if (!c) { this.visible.set(false); return; }
    // An unpaid covering bundle is the only sensible thing to collect: the
    // session's own fee is already accounted for against it, so asking for the
    // fee would take the money twice.
    if (this.bundleOwes(c) > 0) {
      this.setMode('SETTLE', c);
      this.payDate.set(new Date());
      this.notes.set('');
      this.visible.set(true);
      return;
    }
    // Returning package customers (bought a bundle before, now out of credit)
    // default to buying the next bundle; everyone else defaults to per-session.
    const packageMode = !!c.coursePackageSize && !!c.hadPackage;
    this.setMode(packageMode ? 'PACKAGE' : 'SESSION', c);
    this.payDate.set(new Date());
    this.notes.set('');
    this.visible.set(true);
  }

  setMode(mode: 'SESSION' | 'PACKAGE' | 'SETTLE', charge?: SessionPaymentWithDetails): void {
    const c = charge ?? this.current();
    if (!c) return;
    this.mode.set(mode);
    // PACKAGE buys a fresh bundle, so it costs the whole package price.
    // SETTLE collects the balance of the bundle already covering this session.
    // SESSION settles what is still owed on THIS charge: a student who already
    // paid 50 of 100 is asked for 50, not 100 again. (The dashboard's package
    // top-up has always defaulted to the remainder — only this one didn't.)
    this.amount.set(
      mode === 'PACKAGE' ? (c.coursePackagePrice ?? 0)
      : mode === 'SETTLE' ? this.bundleOwes(c)
      : Math.max(0, (c.amountDue ?? 0) - (c.amountPaid || 0)),
    );
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
  pay(receiptMode: false | 'print' | 'download' = false): void {
    if (this.mode() === 'PACKAGE') {
      this.buyPackage(receiptMode);
      return;
    }
    if (this.mode() === 'SETTLE') {
      this.settleBundle(receiptMode);
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
        if (receiptMode) this.receiptService.open(res?.receipt, receiptMode);
        this.advance();
      },
      error: () => { this.submitting.set(false); },
    });
  }

  buyPackage(receiptMode: false | 'print' | 'download' = false): void {
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
        if (receiptMode) this.receiptService.open(res?.receipt, receiptMode);
        this.advance();
      },
      error: () => { this.submitting.set(false); },
    });
  }

  /**
   * Collect the outstanding balance of the bundle already covering this session,
   * rather than the session fee.
   *
   * The fee has already been booked against that bundle, so charging it here as
   * well would take the same money twice — once on the bundle and once on the
   * session. payPackage credits the bundle, which settles every session it
   * covers, including this one.
   */
  settleBundle(receiptMode: false | 'print' | 'download' = false): void {
    const c = this.current();
    if (!c || !c.packageId || this.amount() == null) return;
    this.submitting.set(true);
    this.service.payPackage(c.packageId, {
      amount: this.amount() as number,
      paymentDate: this.formatDate(this.payDate()),
      notes: this.notes() || undefined,
    }).subscribe({
      next: (res: any) => {
        this.submitting.set(false);
        this.notify.success(this.translate.instant('SESSION_PAYMENTS.PAY_SUCCESS'));
        this.settled.emit();
        if (receiptMode) this.receiptService.open(res?.receipt, receiptMode);
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
