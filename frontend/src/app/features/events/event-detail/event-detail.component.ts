import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DividerModule } from 'primeng/divider';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { RadioButtonModule } from 'primeng/radiobutton';
import { CheckboxModule } from 'primeng/checkbox';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  EventService,
  EventSubscription,
  EventExpense,
  EventRefund,
} from '../services/event.service';
import { StudentService } from '../../students/services/student.service';
import { ExpenseService } from '../../expenses/services/expense.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { EventModel, EventPL } from '@shared/interfaces/event.interface';
import { Student } from '@shared/interfaces/student.interface';
import { ExpenseCategory, ExpenseType } from '@shared/enums/expense-type.enum';

@Component({
  selector: 'app-event-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    TagModule,
    DividerModule,
    TableModule,
    DialogModule,
    InputTextModule,
    InputNumberModule,
    TextareaModule,
    SelectModule,
    DatePickerModule,
    RadioButtonModule,
    CheckboxModule,
    TooltipModule,
    ConfirmDialogModule,
    TranslateModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './event-detail.component.html',
  styles: [],
})
export class EventDetailComponent implements OnInit {
  private service = inject(EventService);
  private studentService = inject(StudentService);
  private expenseService = inject(ExpenseService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private notifications = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);

  id!: string;
  event = signal<EventModel | null>(null);
  pl = signal<EventPL | null>(null);

  // Cancelled events are read-only: no new subscriptions, refunds, or expenses.
  isCancelled = computed(() => this.event()?.status === 'CANCELLED');

  subscriptions = signal<EventSubscription[]>([]);
  expenses = signal<EventExpense[]>([]);
  refunds = signal<EventRefund[]>([]);

  // Lookup
  students = signal<Student[]>([]);
  studentOptions = signal<{ label: string; value: string }[]>([]);

  // Dialogs
  showSubscriptionDialog = false;
  showExpenseDialog = false;
  showRefundDialog = false;

  // Subscription form
  subType: 'STUDENT' | 'EXTERNAL' = 'STUDENT';
  subStudentId: string | null = null;
  subFirstName = '';
  subLastName = '';
  subAge: number | null = null;
  subMobile = '';
  subAmount: number | null = null;
  subPaymentDate: Date = new Date();
  subPaymentMethod: string | null = null;
  subNotes = '';

  // Expense form
  expCategory: string = ExpenseCategory.OTHER;
  expAmount: number | null = null;
  expDescription = '';
  expDate: Date = new Date();
  expVendor = '';
  expInvoice = '';
  expNotes = '';
  expPayNow = true;

  // Refund form (always tied to a specific subscription)
  refSubscription: EventSubscription | null = null;
  refAmount: number | null = null;
  refDate: Date = new Date();
  refType: 'FULL' | 'PARTIAL' = 'PARTIAL';
  refReason = '';

  saving = signal(false);

  paymentMethodOptions = [
    { label: 'Cash', value: 'CASH' },
    { label: 'Bank Transfer', value: 'BANK_TRANSFER' },
    { label: 'Credit Card', value: 'CREDIT_CARD' },
    { label: 'Check', value: 'CHECK' },
  ];

  // Getter so labels re-evaluate when the active language changes.
  get expenseCategoryOptions() {
    return Object.values(ExpenseCategory).map(c => ({
      label: this.translate.instant(`EXPENSES.CATEGORY_VALUES.${c}`),
      value: c,
    }));
  }

  ngOnInit() {
    this.id = this.route.snapshot.paramMap.get('id')!;
    this.loadEvent();
    this.loadPL();
    this.loadSubscriptions();
    this.loadExpenses();
    this.loadRefunds();
    this.loadStudents();
  }

  loadEvent() {
    this.service.getById(this.id).subscribe({
      next: (e) => this.event.set(e),
      error: () => {
        this.notifications.error('Failed to load event');
        this.router.navigate(['/events']);
      },
    });
  }

  loadPL() {
    this.service.getPL(this.id).subscribe({ next: (p) => this.pl.set(p) });
  }

