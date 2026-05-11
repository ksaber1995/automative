import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { TooltipModule } from 'primeng/tooltip';
import { DividerModule } from 'primeng/divider';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { ExpenseService } from '../services/expense.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { Expense, ExpensePayment } from '@shared/interfaces/expense.interface';
import { DeleteConfirmDialogComponent } from '../../../shared/components/delete-confirm-dialog/delete-confirm-dialog.component';

@Component({
  selector: 'app-expense-detail',
  standalone: true,
  imports: [
    CommonModule, FormsModule, CardModule, ButtonModule, TagModule, TableModule,
    DialogModule, TooltipModule, DividerModule, InputTextModule, DeleteConfirmDialogComponent,
    TranslateModule,
  ],
  template: `
    <div class="container-custom py-8">
      <!-- Header -->
      <div class="flex items-center gap-4 mb-6">
        <p-button icon="pi pi-arrow-left" [text]="true" severity="secondary" (onClick)="goBack()"></p-button>
        <div class="flex-1">
          @if (expense()) {
            <h1 class="text-2xl font-bold text-gray-900">{{ expense()!.description }}</h1>
            <p class="text-gray-500 mt-1">
              {{ ('EXPENSES.CATEGORY_VALUES.' + expense()!.category) | translate }} ·
              {{ ('EXPENSES.LIST.' + expense()!.type) | translate }}
            </p>
          } @else if (loading()) {
            <div class="h-7 bg-gray-200 rounded w-64 animate-pulse"></div>
          }
        </div>
        @if (expense() && authService.canWrite('expenses')) {
          <p-button
            icon="pi pi-pencil"
            [label]="'EXPENSES.DETAIL.EDIT' | translate"
            severity="secondary"
            [outlined]="true"
            (onClick)="editExpense()">
          </p-button>
        }
      </div>

      @if (loading()) {
        <div class="flex justify-center py-16">
          <i class="pi pi-spin pi-spinner text-3xl text-gray-400"></i>
        </div>
      } @else if (expense()) {
        <!-- Info cards -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div class="bg-white border border-gray-200 rounded-xl p-4">
            <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">{{ 'EXPENSES.DETAIL.EXPECTED_AMOUNT' | translate }}</p>
            <p class="text-2xl font-bold text-gray-900">{{ expense()!.amount | number:'1.2-2' }}</p>
          </div>
          <div class="bg-green-50 border border-green-200 rounded-xl p-4">
            <p class="text-xs text-green-600 uppercase tracking-wider mb-1">{{ 'EXPENSES.DETAIL.TOTAL_PAID' | translate }}</p>
            <p class="text-2xl font-bold text-green-700">{{ (expense()!.totalPaid ?? 0) | number:'1.2-2' }}</p>
          </div>
          <div class="rounded-xl p-4 border"
            [class]="getStatusClass()">
            <p class="text-xs uppercase tracking-wider mb-1 opacity-70">{{ 'EXPENSES.DETAIL.STATUS' | translate }}</p>
            <p class="text-xl font-bold">{{ getStatusLabelKey() | translate }}</p>
          </div>
          <div class="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p class="text-xs text-blue-600 uppercase tracking-wider mb-1">{{ 'EXPENSES.DETAIL.PAYMENTS_MADE' | translate }}</p>
            <p class="text-2xl font-bold text-blue-700">{{ payments().length }}</p>
          </div>
        </div>

        <!-- Expense meta -->
        <p-card styleClass="mb-6">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">{{ 'EXPENSES.DETAIL.DATE' | translate }}</p>
              <p class="font-medium">{{ expense()!.date | date:'mediumDate' }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">{{ 'EXPENSES.DETAIL.BRANCH' | translate }}</p>
              <p class="font-medium">{{ getBranchName(expense()!.branchId) }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">{{ 'EXPENSES.DETAIL.TYPE' | translate }}</p>
              <p-tag [value]="('EXPENSES.LIST.' + expense()!.type) | translate" [severity]="getTypeColor(expense()!.type)"></p-tag>
            </div>
            <div>
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">{{ 'EXPENSES.DETAIL.RECURRING' | translate }}</p>
              @if (expense()!.isRecurring) {
                <p-tag [value]="'EXPENSES.DETAIL.IS_RECURRING' | translate" severity="info" icon="pi pi-refresh"></p-tag>
              } @else {
                <p class="font-medium text-gray-500">{{ 'EXPENSES.DETAIL.ONE_TIME' | translate }}</p>
              }
            </div>
            @if (expense()!.vendor) {
              <div>
                <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">{{ 'EXPENSES.DETAIL.VENDOR' | translate }}</p>
                <p class="font-medium">{{ expense()!.vendor }}</p>
              </div>
            }
            @if (expense()!.invoiceNumber) {
              <div>
                <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">{{ 'EXPENSES.DETAIL.INVOICE_NUMBER' | translate }}</p>
                <p class="font-medium">{{ expense()!.invoiceNumber }}</p>
              </div>
            }
            @if (expense()!.notes) {
              <div class="col-span-2">
                <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">{{ 'EXPENSES.DETAIL.NOTES' | translate }}</p>
                <p class="font-medium">{{ expense()!.notes }}</p>
              </div>
            }
            @if (expense()!.lastPaymentDate) {
              <div>
                <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">{{ 'EXPENSES.DETAIL.LAST_PAYMENT' | translate }}</p>
                <p class="font-medium">{{ expense()!.lastPaymentDate | date:'mediumDate' }}</p>
              </div>
            }
          </div>
        </p-card>

        <!-- Payment history -->
        <p-card>
          <ng-template pTemplate="header">
            <div class="flex items-center justify-between px-4 pt-4">
              <h2 class="text-lg font-semibold text-gray-800">{{ 'EXPENSES.DETAIL.PAYMENT_HISTORY' | translate }}</h2>
              @if (authService.canWrite('expenses')) {
                <p-button
                  icon="pi pi-dollar"
                  [label]="'EXPENSES.DETAIL.RECORD_PAYMENT' | translate"
                  severity="success"
                  [outlined]="true"
                  (onClick)="openPaymentDialog()">
                </p-button>
              }
            </div>
          </ng-template>

          <p-table [value]="payments()" [loading]="paymentsLoading()" responsiveLayout="scroll">
            <ng-template pTemplate="header">
              <tr>
                <th>{{ 'EXPENSES.DETAIL.COL_DATE' | translate }}</th>
                <th class="text-right">{{ 'EXPENSES.DETAIL.COL_AMOUNT' | translate }}</th>
                <th>{{ 'EXPENSES.DETAIL.COL_VENDOR' | translate }}</th>
                <th>{{ 'EXPENSES.DETAIL.COL_INVOICE' | translate }}</th>
                <th>{{ 'EXPENSES.DETAIL.COL_NOTES' | translate }}</th>
                <th style="width: 60px"></th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-p>
              <tr>
                <td class="font-medium">{{ p.date | date:'mediumDate' }}</td>
                <td class="text-right font-semibold text-green-700">{{ p.amount | number:'1.2-2' }}</td>
                <td>{{ p.vendor || '—' }}</td>
                <td>{{ p.invoiceNumber || '—' }}</td>
                <td class="text-gray-500 text-sm">{{ p.notes || '—' }}</td>
                <td>
                  @if (authService.canDelete('expenses')) {
                    <p-button
                      icon="pi pi-trash"
                      [rounded]="true"
                      [text]="true"
                      severity="danger"
                      [pTooltip]="'EXPENSES.DETAIL.DELETE_PAYMENT_TOOLTIP' | translate"
                      (onClick)="confirmDeletePayment(p)">
                    </p-button>
                  }
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="6" class="text-center py-10 text-gray-400">
                  <i class="pi pi-inbox text-3xl mb-2 block"></i>
                  {{ 'EXPENSES.DETAIL.NO_PAYMENTS' | translate }}
                </td>
              </tr>
            </ng-template>
          </p-table>
        </p-card>
      } @else {
        <div class="text-center py-16 text-gray-500">{{ 'EXPENSES.DETAIL.NOT_FOUND' | translate }}</div>
      }
    </div>

    <!-- Record Payment Dialog -->
    <p-dialog
      [header]="'EXPENSES.DETAIL.DIALOG_RECORD_PAYMENT' | translate"
      [(visible)]="showPaymentDialog"
      [modal]="true"
      [style]="{ width: '420px' }"
      [draggable]="false">
      <div class="flex flex-col gap-4 py-2">
        <div class="p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p class="text-sm text-blue-700 font-medium">{{ expense()?.description }}</p>
          <p class="text-xs text-blue-500 mt-1">{{ 'EXPENSES.DETAIL.EXPECTED_LABEL' | translate }} {{ expense()?.amount | number:'1.2-2' }}</p>
        </div>
        <div>
          <label class="block text-sm font-medium mb-2">{{ 'EXPENSES.DETAIL.AMOUNT_REQUIRED' | translate }}</label>
          <input type="number" pInputText [(ngModel)]="newPayment.amount" class="w-full" min="0.01" step="0.01" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-2">{{ 'EXPENSES.DETAIL.DATE_REQUIRED' | translate }}</label>
          <input type="date" [(ngModel)]="newPayment.date" class="w-full px-3 py-2 border border-gray-300 rounded-md" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-2">{{ 'EXPENSES.DETAIL.VENDOR' | translate }}</label>
          <input type="text" pInputText [(ngModel)]="newPayment.vendor" [placeholder]="'EXPENSES.DETAIL.VENDOR_PLACEHOLDER' | translate" class="w-full" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-2">{{ 'EXPENSES.DETAIL.INVOICE_NUMBER' | translate }}</label>
          <input type="text" pInputText [(ngModel)]="newPayment.invoiceNumber" [placeholder]="'EXPENSES.DETAIL.INVOICE_PLACEHOLDER' | translate" class="w-full" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-2">{{ 'EXPENSES.DETAIL.NOTES' | translate }}</label>
          <input type="text" pInputText [(ngModel)]="newPayment.notes" [placeholder]="'EXPENSES.DETAIL.NOTES_PLACEHOLDER' | translate" class="w-full" />
        </div>
      </div>
      <ng-template pTemplate="footer">
        <p-button [label]="'EXPENSES.DETAIL.CANCEL' | translate" severity="secondary" [outlined]="true" (onClick)="showPaymentDialog = false"></p-button>
        <p-button
          [label]="'EXPENSES.DETAIL.RECORD' | translate"
          severity="success"
          icon="pi pi-check"
          [loading]="savingPayment()"
          [disabled]="savingPayment()"
          (onClick)="savePayment()">
        </p-button>
      </ng-template>
    </p-dialog>

    <!-- Delete payment confirm -->
    <app-delete-confirm-dialog
      [visible]="showDeletePaymentDialog"
      (visibleChange)="showDeletePaymentDialog = $event"
      [header]="'EXPENSES.DETAIL.DELETE_PAYMENT_TITLE' | translate"
      [message]="'EXPENSES.DETAIL.DELETE_PAYMENT_MSG' | translate"
      (confirm)="deletePayment()"
      (cancel)="showDeletePaymentDialog = false">
    </app-delete-confirm-dialog>
  `
})
export class ExpenseDetailComponent implements OnInit {
  private expenseService = inject(ExpenseService);
  private branchService = inject(BranchService);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  authService = inject(AuthService);

