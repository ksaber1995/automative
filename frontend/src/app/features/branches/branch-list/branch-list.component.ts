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
import { DialogModule } from 'primeng/dialog';
import { RadioButtonModule } from 'primeng/radiobutton';
import { TranslateModule } from '@ngx-translate/core';
import { BranchService, BranchDeletionImpact } from '../services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { Branch } from '@shared/interfaces/branch.interface';

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
    DialogModule,
    RadioButtonModule,
    TranslateModule
  ],
  templateUrl: './branch-list.component.html',
  styleUrl: './branch-list.component.scss'
})
export class BranchListComponent implements OnInit {
  private branchService = inject(BranchService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  authService = inject(AuthService);

  allBranches = signal<Branch[]>([]);
  loading = signal(true);
  showDeleteDialog = signal(false);
  branchToDelete = signal<Branch | null>(null);
  deletionImpact = signal<BranchDeletionImpact | null>(null);
  impactLoading = signal(false);
  deleteSubmitting = signal(false);
  studentsHandling = signal<'delete' | 'deactivate'>('deactivate');
  employeesHandling = signal<'delete' | 'deactivate'>('deactivate');

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
    this.deletionImpact.set(null);
    this.studentsHandling.set('deactivate');
    this.employeesHandling.set('deactivate');
    this.showDeleteDialog.set(true);
    this.impactLoading.set(true);
    this.branchService.getDeletionImpact(branch.id).subscribe({
      next: (impact) => {
        this.deletionImpact.set(impact);
        this.impactLoading.set(false);
        // No financials → hard delete path. CASCADE wipes everything anyway,
        // so we don't ask the user about students/employees.
        if (!impact.hasFinancials) {
          this.studentsHandling.set('delete');
          this.employeesHandling.set('delete');
        }
      },
      error: () => {
        this.impactLoading.set(false);
        this.notificationService.error('Failed to compute deletion impact');
        this.showDeleteDialog.set(false);
      }
    });
  }

  closeDeleteDialog() {
    this.showDeleteDialog.set(false);
    this.branchToDelete.set(null);
    this.deletionImpact.set(null);
  }

  deleteBranch() {
    const branch = this.branchToDelete();
    if (!branch) return;
    this.deleteSubmitting.set(true);
    this.branchService.deleteBranch(branch.id, {
      studentsHandling: this.studentsHandling(),
      employeesHandling: this.employeesHandling(),
    }).subscribe({
      next: (result) => {
        this.deleteSubmitting.set(false);
        if (result.deactivated) {
          this.notificationService.info(
            `Branch "${branch.name}" was deactivated because it has financial records.`
          );
        } else {
          this.notificationService.success(`Branch "${branch.name}" deleted successfully`);
        }
        this.loadBranches();
        this.closeDeleteDialog();
      },
      error: () => {
        this.deleteSubmitting.set(false);
        this.notificationService.error('Failed to delete branch');
      }
    });
  }

  createBranch() {
    this.router.navigate(['/branches/create']);
  }
}
