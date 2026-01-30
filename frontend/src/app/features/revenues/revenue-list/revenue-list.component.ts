import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { RevenueService } from '../services/revenue.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Revenue } from '@shared/interfaces/revenue.interface';
import { Branch } from '@shared/interfaces/branch.interface';

@Component({
  selector: 'app-revenue-list',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, TableModule, ButtonModule, TagModule, ConfirmDialogModule],
  providers: [ConfirmationService],
  templateUrl: './revenue-list.component.html',
  styleUrl: './revenue-list.component.scss'
})
export class RevenueListComponent implements OnInit {
  private revenueService = inject(RevenueService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);

  revenues = signal<Revenue[]>([]);
  branches = signal<Branch[]>([]);
  loading = signal(true);
  selectedBranchId: string = '';
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
    if (this.startDate) params.startDate = this.startDate;
    if (this.endDate) params.endDate = this.endDate;

    this.revenueService.getAllRevenues(params).subscribe({
      next: (revenues) => {
        this.revenues.set(revenues);
        this.totalRevenue = revenues.reduce((sum, r) => sum + r.amount, 0);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  onFilterChange() {
    this.loadRevenues();
  }

  createRevenue() {
    this.router.navigate(['/revenues/create']);
  }

  editRevenue(revenue: Revenue) {
    this.router.navigate(['/revenues', revenue.id, 'edit']);
  }

  deleteRevenue(revenue: Revenue) {
    this.confirmationService.confirm({
      message: 'Are you sure you want to delete this revenue entry?',
      header: 'Confirm Delete',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.revenueService.deleteRevenue(revenue.id).subscribe({
          next: () => {
            this.notificationService.success('Revenue deleted');
            this.loadRevenues();
          }
        });
      }
    });
  }

  getBranchName(branchId: string): string {
    return this.branches().find(b => b.id === branchId)?.name || 'Unknown';
  }
}
