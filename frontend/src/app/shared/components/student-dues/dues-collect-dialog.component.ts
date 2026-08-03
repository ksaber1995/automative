import { Component, EventEmitter, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AmountPipe } from '../../pipes/amount.pipe';
import { SessionDueItem, StudentSessionDues } from '../../../features/rooms/services/attendance.service';
import { MonthlySubscriptionsService } from '../../../features/monthly-subscriptions/monthly-subscriptions.service';
import { SessionPaymentsService } from '../../../features/session-payments/session-payments.service';
import { EnrollmentService } from '../../../features/enrollments/services/enrollment.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ReceiptService } from '../../../core/services/receipt.service';
import { toLocalYmd } from '../../../core/utils/date.util';
import { dueItemLabel } from './student-dues.util';

/**
 * Collect a student's outstanding money at the door, from an attendance roster.
 * `open()` it with what the dues endpoint reported; it settles the OLDEST item
 * and emits `collected` so the host can reload — pay again for the next one.
 *
 * The payment itself goes through the same endpoints the dedicated pages use, so
 * receipts, the installment ledger and the revenue reads behave identically. A
 * monthly month with no stored bill goes through /collect, which materialises
 * the row and pays it in one call.
 */
@Component({
  selector: 'app-dues-collect-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, TranslateModule,
    DialogModule, ButtonModule, InputNumberModule, DatePickerModule, TextareaModule,
    AmountPipe,
  ],
  template: `
    <p-dialog
      [visible]="visible()"
      (visibleChange)="$event ? null : close()"
      [modal]="true"
      [draggable]="false"
      [style]="{ width: '26rem', maxWidth: '95vw' }"
      [header]="'SESSION_ATTENDANCE.COLLECT_TITLE' | translate: { name: studentName() }"
    >
      @if (item(); as it) {
        <div class="space-y-3 pt-1">
          <div class="flex justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
            <span class="text-gray-600">
              {{ 'SESSION_ATTENDANCE.COLLECT_FOR' | translate }}
              @if (label(it)) { <span class="font-medium text-gray-800">{{ label(it) }}</span> }
            </span>
            <span class="font-semibold">{{ it.amount | amount }}</span>
          </div>
          @if (itemCount() > 1) {
            <p class="text-xs text-gray-500">
              {{ 'SESSION_ATTENDANCE.COLLECT_OLDEST_HINT' | translate: { count: itemCount() } }}
            </p>
          }

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'SESSION_ATTENDANCE.COLLECT_AMOUNT' | translate }}</label>
            <p-inputnumber [(ngModel)]="amount" [min]="0" [max]="it.amount" [style]="{ width: '100%' }" [inputStyle]="{ width: '100%' }"></p-inputnumber>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'SESSION_ATTENDANCE.COLLECT_DATE' | translate }}</label>
            <p-datepicker [(ngModel)]="payDate" [showIcon]="true" dateFormat="yy-mm-dd" [style]="{ width: '100%' }" appendTo="body"></p-datepicker>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'SESSION_ATTENDANCE.COLLECT_NOTES' | translate }}</label>
            <textarea pTextarea [(ngModel)]="notes" rows="2" class="w-full"></textarea>
          </div>
        </div>
      }

      <ng-template pTemplate="footer">
        <!-- Its own key, not the un-check dialog's "Keep present": dismissing a
             collection is skipping the payment, and says nothing about attendance. -->
        <p-button [label]="'SESSION_ATTENDANCE.COLLECT_SKIP' | translate" [text]="true" severity="secondary" (onClick)="close()"></p-button>
        <p-button [label]="'SESSION_ATTENDANCE.COLLECT_PRINT' | translate" icon="pi pi-print" [outlined]="true"
          [disabled]="!amount || submitting()" (onClick)="submit(true)"></p-button>
        <p-button [label]="'SESSION_ATTENDANCE.COLLECT_CONFIRM' | translate" icon="pi pi-check"
          [loading]="submitting()" [disabled]="!amount" (onClick)="submit()"></p-button>
      </ng-template>
    </p-dialog>
  `,
})
export class DuesCollectDialogComponent {
  private monthlySubs = inject(MonthlySubscriptionsService);
  private sessionPayments = inject(SessionPaymentsService);
  private enrollmentService = inject(EnrollmentService);
  private notify = inject(NotificationService);
  private receiptService = inject(ReceiptService);
  private translate = inject(TranslateService);

  /** A payment was recorded — the host reloads its dues. */
  @Output() collected = new EventEmitter<void>();

  visible = signal(false);
  studentName = signal('');
  item = signal<SessionDueItem | null>(null);
  itemCount = signal(0);
  amount: number | null = null;
  payDate: Date = new Date();
  notes = '';
  submitting = signal(false);

  label = (it: SessionDueItem) => dueItemLabel(it, this.translate);

  /** Open on the oldest of this student's outstanding items. */
  open(studentName: string, dues: StudentSessionDues | undefined): void {
    const oldest = dues?.items?.[0];
    if (!oldest) return;
    this.studentName.set(studentName);
    this.item.set(oldest);
    this.itemCount.set(dues!.items.length);
    this.amount = parseFloat(oldest.amount.toFixed(2));
    this.payDate = new Date();
    this.notes = '';
    this.visible.set(true);
  }

  close(): void {
    this.visible.set(false);
    this.item.set(null);
  }

  submit(print = false): void {
    const it = this.item();
    const amount = this.amount;
    if (!it || !amount || amount <= 0 || this.submitting()) return;
    const paymentDate = toLocalYmd(this.payDate);
    const notes = this.notes || undefined;

    let req$;
    if (it.kind === 'MONTHLY') {
      req$ = it.paymentId
        ? this.monthlySubs.recordPayment(it.paymentId, { amount, paymentDate, notes })
        : this.monthlySubs.collect({
            enrollmentId: it.enrollmentId,
            billingYear: it.billingYear!,
            billingMonth: it.billingMonth!,
            amount,
            paymentDate,
            notes,
          });
    } else if (it.kind === 'SESSION') {
      req$ = this.sessionPayments.recordPayment(it.paymentId!, { amount, paymentDate, notes });
    } else {
      req$ = this.enrollmentService.addPayment(it.enrollmentId, { amount, paymentDate, notes });
    }

    this.submitting.set(true);
    req$.subscribe({
      next: (res: any) => {
        this.submitting.set(false);
        this.close();
        this.notify.success(this.translate.instant('SESSION_ATTENDANCE.DUES_PAID'));
        this.collected.emit();
        if (print) this.receiptService.openPrint(res?.receipt);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.submitting.set(false);
      },
    });
  }
}
