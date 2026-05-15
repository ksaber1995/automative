import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
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
    TooltipModule, DeleteConfirmDialogComponent, TranslateModule,
  ],
  templateUrl: './installment-list.component.html',
})
export class InstallmentListComponent implements OnInit {
  private installmentService = inject(InstallmentService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);
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
    this.branchService.getAllBranches().subscribe({ next: bs => this.branches.set(bs) });
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
        this.notificationService.success(this.translate.instant('INSTALLMENTS.LIST.MSG_DELETED'));
        this.showDeleteDialog = false;
        this.planToDelete.set(null);
        this.load();
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.showDeleteDialog = false;
      },
    });
  }

  getBranchName(branchId?: string | null): string {
    if (!branchId) return this.translate.instant('INSTALLMENTS.LIST.GLOBAL');
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
