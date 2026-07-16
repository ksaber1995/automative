import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { TabsModule } from 'primeng/tabs';
import { ExpenseService } from '../services/expense.service';
import { InstallmentService } from '../services/installment.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { EmployeeService } from '../../employees/services/employee.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { Expense, ExpensePayment } from '@shared/interfaces/expense.interface';
import { Employee } from '@shared/interfaces/employee.interface';
import { InstallmentPlan } from '@shared/interfaces/installment.interface';
import { DeleteConfirmDialogComponent } from '../../../shared/components/delete-confirm-dialog/delete-confirm-dialog.component';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { toLocalYmd } from '../../../core/utils/date.util';

type ExpenseTab = 'all' | 'due' | 'direct' | 'salaries' | 'installments' | 'events';

@Component({
  selector: 'app-expense-list',
  standalone: true,
  imports: [
    CommonModule, FormsModule, CardModule, TableModule, ButtonModule, TooltipModule,
    TagModule, DialogModule, DatePickerModule, InputNumberModule, InputTextModule,
    TextareaModule, TabsModule, DeleteConfirmDialogComponent, TranslateModule
  ],
  templateUrl: './expense-list.component.html',
  styleUrl: './expense-list.component.scss'
})
export class ExpenseListComponent implements OnInit {
  private expenseService = inject(ExpenseService);
  private installmentService = inject(InstallmentService);
  private lookupService = inject(LookupService);
  private employeeService = inject(EmployeeService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);
  protected branchState = inject(BranchStateService);

  expenses = signal<Expense[]>([]);
  branches = signal<LookupOption[]>([]);
  employees = signal<Employee[]>([]);
  loading = signal(true);

  // Tab state
  activeTab = signal<ExpenseTab>('all');

  // Per-tab data
  dueItems = signal<any[]>([]);
  dueLoading = signal(false);
  dueMonth = signal<string>(new Date().toISOString().substring(0, 7));
  dueTotal = signal<number>(0);

  salaryPayments = signal<ExpensePayment[]>([]);
  salaryLoading = signal(false);

  installmentPlans = signal<InstallmentPlan[]>([]);
  installmentLoading = signal(false);

  // Derived row counts for tab badges
  directCount = computed(() =>
    this.expenses().filter(e => !e.eventId && (e.category as string) !== 'SALARIES').length
  );
  eventsCount = computed(() => this.expenses().filter(e => !!e.eventId).length);

  filteredExpenses = computed(() => {
    const all = this.expenses();
    switch (this.activeTab()) {
      case 'direct':
        return all.filter(e => !e.eventId && (e.category as string) !== 'SALARIES');
      case 'events':
        return all.filter(e => !!e.eventId);
      case 'all':
      default:
        return all;
    }
  });

  filteredTotal = computed(() =>
    this.filteredExpenses().reduce((sum, e) => sum + e.amount, 0)
  );

  // Filters
  selectedBranchId: string = '';
  selectedType: string = '';
  selectedCategory: string = '';
  selectedRecurring: string = '';
  startDate: string = '';
  endDate: string = '';

  totalExpenses: number = 0;

  // Delete dialog
  showDeleteDialog = false;
  expenseToDelete = signal<Expense | null>(null);

  // Record payment dialog
  showPaymentDialog = false;
  expenseForPayment = signal<Expense | null>(null);
  paymentAmount: number = 0;
  paymentDate: Date = new Date();
  paymentNotes: string = '';
  paymentVendor: string = '';
  paymentInvoiceNumber: string = '';
  recordingPayment = signal(false);

  // Pay salaries dialog
  showSalariesDialog = false;
  salariesDate: Date = new Date();
  salariesBranchId: string = '';
  payingSalaries = signal(false);

  categories = [
    'SALARIES','RENT','UTILITIES','ELECTRICITY','INTERNET','WATER',
    'MARKETING','SUPPLIES','EQUIPMENT','MAINTENANCE','INSURANCE',
    'SOFTWARE','ADMINISTRATION','COGS','INVENTORY','OTHER'
  ];

