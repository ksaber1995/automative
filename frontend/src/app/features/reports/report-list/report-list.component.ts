import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { ChartModule } from 'primeng/chart';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { TabsModule, Tab, TabList, TabPanel, TabPanels } from 'primeng/tabs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { forkJoin } from 'rxjs';
import {
  ReportService,
  MonthlyPLRow,
  SalaryMonthRow,
  TopCourseRow,
  StudentMonthRow,
  ChurnSummary,
  ProfitByCourseRow,
  ProfitByBranchRow,
  ProfitByProductRow,
  ExpenseCategoryRow,
  ProfitByEventRow,
} from '../services/report.service';
import { BranchService } from '../../branches/services/branch.service';
import { Branch } from '@shared/interfaces/branch.interface';
import { NotificationService } from '../../../core/services/notification.service';

@Component({
  selector: 'app-report-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    ChartModule,
    TableModule,
    TagModule,
    SelectModule,
    DatePickerModule,
    InputNumberModule,
    TabsModule,
    Tab,
    TabList,
    TabPanel,
    TabPanels,
    TranslateModule,
  ],
  templateUrl: './report-list.component.html',
})
export class ReportListComponent implements OnInit {
  private reportService = inject(ReportService);
  private branchService = inject(BranchService);
  private notifications = inject(NotificationService);
  private translate = inject(TranslateService);

  // Filters
  startDate: Date;
  endDate: Date;
  branchId: string | null = null;
  inactiveMonths = 3;
  branches = signal<Branch[]>([]);

  // Data
  loading = signal(false);
  monthlyPL = signal<MonthlyPLRow[]>([]);
  salary = signal<SalaryMonthRow[]>([]);
  topCourses = signal<TopCourseRow[]>([]);
  studentsOT = signal<StudentMonthRow[]>([]);
  churn = signal<ChurnSummary | null>(null);
  profitCourses = signal<ProfitByCourseRow[]>([]);
  profitBranches = signal<ProfitByBranchRow[]>([]);
  profitProducts = signal<ProfitByProductRow[]>([]);
  expenseCats = signal<ExpenseCategoryRow[]>([]);
  profitEvents = signal<ProfitByEventRow[]>([]);

  // KPIs
  totalRevenue = computed(() => this.monthlyPL().reduce((s, r) => s + r.revenue, 0));
  totalExpenses = computed(() => this.monthlyPL().reduce((s, r) => s + r.expenses, 0));
  totalNetProfit = computed(() => this.totalRevenue() - this.totalExpenses());
  margin = computed(() => {
    const rev = this.totalRevenue();
    return rev > 0 ? (this.totalNetProfit() / rev) * 100 : 0;
  });

  branchOptions = computed(() =>
    this.branches().map((b) => ({ label: b.name, value: b.id }))
  );

