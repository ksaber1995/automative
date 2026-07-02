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
import { AmountPipe } from '../../../shared/pipes/amount.pipe';
import { SessionPaymentWithDetails } from '@shared/interfaces/session-payment.interface';

/**
 * Reusable pay-confirmation popup for PER_SESSION attendance. Feed it the charges
 * returned by the attendance endpoints via `enqueue()`. It shows one PENDING
 * charge at a time (Pay / Skip, or Buy package), and toasts COVERED charges.
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
  private translate = inject(TranslateService);

  /** Emitted after a charge is settled (paid or covered by a package). */
  @Output() settled = new EventEmitter<void>();

  queue = signal<SessionPaymentWithDetails[]>([]);
  current = computed(() => this.queue()[0] ?? null);
  currentName = computed(() => {
    const c = this.current();
    return c ? `${c.studentFirstName} ${c.studentLastName}` : '';
  });
  visible = signal(false);

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
            name: `${c.studentFirstName} ${c.studentLastName}`,
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
    this.amount.set(c.amountDue);
    this.payDate.set(new Date());
    this.notes.set('');
    this.visible.set(true);
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

  pay(): void {
    const c = this.current();
    if (!c || this.amount() == null) return;
    this.submitting.set(true);
    this.service.recordPayment(c.id, {
      amount: this.amount() as number,
      paymentDate: this.formatDate(this.payDate()),
      notes: this.notes() || undefined,
    }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.notify.success(this.translate.instant('SESSION_PAYMENTS.PAY_SUCCESS'));
        this.settled.emit();
        this.advance();
      },
      error: () => { this.submitting.set(false); },
    });
  }

  buyPackage(): void {
    const c = this.current();
    if (!c) return;
    this.submitting.set(true);
    this.service.buyPackage({ enrollmentId: c.enrollmentId }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.notify.success(this.translate.instant('SESSION_PAYMENTS.PACKAGE_SUCCESS'));
        this.settled.emit();
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
