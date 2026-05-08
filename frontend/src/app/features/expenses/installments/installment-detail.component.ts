import { Component, OnInit, inject, signal, computed } from '@angular/core';
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
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { TextareaModule } from 'primeng/textarea';
import { InstallmentService } from '../services/installment.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import {
  InstallmentPlan,
  InstallmentScheduleItem,
} from '@shared/interfaces/installment.interface';
import { ExpensePayment } from '@shared/interfaces/expense.interface';
import { Branch } from '@shared/interfaces/branch.interface';
import { DeleteConfirmDialogComponent } from '../../../shared/components/delete-confirm-dialog/delete-confirm-dialog.component';

@Component({
  selector: 'app-installment-detail',
  standalone: true,
  imports: [
    CommonModule, FormsModule, CardModule, ButtonModule, TagModule, TableModule,
    DialogModule, TooltipModule, DividerModule, DatePickerModule, InputNumberModule,
    TextareaModule, DeleteConfirmDialogComponent,
  ],
  template: `
    <div class="container-custom py-8">
      <div class="flex items-center gap-4 mb-6">
        <p-button icon="pi pi-arrow-left" [text]="true" severity="secondary" (onClick)="back()"></p-button>
        <div class="flex-1">
          @if (plan()) {
            <h1 class="text-2xl font-bold text-gray-900">{{ plan()!.name }}</h1>
            <p class="text-gray-500 mt-1">
              {{ plan()!.category }} · {{ plan()!.type }} ·
              <span class="font-medium">{{ plan()!.monthsCount }} months</span>
            </p>
          }
        </div>
        @if (plan() && authService.canDelete('expenses')) {
          <p-button icon="pi pi-trash" label="Delete Plan" severity="danger" [outlined]="true"
            (onClick)="confirmDelete()">
          </p-button>
        }
      </div>

      @if (loading()) {
        <div class="flex justify-center py-16">
          <i class="pi pi-spin pi-spinner text-3xl text-gray-400"></i>
        </div>
      } @else if (plan()) {
        <!-- Summary cards -->
        <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <div class="bg-white border border-gray-200 rounded-xl p-4">
            <p class="text-xs text-gray-500 uppercase mb-1">Total</p>
            <p class="text-xl font-bold text-gray-900">{{ plan()!.totalAmount | number:'1.2-2' }}</p>
          </div>
          <div class="bg-white border border-gray-200 rounded-xl p-4">
            <p class="text-xs text-gray-500 uppercase mb-1">Downpayment</p>
            <p class="text-xl font-bold text-gray-900">{{ plan()!.downpaymentAmount | number:'1.2-2' }}</p>
            <p class="text-xs text-gray-500 mt-1">on {{ plan()!.startDate | date:'MMM d, y' }}</p>
          </div>
          <div class="bg-white border border-gray-200 rounded-xl p-4">
            <p class="text-xs text-gray-500 uppercase mb-1">Financed</p>
            <p class="text-xl font-bold text-gray-900">{{ plan()!.financedAmount | number:'1.2-2' }}</p>
          </div>
          <div class="bg-green-50 border border-green-200 rounded-xl p-4">
            <p class="text-xs text-green-700 uppercase mb-1">Paid So Far</p>
            <p class="text-xl font-bold text-green-900">{{ paidTotal() | number:'1.2-2' }}</p>
            <p class="text-xs text-green-700 mt-1">{{ paidCount() }}/{{ plan()!.monthsCount }} installments</p>
          </div>
          <div class="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p class="text-xs text-amber-700 uppercase mb-1">Remaining</p>
            <p class="text-xl font-bold text-amber-900">{{ remaining() | number:'1.2-2' }}</p>
            @if (plan()!.nextDueDate) {
              <p class="text-xs text-amber-700 mt-1">Next: {{ plan()!.nextDueDate | date:'MMM d' }}</p>
            }
          </div>
        </div>

        <!-- Plan info -->
        <p-card styleClass="mb-6">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p class="text-gray-500 text-xs uppercase mb-1">Status</p>
              <p-tag [value]="plan()!.status" [severity]="statusSeverity(plan()!.status)"></p-tag>
            </div>
            <div>
              <p class="text-gray-500 text-xs uppercase mb-1">Branch</p>
              <p class="font-medium">{{ branchName() }}</p>
            </div>
            <div>
              <p class="text-gray-500 text-xs uppercase mb-1">Vendor</p>
              <p class="font-medium">{{ plan()!.vendor || '—' }}</p>
            </div>
            <div>
              <p class="text-gray-500 text-xs uppercase mb-1">Invoice</p>
              <p class="font-medium">{{ plan()!.invoiceNumber || '—' }}</p>
            </div>
            @if (plan()!.notes) {
              <div class="md:col-span-4">
                <p class="text-gray-500 text-xs uppercase mb-1">Notes</p>
                <p>{{ plan()!.notes }}</p>
              </div>
            }
          </div>
        </p-card>

        <!-- Schedule -->
        <p-card>
          <ng-template pTemplate="header">
            <div class="flex justify-between items-center p-4">
              <div>
                <h3 class="text-lg font-bold">Payment Schedule</h3>
                <p class="text-sm text-gray-600">Pay each installment as due. Each paid installment becomes an expense.</p>
              </div>
            </div>
          </ng-template>

          <p-table [value]="schedule()" responsiveLayout="scroll">
            <ng-template pTemplate="header">
              <tr>
                <th class="w-16">#</th>
                <th>Due Date</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Paid Date</th>
                <th>Paid Amount</th>
                <th class="w-48">Actions</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-item>
              <tr [class.bg-green-50]="item.status === 'PAID'" [class.bg-amber-50]="isOverdue(item)">
                <td class="font-bold text-gray-700">{{ item.installmentNumber }}</td>
                <td>{{ item.dueDate | date:'MMM d, y' }}</td>
                <td class="font-semibold">{{ item.amount | number:'1.2-2' }}</td>
                <td>
                  <p-tag [value]="item.status" [severity]="schedSeverity(item)"></p-tag>
                  @if (isOverdue(item)) {
                    <span class="ml-2 text-xs text-amber-700">Overdue</span>
                  }
                </td>
                <td>
                  @if (item.paidDate) {
                    <span class="text-sm">{{ item.paidDate | date:'MMM d, y' }}</span>
                  } @else {
                    <span class="text-gray-400 text-sm">—</span>
                  }
                </td>
                <td>
                  @if (item.paidAmount !== null && item.paidAmount !== undefined) {
                    <span class="font-medium text-green-700">{{ item.paidAmount | number:'1.2-2' }}</span>
                  } @else {
                    <span class="text-gray-400 text-sm">—</span>
                  }
                </td>
                <td>
                  @if (item.status === 'PENDING') {
                    @if (authService.canWrite('expenses')) {
                      <p-button label="Pay" icon="pi pi-dollar" severity="success" size="small"
                        (onClick)="openPay(item)">
                      </p-button>
                    }
                  } @else if (item.status === 'PAID') {
                    @if (authService.canWrite('expenses')) {
                      <p-button label="Reverse" icon="pi pi-undo" severity="warn" [outlined]="true" size="small"
                        (onClick)="confirmUnpay(item)">
                      </p-button>
                    }
                  }
                </td>
              </tr>
            </ng-template>
          </p-table>
        </p-card>
      }
    </div>

    <!-- Pay dialog -->
    <p-dialog header="Record Installment Payment" [(visible)]="showPayDialog" [modal]="true"
      [style]="{ width: '460px' }" [draggable]="false">
      @if (payTarget()) {
        <div class="flex flex-col gap-4 py-2">
          <div class="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p class="text-sm text-blue-700 font-medium">
              Installment {{ payTarget()!.installmentNumber }} / {{ plan()?.monthsCount }}
            </p>
            <p class="text-xs text-blue-500 mt-1">Due {{ payTarget()!.dueDate | date:'MMM d, y' }} · Expected
              {{ payTarget()!.amount | number:'1.2-2' }}</p>
          </div>
          <div>
            <label class="block text-sm font-medium mb-2">Amount *</label>
            <p-inputnumber [(ngModel)]="payAmount" [min]="0.01" [minFractionDigits]="2"
              [maxFractionDigits]="2" styleClass="w-full">
            </p-inputnumber>
          </div>
          <div>
            <label class="block text-sm font-medium mb-2">Payment Date *</label>
            <p-datepicker [(ngModel)]="payDate" dateFormat="yy-mm-dd" [showIcon]="true"
              styleClass="w-full">
            </p-datepicker>
          </div>
          <div>
            <label class="block text-sm font-medium mb-2">Notes</label>
            <textarea pTextarea [(ngModel)]="payNotes" placeholder="Optional notes" rows="2"
              class="w-full"></textarea>
          </div>
        </div>
      }
      <ng-template pTemplate="footer">
        <p-button label="Cancel" severity="secondary" [outlined]="true"
          (onClick)="showPayDialog = false"></p-button>
        <p-button label="Record Payment" severity="success" icon="pi pi-check"
          [disabled]="paying()" [loading]="paying()" (onClick)="confirmPay()">
        </p-button>
      </ng-template>
    </p-dialog>

    <!-- Unpay dialog -->
    <app-delete-confirm-dialog
      [visible]="showUnpayDialog"
      (visibleChange)="showUnpayDialog = $event"
      header="Reverse Installment Payment"
      [message]="'This will delete the linked expense payment and mark this installment as PENDING again. Continue?'"
      (confirm)="doUnpay()"
      (cancel)="showUnpayDialog = false">
    </app-delete-confirm-dialog>

    <!-- Delete plan -->
    <app-delete-confirm-dialog
      [visible]="showDeleteDialog"
      (visibleChange)="showDeleteDialog = $event"
      header="Delete Installment Plan"
      [message]="'Permanently delete this plan and ALL its payments (including downpayment)? This cannot be undone.'"
      (confirm)="doDelete()"
      (cancel)="showDeleteDialog = false">
    </app-delete-confirm-dialog>
  `,
})
export class InstallmentDetailComponent implements OnInit {
  private installmentService = inject(InstallmentService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);
  authService = inject(AuthService);