  ngOnInit() {
    this.loadBranches();
    this.employeeService.getAllEmployees().subscribe({
      next: (emps) => this.employees.set(emps),
    });
    this.loadExpenses();
  }

  loadBranches() {
    this.lookupService.branches().subscribe({
      next: (branches) => this.branches.set(branches)
    });
  }

  loadExpenses() {
    this.loading.set(true);
    const params: any = {};
    if (this.selectedBranchId) params.branchId = this.selectedBranchId;
    if (this.selectedType) params.type = this.selectedType;
    if (this.selectedCategory) params.category = this.selectedCategory;
    if (this.selectedRecurring) params.isRecurring = this.selectedRecurring;
    if (this.startDate) params.startDate = this.startDate;
    if (this.endDate) params.endDate = this.endDate;

    this.expenseService.getAllExpenses(params).subscribe({
      next: (expenses) => {
        this.expenses.set(expenses);
        this.totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  onFilterChange() {
    this.loadExpenses();
  }

  setTab(tab: ExpenseTab) {
    this.activeTab.set(tab);
    if (tab === 'due' && this.dueItems().length === 0) {
      this.loadDue();
    } else if (tab === 'salaries' && this.salaryPayments().length === 0) {
      this.loadSalaryPayments();
    } else if (tab === 'installments' && this.installmentPlans().length === 0) {
      this.loadInstallments();
    }
  }

  loadDue() {
    this.dueLoading.set(true);
    this.expenseService.getDue(this.dueMonth()).subscribe({
      next: (res) => {
        this.dueItems.set(res.items || []);
        this.dueTotal.set(res.totalDue || 0);
        this.dueLoading.set(false);
      },
      error: () => this.dueLoading.set(false),
    });
  }

  loadSalaryPayments() {
    this.salaryLoading.set(true);
    const params: any = { category: 'SALARIES' };
    if (this.selectedBranchId) params.branchId = this.selectedBranchId;
    if (this.startDate) params.startDate = this.startDate;
    if (this.endDate) params.endDate = this.endDate;
    this.expenseService.getAllPayments(params).subscribe({
      next: (payments) => {
        this.salaryPayments.set(payments.filter(p => !!p.employeeId));
        this.salaryLoading.set(false);
      },
      error: () => this.salaryLoading.set(false),
    });
  }

  loadInstallments() {
    this.installmentLoading.set(true);
    const params: any = {};
    if (this.selectedBranchId) params.branchId = this.selectedBranchId;
    this.installmentService.list(params).subscribe({
      next: (plans) => {
        this.installmentPlans.set(plans);
        this.installmentLoading.set(false);
      },
      error: () => this.installmentLoading.set(false),
    });
  }

  getEmployeeName(employeeId?: string | null): string {
    if (!employeeId) return '—';
    const e = this.employees().find(x => x.id === employeeId);
    return e ? `${e.firstName} ${e.lastName}` : 'Unknown';
  }

  installmentProgress(plan: InstallmentPlan): string {
    const paid = plan.paidCount ?? 0;
    return `${paid} / ${plan.monthsCount}`;
  }

  installmentStatusSeverity(status: string): 'success' | 'info' | 'warn' | 'secondary' | 'danger' {
    if (status === 'COMPLETED') return 'success';
    if (status === 'CANCELED') return 'danger';
    return 'info';
  }

  dueItemTypeSeverity(type: string): 'success' | 'info' | 'warn' | 'secondary' {
    if (type === 'salary') return 'warn';
    if (type === 'recurring') return 'info';
    return 'secondary';
  }

  goToDuesPay(item: any) {
    // Recurring → expense detail (pay button), Salary → salaries page.
    if (item.type === 'salary') {
      this.router.navigate(['/expenses/salaries']);
    } else if (item.templateId) {
      this.router.navigate(['/expenses', item.templateId]);
    }
  }

  goToInstallmentDetail(plan: InstallmentPlan) {
    this.router.navigate(['/expenses/installments', plan.id]);
  }

  clearFilters() {
    this.selectedBranchId = '';
    this.selectedType = '';
    this.selectedCategory = '';
    this.selectedRecurring = '';
    this.startDate = '';
    this.endDate = '';
    this.loadExpenses();
  }

  createExpense() {
    this.router.navigate(['/expenses/create']);
  }

  editExpense(expense: Expense) {
    this.router.navigate(['/expenses', expense.id, 'edit']);
  }

  confirmDelete(expense: Expense) {
    this.expenseToDelete.set(expense);
    this.showDeleteDialog = true;
  }

  deleteExpense() {
    const expense = this.expenseToDelete();
    if (!expense) return;
    this.expenseService.deleteExpense(expense.id).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('EXPENSES.DELETED'));
        this.showDeleteDialog = false;
        this.expenseToDelete.set(null);
        this.loadExpenses();
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.showDeleteDialog = false;
      }
    });
  }