  loadSubscriptions() {
    this.service.listSubscriptions(this.id).subscribe({
      next: (rows) => this.subscriptions.set(rows),
    });
  }

  loadExpenses() {
    this.service.listExpenses(this.id).subscribe({
      next: (rows) => this.expenses.set(rows),
    });
  }

  loadRefunds() {
    this.service.listRefunds(this.id).subscribe({
      next: (rows) => this.refunds.set(rows),
    });
  }

  loadStudents() {
    this.studentService.getAllStudents().subscribe({
      next: (list) => {
        this.students.set(list);
        this.studentOptions.set(
          list.map((s) => ({ label: `${s.firstName} ${s.lastName}`, value: s.id }))
        );
      },
    });
  }

  // ─── Subscription dialog ────────────────────────────────────────────────
  openSubscriptionDialog() {
    this.subType = 'STUDENT';
    this.subStudentId = null;
    this.subFirstName = '';
    this.subLastName = '';
    this.subAge = null;
    this.subMobile = '';
    this.subAmount = null;
    this.subPaymentDate = new Date();
    this.subPaymentMethod = null;
    this.subNotes = '';
    this.showSubscriptionDialog = true;
  }

  submitSubscription() {
    if (!this.subAmount || !this.subPaymentDate) return;
    if (this.subType === 'STUDENT' && !this.subStudentId) {
      this.notifications.error('Pick a student');
      return;
    }
    if (this.subType === 'EXTERNAL' && (!this.subFirstName || !this.subLastName)) {
      this.notifications.error('First and last name required');
      return;
    }

    this.saving.set(true);
    const dto =
      this.subType === 'STUDENT'
        ? {
            studentId: this.subStudentId!,
            amount: this.subAmount,
            paymentDate: this.subPaymentDate.toISOString().split('T')[0],
            paymentMethod: this.subPaymentMethod || undefined,
            notes: this.subNotes || undefined,
          }
        : {
            externalFirstName: this.subFirstName,
            externalLastName: this.subLastName,
            externalAge: this.subAge ?? undefined,
            externalMobile: this.subMobile || undefined,
            amount: this.subAmount,
            paymentDate: this.subPaymentDate.toISOString().split('T')[0],
            paymentMethod: this.subPaymentMethod || undefined,
            notes: this.subNotes || undefined,
          };

    this.service.createSubscription(this.id, dto).subscribe({
      next: () => {
        this.notifications.success('Subscription added');
        this.showSubscriptionDialog = false;
        this.saving.set(false);
        this.loadSubscriptions();
        this.loadPL();
      },
      error: (err) => {
        this.saving.set(false);
        this.notifications.error(err?.error?.message || 'Failed to add subscription');
      },
    });
  }

