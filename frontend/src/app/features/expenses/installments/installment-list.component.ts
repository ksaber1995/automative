import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { InstallmentService } from '../services/installment.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { InstallmentPlan } from '@shared/interfaces/installment.interface';
import { Branch } from '@shared/interfaces/branch.interface';
import { DeleteConfirmDialogComponent } from '../../../shared/components/delete-confirm-dialog/delete-confirm-dialog.component';

@Component({
  selector: 'app-installment-list',
  standalone: true,
  imports: [
    CommonModule, FormsModule, CardModule, TableModule, ButtonModule, TagModule,
    TooltipModule, DeleteConfirmDialogComponent,
  ],
  template: `
    <div class="container mx-auto p-6">
      <p-card>
        <ng-template pTemplate="header">
          <div class="flex justify-between items-center p-4">
            <div>
              <h2 class="text-2xl font-bold">Installment Plans</h2>
              <p class="text-gray-600 mt-1">Track financed purchases paid over time</p>
            </div>
            <div class="flex gap-2">
              <p-button
                label="Back to Expenses"
                icon="pi pi-arrow-left"
                severity="secondary"
                [outlined]="true"
                (onClick)="backToExpenses()">
              </p-button>
              @if (authService.canWrite('expenses')) {
                <p-button
                  label="New Installment"
                  icon="pi pi-plus"
                  (onClick)="newPlan()">
                </p-button>
              }
            </div>
          </div>
        </ng-template>

        <!-- Summary -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div class="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p class="text-xs text-blue-700 uppercase">Active Plans</p>
            <p class="text-2xl font-bold text-blue-900">{{ activeCount() }}</p>
          </div>
          <div class="bg-green-50 border border-green-200 rounded-lg p-3">
            <p class="text-xs text-green-700 uppercase">Completed</p>
            <p class="text-2xl font-bold text-green-900">{{ completedCount() }}</p>
          </div>
          <div class="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p class="text-xs text-amber-700 uppercase">Total Financed</p>
            <p class="text-2xl font-bold text-amber-900">{{ totalFinanced() | number:'1.2-2' }}</p>
          </div>
          <div class="bg-purple-50 border border-purple-200 rounded-lg p-3">
            <p class="text-xs text-purple-700 uppercase">Remaining</p>
            <p class="text-2xl font-bold text-purple-900">{{ remainingTotal() | number:'1.2-2' }}</p>
          </div>
        </div>

        <!-- Filters -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div>
            <label class="block text-sm font-medium mb-1">Branch</label>
            <select [(ngModel)]="selectedBranchId" (change)="load()" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
              <option value="">All branches</option>
              @for (b of branches(); track b.id) {
                <option [value]="b.id">{{ b.name }}</option>
              }
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Status</label>
            <select [(ngModel)]="selectedStatus" (change)="load()" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
              <option value="">All</option>
              <option value="ACTIVE">Active</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELED">Canceled</option>
            </select>
          </div>
        </div>

        <!-- Table -->
        <p-table [value]="plans()" [loading]="loading()" [paginator]="true" [rows]="15" responsiveLayout="scroll">
          <ng-template pTemplate="header">
            <tr>
              <th>Name</th>
              <th>Branch</th>
              <th>Category</th>
              <th>Total</th>
              <th>Down</th>
              <th>Monthly</th>
              <th>Months</th>
              <th>Progress</th>
              <th>Next Due</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-plan>
            <tr>
              <td>
                <span class="font-medium text-blue-600 hover:underline cursor-pointer" (click)="viewPlan(plan)">
                  {{ plan.name }}
                </span>
                @if (plan.vendor) {
                  <div class="text-xs text-gray-500">{{ plan.vendor }}</div>
                }
              </td>
              <td>{{ getBranchName(plan.branchId) }}</td>
              <td>{{ plan.category }}</td>
              <td class="font-semibold">{{ plan.totalAmount | number:'1.2-2' }}</td>
              <td>{{ plan.downpaymentAmount | number:'1.2-2' }}</td>
              <td>{{ plan.monthlyAmount | number:'1.2-2' }}</td>
              <td class="text-center">
                <span class="font-medium">{{ plan.paidCount ?? 0 }}/{{ plan.monthsCount }}</span>
              </td>
              <td>
                <div class="w-32">
                  <div class="bg-gray-200 rounded-full h-2 overflow-hidden">
                    <div class="bg-green-500 h-2" [style.width.%]="progressPct(plan)"></div>
                  </div>
                  <div class="text-xs text-gray-500 mt-0.5">{{ progressPct(plan) }}%</div>
                </div>
              </td>
              <td>
                @if (plan.nextDueDate) {
                  <span class="text-sm">{{ plan.nextDueDate | date:'MMM d, y' }}</span>
                } @else {
                  <span class="text-gray-400 text-sm">—</span>
                }
              </td>
              <td>
                <p-tag [value]="plan.status" [severity]="statusSeverity(plan.status)"></p-tag>
              </td>
              <td>
                <div class="flex gap-1">
                  <p-button
                    icon="pi pi-eye"
                    [rounded]="true"
                    [text]="true"
                    severity="info"
                    pTooltip="View"
                    (onClick)="viewPlan(plan)">
                  </p-button>
                  @if (authService.canDelete('expenses')) {
                    <p-button
                      icon="pi pi-trash"
                      [rounded]="true"
                      [text]="true"
                      severity="danger"
                      pTooltip="Delete"
                      (onClick)="confirmDelete(plan)">
                    </p-button>
                  }
                </div>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="11" class="text-center py-8 text-gray-500">
                No installment plans yet. Click "New Installment" to create one.
              </td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>
    </div>

    <app-delete-confirm-dialog
      [visible]="showDeleteDialog"
      (visibleChange)="showDeleteDialog = $event"
      header="Delete Installment Plan"
      [message]="'This will permanently remove the plan, its schedule, and all linked payments (including the downpayment). Continue?'"
      (confirm)="doDelete()"
      (cancel)="showDeleteDialog = false">
    </app-delete-confirm-dialog>
  `,
})
export class InstallmentListComponent implements OnInit {
  private installmentService = inject(InstallmentService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  authService = inject(AuthService);

  plans = signal<InstallmentPlan[]>([]);
  branches = signal<Branch[]>([]);
  loading = signal(true);

  selectedBranchId = '';
  selectedStatus = '';

  showDeleteDialog = false;
  planToDelete = signal<InstallmentPlan | null>(null);

  activeCount = computed(() => this.plans().filter(p => p.status === 'ACTIVE').length);
  completedCount = computed(() => this.plans().filter(p => p.status === 'COMPLETED').length);
  totalFinanced = computed(() => this.plans().reduce((s, p) => s + p.financedAmount, 0));
  remainingTotal = computed(() => this.plans().reduce((s, p) => s + (p.financedAmount - (p.paidAmount ?? 0)), 0));

  ngOnInit() {
    this.branchService.getActiveBranches().subscribe({ next: bs => this.branches.set(bs) });
    this.load();
  }

  load() {
    this.loading.set(true);
    const params: any = {};
    if (this.selectedBranchId) params.branchId = this.selectedBranchId;
    if (this.selectedStatus) params.status = this.selectedStatus;
    this.installmentService.list(params).subscribe({
      next: (plans) => { this.plans.set(plans); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  newPlan() { this.router.navigate(['/expenses/installments/new']); }
  viewPlan(plan: InstallmentPlan) { this.router.navigate(['/expenses/installments', plan.id]); }
  backToExpenses() { this.router.navigate(['/expenses']); }

  confirmDelete(plan: InstallmentPlan) {
    this.planToDelete.set(plan);
    this.showDeleteDialog = true;
  }

  doDelete() {
    const p = this.planToDelete();
    if (!p) return;
    this.installmentService.delete(p.id).subscribe({
      next: () => {
        this.notificationService.success('Installment plan deleted');
        this.showDeleteDialog = false;
        this.planToDelete.set(null);
        this.load();
      },
      error: (err) => {
        this.notificationService.error(err.error?.message || 'Failed to delete plan');
        this.showDeleteDialog = false;
      },
    });
  }

  getBranchName(branchId?: string | null): string {
    if (!branchId) return 'Global';
    return this.branches().find(b => b.id === branchId)?.name || '—';
  }

  progressPct(plan: InstallmentPlan): number {
    if (!plan.financedAmount) return 0;
    return Math.round(((plan.paidAmount ?? 0) / plan.financedAmount) * 100);
  }

  statusSeverity(status: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    switch (status) {
      case 'ACTIVE': return 'info';
      case 'COMPLETED': return 'success';
      case 'CANCELED': return 'danger';
      default: return 'secondary';
    }
  }
}
