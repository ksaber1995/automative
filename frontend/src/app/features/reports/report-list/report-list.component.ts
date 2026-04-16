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
  template: `
    <div class="container-custom py-6">
      <div class="mb-4">
        <h1 class="text-3xl font-bold text-gray-900">{{ 'REPORTS.TITLE' | translate }}</h1>
        <p class="text-gray-600 mt-1">{{ 'REPORTS.SUBTITLE' | translate }}</p>
      </div>

      <!-- Filters -->
      <p-card styleClass="mb-4">
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'REPORTS.START_DATE' | translate }}</label>
            <p-datepicker
              [(ngModel)]="startDate"
              dateFormat="yy-mm-dd"
              [showIcon]="true"
              [style]="{ width: '100%' }"
              styleClass="w-full"
            ></p-datepicker>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'REPORTS.END_DATE' | translate }}</label>
            <p-datepicker
              [(ngModel)]="endDate"
              dateFormat="yy-mm-dd"
              [showIcon]="true"
              [style]="{ width: '100%' }"
              styleClass="w-full"
            ></p-datepicker>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'REPORTS.BRANCH' | translate }}</label>
            <p-select
              [(ngModel)]="branchId"
              [options]="branchOptions()"
              optionLabel="label"
              optionValue="value"
              [placeholder]="'REPORTS.ALL_BRANCHES' | translate"
              [showClear]="true"
              [style]="{ width: '100%' }"
              appendTo="body"
            ></p-select>
          </div>
          <div class="flex items-end gap-2">
            <p-button
              icon="pi pi-refresh"
              [label]="'REPORTS.APPLY' | translate"
              [loading]="loading()"
              (onClick)="reload()"
            ></p-button>
            <p-button
              icon="pi pi-filter-slash"
              severity="secondary"
              [outlined]="true"
              (onClick)="resetFilters()"
            ></p-button>
          </div>
        </div>
      </p-card>

      <!-- KPI cards -->
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
        <p-card>
          <div class="text-sm text-gray-500">{{ 'REPORTS.KPI_REVENUE' | translate }}</div>
          <div class="text-2xl font-bold text-green-700">{{ totalRevenue() | number:'1.0-0' }}</div>
        </p-card>
        <p-card>
          <div class="text-sm text-gray-500">{{ 'REPORTS.KPI_EXPENSES' | translate }}</div>
          <div class="text-2xl font-bold text-red-700">{{ totalExpenses() | number:'1.0-0' }}</div>
        </p-card>
        <p-card>
          <div class="text-sm text-gray-500">{{ 'REPORTS.KPI_NET_PROFIT' | translate }}</div>
          <div class="text-2xl font-bold" [class.text-green-700]="totalNetProfit() >= 0" [class.text-red-700]="totalNetProfit() < 0">
            {{ totalNetProfit() | number:'1.0-0' }}
          </div>
        </p-card>
        <p-card>
          <div class="text-sm text-gray-500">{{ 'REPORTS.KPI_MARGIN' | translate }}</div>
          <div class="text-2xl font-bold text-blue-700">{{ margin() | number:'1.1-1' }}%</div>
        </p-card>
      </div>

      <p-tabs value="0">
        <p-tablist>
          <p-tab value="0"><i class="pi pi-chart-line mr-2"></i>{{ 'REPORTS.TAB_FINANCIAL' | translate }}</p-tab>
          <p-tab value="1"><i class="pi pi-users mr-2"></i>{{ 'REPORTS.TAB_STUDENTS' | translate }}</p-tab>
          <p-tab value="2"><i class="pi pi-book mr-2"></i>{{ 'REPORTS.TAB_COURSES' | translate }}</p-tab>
          <p-tab value="3"><i class="pi pi-building mr-2"></i>{{ 'REPORTS.TAB_BRANCHES' | translate }}</p-tab>
          <p-tab value="4"><i class="pi pi-box mr-2"></i>{{ 'REPORTS.TAB_PRODUCTS' | translate }}</p-tab>
        </p-tablist>

        <p-tabpanels>
          <!-- ── FINANCIAL ──────────────────────────────────────── -->
          <p-tabpanel value="0">
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-4">
              <p-card>
                <ng-template pTemplate="header">
                  <div class="px-6 pt-4 pb-2">
                    <h3 class="text-lg font-semibold">{{ 'REPORTS.MONTHLY_PL_TITLE' | translate }}</h3>
                    <p class="text-sm text-gray-500">{{ 'REPORTS.MONTHLY_PL_DESC' | translate }}</p>
                  </div>
                </ng-template>
                @if (monthlyPLChart()) {
                  <p-chart type="line" [data]="monthlyPLChart()" [options]="lineOpts" [style]="{ height: '320px' }"></p-chart>
                }
              </p-card>

              <p-card>
                <ng-template pTemplate="header">
                  <div class="px-6 pt-4 pb-2">
                    <h3 class="text-lg font-semibold">{{ 'REPORTS.EXPENSES_CAT_TITLE' | translate }}</h3>
                    <p class="text-sm text-gray-500">{{ 'REPORTS.EXPENSES_CAT_DESC' | translate }}</p>
                  </div>
                </ng-template>
                @if (expenseCatChart()) {
                  <p-chart type="doughnut" [data]="expenseCatChart()" [options]="donutOpts" [style]="{ height: '320px' }"></p-chart>
                }
              </p-card>

              <p-card styleClass="lg:col-span-2">
                <ng-template pTemplate="header">
                  <div class="px-6 pt-4 pb-2">
                    <h3 class="text-lg font-semibold">{{ 'REPORTS.SALARY_TITLE' | translate }}</h3>
                    <p class="text-sm text-gray-500">{{ 'REPORTS.SALARY_DESC' | translate }}</p>
                  </div>
                </ng-template>
                @if (salaryChart()) {
                  <p-chart type="bar" [data]="salaryChart()" [options]="barOpts" [style]="{ height: '320px' }"></p-chart>
                }
              </p-card>
            </div>
          </p-tabpanel>

          <!-- ── STUDENTS ───────────────────────────────────────── -->
          <p-tabpanel value="1">
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-4">
              <p-card>
                <ng-template pTemplate="header">
                  <div class="px-6 pt-4 pb-2">
                    <h3 class="text-lg font-semibold">{{ 'REPORTS.STUDENTS_OT_TITLE' | translate }}</h3>
                    <p class="text-sm text-gray-500">{{ 'REPORTS.STUDENTS_OT_DESC' | translate }}</p>
                  </div>
                </ng-template>
                @if (studentsChart()) {
                  <p-chart type="bar" [data]="studentsChart()" [options]="barOpts" [style]="{ height: '320px' }"></p-chart>
                }
              </p-card>

              <p-card>
                <ng-template pTemplate="header">
                  <div class="px-6 pt-4 pb-2 flex justify-between items-center">
                    <div>
                      <h3 class="text-lg font-semibold">{{ 'REPORTS.CHURN_TITLE' | translate }}</h3>
                      <p class="text-sm text-gray-500">{{ 'REPORTS.CHURN_DESC' | translate }}</p>
                    </div>
                    <div class="flex items-center gap-2">
                      <label class="text-sm whitespace-nowrap">{{ 'REPORTS.INACTIVE_MONTHS' | translate }}</label>
                      <p-inputnumber [(ngModel)]="inactiveMonths" [min]="1" [max]="24" [showButtons]="true" [inputStyle]="{ width: '60px' }" (onInput)="onChurnWindowChange()"></p-inputnumber>
                    </div>
                  </div>
                </ng-template>
                @if (churn(); as c) {
                  <div class="grid grid-cols-2 gap-3 p-4">
                    <div class="p-3 bg-blue-50 rounded">
                      <div class="text-xs text-gray-600">{{ 'REPORTS.CHURN_TOTAL' | translate }}</div>
                      <div class="text-2xl font-bold text-blue-700">{{ c.totalStudents }}</div>
                    </div>
                    <div class="p-3 bg-green-50 rounded">
                      <div class="text-xs text-gray-600">{{ 'REPORTS.CHURN_ACTIVE' | translate }}</div>
                      <div class="text-2xl font-bold text-green-700">{{ c.activeStudents }}</div>
                    </div>
                    <div class="p-3 bg-red-50 rounded">
                      <div class="text-xs text-gray-600">{{ 'REPORTS.CHURN_CHURNED' | translate }}</div>
                      <div class="text-2xl font-bold text-red-700">{{ c.churnedStudents }}</div>
                    </div>
                    <div class="p-3 bg-orange-50 rounded">
                      <div class="text-xs text-gray-600">{{ 'REPORTS.CHURN_INACTIVE' | translate }}</div>
                      <div class="text-2xl font-bold text-orange-700">{{ c.inactiveStudents }}</div>
                    </div>
                    <div class="p-3 bg-gray-50 rounded col-span-2">
                      <div class="flex justify-between items-center mb-2">
                        <span class="text-sm font-medium">{{ 'REPORTS.CHURN_RATE' | translate }}</span>
                        <span class="text-xl font-bold text-red-700">{{ c.churnRate }}%</span>
                      </div>
                      <div class="flex justify-between items-center">
                        <span class="text-sm font-medium">{{ 'REPORTS.INACTIVITY_RATE' | translate }} ({{ c.inactiveMonths }}m)</span>
                        <span class="text-xl font-bold text-orange-700">{{ c.inactivityRate }}%</span>
                      </div>
                    </div>
                  </div>
                }
              </p-card>
            </div>
          </p-tabpanel>

          <!-- ── COURSES ────────────────────────────────────────── -->
          <p-tabpanel value="2">
            <div class="grid grid-cols-1 gap-4 pt-4">
              <p-card>
                <ng-template pTemplate="header">
                  <div class="px-6 pt-4 pb-2">
                    <h3 class="text-lg font-semibold">{{ 'REPORTS.TOP_COURSES_TITLE' | translate }}</h3>
                    <p class="text-sm text-gray-500">{{ 'REPORTS.TOP_COURSES_DESC' | translate }}</p>
                  </div>
                </ng-template>
                @if (topCoursesChart()) {
                  <p-chart type="bar" [data]="topCoursesChart()" [options]="horizontalBarOpts" [style]="{ height: '400px' }"></p-chart>
                }
              </p-card>

              <p-card>
                <ng-template pTemplate="header">
                  <div class="px-6 pt-4 pb-2">
                    <h3 class="text-lg font-semibold">{{ 'REPORTS.PROFIT_COURSE_TITLE' | translate }}</h3>
                  </div>
                </ng-template>
                <p-table [value]="profitCourses()" [paginator]="true" [rows]="10" responsiveLayout="scroll">
                  <ng-template pTemplate="header">
                    <tr>
                      <th>{{ 'REPORTS.COL_TYPE' | translate }}</th>
                      <th>{{ 'REPORTS.COL_COURSE' | translate }}</th>
                      <th>{{ 'REPORTS.COL_BRANCH' | translate }}</th>
                      <th class="text-right">{{ 'REPORTS.COL_ENROLLMENTS' | translate }}</th>
                      <th class="text-right">{{ 'REPORTS.COL_REVENUE' | translate }}</th>
                      <th class="text-right">{{ 'REPORTS.COL_AVG_PRICE' | translate }}</th>
                    </tr>
                  </ng-template>
                  <ng-template pTemplate="body" let-row>
                    <tr>
                      <td>
                        <p-tag
                          [value]="row.type === 'MASTER' ? ('REPORTS.TYPE_BUNDLE' | translate) : ('REPORTS.TYPE_COURSE' | translate)"
                          [severity]="row.type === 'MASTER' ? 'warn' : 'info'"></p-tag>
                      </td>
                      <td class="font-medium">{{ row.courseName }} <span class="text-xs text-gray-500 font-mono">{{ row.courseCode }}</span></td>
                      <td>{{ row.branchName }}</td>
                      <td class="text-right">{{ row.enrollments }}</td>
                      <td class="text-right font-semibold text-green-700">{{ row.revenue | number:'1.2-2' }}</td>
                      <td class="text-right">{{ row.avgPrice | number:'1.2-2' }}</td>
                    </tr>
                  </ng-template>
                  <ng-template pTemplate="emptymessage">
                    <tr><td colspan="6" class="text-center py-6 text-gray-500">{{ 'REPORTS.NO_DATA' | translate }}</td></tr>
                  </ng-template>
                </p-table>
              </p-card>
            </div>
          </p-tabpanel>

          <!-- ── BRANCHES ───────────────────────────────────────── -->
          <p-tabpanel value="3">
            <div class="grid grid-cols-1 gap-4 pt-4">
              <p-card>
                <ng-template pTemplate="header">
                  <div class="px-6 pt-4 pb-2">
                    <h3 class="text-lg font-semibold">{{ 'REPORTS.PROFIT_BRANCH_TITLE' | translate }}</h3>
                    <p class="text-sm text-gray-500">{{ 'REPORTS.PROFIT_BRANCH_DESC' | translate }}</p>
                  </div>
                </ng-template>
                @if (branchChart()) {
                  <p-chart type="bar" [data]="branchChart()" [options]="stackedBarOpts" [style]="{ height: '360px' }"></p-chart>
                }
              </p-card>

              <p-card>
                <p-table [value]="profitBranches()" responsiveLayout="scroll">
                  <ng-template pTemplate="header">
                    <tr>
                      <th>{{ 'REPORTS.COL_BRANCH' | translate }}</th>
                      <th class="text-right">{{ 'REPORTS.COL_REVENUE' | translate }}</th>
                      <th class="text-right">{{ 'REPORTS.COL_EXPENSES' | translate }}</th>
                      <th class="text-right">{{ 'REPORTS.COL_NET_PROFIT' | translate }}</th>
                      <th class="text-right">{{ 'REPORTS.COL_ACTIVE_STUDENTS' | translate }}</th>
                    </tr>
                  </ng-template>
                  <ng-template pTemplate="body" let-row>
                    <tr>
                      <td class="font-medium">{{ row.branchName }} <span class="text-xs text-gray-500 font-mono">{{ row.branchCode }}</span></td>
                      <td class="text-right text-green-700 font-semibold">{{ row.revenue | number:'1.2-2' }}</td>
                      <td class="text-right text-red-700">{{ row.expenses | number:'1.2-2' }}</td>
                      <td class="text-right font-bold" [class.text-green-700]="row.netProfit >= 0" [class.text-red-700]="row.netProfit < 0">
                        {{ row.netProfit | number:'1.2-2' }}
                      </td>
                      <td class="text-right">{{ row.activeStudents }}</td>
                    </tr>
                  </ng-template>
                  <ng-template pTemplate="emptymessage">
                    <tr><td colspan="5" class="text-center py-6 text-gray-500">{{ 'REPORTS.NO_DATA' | translate }}</td></tr>
                  </ng-template>
                </p-table>
              </p-card>
            </div>
          </p-tabpanel>

          <!-- ── PRODUCTS ───────────────────────────────────────── -->
          <p-tabpanel value="4">
            <div class="grid grid-cols-1 gap-4 pt-4">
              <p-card>
                <ng-template pTemplate="header">
                  <div class="px-6 pt-4 pb-2">
                    <h3 class="text-lg font-semibold">{{ 'REPORTS.PROFIT_PRODUCT_TITLE' | translate }}</h3>
                    <p class="text-sm text-gray-500">{{ 'REPORTS.PROFIT_PRODUCT_DESC' | translate }}</p>
                  </div>
                </ng-template>
                <p-table [value]="profitProducts()" [paginator]="true" [rows]="15" responsiveLayout="scroll">
                  <ng-template pTemplate="header">
                    <tr>
                      <th>{{ 'REPORTS.COL_PRODUCT' | translate }}</th>
                      <th>{{ 'REPORTS.COL_BRANCH' | translate }}</th>
                      <th class="text-right">{{ 'REPORTS.COL_UNITS' | translate }}</th>
                      <th class="text-right">{{ 'REPORTS.COL_REVENUE' | translate }}</th>
                      <th class="text-right">{{ 'REPORTS.COL_COST' | translate }}</th>
                      <th class="text-right">{{ 'REPORTS.COL_MARGIN' | translate }}</th>
                      <th class="text-right">{{ 'REPORTS.COL_STOCK' | translate }}</th>
                    </tr>
                  </ng-template>
                  <ng-template pTemplate="body" let-row>
                    <tr>
                      <td class="font-medium">{{ row.productName }} <span class="text-xs text-gray-500 font-mono">{{ row.productCode }}</span></td>
                      <td>{{ row.branchName }}</td>
                      <td class="text-right">{{ row.unitsSold }}</td>
                      <td class="text-right text-green-700">{{ row.revenue | number:'1.2-2' }}</td>
                      <td class="text-right text-red-700">{{ row.cost | number:'1.2-2' }}</td>
                      <td class="text-right font-bold" [class.text-green-700]="row.margin >= 0" [class.text-red-700]="row.margin < 0">
                        {{ row.margin | number:'1.2-2' }}
                      </td>
                      <td class="text-right">
                        <p-tag [value]="row.currentStock" [severity]="row.currentStock > 0 ? 'success' : 'danger'"></p-tag>
                      </td>
                    </tr>
                  </ng-template>
                  <ng-template pTemplate="emptymessage">
                    <tr><td colspan="7" class="text-center py-6 text-gray-500">{{ 'REPORTS.NO_DATA' | translate }}</td></tr>
                  </ng-template>
                </p-table>
              </p-card>
            </div>
          </p-tabpanel>
        </p-tabpanels>
      </p-tabs>
    </div>
  `,
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
    this.branchService.getActiveBranches().subscribe({
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
