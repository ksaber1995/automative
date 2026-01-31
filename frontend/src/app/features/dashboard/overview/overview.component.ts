import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ChartModule } from 'primeng/chart';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { AnalyticsService } from '../services/analytics.service';
import { DashboardMetrics } from '@shared/interfaces/analytics.interface';

@Component({
  selector: 'app-overview',
  standalone: true,
  imports: [CommonModule, CardModule, ChartModule, TableModule, TagModule, ButtonModule, TooltipModule],
  templateUrl: './overview.component.html',
  styleUrl: './overview.component.scss'
})
export class OverviewComponent implements OnInit {
  private analyticsService = inject(AnalyticsService);
  private router = inject(Router);

  dashboardData =  signal<DashboardMetrics | null>(null);
  loading = signal(true);

  revenueChartData: any;
  revenueChartOptions: any;
  expenseChartData: any;
  expenseChartOptions: any;

  ngOnInit() {
    this.loadDashboard();
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

  prepareCharts(data: DashboardMetrics) {
    // Revenue Trends Chart
    const months = data.revenueByMonth.map(m => `${m.year}-${m.month}`);
    this.revenueChartData = {
      labels: months,
      datasets: [
        {
          label: 'Revenue',
          data: data.revenueByMonth.map(m => m.revenue),
          borderColor: '#3B82F6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: true,
          tension: 0.4
        },
        {
          label: 'Expenses',
          data: data.revenueByMonth.map(m => m.expenses),
          borderColor: '#EF4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          fill: true,
          tension: 0.4
        },
        {
          label: 'Profit',
          data: data.revenueByMonth.map(m => m.profit),
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
              return `${context.dataset.label}: $${context.parsed.y.toFixed(2)}`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value: any) => '$' + value.toLocaleString()
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
              return `${label}: $${value.toFixed(2)}`;
            }
          }
        }
      }
    };
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(value);
  }

  getProfitSeverity(profit: number): 'success' | 'danger' {
    return profit >= 0 ? 'success' : 'danger';
  }

  navigateTo(path: string) {
    this.router.navigate([path]);
  }
}
