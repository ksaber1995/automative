import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { RevenueService, RevenueItem } from '../services/revenue.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { TranslateModule } from '@ngx-translate/core';
import { AmountPipe } from '../../../shared/pipes/amount.pipe';

@Component({
  selector: 'app-revenue-list',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, TableModule, ButtonModule, TagModule, TranslateModule,
    AmountPipe,
  ],
  templateUrl: './revenue-list.component.html',
  styleUrl: './revenue-list.component.scss'
})
export class RevenueListComponent implements OnInit {
  private revenueService = inject(RevenueService);
  private lookupService = inject(LookupService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  protected authService = inject(AuthService);
  protected branchState = inject(BranchStateService);

  revenues = signal<RevenueItem[]>([]);
  branches = signal<LookupOption[]>([]);
  loading = signal(true);
  selectedBranchId: string = '';
  selectedSource: 'ENROLLMENT' | 'PRODUCT_SALE' | 'MASTER_ENROLLMENT' | 'EVENT' | 'SUBSCRIPTION' | 'SESSION' | 'ALL' = 'ALL';
  startDate: string = '';
  endDate: string = '';
  totalRevenue: number = 0;
  activePreset = signal<string>('month');

  ngOnInit() {
    this.loadBranches();
    // Default to the current month (matches the dashboard's default range).
    this.setPreset('month');
  }

  private toIso(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** Apply a named date range (This Month / This Year / Last 12 Months) and reload. */
  setPreset(preset: string) {
    const now = new Date();
    this.activePreset.set(preset);
    let start: Date;
    switch (preset) {
      case 'today':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'year':
        start = new Date(now.getFullYear(), 0, 1);
        break;
      case '12months':
        start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
        break;
      case 'month':
      default:
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
    }
    this.startDate = this.toIso(start);
    this.endDate = this.toIso(now);
    this.loadRevenues();
  }

  loadBranches() {
    this.lookupService.branches().subscribe({
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

  /** Manual date-input change: drop the preset highlight, then reload. */
  onDateChange() {
    this.activePreset.set('');
    this.loadRevenues();
  }

  getSourceBadge(source: string): { severity: 'success' | 'info' | 'warn' | 'secondary'; label: string } {
    if (source === 'ENROLLMENT') return { severity: 'success', label: 'Course' };
    if (source === 'MASTER_ENROLLMENT') return { severity: 'secondary', label: 'Bundle' };
    if (source === 'EVENT') return { severity: 'warn', label: 'Event' };
    if (source === 'SUBSCRIPTION') return { severity: 'success', label: 'Subscription' };
    if (source === 'SESSION') return { severity: 'info', label: 'Session' };
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
    return branch ? branch.label : 'Unknown';
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
    } else if (revenue.source === 'SUBSCRIPTION') {
      // Monthly subscription bills have no edit page — jump to the student so the
      // user can view the enrollment and its monthly payment history.
      if (revenue.studentId) {
        this.router.navigate(['/students', revenue.studentId]);
      }
    } else if (revenue.source === 'SESSION') {
      // Per-session charges and packages live on the Session Payments dashboard.
      this.router.navigate(['/session-payments']);
    } else {
      this.router.navigate(['/products/sales']);
    }
  }
}