  deleteSubscription(sub: EventSubscription) {
    const refunded = sub.refundedAmount || 0;
    const message = refunded > 0
      ? `This subscription has ${refunded.toFixed(2)} in refunds against it. Deleting it will also delete those refund records and the linked revenue. Continue?`
      : 'Delete this subscription? Linked revenue (if any) will also be removed.';
    this.confirmationService.confirm({
      message,
      header: 'Confirm Delete',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.service.deleteSubscription(sub.id).subscribe({
          next: () => {
            this.notifications.success('Subscription deleted');
            this.loadSubscriptions();
            this.loadPL();
          },
          error: (err) => {
            this.notifications.error(err?.error?.message || 'Failed to delete');
          },
        });
      },
    });
  }

  // ─── Expense dialog ─────────────────────────────────────────────────────
  openExpenseDialog() {
    this.expCategory = ExpenseCategory.OTHER;
    this.expAmount = null;
    this.expDescription = '';
    this.expDate = new Date();
    this.expVendor = '';
    this.expInvoice = '';
    this.expNotes = '';
    this.expPayNow = true;
    this.showExpenseDialog = true;
  }

  submitExpense() {
    if (!this.expAmount || !this.expDescription || !this.expDate) {
      this.notifications.error('Fill required fields');
      return;
    }
    this.saving.set(true);
    const dateStr = this.expDate.toISOString().split('T')[0];
    const expenseData: any = {
      type: ExpenseType.VARIABLE,
      category: this.expCategory,
      amount: this.expAmount,
      description: this.expDescription,
      date: dateStr,
      isRecurring: false,
      eventId: this.id,
      vendor: this.expVendor || null,
      invoiceNumber: this.expInvoice || null,
      notes: this.expNotes || null,
      // branchId omitted — backend derives from event
    };

    this.expenseService.createExpense(expenseData).subscribe({
      next: (created) => {
        if (this.expPayNow) {
          this.expenseService
            .recordPayment({
              expenseId: created.id,
              type: created.type,
              category: created.category,
              amount: created.amount,
              date: dateStr,
              branchId: created.branchId,
              eventId: this.id,
              vendor: created.vendor || undefined,
              invoiceNumber: created.invoiceNumber || undefined,
              notes: created.notes || undefined,
            })
            .subscribe({
              next: () => {
                this.notifications.success('Expense recorded and paid');
                this.finishExpense();
              },
              error: (err) => {
                this.saving.set(false);
                this.notifications.error(err?.error?.message || 'Expense created but payment failed');
                this.loadExpenses();
              },
            });
        } else {
          this.notifications.success('Expense added');
          this.finishExpense();
        }
      },
      error: (err) => {
        this.saving.set(false);
        this.notifications.error(err?.error?.message || 'Failed to add expense');
      },
    });
  }

  private finishExpense() {
    this.showExpenseDialog = false;
    this.saving.set(false);
    this.loadExpenses();
    this.loadPL();
  }

  // ─── Refund dialog (per subscription) ──────────────────────────────────
  refundRemaining(s: EventSubscription): number {
    return +(s.amount - (s.refundedAmount || 0)).toFixed(2);
  }

  openRefundDialog(sub: EventSubscription) {
    const remaining = this.refundRemaining(sub);
    if (remaining <= 0) {
      this.notifications.error('This subscription has already been fully refunded');
      return;
    }
    this.refSubscription = sub;
    this.refAmount = remaining;
    this.refDate = new Date();
    this.refType = 'FULL';
    this.refReason = '';
    this.showRefundDialog = true;
  }

  onRefundAmountChange() {
    if (!this.refSubscription || this.refAmount == null) return;
    const remaining = this.refundRemaining(this.refSubscription);
    this.refType = Math.abs(this.refAmount - remaining) < 0.005 ? 'FULL' : 'PARTIAL';
  }

  submitRefund() {
    if (!this.refSubscription || !this.refAmount || !this.refDate) return;
    const remaining = this.refundRemaining(this.refSubscription);
    if (this.refAmount > remaining + 0.005) {
      this.notifications.error(`Cannot refund more than the remaining amount (${remaining.toFixed(2)})`);
      return;
    }

    this.saving.set(true);
    this.service
      .createRefund(this.id, {
        subscriptionId: this.refSubscription.id,
        amount: this.refAmount,
        refundDate: this.refDate.toISOString().split('T')[0],
        type: this.refType,
        reason: this.refReason || undefined,
      })
      .subscribe({
        next: () => {
          this.notifications.success('Refund issued');
          this.showRefundDialog = false;
          this.saving.set(false);
          this.refSubscription = null;
          this.loadSubscriptions();
          this.loadRefunds();
          this.loadPL();
        },
        error: (err) => {
          this.saving.set(false);
          this.notifications.error(err?.error?.message || 'Failed to issue refund');
        },
      });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────
  edit() {
    this.router.navigate(['/events', this.id, 'edit']);
  }

  back() {
    this.router.navigate(['/events']);
  }

  statusSeverity(status: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    switch (status) {
      case 'ACTIVE':
        return 'success';
      case 'PLANNED':
        return 'info';
      case 'COMPLETED':
        return 'secondary';
      case 'CANCELLED':
        return 'danger';
      default:
        return 'info';
    }
  }

  subscriberLabel(s: EventSubscription): string {
    if (s.studentName) return s.studentName;
    return `${s.externalFirstName ?? ''} ${s.externalLastName ?? ''}`.trim() || '—';
  }
}