  plan = signal<InstallmentPlan | null>(null);
  schedule = signal<InstallmentScheduleItem[]>([]);
  downpaymentPayment = signal<ExpensePayment | null>(null);
  branches = signal<Branch[]>([]);
  loading = signal(true);
  planId = '';

  paidTotal = computed(() =>
    this.schedule()
      .filter(s => s.status === 'PAID')
      .reduce((sum, s) => sum + (s.paidAmount ?? 0), 0),
  );
  paidCount = computed(() => this.schedule().filter(s => s.status === 'PAID').length);
  remaining = computed(() => {
    const p = this.plan();
    if (!p) return 0;
    return Math.max(0, p.financedAmount - this.paidTotal());
  });
  branchName = computed(() => {
    const p = this.plan();
    if (!p?.branchId) return 'Global';
    return this.branches().find(b => b.id === p.branchId)?.name || '—';
  });

  showPayDialog = false;
  payTarget = signal<InstallmentScheduleItem | null>(null);
  payAmount = 0;
  payDate: Date = new Date();
  payNotes = '';
  paying = signal(false);

  showUnpayDialog = false;
  unpayTarget = signal<InstallmentScheduleItem | null>(null);

  showDeleteDialog = false;

  ngOnInit() {
    this.planId = this.route.snapshot.paramMap.get('id') || '';
    this.branchService.getActiveBranches().subscribe({ next: bs => this.branches.set(bs) });
    this.load();
  }

