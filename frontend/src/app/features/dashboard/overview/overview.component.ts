import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { CardModule } from 'primeng/card';
import { ChartModule } from 'primeng/chart';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { AnalyticsService } from '../services/analytics.service';
import { ExpenseService } from '../../expenses/services/expense.service';
import { NotificationService } from '../../../core/services/notification.service';
import { DashboardMetrics } from '@shared/interfaces/analytics.interface';

@Component({
  selector: 'app-overview',
  standalone: true,
  imports: [CommonModule, RouterModule, CardModule, ChartModule, TableModule, TagModule, ButtonModule, TooltipModule, ProgressSpinnerModule, TranslateModule],
  templateUrl: './overview.component.html',
  styleUrl: './overview.component.scss'
})
export class OverviewComponent implements OnInit {
  private analyticsService = inject(AnalyticsService);
  private expenseService = inject(ExpenseService);
  private notificationService = inject(NotificationService);
  private router = inject(Router);

  dashboardData = signal<DashboardMetrics | null>(null);
  loading = signal(true);
  dueExpenses = signal<{ items: any[]; totalDue: number; month: string } | null>(null);
  dueLoading = signal(false);
  payingId = signal<string | null>(null);

  revenueChartData: any;
  revenueChartOptions: any;
  expenseChartData: any;
  expenseChartOptions: any;

  ngOnInit() {
    this.loadDashboard();
    this.loadDueExpenses();
    this.initChartOptions();
  }

  loadDashboard() {
    this.loading.set(true);
    this.analyticsService.getDashboard().subscribe({
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

  loadDueExpenses() {
    this.dueLoading.set(true);
    this.expenseService.getDue().subscribe({
      next: (data) => {
        this.dueExpenses.set(data);
        this.dueLoading.set(false);
      },
      error: () => {
        this.dueLoading.set(false);
      }
    });
  }

  payDueItem(item: any) {
    this.payingId.set(item.id);
    const obs = item.type === 'salary'
      ? this.expenseService.payEmployeeSalary(item.employeeId)
      : this.expenseService.payRecurring(item.templateId);

    obs.subscribe({
      next: () => {
        this.notificationService.success(`${item.label} paid successfully`);
        this.payingId.set(null);
        this.loadDueExpenses();
      },
      error: (err) => {
        this.notificationService.error(err?.error?.message || 'Failed to pay');
        this.payingId.set(null);
      }
    });
  }

  getAllocationLabel(method: string): string {
    const labels: Record<string, string> = {
      PROPORTIONAL: 'Proportional Allocation',
      EQUAL: 'Equal Split',
      OVERHEAD: 'Global Overhead Bucket',
    };
    return labels[method] || method;
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
      labels: data.expensesByCategory.map(e => e.category),
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
              return `${context.dataset.label}: ${context.parsed.y.toFixed(2)}`;
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
              return `${label}: ${value.toFixed(2)}`;
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

  navigateTo(path: string) {
    this.router.navigate([path]);
  }
}
