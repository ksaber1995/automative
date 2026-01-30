import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { BranchService } from '../services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Branch } from '@shared/interfaces/branch.interface';

@Component({
  selector: 'app-branch-list',
  standalone: true,
  imports: [
    CommonModule,
    CardModule,
    TableModule,
    ButtonModule,
    TagModule,
    ConfirmDialogModule
  ],
  providers: [ConfirmationService],
  templateUrl: './branch-list.component.html',
  styleUrl: './branch-list.component.scss'
})
export class BranchListComponent implements OnInit {
  private branchService = inject(BranchService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);

  branches = signal<Branch[]>([]);
  loading = signal(true);

  ngOnInit() {
    this.loadBranches();
  }

  loadBranches() {
    this.loading.set(true);
    this.branchService.getAllBranches().subscribe({
      next: (branches) => {
        this.branches.set(branches);
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

  deleteBranch(branch: Branch) {
    this.confirmationService.confirm({
      message: `Are you sure you want to deactivate ${branch.name}?`,
      header: 'Confirm Deactivation',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.branchService.deleteBranch(branch.id).subscribe({
          next: () => {
            this.notificationService.success('Branch deactivated successfully');
            this.loadBranches();
          }
        });
      }
    });
  }

  createBranch() {
    this.router.navigate(['/branches/create']);
  }
}