  expense = signal<Expense | null>(null);
  payments = signal<ExpensePayment[]>([]);
  branches = signal<any[]>([]);
  loading = signal(true);
  paymentsLoading = signal(false);

  showPaymentDialog = false;
  savingPayment = signal(false);
  newPayment = { amount: 0, date: '', vendor: '', invoiceNumber: '', notes: '' };

  showDeletePaymentDialog = false;
  paymentToDelete = signal<ExpensePayment | null>(null);

  ngOnInit() {
    const id = this.route.snapshot.params['id'];
    this.branchService.getActiveBranches().subscribe({ next: (b) => this.branches.set(b) });
    this.loadExpense(id);
    this.loadPayments(id);
  }

  private loadExpense(id: string) {
    this.loading.set(true);
    this.expenseService.getExpenseById(id).subscribe({
      next: (e) => { this.expense.set(e); this.loading.set(false); },
      error: () => { this.loading.set(false); }
    });
  }

  private loadPayments(id: string) {
    this.paymentsLoading.set(true);
    this.expenseService.getExpensePayments(id).subscribe({
      next: (p) => { this.payments.set(p); this.paymentsLoading.set(false); },
      error: () => this.paymentsLoading.set(false)
    });
  }

  openPaymentDialog() {
    const e = this.expense();
    this.newPayment = {
      amount: e?.amount ?? 0,
      date: new Date().toISOString().split('T')[0],
      vendor: e?.vendor ?? '',
      invoiceNumber: '',
      notes: '',
    };
    this.showPaymentDialog = true;
  }