  // Chart options
  lineOpts: any = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom' } },
    scales: { y: { beginAtZero: true } },
  };
  barOpts: any = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom' } },
    scales: { y: { beginAtZero: true } },
  };
  horizontalBarOpts: any = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { x: { beginAtZero: true } },
  };
  stackedBarOpts: any = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom' } },
    scales: { x: { stacked: false }, y: { beginAtZero: true, stacked: false } },
  };
  donutOpts: any = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'right' } },
    cutout: '60%',
  };

  monthlyPLChart = computed(() => {
    const data = this.monthlyPL();
    if (!data.length) return null;
    return {
      labels: data.map((r) => r.month),
      datasets: [
        {
          label: this.translate.instant('REPORTS.CHART_REVENUE'),
          data: data.map((r) => r.revenue),
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.15)',
          tension: 0.3,
        },
        {
          label: this.translate.instant('REPORTS.CHART_EXPENSES'),
          data: data.map((r) => r.expenses),
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.15)',
          tension: 0.3,
        },
        {
          label: this.translate.instant('REPORTS.CHART_NET_PROFIT'),
          data: data.map((r) => r.netProfit),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.15)',
          tension: 0.3,
          borderDash: [5, 5],
        },
      ],
    };
  });

  salaryChart = computed(() => {
    const data = this.salary();
    if (!data.length) return null;
    return {
      labels: data.map((r) => r.month),
      datasets: [
        {
          label: this.translate.instant('REPORTS.CHART_SALARIES'),
          data: data.map((r) => r.total),
          backgroundColor: '#8b5cf6',
        },
      ],
    };
  });

  studentsChart = computed(() => {
    const data = this.studentsOT();
    if (!data.length) return null;
    return {
      labels: data.map((r) => r.month),
      datasets: [
        {
          label: this.translate.instant('REPORTS.CHART_NEW_STUDENTS'),
          data: data.map((r) => r.newStudents),
          backgroundColor: '#10b981',
        },
        {
          label: this.translate.instant('REPORTS.CHART_CHURNED'),
          data: data.map((r) => r.churned),
          backgroundColor: '#ef4444',
        },
      ],
    };
  });

  topCoursesChart = computed(() => {
    const data = this.topCourses();
    if (!data.length) return null;
    // Color master bundles purple to distinguish from single-course rows.
    const colors = data.map((r) => (r.type === 'MASTER' ? '#8b5cf6' : '#3b82f6'));
    return {
      labels: data.map((r) => (r.type === 'MASTER' ? `🎁 ${r.courseName}` : r.courseName)),
      datasets: [
        {
          label: this.translate.instant('REPORTS.CHART_ENROLLMENTS'),
          data: data.map((r) => r.enrollmentCount),
          backgroundColor: colors,
        },
      ],
    };
  });

  branchChart = computed(() => {
    const data = this.profitBranches();
    if (!data.length) return null;
    return {
      labels: data.map((b) => b.branchName),
      datasets: [
        {
          label: this.translate.instant('REPORTS.CHART_REVENUE'),
          data: data.map((b) => b.revenue),
          backgroundColor: '#10b981',
        },
        {
          label: this.translate.instant('REPORTS.CHART_EXPENSES'),
          data: data.map((b) => b.expenses),
          backgroundColor: '#ef4444',
        },
        {
          label: this.translate.instant('REPORTS.CHART_NET_PROFIT'),
          data: data.map((b) => b.netProfit),
          backgroundColor: '#3b82f6',
        },
      ],
    };
  });

  eventTotalRevenue = computed(() => this.profitEvents().reduce((s, r) => s + r.revenue + r.productMargin, 0));
  eventTotalExpenses = computed(() => this.profitEvents().reduce((s, r) => s + r.expenses + r.refunds, 0));
  eventTotalNetProfit = computed(() => this.profitEvents().reduce((s, r) => s + r.netProfit, 0));

  eventChart = computed(() => {
    const data = this.profitEvents();
    if (!data.length) return null;
    return {
      labels: data.map((e) => e.name),
      datasets: [
        {
          label: this.translate.instant('REPORTS.CHART_REVENUE'),
          data: data.map((e) => e.revenue + e.productMargin),
          backgroundColor: '#10b981',
        },
        {
          label: this.translate.instant('REPORTS.CHART_EXPENSES'),
          data: data.map((e) => e.expenses + e.refunds),
          backgroundColor: '#ef4444',
        },
        {
          label: this.translate.instant('REPORTS.CHART_NET_PROFIT'),
          data: data.map((e) => e.netProfit),
          backgroundColor: '#3b82f6',
        },
      ],
    };
  });

  eventStatusSeverity(status: string): 'success' | 'info' | 'warn' | 'secondary' | 'danger' {
    switch (status) {
      case 'ACTIVE': return 'success';
      case 'PLANNED': return 'info';
      case 'COMPLETED': return 'secondary';
      case 'CANCELLED': return 'danger';
      default: return 'info';
    }
  }

  expenseCatChart = computed(() => {
    const data = this.expenseCats();
    if (!data.length) return null;
    const palette = ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e'];
    return {
      labels: data.map((r) => r.category),
      datasets: [
        {
          data: data.map((r) => r.total),
          backgroundColor: data.map((_, i) => palette[i % palette.length]),
        },
      ],
    };
  });

  constructor() {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 11);
    start.setDate(1);
    this.startDate = start;
    this.endDate = end;
  }

  ngOnInit() {
    this.branchService.getAllBranches().subscribe({
      next: (rows) => this.branches.set(rows),
    });
    this.reload();
  }

  private toIso(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private filters() {
    return {
      startDate: this.toIso(this.startDate),
      endDate: this.toIso(this.endDate),
      branchId: this.branchId || undefined,
    };
  }

  reload() {
    const f = this.filters();
    this.loading.set(true);
    forkJoin({
      monthlyPL: this.reportService.monthlyPL(f),
      salary: this.reportService.salaryGrowth(f),
      topCourses: this.reportService.topCourses(f),
      studentsOT: this.reportService.studentsOverTime(f),
      churn: this.reportService.studentChurn(f.branchId, this.inactiveMonths),
      profitCourses: this.reportService.profitByCourse(f),
      profitBranches: this.reportService.profitByBranch(f),
      profitProducts: this.reportService.profitByProduct(f),
      expenseCats: this.reportService.expensesByCategory(f),
      profitEvents: this.reportService.profitByEvent(f),
    }).subscribe({
      next: (res) => {
        this.monthlyPL.set(res.monthlyPL);
        this.salary.set(res.salary);
        this.topCourses.set(res.topCourses);
        this.studentsOT.set(res.studentsOT);
        this.churn.set(res.churn);
        this.profitCourses.set(res.profitCourses);
        this.profitBranches.set(res.profitBranches);
        this.profitProducts.set(res.profitProducts);
        this.expenseCats.set(res.expenseCats);
        this.profitEvents.set(res.profitEvents);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.notifications.error(err?.error?.message || this.translate.instant('REPORTS.LOAD_FAILED'));
      },
    });
  }

  onChurnWindowChange() {
    this.reportService
      .studentChurn(this.branchId || undefined, this.inactiveMonths)
      .subscribe({ next: (c) => this.churn.set(c) });
  }

  resetFilters() {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 11);
    start.setDate(1);
    this.startDate = start;
    this.endDate = end;
    this.branchId = null;
    this.inactiveMonths = 3;
    this.reload();
  }
}
