import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CardModule } from 'primeng/card';
import { ChartModule } from 'primeng/chart';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { DatePickerModule } from 'primeng/datepicker';
import { PaginatorModule } from 'primeng/paginator';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { AnalyticsService } from '../services/analytics.service';
import { ExpenseService } from '../../expenses/services/expense.service';
import { NotificationService } from '../../../core/services/notification.service';
import { CashService, CurrentCashResponse } from '../../../core/services/cash.service';
import { AuthService } from '../../../core/services/auth.service';
import { DashboardMetrics } from '@shared/interfaces/analytics.interface';

@Component({
  selector: 'app-overview',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, CardModule, ChartModule, TableModule, TagModule, ButtonModule, TooltipModule, DatePickerModule, PaginatorModule, ProgressSpinnerModule, TranslateModule],
  templateUrl: './overview.component.html',
  styleUrl: './overview.component.scss'
})
export class OverviewComponent implements OnInit {
  private analyticsService = inject(AnalyticsService);
  private expenseService = inject(ExpenseService);
  private notificationService = inject(NotificationService);
  private cashService = inject(CashService);
  private router = inject(Router);
  private translate = inject(TranslateService);
  private authService = inject(AuthService);

  isTeacher = (): boolean => this.authService.isTeacher();

  // Date range filter — mirrors the Reports page (default: last 12 months) so
  // the two screens reconcile out of the box. Without an explicit range the
  // dashboard previously defaulted to year-to-date server-side while Reports
  // used a rolling 12 months, which is why their totals didn't match.
  startDate: Date;
  endDate: Date;

  dashboardData = signal<DashboardMetrics | null>(null);
  loading = signal(true);
  dueExpenses = signal<{ items: any[]; totalDue: number; month: string } | null>(null);
  dueLoading = signal(false);
  payingId = signal<string | null>(null);

  // Client-side pagination for the "Due This Month" list (all items are already
  // loaded, so we just slice the current page).
  readonly dueRows = 5;
  duePage = signal(0);
  pagedDueItems = computed(() => {
    const items = this.dueExpenses()?.items ?? [];
    const start = this.duePage() * this.dueRows;
    return items.slice(start, start + this.dueRows);
  });
  currentCash = signal<CurrentCashResponse | null>(null);
  cashLoading = signal(false);

  revenueChartData: any;
  revenueChartOptions: any;
  expenseChartData: any;
  expenseChartOptions: any;