  savePayment() {
    const e = this.expense();
    if (!e || !this.newPayment.amount || !this.newPayment.date) return;

    this.savingPayment.set(true);
    this.expenseService.recordPayment({
      expenseId: e.id,
      type: e.type,
      category: e.category,
      amount: Number(this.newPayment.amount),
      date: this.newPayment.date,
      branchId: e.branchId,
      vendor: this.newPayment.vendor || undefined,
      invoiceNumber: this.newPayment.invoiceNumber || undefined,
      notes: this.newPayment.notes || undefined,
    }).subscribe({
      next: () => {
        this.savingPayment.set(false);
        this.showPaymentDialog = false;
        this.notificationService.success(this.translate.instant('EXPENSES.DETAIL.MSG_PAYMENT_RECORDED'));
        this.loadExpense(e.id);
        this.loadPayments(e.id);
      },
      error: (err) => {
        this.savingPayment.set(false);
        this.notificationService.error(err.error?.message || this.translate.instant('EXPENSES.DETAIL.MSG_PAYMENT_RECORD_FAILED'));
      }
    });
  }

  confirmDeletePayment(payment: ExpensePayment) {
    this.paymentToDelete.set(payment);
    this.showDeletePaymentDialog = true;
  }

  deletePayment() {
    const p = this.paymentToDelete();
    if (!p) return;
    this.expenseService.deletePayment(p.id).subscribe({
      next: () => {
        this.showDeletePaymentDialog = false;
        this.notificationService.success(this.translate.instant('EXPENSES.DETAIL.MSG_PAYMENT_DELETED'));
        const id = this.route.snapshot.params['id'];
        this.loadExpense(id);
        this.loadPayments(id);
      },
      error: () => this.notificationService.error(this.translate.instant('EXPENSES.DETAIL.MSG_PAYMENT_DELETE_FAILED'))
    });
  }

