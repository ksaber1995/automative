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
import { AmountPipe } from '../../../shared/pipes/amount.pipe';
import { EmployeeService } from '../services/employee.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { Employee } from '@shared/interfaces/employee.interface';

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
    TranslateModule,
    AmountPipe,
  ],
  providers: [ConfirmationService],
  templateUrl: './employee-list.component.html',
  styleUrl: './employee-list.component.scss'
})
export class EmployeeListComponent implements OnInit {
  private employeeService = inject(EmployeeService);
  private lookupService = inject(LookupService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);
  protected branchState = inject(BranchStateService);

  /**
   * Is there anything to pay this person?
   *
   * UNPAID is the deliberate case — a founder teaching their own academy draws
   * nothing — but a figure simply never entered means the same on this column,
   * and each pay model reads its own field.
   */
  hasPay(employee: Employee): boolean {
    if (employee.salaryType === 'UNPAID') return false;
    if (employee.salaryType === 'SESSION_BASED') return (employee.sessionRate ?? 0) > 0;
    if (employee.salaryType === 'PERCENTAGE') return (employee.percentageRate ?? 0) > 0;
    return (employee.salary ?? 0) > 0;
  }

  employees = signal<Employee[]>([]);
  branches = signal<LookupOption[]>([]);
  loading = signal(true);
  selectedBranchId: string | null = null;
  statusFilter = signal<'active' | 'inactive'>('active');
  // Employee vs teacher. Filtered client-side (like statusFilter) so both counts
  // stay live off one fetch; the API also takes an `isTeacher` query param.
  roleFilter = signal<'all' | 'employee' | 'teacher'>('all');

  showAssignedClassesDialog = signal(false);
  blockedEmployee = signal<Employee | null>(null);
  blockingClasses = signal<{ id: string; name: string }[]>([]);

  filteredEmployees = computed(() => {
    const active = this.statusFilter() === 'active';
    const role = this.roleFilter();
    return this.employees().filter(e => {
      if (e.isActive !== active) return false;
      if (role === 'teacher') return e.isTeacher === true;
      if (role === 'employee') return e.isTeacher !== true;
      return true;
    });
  });

  // Status counts stay whole-list so the tab badges don't move when the
  // employee/teacher filter changes.
  activeCount = computed(() => this.employees().filter(e => e.isActive).length);
  inactiveCount = computed(() => this.employees().filter(e => !e.isActive).length);

  ngOnInit() {
    this.loadBranches();
    this.loadEmployees();
  }

  loadBranches() {
    this.lookupService.branches().subscribe({
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
    this.runDelete(employee, {
      messageKey: 'EMPLOYEES.TERMINATE_CONFIRM',
      headerKey: 'EMPLOYEES.TERMINATE_HEADER',
      successKey: 'EMPLOYEES.TERMINATED',
    });
  }

  deleteEmployee(employee: Employee) {
    this.runDelete(employee, {
      messageKey: 'EMPLOYEES.DELETE_CONFIRM',
      headerKey: 'EMPLOYEES.DELETE_HEADER',
      successKey: 'EMPLOYEES.DELETED',
    });
  }

  private runDelete(employee: Employee, keys: { messageKey: string; headerKey: string; successKey: string }) {
    this.confirmationService.confirm({
      message: this.translate.instant(keys.messageKey, {
        name: `${employee.firstName} ${employee.lastName}`,
      }),
      header: this.translate.instant(keys.headerKey),
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.employeeService.deleteEmployee(employee.id).subscribe({
          next: () => {
            this.notificationService.success(this.translate.instant(keys.successKey));
            this.loadEmployees();
          },
          error: (err) => {
            const assigned = err?.error?.assignedClasses;
            if (err?.status === 400 && Array.isArray(assigned) && assigned.length > 0) {
              this.blockedEmployee.set(employee);
              this.blockingClasses.set(assigned);
              this.showAssignedClassesDialog.set(true);
            }
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

  // Same form, teacher mode — it reads `teacher=1` to show the subject/level
  // pickers and to set isTeacher on submit.
  createTeacher() {
    this.router.navigate(['/employees/create'], { queryParams: { teacher: 1 } });
  }

  getBranchName(branchId: string | null): string {
    if (!branchId) return 'Global';
    const branch = this.branches().find(b => b.id === branchId);
    return branch ? branch.label : 'Unknown';
  }
}