  openPaymentDialog(expense: Expense) {
    this.expenseForPayment.set(expense);
    this.paymentAmount = expense.amount;
    this.paymentDate = new Date();
    this.paymentNotes = '';
    this.paymentVendor = expense.vendor || '';
    this.paymentInvoiceNumber = '';
    this.showPaymentDialog = true;
  }

  confirmRecordPayment() {
    const expense = this.expenseForPayment();
    if (!expense) return;

    this.recordingPayment.set(true);
    const dateStr = toLocalYmd(this.paymentDate);

    this.expenseService.recordPayment({
      expenseId: expense.id,
      type: expense.type,
      category: expense.category,
      amount: this.paymentAmount,
      date: dateStr,
      branchId: expense.branchId,
      notes: this.paymentNotes || undefined,
      vendor: this.paymentVendor || undefined,
      invoiceNumber: this.paymentInvoiceNumber || undefined,
    }).subscribe({
      next: () => {
        this.recordingPayment.set(false);
        this.notificationService.success(this.translate.instant('EXPENSES.PAYMENT_RECORDED'));
        this.showPaymentDialog = false;
        this.loadExpenses();
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.recordingPayment.set(false);
      }
    });
  }

  openSalariesDialog() {
    this.salariesDate = new Date();
    this.salariesBranchId = '';
    this.showSalariesDialog = true;
  }

  viewExpense(expense: Expense) {
    this.router.navigate(['/expenses', expense.id]);
  }

  goToManageRecurring() {
    this.router.navigate(['/expenses/manage-recurring']);
  }

  goToInstallments() {
    this.router.navigate(['/expenses/installments']);
  }

  goToSalaries() {
    this.router.navigate(['/expenses/salaries']);
  }

  confirmPaySalaries() {
    this.payingSalaries.set(true);
    const dateStr = toLocalYmd(this.salariesDate);

    this.expenseService.paySalaries(dateStr, this.salariesBranchId || undefined).subscribe({
      next: () => {
        this.payingSalaries.set(false);
        this.showSalariesDialog = false;
        this.notificationService.success(this.translate.instant('SALARIES.PAID'));
        this.loadExpenses();
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.payingSalaries.set(false);
        this.showSalariesDialog = false;
      }
    });
  }

  getBranchName(branchId?: string | null): string {
    if (!branchId) return 'Global/Shared';
    return this.branches().find(b => b.id === branchId)?.label || 'Unknown';
  }

  getTypeColor(type: string): 'success' | 'info' | 'warn' | 'danger' {
    switch (type) {
      case 'FIXED': return 'info';
      case 'VARIABLE': return 'success';
      case 'SHARED': return 'warn';
      case 'CAPITAL': return 'danger';
      default: return 'info';
    }
  }

  getPaymentStatus(expense: Expense): { label: string; severity: 'success' | 'warn' | 'danger' | 'secondary' } {
    const totalPaid = expense.totalPaid ?? 0;
    if (totalPaid >= expense.amount) {
      return { label: 'EXPENSES.LIST.PAYMENT_STATUS_PAID', severity: 'success' };
    } else if (totalPaid > 0) {
      return { label: 'EXPENSES.LIST.PAYMENT_STATUS_PARTIAL', severity: 'warn' };
    }
    return { label: 'EXPENSES.LIST.PAYMENT_STATUS_UNPAID', severity: 'danger' };
  }
}
