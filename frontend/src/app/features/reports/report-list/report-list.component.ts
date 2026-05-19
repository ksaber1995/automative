import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { ChartModule } from 'primeng/chart';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { TabsModule, Tab, TabList, TabPanel, TabPanels } from 'primeng/tabs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { forkJoin, of } from 'rxjs';
import { map } from 'rxjs/operators';
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
    MultiSelectModule,
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
  /**
   * Empty array = all branches (no filter, aggregated).
   * One id   = filter to that branch.
   * 2+ ids   = "compare mode" — time-series endpoints are fanned out per branch and
   *            tables/aggregates filter to the selected set.
   */
  branchIds: string[] = [];
  inactiveMonths = 3;
  branches = signal<Branch[]>([]);
  // Mirror of branchIds usable from reactive computeds.
  branchIdsSignal = signal<string[]>([]);

  // Single-branch / aggregate data (mode: branchIds.length <= 1).
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

  // Compare mode (branchIds.length >= 2). Time-series broken out per branch.
  compareSeries = signal<Array<{
    branchId: string;
    branchName: string;
    color: string;
    monthlyPL: MonthlyPLRow[];
    salary: SalaryMonthRow[];
    studentsOT: StudentMonthRow[];
    churn: ChurnSummary | null;
    expenseCats: ExpenseCategoryRow[];
  }>>([]);

  compareMode = computed(() => this.branchIdsSignal().length >= 2);

  // Stable color palette for branch series (cycles if > 12 branches).
  private readonly branchPalette = [
    '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4',
    '#ec4899', '#84cc16', '#f97316', '#6366f1', '#14b8a6', '#a855f7',
  ];

  // KPIs — aggregate selected branches in compare mode, else use monthlyPL.
  totalRevenue = computed(() => {
    if (this.compareMode()) {
      return this.compareSeries().reduce(
        (s, b) => s + b.monthlyPL.reduce((ss, r) => ss + r.revenue, 0), 0,
      );
    }
    return this.monthlyPL().reduce((s, r) => s + r.revenue, 0);
  });
  totalExpenses = computed(() => {
    if (this.compareMode()) {
      return this.compareSeries().reduce(
        (s, b) => s + b.monthlyPL.reduce((ss, r) => ss + r.expenses, 0), 0,
      );
    }
    return this.monthlyPL().reduce((s, r) => s + r.expenses, 0);
  });
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
    // Compare mode: 3 series (revenue/expenses/profit) per branch, color-coded by branch.
    if (this.compareMode()) {
      const series = this.compareSeries();
      if (!series.length) return null;
      const labels = series[0].monthlyPL.map((r) => r.month);
      const datasets: any[] = [];
      const revLabel = this.translate.instant('REPORTS.CHART_REVENUE');
      const expLabel = this.translate.instant('REPORTS.CHART_EXPENSES');
      const npLabel = this.translate.instant('REPORTS.CHART_NET_PROFIT');
      for (const b of series) {
        datasets.push({
          label: `${b.branchName} · ${revLabel}`,
          data: b.monthlyPL.map((r) => r.revenue),
          borderColor: b.color,
          backgroundColor: 'transparent',
          tension: 0.3,
        });
        datasets.push({
          label: `${b.branchName} · ${expLabel}`,
          data: b.monthlyPL.map((r) => r.expenses),
          borderColor: b.color,
          backgroundColor: 'transparent',
          tension: 0.3,
          borderDash: [6, 4],
        });
        datasets.push({
          label: `${b.branchName} · ${npLabel}`,
          data: b.monthlyPL.map((r) => r.netProfit),
          borderColor: b.color,
          backgroundColor: 'transparent',
          tension: 0.3,
          borderDash: [2, 2],
        });
      }
      return { labels, datasets };
    }

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
    if (this.compareMode()) {
      const series = this.compareSeries();
      if (!series.length) return null;
      const labels = series[0].salary.map((r) => r.month);
      return {
        labels,
        datasets: series.map((b) => ({
          label: b.branchName,
          data: b.salary.map((r) => r.total),
          backgroundColor: b.color,
        })),
      };
    }
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
    if (this.compareMode()) {
      const series = this.compareSeries();
      if (!series.length) return null;
      const labels = series[0].studentsOT.map((r) => r.month);
      const newLabel = this.translate.instant('REPORTS.CHART_NEW_STUDENTS');
      const churnedLabel = this.translate.instant('REPORTS.CHART_CHURNED');
      const datasets: any[] = [];
      for (const b of series) {
        datasets.push({
          label: `${b.branchName} · ${newLabel}`,
          data: b.studentsOT.map((r) => r.newStudents),
          backgroundColor: b.color,
        });
        datasets.push({
          label: `${b.branchName} · ${churnedLabel}`,
          data: b.studentsOT.map((r) => r.churned),
          backgroundColor: b.color + '99', // semi-transparent for churned variant
        });
      }
      return { labels, datasets };
    }
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
    const data = this.visibleTopCourses();
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
    const data = this.visibleProfitBranches();
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

  // Aggregated expenseCats narrowed to selected branches. In compare mode we
  // sum the per-branch expenseCats; otherwise the single aggregate call is the
  // authoritative answer.
  visibleExpenseCats = computed<ExpenseCategoryRow[]>(() => {
    if (this.compareMode()) {
      const byCat = new Map<string, { total: number; count: number }>();
      for (const b of this.compareSeries()) {
        for (const r of b.expenseCats) {
          const prev = byCat.get(r.category) || { total: 0, count: 0 };
          byCat.set(r.category, { total: prev.total + r.total, count: prev.count + r.count });
        }
      }
      return Array.from(byCat.entries())
        .map(([category, { total, count }]) => ({ category, total, count }))
        .sort((a, b) => b.total - a.total);
    }
    return this.expenseCats();
  });

  expenseCatChart = computed(() => {
    const data = this.visibleExpenseCats();
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

  private rangeFilters() {
    return {
      startDate: this.toIso(this.startDate),
      endDate: this.toIso(this.endDate),
    };
  }

  /** Resolve a branch's display name from the loaded branch list (fallback: id). */
  private branchNameFor(id: string): string {
    return this.branches().find((b) => b.id === id)?.name || id;
  }

  reload() {
    // Keep the signal mirror in sync so compareMode/computeds react.
    this.branchIdsSignal.set([...this.branchIds]);
    const range = this.rangeFilters();
    const ids = this.branchIdsSignal();
    this.loading.set(true);

    // Aggregates / table data — single call. For tables we always fetch the
    // company-wide rows (no branch filter) and let computed signals narrow them
    // to the selected branches; this keeps the SQL simple and means switching
    // branches is instant after the first load.
    const aggregateBranchId = ids.length === 1 ? ids[0] : undefined;
    const churnBranchId = ids.length === 1 ? ids[0] : undefined;
    const aggregate$ = forkJoin({
      monthlyPL: this.reportService.monthlyPL({ ...range, branchId: aggregateBranchId }),
      salary: this.reportService.salaryGrowth({ ...range, branchId: aggregateBranchId }),
      topCourses: this.reportService.topCourses({ ...range }),
      studentsOT: this.reportService.studentsOverTime({ ...range, branchId: aggregateBranchId }),
      churn: this.reportService.studentChurn(churnBranchId, this.inactiveMonths),
      profitCourses: this.reportService.profitByCourse({ ...range }),
      profitBranches: this.reportService.profitByBranch({ ...range }),
      profitProducts: this.reportService.profitByProduct({ ...range }),
      expenseCats: this.reportService.expensesByCategory({ ...range, branchId: aggregateBranchId }),
      profitEvents: this.reportService.profitByEvent({ ...range }),
    });

    // Compare-mode fan-out: one parallel set of time-series calls per selected
    // branch. Skipped (empty observable) when ≤1 branch is selected.
    const compare$ = ids.length >= 2
      ? forkJoin(
          ids.map((id, i) =>
            forkJoin({
              monthlyPL: this.reportService.monthlyPL({ ...range, branchId: id }),
              salary: this.reportService.salaryGrowth({ ...range, branchId: id }),
              studentsOT: this.reportService.studentsOverTime({ ...range, branchId: id }),
              churn: this.reportService.studentChurn(id, this.inactiveMonths),
              expenseCats: this.reportService.expensesByCategory({ ...range, branchId: id }),
            }).pipe(map((v) => ({ branchId: id, idx: i, ...v }))),
          ),
        )
      : of([] as Array<{ branchId: string; idx: number; monthlyPL: MonthlyPLRow[]; salary: SalaryMonthRow[]; studentsOT: StudentMonthRow[]; churn: ChurnSummary; expenseCats: ExpenseCategoryRow[] }>);

    forkJoin({ agg: aggregate$, cmp: compare$ }).subscribe({
      next: ({ agg, cmp }) => {
        this.monthlyPL.set(agg.monthlyPL);
        this.salary.set(agg.salary);
        this.topCourses.set(agg.topCourses);
        this.studentsOT.set(agg.studentsOT);
        this.churn.set(agg.churn);
        this.profitCourses.set(agg.profitCourses);
        this.profitBranches.set(agg.profitBranches);
        this.profitProducts.set(agg.profitProducts);
        this.expenseCats.set(agg.expenseCats);
        this.profitEvents.set(agg.profitEvents);

        // Stitch compare-mode per-branch data.
        if (Array.isArray(cmp) && cmp.length > 0) {
          this.compareSeries.set(
            cmp.map((b: any, i: number) => ({
              branchId: b.branchId,
              branchName: this.branchNameFor(b.branchId),
              color: this.branchPalette[i % this.branchPalette.length],
              monthlyPL: b.monthlyPL,
              salary: b.salary,
              studentsOT: b.studentsOT,
              churn: b.churn,
              expenseCats: b.expenseCats,
            })),
          );
        } else {
          this.compareSeries.set([]);
        }

        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.notifications.error(err?.error?.message || this.translate.instant('REPORTS.LOAD_FAILED'));
      },
    });
  }

  onChurnWindowChange() {
    const ids = this.branchIdsSignal();
    if (ids.length >= 2) {
      forkJoin(
        ids.map((id) => this.reportService.studentChurn(id, this.inactiveMonths)),
      ).subscribe({
        next: (results) => {
          this.compareSeries.update((curr) =>
            curr.map((b, i) => ({ ...b, churn: results[i] })),
          );
        },
      });
    } else {
      this.reportService
        .studentChurn(ids[0] || undefined, this.inactiveMonths)
        .subscribe({ next: (c) => this.churn.set(c) });
    }
  }

  resetFilters() {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 11);
    start.setDate(1);
    this.startDate = start;
    this.endDate = end;
    this.branchIds = [];
    this.branchIdsSignal.set([]);
    this.inactiveMonths = 3;
    this.reload();
  }

  // ── Branch-filter-aware views over single-call data ─────────────────────────
  // Tables/aggregates always fetch company-wide; these computeds narrow them
  // by the selected branches without round-tripping.

  private isBranchSelected(branchId: string | null | undefined): boolean {
    const ids = this.branchIdsSignal();
    if (ids.length === 0) return true; // no filter
    if (branchId == null) return false;
    return ids.includes(branchId);
  }

  visibleProfitBranches = computed(() =>
    this.profitBranches().filter((r) => this.isBranchSelected(r.branchId)),
  );
  visibleProfitCourses = computed(() => {
    const ids = this.branchIdsSignal();
    if (ids.length === 0) return this.profitCourses();
    const allowed = new Set(ids.map((id) => this.branchNameFor(id)));
    return this.profitCourses().filter((r) => allowed.has(r.branchName));
  });
  visibleProfitProducts = computed(() => {
    const ids = this.branchIdsSignal();
    if (ids.length === 0) return this.profitProducts();
    const allowed = new Set(ids.map((id) => this.branchNameFor(id)));
    return this.profitProducts().filter((r) => allowed.has(r.branchName));
  });
  visibleProfitEvents = computed(() =>
    this.profitEvents().filter((r) =>
      r.branchId == null
        ? this.branchIdsSignal().length === 0
        : this.isBranchSelected(r.branchId),
    ),
  );
  visibleTopCourses = computed(() => {
    const ids = this.branchIdsSignal();
    if (ids.length === 0) return this.topCourses();
    const allowed = new Set(ids.map((id) => this.branchNameFor(id)));
    return this.topCourses().filter((r) => allowed.has(r.branchName));
  });

  // Per-branch churn rows for the Students tab in compare mode.
  compareChurnRows = computed(() =>
    this.compareSeries().map((b) => ({ branchName: b.branchName, color: b.color, churn: b.churn })),
  );
}
