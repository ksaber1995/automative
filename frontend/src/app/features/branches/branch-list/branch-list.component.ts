import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { SelectModule } from 'primeng/select';
import { BranchService } from '../services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Branch } from '@shared/interfaces/branch.interface';
import { DeleteConfirmDialogComponent } from '../../../shared/components/delete-confirm-dialog/delete-confirm-dialog.component';

@Component({
  selector: 'app-branch-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    TableModule,
    ButtonModule,
    TagModule,
    TooltipModule,
    SelectModule,
    DeleteConfirmDialogComponent
  ],
  templateUrl: './branch-list.component.html',
  styleUrl: './branch-list.component.scss'
})
export class BranchListComponent implements OnInit {
  private branchService = inject(BranchService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);

  allBranches = signal<Branch[]>([]);
  loading = signal(true);
  showDeleteDialog = false;
  branchToDelete = signal<Branch | null>(null);

  // Filter state
  private statusFilterSignal = signal<'all' | 'active' | 'inactive'>('all');

  statusFilterOptions = [
    { label: 'All Branches', value: 'all' },
    { label: 'Active Only', value: 'active' },
    { label: 'Inactive Only', value: 'inactive' }
  ];

  // Getter/setter for ngModel compatibility
  get statusFilter() {
    return this.statusFilterSignal();
  }
  set statusFilter(value: 'all' | 'active' | 'inactive') {
    this.statusFilterSignal.set(value);
  }

  // Computed filtered branches based on status filter
  branches = computed(() => {
    const all = this.allBranches();
    const filter = this.statusFilterSignal();
    if (filter === 'active') {
      return all.filter(b => b.isActive);
    } else if (filter === 'inactive') {
      return all.filter(b => !b.isActive);
    }
    return all;
  });

  ngOnInit() {
    this.loadBranches();
  }

  loadBranches() {
    this.loading.set(true);
    this.branchService.getAllBranches().subscribe({
      next: (branches) => {
        this.allBranches.set(branches);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }

  viewBranch(branch: Branch) {
    this.router.navigate(['/branches', branch.id]);
  }

  editBranch(branch: Branch) {
    this.router.navigate(['/branches', branch.id, 'edit']);
  }

  confirmDelete(branch: Branch) {
    this.branchToDelete.set(branch);
    this.showDeleteDialog = true;
  }

  deleteBranch() {
    const branch = this.branchToDelete();
    if (!branch) return;

    this.branchService.deleteBranch(branch.id).subscribe({
      next: () => {
        this.notificationService.success('Branch deleted successfully');
        this.loadBranches();
        this.showDeleteDialog = false;
        this.branchToDelete.set(null);
      },
      error: () => {
        this.notificationService.error('Failed to delete branch');
        this.showDeleteDialog = false;
      }
    });
  }

  createBranch() {
    this.router.navigate(['/branches/create']);
  }
}
