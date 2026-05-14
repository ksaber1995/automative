import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { RevenueService, RevenueItem } from '../services/revenue.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { Branch } from '@shared/interfaces/branch.interface';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-revenue-list',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, TableModule, ButtonModule, TagModule, TranslateModule],
  templateUrl: './revenue-list.component.html',
  styleUrl: './revenue-list.component.scss'
})
export class RevenueListComponent implements OnInit {
  private revenueService = inject(RevenueService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  private authService = inject(AuthService);

  revenues = signal<RevenueItem[]>([]);
  branches = signal<Branch[]>([]);
  loading = signal(true);
  selectedBranchId: string = '';
  selectedSource: 'ENROLLMENT' | 'PRODUCT_SALE' | 'MASTER_ENROLLMENT' | 'EVENT' | 'ALL' = 'ALL';
  startDate: string = '';
  endDate: string = '';
  totalRevenue: number = 0;

  ngOnInit() {
    this.loadBranches();
    this.loadRevenues();
  }

  loadBranches() {
    this.branchService.getAllBranches().subscribe({
      next: (branches) => this.branches.set(branches)
    });
  }

  loadRevenues() {
    this.loading.set(true);
    const params: any = {};
    if (this.selectedBranchId) params.branchId = this.selectedBranchId;
    if (this.selectedSource !== 'ALL') params.source = this.selectedSource;
    if (this.startDate) params.startDate = this.startDate;
    if (this.endDate) params.endDate = this.endDate;

    this.revenueService.getRevenues(params).subscribe({
      next: (revenues: RevenueItem[]) => {
        this.revenues.set(revenues);
        this.totalRevenue = revenues.reduce((sum: number, r: RevenueItem) => sum + r.amount - (r.totalRefunded || 0), 0);
        this.loading.set(false);
      },
      error: () => {
        this.notificationService.error('Failed to load revenues');
        this.loading.set(false);
      }
    });
  }

  onFilterChange() {
    this.loadRevenues();
  }

  getSourceBadge(source: string): { severity: 'success' | 'info' | 'warn' | 'secondary'; label: string } {
    if (source === 'ENROLLMENT') return { severity: 'success', label: 'Course' };
    if (source === 'MASTER_ENROLLMENT') return { severity: 'secondary', label: 'Bundle' };
    if (source === 'EVENT') return { severity: 'warn', label: 'Event' };
    return { severity: 'info', label: 'Product' };
  }

  getRefundStatus(revenue: RevenueItem): 'NONE' | 'PARTIAL' | 'FULL' {
    if (!revenue.totalRefunded || revenue.totalRefunded === 0) return 'NONE';
    if (revenue.totalRefunded < revenue.amount) return 'PARTIAL';
    return 'FULL';
  }

  getRefundStatusSeverity(revenue: RevenueItem): 'success' | 'warn' | 'danger' {
    const status = this.getRefundStatus(revenue);
    if (status === 'NONE') return 'success';
    if (status === 'PARTIAL') return 'warn';
    return 'danger';
  }

  getBranchName(branchId: string | null | undefined): string {
    if (!branchId) return 'Company-level';
    const branch = this.branches().find(b => b.id === branchId);
    return branch ? branch.name : 'Unknown';
  }

  canSeeCompanyLevel(): boolean {
    return this.authService.isGlobalAdmin();
  }

  navigateToSource(revenue: RevenueItem) {
    if (revenue.source === 'ENROLLMENT') {
      this.router.navigate(['/enrollments', revenue.sourceId, 'edit']);
    } else if (revenue.source === 'MASTER_ENROLLMENT') {
      // Master bundles don't have a dedicated edit page — jump to the student
      // so the user can view/cancel/refund the enrollment row.
      if (revenue.studentId) {
        this.router.navigate(['/students', revenue.studentId]);
      }
    } else if (revenue.source === 'EVENT') {
      if (revenue.eventId) {
        this.router.navigate(['/events', revenue.eventId]);
      }
    } else {
      this.router.navigate(['/products/sales']);
    }
  }
}