  getBranchName(branchId?: string | null): string {
    if (!branchId) return this.translate.instant('EXPENSES.DETAIL.GLOBAL_SHARED');
    return this.branches().find(b => b.id === branchId)?.name || this.translate.instant('EXPENSES.DETAIL.UNKNOWN');
  }

  getTypeColor(type: string): 'success' | 'info' | 'warn' | 'danger' {
    switch (type) {
      case 'FIXED': return 'info';
      case 'VARIABLE': return 'success';
      case 'SHARED': return 'warn';
      case 'CAPITAL': return 'danger';
      default: return 'info';
    }
  }

  /** Returns the status enum value (PAID / PARTIAL / UNPAID), used to derive both the i18n key and the color class. */
  getStatusKey(): 'PAID' | 'PARTIAL' | 'UNPAID' {
    const paid = this.expense()?.totalPaid ?? 0;
    const amount = this.expense()?.amount ?? 0;
    if (paid >= amount && amount > 0) return 'PAID';
    if (paid > 0) return 'PARTIAL';
    return 'UNPAID';
  }

  getStatusLabelKey(): string {
    return 'EXPENSES.DETAIL.STATUS_' + this.getStatusKey();
  }

  getStatusClass(): string {
    const status = this.getStatusKey();
    if (status === 'PAID') return 'bg-green-50 border-green-200 text-green-800';
    if (status === 'PARTIAL') return 'bg-yellow-50 border-yellow-200 text-yellow-800';
    return 'bg-red-50 border-red-200 text-red-800';
  }

  editExpense() {
    this.router.navigate(['/expenses', this.route.snapshot.params['id'], 'edit']);
  }

  goBack() {
    this.router.navigate(['/expenses']);
  }
}
