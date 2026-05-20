import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { TooltipModule } from 'primeng/tooltip';
import { TabsModule } from 'primeng/tabs';
import { ConfirmationService } from 'primeng/api';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { EmployeeService } from '../services/employee.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
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
    DialogModule,
    TooltipModule,
    TabsModule,
    TranslateModule
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
  private translate = inject(TranslateService);
  authService = inject(AuthService);

  employees = signal<Employee[]>([]);
  branches = signal<Branch[]>([]);
  loading = signal(true);
  selectedBranchId: string | null = null;
  statusFilter = signal<'active' | 'inactive'>('active');

  showAssignedClassesDialog = signal(false);
  blockedEmployee = signal<Employee | null>(null);
  blockingClasses = signal<{ id: string; name: string; code: string }[]>([]);

  filteredEmployees = computed(() => {
    const list = this.employees();
    return this.statusFilter() === 'active'
      ? list.filter(e => e.isActive)
      : list.filter(e => !e.isActive);
  });

  activeCount = computed(() => this.employees().filter(e => e.isActive).length);
  inactiveCount = computed(() => this.employees().filter(e => !e.isActive).length);

  ngOnInit() {
    this.loadBranches();
    this.loadEmployees();
  }

  loadBranches() {
    this.branchService.getAllBranches().subscribe({
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
      message: this.translate.instant('EMPLOYEES.TERMINATE_CONFIRM', {
        name: `${employee.firstName} ${employee.lastName}`,
      }),
      header: this.translate.instant('EMPLOYEES.TERMINATE_HEADER'),
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.employeeService.deleteEmployee(employee.id).subscribe({
          next: () => {
            this.notificationService.success(this.translate.instant('EMPLOYEES.TERMINATED'));
            this.loadEmployees();
          },
          error: (err) => {
            const assigned = err?.error?.assignedClasses;
            if (err?.status === 400 && Array.isArray(assigned) && assigned.length > 0) {
              // Show the specialized "assigned to classes" dialog instead of relying on the interceptor toast.
              this.blockedEmployee.set(employee);
              this.blockingClasses.set(assigned);
              this.showAssignedClassesDialog.set(true);
            }
            // Otherwise the interceptor toasted the translated error.
          }
        });
      }
    });
  }

  goToBlockingClass(classId: string) {
    this.showAssignedClassesDialog.set(false);
    this.router.navigate(['/classes', classId]);
  }

  closeAssignedClassesDialog() {
    this.showAssignedClassesDialog.set(false);
    this.blockedEmployee.set(null);
    this.blockingClasses.set([]);
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
