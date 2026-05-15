import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BranchService } from '../services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { Branch } from '@shared/interfaces/branch.interface';

interface BranchStats {
  courseCount: number;
  studentCount: number;
  classCount: number;
  employeeCount: number;
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  activeEnrollments: number;
}

@Component({
  selector: 'app-branch-detail',
  standalone: true,
  imports: [
    CommonModule,
    CardModule,
    ButtonModule,
    TagModule,
    TooltipModule,
    ProgressSpinnerModule,
    ConfirmDialogModule,
    TranslateModule
  ],
  providers: [ConfirmationService],
  templateUrl: './branch-detail.component.html',
  styleUrl: './branch-detail.component.scss'
})
export class BranchDetailComponent implements OnInit {
  private branchService = inject(BranchService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);

  branch = signal<Branch | null>(null);
  stats = signal<BranchStats | null>(null);
  loading = signal(true);
  statsLoading = signal(true);
  branchId: string | null = null;

  ngOnInit() {
    this.branchId = this.route.snapshot.paramMap.get('id');
    if (this.branchId) {
      this.loadBranch(this.branchId);
      this.loadBranchStats(this.branchId);
    }
  }

  loadBranch(id: string) {
    this.loading.set(true);
    this.branchService.getBranchById(id).subscribe({
      next: (branch) => {
        this.branch.set(branch);
        this.loading.set(false);
      },
      error: () => {
        // Interceptor toasted the translated error already.
        this.loading.set(false);
        this.router.navigate(['/branches']);
      }
    });
  }

  loadBranchStats(id: string) {
    this.statsLoading.set(true);
    this.branchService.getBranchStats(id).subscribe({
      next: (stats) => {
        this.stats.set(stats);
        this.statsLoading.set(false);
      },
      error: () => {
        // If stats endpoint doesn't exist, set default values
        this.stats.set({
          courseCount: 0,
          studentCount: 0,
          classCount: 0,
          employeeCount: 0,
          totalRevenue: 0,
          totalExpenses: 0,
          netProfit: 0,
          activeEnrollments: 0
        });
        this.statsLoading.set(false);
      }
    });
  }

  editBranch() {
    if (this.branchId) {
      this.router.navigate(['/branches', this.branchId, 'edit']);
    }
  }

  backToList() {
    this.router.navigate(['/branches']);
  }

  toggleBranchStatus() {
    const branch = this.branch();
    if (!branch || !this.branchId) return;

    const willDeactivate = branch.isActive;

    this.confirmationService.confirm({
      message: this.translate.instant(
        willDeactivate ? 'BRANCHES.DEACTIVATE_CONFIRM' : 'BRANCHES.ACTIVATE_CONFIRM'
      ),
      header: this.translate.instant(
        willDeactivate ? 'BRANCHES.DEACTIVATE_HEADER' : 'BRANCHES.ACTIVATE_HEADER'
      ),
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.branchService.updateBranch(this.branchId!, {
          isActive: !branch.isActive
        }).subscribe({
          next: (updatedBranch) => {
            this.branch.set(updatedBranch);
            this.notificationService.success(
              this.translate.instant(willDeactivate ? 'BRANCHES.DEACTIVATED' : 'BRANCHES.ACTIVATED')
            );
          },
          error: () => {
            // Interceptor toasted the translated error.
          }
        });
      }
    });
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  }
}
