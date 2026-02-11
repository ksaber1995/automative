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
import { Branch } from '@shared/interfaces/branch.interface';

@Component({
  selector: 'app-revenue-list',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, TableModule, ButtonModule, TagModule],
  templateUrl: './revenue-list.component.html',
  styleUrl: './revenue-list.component.scss'
})
export class RevenueListComponent implements OnInit {
  private revenueService = inject(RevenueService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);

  revenues = signal<RevenueItem[]>([]);
  branches = signal<Branch[]>([]);
  loading = signal(true);
  selectedBranchId: string = '';
  selectedSource: 'ENROLLMENT' | 'PRODUCT_SALE' | 'ALL' = 'ALL';
  startDate: string = '';
  endDate: string = '';
  totalRevenue: number = 0;

  ngOnInit() {
    this.loadBranches();
    this.loadRevenues();
  }

  loadBranches() {
    this.branchService.getActiveBranches().subscribe({
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
        this.totalRevenue = revenues.reduce((sum: number, r: RevenueItem) => sum + r.amount, 0);
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

  getSourceBadge(source: string): { severity: 'success' | 'info' | 'warn'; label: string } {
    return source === 'ENROLLMENT'
      ? { severity: 'success', label: 'Course' }
      : { severity: 'info', label: 'Product' };
  }

  getBranchName(branchId: string): string {
    const branch = this.branches().find(b => b.id === branchId);
    return branch ? branch.name : 'Unknown';
  }
}