  load() {
    this.loading.set(true);
    this.installmentService.getById(this.planId).subscribe({
      next: (res) => {
        this.plan.set(res.plan);
        this.schedule.set(res.schedule);
        this.downpaymentPayment.set(res.downpaymentPayment);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notificationService.error('Failed to load installment plan');
      },
    });
  }

  back() { this.router.navigate(['/expenses/installments']); }

  openPay(item: InstallmentScheduleItem) {
    this.payTarget.set(item);
    this.payAmount = item.amount;
    this.payDate = new Date();
    this.payNotes = '';
    this.showPayDialog = true;
  }

  confirmPay() {
    const t = this.payTarget();
    if (!t) return;
    this.paying.set(true);
    const dateStr = this.payDate instanceof Date
      ? this.payDate.toISOString().split('T')[0]
      : this.payDate;

    this.installmentService.pay(this.planId, t.id, {
      date: dateStr,
      amount: this.payAmount,
      notes: this.payNotes || undefined,
    }).subscribe({
      next: () => {
        this.paying.set(false);
        this.showPayDialog = false;
        this.notificationService.success('Installment paid');
        this.load();
      },
      error: (err) => {
        this.paying.set(false);
        this.notificationService.error(err.error?.message || 'Failed to pay');
      },
    });
  }

  confirmUnpay(item: InstallmentScheduleItem) {
    this.unpayTarget.set(item);
    this.showUnpayDialog = true;
  }

  doUnpay() {
    const t = this.unpayTarget();
    if (!t) return;
    this.installmentService.unpay(this.planId, t.id).subscribe({
      next: () => {
        this.notificationService.success('Payment reversed');
        this.showUnpayDialog = false;
        this.unpayTarget.set(null);
        this.load();
      },
      error: (err) => {
        this.notificationService.error(err.error?.message || 'Failed to reverse');
        this.showUnpayDialog = false;
      },
    });
  }

  confirmDelete() { this.showDeleteDialog = true; }

  doDelete() {
    this.installmentService.delete(this.planId).subscribe({
      next: () => {
        this.notificationService.success('Installment plan deleted');
        this.router.navigate(['/expenses/installments']);
      },
      error: (err) => {
        this.notificationService.error(err.error?.message || 'Failed to delete plan');
        this.showDeleteDialog = false;
      },
    });
  }

  isOverdue(item: InstallmentScheduleItem): boolean {
    if (item.status !== 'PENDING') return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(item.dueDate) < today;
  }

  statusSeverity(status: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    switch (status) {
      case 'ACTIVE': return 'info';
      case 'COMPLETED': return 'success';
      case 'CANCELED': return 'danger';
      default: return 'secondary';
    }
  }

  schedSeverity(item: InstallmentScheduleItem): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    if (item.status === 'PAID') return 'success';
    if (item.status === 'SKIPPED') return 'secondary';
    if (this.isOverdue(item)) return 'danger';
    return 'warn';
  }
}
