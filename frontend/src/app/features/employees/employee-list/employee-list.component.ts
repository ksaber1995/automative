import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService } from 'primeng/api';
import { EmployeeService } from '../services/employee.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Employee } from '@shared/interfaces/employee.interface';
import { Branch } from '@shared/interfaces/branch.interface';

@Component({
  selector: 'app-employee-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    TableModule,
    ButtonModule,
    TagModule,
    ConfirmDialogModule,
    TooltipModule
  ],
  providers: [ConfirmationService],
  templateUrl: './employee-list.component.html',
  styleUrl: './employee-list.component.scss'
})
export class EmployeeListComponent implements OnInit {
  private employeeService = inject(EmployeeService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);

  employees = signal<Employee[]>([]);
  branches = signal<Branch[]>([]);
  loading = signal(true);
  selectedBranchId: string | null = null;

  ngOnInit() {
    this.loadBranches();
    this.loadEmployees();
  }

  loadBranches() {
    this.branchService.getActiveBranches().subscribe({
      next: (branches) => {
        this.branches.set(branches);
      }
    });
  }

  loadEmployees() {
    this.loading.set(true);
    if (this.selectedBranchId) {
      this.employeeService.getEmployeesByBranch(this.selectedBranchId).subscribe({
        next: (employees) => {
          this.employees.set(employees);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        }
      });
    } else {
      this.employeeService.getAllEmployees().subscribe({
        next: (employees) => {
          this.employees.set(employees);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        }
      });
    }
  }

  onBranchFilterChange() {
    this.loadEmployees();
  }

  viewEmployee(employee: Employee) {
    this.router.navigate(['/employees', employee.id]);
  }

  editEmployee(employee: Employee) {
    this.router.navigate(['/employees', employee.id, 'edit']);
  }

  terminateEmployee(employee: Employee) {
    this.confirmationService.confirm({
      message: `Are you sure you want to terminate ${employee.firstName} ${employee.lastName}?`,
      header: 'Confirm Termination',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.employeeService.deleteEmployee(employee.id).subscribe({
          next: () => {
            this.notificationService.success('Employee terminated successfully');
            this.loadEmployees();
          }
        });
      }
    });
  }

  createEmployee() {
    this.router.navigate(['/employees/create']);
  }

  getBranchName(branchId: string | null): string {
    if (!branchId) return 'Global';
    const branch = this.branches().find(b => b.id === branchId);
    return branch ? branch.name : 'Unknown';
  }
}