  constructor() {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 11);
    start.setDate(1);
    this.startDate = start;
    this.endDate = end;
  }

  ngOnInit() {
    this.loadDashboard();
    this.loadDueExpenses();
    this.loadCurrentCash();
    this.initChartOptions();
  }

  loadCurrentCash() {
    this.cashLoading.set(true);
    this.cashService.getCurrentCash().subscribe({
      next: (data) => {
        this.currentCash.set(data);
        this.cashLoading.set(false);
      },
      error: () => {
        this.cashLoading.set(false);
      }
    });
  }

  loadDashboard() {
    this.loading.set(true);
    this.analyticsService.getDashboard(this.rangeFilters()).subscribe({
      next: (data) => {
        this.dashboardData.set(data);
        this.prepareCharts(data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      }
    });
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

  /** Apply the selected date range — reloads the range-dependent dashboard data.
   * (Current cash is a point-in-time snapshot, so it isn't re-fetched here.) */
  applyFilters() {
    this.loadDashboard();
  }

  /** Reset the range to the default rolling 12 months and reload. */
  resetFilters() {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 11);
    start.setDate(1);
    this.startDate = start;
    this.endDate = end;
    this.applyFilters();
  }

  loadDueExpenses() {
    this.dueLoading.set(true);
    this.expenseService.getDue().subscribe({
      next: (data) => {
        this.dueExpenses.set(data);
        this.duePage.set(0);
        this.dueLoading.set(false);
      },
      error: () => {
        this.dueLoading.set(false);
      }
    });
  }

  onDuePageChange(event: { page?: number }) {
    this.duePage.set(event.page ?? 0);
  }

  payDueItem(item: any) {
    this.payingId.set(item.id);
    const obs = item.type === 'salary'
      ? this.expenseService.payEmployeeSalary(item.employeeId)
      : this.expenseService.payRecurring(item.templateId);

    obs.subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('DASHBOARD.ITEM_PAID', { label: item.label }));
        this.payingId.set(null);
        this.loadDueExpenses();
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.payingId.set(null);
      }
    });
  }

  getAllocationLabel(method: string): string {
    const keys: Record<string, string> = {
      PROPORTIONAL: 'DASHBOARD.ALLOCATION_PROPORTIONAL',
      EQUAL: 'DASHBOARD.ALLOCATION_EQUAL',
      OVERHEAD: 'DASHBOARD.ALLOCATION_OVERHEAD',
    };
    const key = keys[method];
    return key ? this.translate.instant(key) : method;
  }

  getAllocationIcon(method: string): string {
    const icons: Record<string, string> = {
      PROPORTIONAL: 'pi pi-chart-pie text-green-500',
      EQUAL: 'pi pi-sliders-h text-blue-500',
      OVERHEAD: 'pi pi-building text-purple-500',
    };
    return icons[method] || 'pi pi-cog';
  }

  prepareCharts(data: DashboardMetrics) {
    // Revenue Trends Chart
    const months = data.revenueByMonth.map((m: any) => m.month);
    this.revenueChartData = {
      labels: months,
      datasets: [
        {
          label: 'Revenue',
          data: data.revenueByMonth.map((m: any) => m.revenue),
          borderColor: '#3B82F6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: true,
          tension: 0.4
        },
        {
          label: 'Expenses',
          data: data.revenueByMonth.map((m: any) => m.expenses),
          borderColor: '#EF4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          fill: true,
          tension: 0.4
        },
        {
          label: 'Refunds',
          data: data.revenueByMonth.map((m: any) => m.refunds || 0),
          borderColor: '#F97316',
          backgroundColor: 'rgba(249, 115, 22, 0.1)',
          fill: true,
          tension: 0.4
        },
        {
          label: 'Profit',
          data: data.revenueByMonth.map((m: any) => m.profit),
          borderColor: '#10B981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          fill: true,
          tension: 0.4
        }
      ]
    };

    // Expense Breakdown Chart
    this.expenseChartData = {
      labels: data.expensesByCategory.map(e => this.translate.instant('EXPENSES.CATEGORY_VALUES.' + e.category) || e.category),
      datasets: [{
        data: data.expensesByCategory.map(e => e.amount),
        backgroundColor: [
          '#3B82F6',
          '#EF4444',
          '#10B981',
          '#F59E0B',
          '#8B5CF6',
          '#EC4899',
          '#06B6D4',
          '#84CC16'
        ]
      }]
    };
  }

  initChartOptions() {
    this.revenueChartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
        },
        tooltip: {
          callbacks: {
            label: (context: any) => {
              return `${context.dataset.label}: ${this.formatCurrency(context.parsed.y)}`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value: any) => '' + value.toLocaleString()
          }
        }
      }
    };

    this.expenseChartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
        },
        tooltip: {
          callbacks: {
            label: (context: any) => {
              const label = context.label || '';
              const value = context.parsed || 0;
              return `${label}: ${this.formatCurrency(value)}`;
            }
          }
        }
      }
    };
  }

  formatCurrency(value: number): string {
    if (value == null || isNaN(value)) return '0.00';
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  }

  formatMargin(value: number): string {
    if (value == null || isNaN(value)) return '0.0';
    return value.toFixed(1);
  }

  getProfitSeverity(profit: number): 'success' | 'danger' {
    return profit >= 0 ? 'success' : 'danger';
  }

  hasUnallocatedActivity(data: DashboardMetrics | null): boolean {
    if (!data) return false;
    const c = data.companyWideSummary;
    return (c.unallocatedRevenue || 0) !== 0 || (c.unallocatedExpenses || 0) !== 0;
  }

  // Unallocated expenses that aren't "overhead" — i.e. unbranched COGS/Inventory
  // payments. The footer needs to show this separately so sumBranches − overhead
  // − cogs/inv − unattributedRefunds + unallocatedRevenue reconciles with the
  // displayed Company Net.
  unallocatedCogsAndInventory(data: DashboardMetrics): number {
    const c = data.companyWideSummary;
    const diff = (c.unallocatedExpenses || 0) - (c.globalOverhead || 0);
    return diff > 0 ? diff : 0;
  }

  // Refunds the backend couldn't tie to any branch (e.g. product-sale refunds
  // before branch attribution, refunds with no parent record). Surfaced as a
  // row so the breakdown still adds up to companyNet.
  unattributedRefunds(data: DashboardMetrics): number {
    return data.companyWideSummary.unattributedRefunds || 0;
  }

  hasOverheadFooter(data: DashboardMetrics): boolean {
    const c = data.companyWideSummary;
    if (c.allocationMethod !== 'OVERHEAD') return false;
    return (c.globalOverhead || 0) > 0
      || (c.unallocatedRevenue || 0) > 0
      || this.unallocatedCogsAndInventory(data) > 0
      || this.unattributedRefunds(data) > 0;
  }

  getProfitBreakdownTooltip(data: DashboardMetrics): string {
    const c = data.companyWideSummary;
    const parts = [
      `Sum of branches: ${this.formatCurrency(c.sumBranchNetProfit || 0)}`,
    ];
    if ((c.unallocatedRevenue || 0) > 0) parts.push(`+ Unallocated revenue: ${this.formatCurrency(c.unallocatedRevenue || 0)}`);
    if ((c.unallocatedExpenses || 0) > 0) parts.push(`- Unallocated expenses: ${this.formatCurrency(c.unallocatedExpenses || 0)}`);
    parts.push(`= Net profit: ${this.formatCurrency(c.netProfit)}`);
    return parts.join('\n');
  }

  navigateTo(path: string) {
    this.router.navigate([path]);
  }
}
