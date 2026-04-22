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
    DialogModule, TooltipModule, DividerModule, DeleteConfirmDialogComponent,
  ],
  template: `
    <div class="container-custom py-8">
      <!-- Header -->
      <div class="flex items-center gap-4 mb-6">
        <p-button icon="pi pi-arrow-left" [text]="true" severity="secondary" (onClick)="goBack()"></p-button>
        <div class="flex-1">
          @if (expense()) {
            <h1 class="text-2xl font-bold text-gray-900">{{ expense()!.description }}</h1>
            <p class="text-gray-500 mt-1">{{ expense()!.category }} · {{ expense()!.type }}</p>
          } @else if (loading()) {
            <div class="h-7 bg-gray-200 rounded w-64 animate-pulse"></div>
          }
        </div>
        @if (expense() && authService.canWrite('expenses')) {
          <p-button
            icon="pi pi-pencil"
            label="Edit"
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
            <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Expected Amount</p>
            <p class="text-2xl font-bold text-gray-900">{{ expense()!.amount | number:'1.2-2' }}</p>
          </div>
          <div class="bg-green-50 border border-green-200 rounded-xl p-4">
            <p class="text-xs text-green-600 uppercase tracking-wider mb-1">Total Paid</p>
            <p class="text-2xl font-bold text-green-700">{{ (expense()!.totalPaid ?? 0) | number:'1.2-2' }}</p>
          </div>
          <div class="rounded-xl p-4 border"
            [class]="getStatusClass()">
            <p class="text-xs uppercase tracking-wider mb-1 opacity-70">Status</p>
            <p class="text-xl font-bold">{{ getStatusLabel() }}</p>
          </div>
          <div class="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p class="text-xs text-blue-600 uppercase tracking-wider mb-1">Payments Made</p>
            <p class="text-2xl font-bold text-blue-700">{{ payments().length }}</p>
          </div>
        </div>

        <!-- Expense meta -->
        <p-card styleClass="mb-6">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Date</p>
              <p class="font-medium">{{ expense()!.date | date:'mediumDate' }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Branch</p>
              <p class="font-medium">{{ getBranchName(expense()!.branchId) }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Type</p>
              <p-tag [value]="expense()!.type" [severity]="getTypeColor(expense()!.type)"></p-tag>
            </div>
            <div>
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Recurring</p>
              @if (expense()!.isRecurring) {
                <p-tag value="Recurring" severity="info" icon="pi pi-refresh"></p-tag>
              } @else {
                <p class="font-medium text-gray-500">One-time</p>
              }
            </div>
            @if (expense()!.vendor) {
              <div>
                <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Vendor</p>
                <p class="font-medium">{{ expense()!.vendor }}</p>
              </div>
            }
            @if (expense()!.invoiceNumber) {
              <div>
                <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Invoice #</p>
                <p class="font-medium">{{ expense()!.invoiceNumber }}</p>
              </div>
            }
            @if (expense()!.notes) {
              <div class="col-span-2">
                <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Notes</p>
                <p class="font-medium">{{ expense()!.notes }}</p>
              </div>
            }
            @if (expense()!.lastPaymentDate) {
              <div>
                <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Last Payment</p>
                <p class="font-medium">{{ expense()!.lastPaymentDate | date:'mediumDate' }}</p>
              </div>
            }
          </div>
        </p-card>

        <!-- Payment history -->
        <p-card>
          <ng-template pTemplate="header">
            <div class="flex items-center justify-between px-4 pt-4">
              <h2 class="text-lg font-semibold text-gray-800">Payment History</h2>
              @if (authService.canWrite('expenses')) {
                <p-button
                  icon="pi pi-dollar"
                  label="Record Payment"
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
                <th>Date</th>
                <th class="text-right">Amount</th>
                <th>Vendor</th>
                <th>Invoice #</th>
                <th>Notes</th>
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
                      pTooltip="Delete payment"
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
                  No payments recorded yet
                </td>
              </tr>
            </ng-template>
          </p-table>
        </p-card>
      } @else {
        <div class="text-center py-16 text-gray-500">Expense not found.</div>
      }
    </div>

    <!-- Record Payment Dialog -->
    <p-dialog
      header="Record Payment"
      [(visible)]="showPaymentDialog"
      [modal]="true"
      [style]="{ width: '420px' }"
      [draggable]="false">
      <div class="flex flex-col gap-4 py-2">
        <div class="p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p class="text-sm text-blue-700 font-medium">{{ expense()?.description }}</p>
          <p class="text-xs text-blue-500 mt-1">Expected: {{ expense()?.amount | number:'1.2-2' }}</p>
        </div>
        <div>
          <label class="block text-sm font-medium mb-2">Amount *</label>
          <input type="number" pInputText [(ngModel)]="newPayment.amount" class="w-full" min="0.01" step="0.01" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-2">Date *</label>
          <input type="date" [(ngModel)]="newPayment.date" class="w-full px-3 py-2 border border-gray-300 rounded-md" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-2">Vendor</label>
          <input type="text" pInputText [(ngModel)]="newPayment.vendor" placeholder="Vendor name" class="w-full" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-2">Invoice #</label>
          <input type="text" pInputText [(ngModel)]="newPayment.invoiceNumber" placeholder="Invoice number" class="w-full" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-2">Notes</label>
          <input type="text" pInputText [(ngModel)]="newPayment.notes" placeholder="Optional notes" class="w-full" />
        </div>
      </div>
      <ng-template pTemplate="footer">
        <p-button label="Cancel" severity="secondary" [outlined]="true" (onClick)="showPaymentDialog = false"></p-button>
        <p-button
          label="Record"
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
      header="Delete Payment"
      message="Are you sure you want to delete this payment record?"
      (confirm)="deletePayment()"
      (cancel)="showDeletePaymentDialog = false">
    </app-delete-confirm-dialog>
  `
})
export class ExpenseDetailComponent implements OnInit {
  private expenseService = inject(ExpenseService);
  private branchService = inject(BranchService);
  private notificationService = inject(NotificationService);
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
        this.notificationService.success('Payment recorded');
        this.loadExpense(e.id);
        this.loadPayments(e.id);
      },
      error: (err) => {
        this.savingPayment.set(false);
        this.notificationService.error(err.error?.message || 'Failed to record payment');
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
        this.notificationService.success('Payment deleted');
        const id = this.route.snapshot.params['id'];
        this.loadExpense(id);
        this.loadPayments(id);
      },
      error: () => this.notificationService.error('Failed to delete payment')
    });
  }

  getBranchName(branchId?: string | null): string {
    if (!branchId) return 'Global / Shared';
    return this.branches().find(b => b.id === branchId)?.name || 'Unknown';
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

  getStatusLabel(): string {
    const paid = this.expense()?.totalPaid ?? 0;
    const amount = this.expense()?.amount ?? 0;
    if (paid >= amount && amount > 0) return 'Paid';
    if (paid > 0) return 'Partial';
    return 'Unpaid';
  }

  getStatusClass(): string {
    const status = this.getStatusLabel();
    if (status === 'Paid') return 'bg-green-50 border-green-200 text-green-800';
    if (status === 'Partial') return 'bg-yellow-50 border-yellow-200 text-yellow-800';
    return 'bg-red-50 border-red-200 text-red-800';
  }

  editExpense() {
    this.router.navigate(['/expenses', this.route.snapshot.params['id'], 'edit']);
  }

  goBack() {
    this.router.navigate(['/expenses']);
  }
}
