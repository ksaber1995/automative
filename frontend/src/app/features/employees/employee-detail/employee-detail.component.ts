import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DividerModule } from 'primeng/divider';
import { DialogModule } from 'primeng/dialog';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { EmployeeService, EmployeeCoursePercentage } from '../services/employee.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { UserService } from '../../users/services/user.service';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ExpenseService, BackPayPreview, PercentageSummary } from '../../expenses/services/expense.service';
import { SalaryBreakdownDialogComponent } from '../../expenses/salaries/salary-breakdown-dialog.component';
import { TeacherAttendanceService, TeacherAttendanceHistoryRow } from '../../attendance/services/teacher-attendance.service';
import { ClassService } from '../../courses/services/class.service';
import { Employee, SalaryType } from '@shared/interfaces/employee.interface';
import { ExpensePayment } from '@shared/interfaces/expense.interface';
import { ClassWithDetails } from '@shared/interfaces/class.interface';
import { UserRole } from '@shared/enums/user-role.enum';

@Component({
  selector: 'app-employee-detail',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink, CardModule, ButtonModule, TagModule, DividerModule,
    DialogModule, ConfirmDialogModule, InputTextModule, PasswordModule, SelectModule, MultiSelectModule,
    TableModule, TooltipModule, TranslateModule, SalaryBreakdownDialogComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './employee-detail.component.html'
})
export class EmployeeDetailComponent implements OnInit {
  private employeeService = inject(EmployeeService);
  private lookupService = inject(LookupService);
  private userService = inject(UserService);
  private authService = inject(AuthService);
  private notificationService = inject(NotificationService);
  private expenseService = inject(ExpenseService);
  private teacherAttendanceService = inject(TeacherAttendanceService);
  private classService = inject(ClassService);
  private translate = inject(TranslateService);
  private confirmationService = inject(ConfirmationService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  employee = signal<Employee | null>(null);
  loading = signal(true);
  branchName = signal('—');
  branches = signal<LookupOption[]>([]);
  converting = signal(false);
  removingUser = signal(false);

  hasLinkedUser = computed(() => !!this.employee()?.linkedUserId);

  subjectNames = computed(() => (this.employee()?.subjects ?? []).map(s => s.name).filter(Boolean).join(', '));
  levelNames = computed(() => (this.employee()?.levels ?? []).map(l => l.name).filter(Boolean).join(', '));
  salaryHistory = signal<ExpensePayment[]>([]);
  historyLoading = signal(false);

  // "How was this calculated?" for one row of the salary history.
  breakdownVisible = signal(false);
  breakdownPaymentId = signal<string | null>(null);

  openSalaryBreakdown(item: ExpensePayment): void {
    this.breakdownPaymentId.set(item.id);
    this.breakdownVisible.set(true);
  }

  attendanceHistory = signal<TeacherAttendanceHistoryRow[]>([]);
  attendanceLoading = signal(false);
  attendancePresentCount = computed(() => this.attendanceHistory().filter((r) => r.status === 'PRESENT').length);
  attendanceAbsentCount = computed(() => this.attendanceHistory().filter((r) => r.status === 'ABSENT').length);

  // Classes this teacher is assigned to (classes.instructor_id), and any
  // per-course pay overrides — a course can pay this teacher differently
  // (percentage vs. per-session, and its own rate) than their default.
  teacherClasses = signal<ClassWithDetails[]>([]);
  classesLoading = signal(false);
  coursePercentages = signal<EmployeeCoursePercentage[]>([]);

  /** The course override for a class, when that course pays this teacher differently. */
  private overrideFor(c: ClassWithDetails): EmployeeCoursePercentage | undefined {
    return this.coursePercentages().find((p) => p.courseId === c.courseId);
  }

  hasPayOverride(c: ClassWithDetails): boolean {
    return !!this.overrideFor(c);
  }

  /** PERCENTAGE / SESSION_BASED / MONTHLY / UNPAID — the override's type if the
   *  course has one, otherwise the teacher's own default salary type. */
  classPayType(c: ClassWithDetails): SalaryType {
    return this.overrideFor(c)?.payType || this.employee()?.salaryType || 'MONTHLY';
  }

  /** The rate that goes with classPayType(c) — a percentage or a session rate,
   *  null for MONTHLY/UNPAID where there's no per-class rate to show. */
  classPayRate(c: ClassWithDetails): number | null {
    const override = this.overrideFor(c);
    if (override) {
      return override.payType === 'PERCENTAGE' ? override.percentageRate : override.sessionRate;
    }
    const emp = this.employee();
    if (!emp) return null;
    if (emp.salaryType === 'PERCENTAGE') return emp.percentageRate ?? null;
    if (emp.salaryType === 'SESSION_BASED') return emp.sessionRate ?? null;
    return null;
  }

  showConvertDialog = false;
  convertForm = {
    email: '',
    password: '',
    role: UserRole.ACADEMIC_MANAGER,
    branchIds: [] as string[],
  };

  showBackPayDialog = false;
  backPayLoading = signal(false);
  backPayCreating = signal(false);
  backPayPreview = signal<BackPayPreview | null>(null);

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

  isSessionBased = computed(() => this.employee()?.salaryType === 'SESSION_BASED');
  isPercentage = computed(() => this.employee()?.salaryType === 'PERCENTAGE');

  // Live percentage earnings (accrued from what students have paid) + withdraw.
  percentageSummary = signal<PercentageSummary | null>(null);
  percentageLoading = signal(false);
  withdrawing = signal(false);

  getBaseSalary(item: ExpensePayment): number {
    return item.amount - (item.bonusAmount || 0) + (item.discountAmount || 0);
  }

  /** Per-session rate for a session-based payment = base ÷ sessions covered. */
  sessionRate(item: ExpensePayment): number {
    const count = item.sessionCount || 0;
    return count > 0 ? this.getBaseSalary(item) / count : 0;
  }

  ngOnInit() {
    const id = this.route.snapshot.params['id'];
    this.lookupService.branches().subscribe({ next: (b) => this.branches.set(b) });
    this.employeeService.getEmployeeById(id).subscribe({
      next: (emp) => {
        this.employee.set(emp);
        this.loading.set(false);
        if (emp.email) this.convertForm.email = emp.email;
        if (emp.branchId) this.convertForm.branchIds = [emp.branchId];
        if (emp.branchId) {
          this.lookupService.branches().subscribe({
            next: (branches) => {
              const branch = branches.find(b => b.id === emp.branchId);
              this.branchName.set(branch?.label || this.translate.instant('EMPLOYEES.DETAIL.UNKNOWN_BRANCH'));
            }
          });
        } else {
          this.branchName.set(emp.isGlobal ? this.translate.instant('EMPLOYEES.DETAIL.ALL_BRANCHES') : '—');
        }
        this.loadSalaryHistory(id);
        this.loadAttendanceHistory(id);
        if (emp.salaryType === 'PERCENTAGE') this.loadPercentageSummary(id);
        if (emp.isTeacher) {
          this.loadTeacherClasses(id);
          this.loadCoursePercentages(id);
        }
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.loading.set(false);
        this.router.navigate(['/employees']);
      }
    });
  }

  private loadPercentageSummary(employeeId: string) {
    this.percentageLoading.set(true);
    this.expenseService.getEmployeePercentageSummary(employeeId).subscribe({
      next: (s) => { this.percentageSummary.set(s); this.percentageLoading.set(false); },
      error: () => { this.percentageLoading.set(false); },
    });
  }

  /** Withdraw the currently-available percentage balance (accrued − withdrawn). */
  confirmWithdrawPercentage() {
    const emp = this.employee();
    const s = this.percentageSummary();
    if (!emp || !s || s.owed <= 0) return;
    this.confirmationService.confirm({
      message: this.translate.instant('EMPLOYEES.DETAIL.PCT_WITHDRAW_CONFIRM', { amount: s.owed.toFixed(2) }),
      header: this.translate.instant('EMPLOYEES.DETAIL.PCT_WITHDRAW_TITLE'),
      icon: 'pi pi-money-bill',
      acceptLabel: this.translate.instant('EMPLOYEES.DETAIL.PCT_WITHDRAW_ACCEPT'),
      rejectLabel: this.translate.instant('EMPLOYEES.DETAIL.CANCEL'),
      accept: () => {
        this.withdrawing.set(true);
        this.expenseService.payEmployeeSalary(emp.id).subscribe({
          next: () => {
            this.notificationService.success(this.translate.instant('EMPLOYEES.DETAIL.PCT_WITHDRAW_SUCCESS'));
            this.withdrawing.set(false);
            this.loadPercentageSummary(emp.id);
            this.loadSalaryHistory(emp.id);
          },
          error: () => { this.withdrawing.set(false); },
        });
      },
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

  private loadTeacherClasses(employeeId: string) {
    this.classesLoading.set(true);
    // The API returns the course/branch/instructor join and student count too
    // (ClassWithDetails), even though the service's declared type is the bare
    // Class — same cast the class list page uses for the same response shape.
    this.classService.getClassesByTeacher(employeeId).subscribe({
      next: (classes) => {
        this.teacherClasses.set(classes as unknown as ClassWithDetails[]);
        this.classesLoading.set(false);
      },
      error: () => {
        this.teacherClasses.set([]);
        this.classesLoading.set(false);
      },
    });
  }

  private loadCoursePercentages(employeeId: string) {
    this.employeeService.getCoursePercentages(employeeId).subscribe({
      next: (rates) => this.coursePercentages.set(rates),
      error: () => this.coursePercentages.set([]),
    });
  }

  /** "Sat, Mon, Wed" from the stored "SATURDAY,MONDAY,WEDNESDAY". */
  formatDaysOfWeek(days: string | null | undefined): string {
    if (!days) return '';
    return days.split(',').map((d) => this.translate.instant('CLASSES.LIST.DAY_' + d.trim())).join(', ');
  }

  /** "2:00 PM" from the stored "14:00" / "14:00:00". */
  formatClassTime(time: string | null | undefined): string {
    if (!time) return '';
    const [h, m] = time.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return time;
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString(this.translate.currentLang === 'ar' ? 'ar-EG' : 'en-US', { hour: 'numeric', minute: '2-digit' });
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

  openBackPayDialog() {
    const emp = this.employee();
    if (!emp) return;
    this.showBackPayDialog = true;
    this.backPayPreview.set(null);
    this.backPayLoading.set(true);
    this.expenseService.previewEmployeeBackPay(emp.id).subscribe({
      next: (preview) => {
        this.backPayPreview.set(preview);
        this.backPayLoading.set(false);
      },
      error: () => {
        this.backPayLoading.set(false);
        this.showBackPayDialog = false;
      }
    });
  }

  confirmBackPay() {
    const emp = this.employee();
    const preview = this.backPayPreview();
    if (!emp || !preview) return;
    this.backPayCreating.set(true);
    this.expenseService.createEmployeeBackPay(emp.id, preview.upTo).subscribe({
      next: (res) => {
        this.notificationService.success(res.message);
        this.backPayCreating.set(false);
        this.showBackPayDialog = false;
        this.loadSalaryHistory(emp.id);
      },
      error: () => {
        this.backPayCreating.set(false);
      }
    });
  }

  canCreateBackPay(): boolean {
    const p = this.backPayPreview();
    if (!p) return false;
    return p.periods.some(period => !period.alreadyPaid);
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
        // Reflect the new link so the action button swaps to "Remove user".
        const emp = this.employee();
        if (emp) this.employee.set({ ...emp, linkedUserId: user.id });
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.converting.set(false);
      }
    });
  }

  confirmRemoveUser() {
    const emp = this.employee();
    if (!emp?.linkedUserId) return;
    this.confirmationService.confirm({
      message: this.translate.instant('EMPLOYEES.DETAIL.REMOVE_USER_CONFIRM', { name: `${emp.firstName} ${emp.lastName}` }),
      header: this.translate.instant('EMPLOYEES.DETAIL.REMOVE_USER_TITLE'),
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: this.translate.instant('EMPLOYEES.DETAIL.REMOVE_USER_ACCEPT'),
      rejectLabel: this.translate.instant('EMPLOYEES.DETAIL.CANCEL'),
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => this.removeUser(),
    });
  }

  private removeUser() {
    const emp = this.employee();
    if (!emp?.linkedUserId) return;
    this.removingUser.set(true);
    this.userService.delete(emp.linkedUserId).subscribe({
      next: (res) => {
        this.notificationService.success(res.message);
        this.employee.set({ ...emp, linkedUserId: null });
        this.removingUser.set(false);
      },
      error: () => {
        this.removingUser.set(false);
      }
    });
  }
}
