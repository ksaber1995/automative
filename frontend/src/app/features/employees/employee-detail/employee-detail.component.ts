import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DividerModule } from 'primeng/divider';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { EmployeeService } from '../services/employee.service';
import { BranchService } from '../../branches/services/branch.service';
import { UserService } from '../../users/services/user.service';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ExpenseService } from '../../expenses/services/expense.service';
import { TeacherAttendanceService, TeacherAttendanceHistoryRow } from '../../attendance/services/teacher-attendance.service';
import { Employee } from '@shared/interfaces/employee.interface';
import { ExpensePayment } from '@shared/interfaces/expense.interface';
import { UserRole } from '@shared/enums/user-role.enum';
import { Branch } from '@shared/interfaces/branch.interface';

@Component({
  selector: 'app-employee-detail',
  standalone: true,
  imports: [
    CommonModule, FormsModule, CardModule, ButtonModule, TagModule, DividerModule,
    DialogModule, InputTextModule, PasswordModule, SelectModule, MultiSelectModule,
    TableModule, TooltipModule, TranslateModule,
  ],
  templateUrl: './employee-detail.component.html'
})
export class EmployeeDetailComponent implements OnInit {
  private employeeService = inject(EmployeeService);
  private branchService = inject(BranchService);
  private userService = inject(UserService);
  private authService = inject(AuthService);
  private notificationService = inject(NotificationService);
  private expenseService = inject(ExpenseService);
  private teacherAttendanceService = inject(TeacherAttendanceService);
  private translate = inject(TranslateService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  employee = signal<Employee | null>(null);
  loading = signal(true);
  branchName = signal('—');
  branches = signal<Branch[]>([]);
  converting = signal(false);
  salaryHistory = signal<ExpensePayment[]>([]);
  historyLoading = signal(false);

  attendanceHistory = signal<TeacherAttendanceHistoryRow[]>([]);
  attendanceLoading = signal(false);
  attendancePresentCount = computed(() => this.attendanceHistory().filter((r) => r.status === 'PRESENT').length);
  attendanceAbsentCount = computed(() => this.attendanceHistory().filter((r) => r.status === 'ABSENT').length);

  showConvertDialog = false;
  convertForm = {
    email: '',
    password: '',
    role: UserRole.ACADEMIC_MANAGER,
    branchIds: [] as string[],
  };

  roleOptions = [
    { label: this.translate.instant('EMPLOYEES.DETAIL.ROLE_BRANCH_ADMIN'), value: UserRole.BRANCH_ADMIN },
    { label: this.translate.instant('EMPLOYEES.DETAIL.ROLE_ACADEMIC_MANAGER'), value: UserRole.ACADEMIC_MANAGER },
    { label: this.translate.instant('EMPLOYEES.DETAIL.ROLE_SALES_MANAGER'), value: UserRole.SALES_MANAGER },
    { label: this.translate.instant('EMPLOYEES.DETAIL.ROLE_ACCOUNTANT'), value: UserRole.ACCOUNTANT },
    { label: this.translate.instant('EMPLOYEES.DETAIL.ROLE_VIEWER'), value: UserRole.VIEWER },
  ];

  canManageUsers(): boolean {
    return this.authService.canManageUsers();
  }

  getBaseSalary(item: ExpensePayment): number {
    return item.amount - (item.bonusAmount || 0) + (item.discountAmount || 0);
  }

  ngOnInit() {
    const id = this.route.snapshot.params['id'];
    this.branchService.getActiveBranches().subscribe({ next: (b) => this.branches.set(b) });
    this.employeeService.getEmployeeById(id).subscribe({
      next: (emp) => {
        this.employee.set(emp);
        this.loading.set(false);
        if (emp.email) this.convertForm.email = emp.email;
        if (emp.branchId) this.convertForm.branchIds = [emp.branchId];
        if (emp.branchId) {
          this.branchService.getActiveBranches().subscribe({
            next: (branches) => {
              const branch = branches.find(b => b.id === emp.branchId);
              this.branchName.set(branch?.name || this.translate.instant('EMPLOYEES.DETAIL.UNKNOWN_BRANCH'));
            }
          });
        } else {
          this.branchName.set(emp.isGlobal ? this.translate.instant('EMPLOYEES.DETAIL.ALL_BRANCHES') : '—');
        }
        this.loadSalaryHistory(id);
        this.loadAttendanceHistory(id);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.loading.set(false);
        this.router.navigate(['/employees']);
      }
    });
  }

  private loadSalaryHistory(employeeId: string) {
    this.historyLoading.set(true);
    this.expenseService.getEmployeeSalaryHistory(employeeId).subscribe({
      next: (history) => {
        this.salaryHistory.set(history);
        this.historyLoading.set(false);
      },
      error: () => {
        this.historyLoading.set(false);
      }
    });
  }

  private loadAttendanceHistory(employeeId: string) {
    this.attendanceLoading.set(true);
    this.teacherAttendanceService.getHistory({ employeeId }).subscribe({
      next: (rows) => {
        this.attendanceHistory.set(rows);
        this.attendanceLoading.set(false);
      },
      error: () => {
        this.attendanceHistory.set([]);
        this.attendanceLoading.set(false);
      }
    });
  }

  attendanceRoleSeverity(role: string): 'success' | 'info' | 'warn' | 'secondary' {
    if (role === 'PRIMARY') return 'success';
    if (role === 'SUBSTITUTE') return 'warn';
    return 'info';
  }

  formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }

  edit() {
    this.router.navigate(['/employees', this.employee()!.id, 'edit']);
  }

  back() {
    this.router.navigate(['/employees']);
  }

  convertToUser() {
    const f = this.convertForm;
    if (!f.email || !f.password || f.password.length < 6 || !f.role) {
      this.notificationService.error(this.translate.instant('EMPLOYEES.DETAIL.ERR_FIELDS_REQUIRED'));
      return;
    }
    this.converting.set(true);
    this.userService.convertEmployee({
      employeeId: this.employee()!.id,
      email: f.email,
      password: f.password,
      role: f.role,
      branchIds: f.branchIds,
    }).subscribe({
      next: (user) => {
        this.notificationService.success(this.translate.instant('EMPLOYEES.DETAIL.USER_CREATED', { name: `${user.firstName} ${user.lastName}` }));
        this.showConvertDialog = false;
        this.converting.set(false);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.converting.set(false);
      }
    });
  }
}
