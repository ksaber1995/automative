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
import { forkJoin, from, of, Observable } from 'rxjs';
import { map, mergeMap, toArray } from 'rxjs/operators';
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
import { downloadCsv, CsvColumn } from '../../../core/utils/csv';

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

    // The AWS account this app runs in has a low Lambda concurrent-execution
    // quota (10). A naive forkJoin would fan out 25–35 requests at once on
    // every filter change; Lambda throttles the overflow, API Gateway returns
    // 5xx, and the user sees random "CORS" failures. Throttle the burst to
    // a safe ceiling so every request actually runs.
    const MAX_CONCURRENT = 5;
    const limitedForkJoin = <T extends Record<string, Observable<any>>>(obs: T) => {
      const entries = Object.entries(obs) as Array<[keyof T, Observable<any>]>;
      return from(entries).pipe(
        mergeMap(([k, o$]) => o$.pipe(map((v) => [k, v] as const)), MAX_CONCURRENT),
        toArray(),
        map((pairs) => Object.fromEntries(pairs) as { [K in keyof T]: T[K] extends Observable<infer R> ? R : never }),
      );
    };

    const aggregate$ = limitedForkJoin({
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
    // branch. Skipped (empty observable) when ≤1 branch is selected. Each
    // per-branch forkJoin is also throttled to keep total in-flight low.
    const compare$ = ids.length >= 2
      ? from(ids.map((id, i) => ({ id, idx: i }))).pipe(
          mergeMap(
            ({ id, idx }) =>
              limitedForkJoin({
                monthlyPL: this.reportService.monthlyPL({ ...range, branchId: id }),
                salary: this.reportService.salaryGrowth({ ...range, branchId: id }),
                studentsOT: this.reportService.studentsOverTime({ ...range, branchId: id }),
                churn: this.reportService.studentChurn(id, this.inactiveMonths),
                expenseCats: this.reportService.expensesByCategory({ ...range, branchId: id }),
              }).pipe(map((v) => ({ branchId: id, idx, ...v }))),
            // Process branches one at a time so the aggregate calls above
            // share the concurrency budget without contention.
            1,
          ),
          toArray(),
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

  // ── CSV export ───────────────────────────────────────────────────────────
  // Filename suffix: ISO date range, so files don't collide between runs.
  private rangeSuffix(): string {
    return `${this.toIso(this.startDate)}_${this.toIso(this.endDate)}`;
  }

  private csvFile(name: string): string {
    return `${name}_${this.rangeSuffix()}.csv`;
  }

  exportMonthlyPL() {
    if (this.compareMode()) {
      const rows = this.compareSeries().flatMap(b =>
        b.monthlyPL.map(r => ({ branch: b.branchName, ...r })),
      );
      const cols: CsvColumn<{ branch: string } & MonthlyPLRow>[] = [
        { header: 'Branch', value: r => r.branch },
        { header: 'Month', value: r => r.month },
        { header: 'Revenue', value: r => r.revenue },
        { header: 'Expenses', value: r => r.expenses },
        { header: 'Net Profit', value: r => r.netProfit },
      ];
      downloadCsv(this.csvFile('monthly_pl'), rows, cols);
      return;
    }
    const cols: CsvColumn<MonthlyPLRow>[] = [
      { header: 'Month', value: r => r.month },
      { header: 'Revenue', value: r => r.revenue },
      { header: 'Expenses', value: r => r.expenses },
      { header: 'Net Profit', value: r => r.netProfit },
    ];
    downloadCsv(this.csvFile('monthly_pl'), this.monthlyPL(), cols);
  }

  exportExpenseCats() {
    const cols: CsvColumn<ExpenseCategoryRow>[] = [
      { header: 'Category', value: r => r.category },
      { header: 'Total', value: r => r.total },
      { header: 'Count', value: r => r.count },
    ];
    downloadCsv(this.csvFile('expenses_by_category'), this.visibleExpenseCats(), cols);
  }

  exportSalary() {
    if (this.compareMode()) {
      const rows = this.compareSeries().flatMap(b =>
        b.salary.map(r => ({ branch: b.branchName, ...r })),
      );
      const cols: CsvColumn<{ branch: string } & SalaryMonthRow>[] = [
        { header: 'Branch', value: r => r.branch },
        { header: 'Month', value: r => r.month },
        { header: 'Total', value: r => r.total },
      ];
      downloadCsv(this.csvFile('salary_growth'), rows, cols);
      return;
    }
    const cols: CsvColumn<SalaryMonthRow>[] = [
      { header: 'Month', value: r => r.month },
      { header: 'Total', value: r => r.total },
    ];
    downloadCsv(this.csvFile('salary_growth'), this.salary(), cols);
  }

  exportStudentsOverTime() {
    if (this.compareMode()) {
      const rows = this.compareSeries().flatMap(b =>
        b.studentsOT.map(r => ({ branch: b.branchName, ...r })),
      );
      const cols: CsvColumn<{ branch: string } & StudentMonthRow>[] = [
        { header: 'Branch', value: r => r.branch },
        { header: 'Month', value: r => r.month },
        { header: 'New Students', value: r => r.newStudents },
        { header: 'Churned', value: r => r.churned },
      ];
      downloadCsv(this.csvFile('students_over_time'), rows, cols);
      return;
    }
    const cols: CsvColumn<StudentMonthRow>[] = [
      { header: 'Month', value: r => r.month },
      { header: 'New Students', value: r => r.newStudents },
      { header: 'Churned', value: r => r.churned },
    ];
    downloadCsv(this.csvFile('students_over_time'), this.studentsOT(), cols);
  }

  exportChurn() {
    if (this.compareMode()) {
      const rows = this.compareChurnRows();
      const cols: CsvColumn<typeof rows[number]>[] = [
        { header: 'Branch', value: r => r.branchName },
        { header: 'Total Students', value: r => r.churn?.totalStudents ?? 0 },
        { header: 'Active', value: r => r.churn?.activeStudents ?? 0 },
        { header: 'Churned', value: r => r.churn?.churnedStudents ?? 0 },
        { header: 'Inactive', value: r => r.churn?.inactiveStudents ?? 0 },
        { header: 'Churn Rate (%)', value: r => r.churn?.churnRate ?? 0 },
        { header: 'Inactivity Rate (%)', value: r => r.churn?.inactivityRate ?? 0 },
        { header: 'Inactive Months Window', value: r => r.churn?.inactiveMonths ?? this.inactiveMonths },
      ];
      downloadCsv(this.csvFile('churn'), rows, cols);
      return;
    }
    const c = this.churn();
    if (!c) {
      downloadCsv(this.csvFile('churn'), [], [{ header: 'Metric', value: () => '' }, { header: 'Value', value: () => '' }]);
      return;
    }
    const rows = [
      { metric: 'Total Students', value: c.totalStudents },
      { metric: 'Active', value: c.activeStudents },
      { metric: 'Churned', value: c.churnedStudents },
      { metric: 'Inactive', value: c.inactiveStudents },
      { metric: 'Churn Rate (%)', value: c.churnRate },
      { metric: 'Inactivity Rate (%)', value: c.inactivityRate },
      { metric: 'Inactive Months Window', value: c.inactiveMonths },
    ];
    const cols: CsvColumn<typeof rows[number]>[] = [
      { header: 'Metric', value: r => r.metric },
      { header: 'Value', value: r => r.value },
    ];
    downloadCsv(this.csvFile('churn'), rows, cols);
  }

  exportTopCourses() {
    const cols: CsvColumn<TopCourseRow>[] = [
      { header: 'Type', value: r => r.type },
      { header: 'Course', value: r => r.courseName },
      { header: 'Code', value: r => r.courseCode },
      { header: 'Branch', value: r => r.branchName },
      { header: 'Enrollments', value: r => r.enrollmentCount },
      { header: 'Revenue', value: r => r.revenue },
    ];
    downloadCsv(this.csvFile('top_courses'), this.visibleTopCourses(), cols);
  }

  exportProfitByCourse() {
    const cols: CsvColumn<ProfitByCourseRow>[] = [
      { header: 'Type', value: r => r.type },
      { header: 'Course', value: r => r.courseName },
      { header: 'Code', value: r => r.courseCode },
      { header: 'Branch', value: r => r.branchName },
      { header: 'Enrollments', value: r => r.enrollments },
      { header: 'Revenue', value: r => r.revenue },
      { header: 'Avg Price', value: r => r.avgPrice },
    ];
    downloadCsv(this.csvFile('profit_by_course'), this.visibleProfitCourses(), cols);
  }

  exportProfitByBranch() {
    const cols: CsvColumn<ProfitByBranchRow>[] = [
      { header: 'Branch', value: r => r.branchName },
      { header: 'Code', value: r => r.branchCode },
      { header: 'Revenue', value: r => r.revenue },
      { header: 'Expenses', value: r => r.expenses },
      { header: 'Net Profit', value: r => r.netProfit },
      { header: 'Active Students', value: r => r.activeStudents },
    ];
    downloadCsv(this.csvFile('profit_by_branch'), this.visibleProfitBranches(), cols);
  }

  exportProfitByProduct() {
    const cols: CsvColumn<ProfitByProductRow>[] = [
      { header: 'Product', value: r => r.productName },
      { header: 'Code', value: r => r.productCode },
      { header: 'Branch', value: r => r.branchName },
      { header: 'Units Sold', value: r => r.unitsSold },
      { header: 'Revenue', value: r => r.revenue },
      { header: 'Cost', value: r => r.cost },
      { header: 'Margin', value: r => r.margin },
      { header: 'Current Stock', value: r => r.currentStock },
    ];
    downloadCsv(this.csvFile('profit_by_product'), this.visibleProfitProducts(), cols);
  }

  exportProfitByEvent() {
    const cols: CsvColumn<ProfitByEventRow>[] = [
      { header: 'Event', value: r => r.name },
      { header: 'Code', value: r => r.code },
      { header: 'Type', value: r => r.eventType },
      { header: 'Branch', value: r => r.branchName },
      { header: 'Status', value: r => r.status },
      { header: 'Subscribers', value: r => r.subscriberCount },
      { header: 'Revenue', value: r => r.revenue },
      { header: 'Product Margin', value: r => r.productMargin },
      { header: 'Refunds', value: r => r.refunds },
      { header: 'Expenses', value: r => r.expenses },
      { header: 'Net Profit', value: r => r.netProfit },
    ];
    downloadCsv(this.csvFile('profit_by_event'), this.visibleProfitEvents(), cols);
  }
}
