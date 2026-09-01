import { TablePageUxDirective } from '../../../core/directives/table-page-ux.directive';
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { RevenueService, RevenueItem, RevenueSource, RevenueSummary } from '../services/revenue.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { TranslateModule } from '@ngx-translate/core';
import { AmountPipe } from '../../../shared/pipes/amount.pipe';

@Component({
  selector: 'app-revenue-list',
  standalone: true,
  imports: [
    TablePageUxDirective,CommonModule, FormsModule, CardModule, TableModule, ButtonModule, TagModule, TooltipModule, TranslateModule,
    AmountPipe,
  ],
  templateUrl: './revenue-list.component.html',
  styleUrl: './revenue-list.component.scss'
})
export class RevenueListComponent implements OnInit {
  private revenueService = inject(RevenueService);
  private lookupService = inject(LookupService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  protected authService = inject(AuthService);
  protected branchState = inject(BranchStateService);

  revenues = signal<RevenueItem[]>([]);
  branches = signal<LookupOption[]>([]);
  loading = signal(true);
  selectedBranchId: string = '';
  selectedSource: 'ENROLLMENT' | 'PRODUCT_SALE' | 'MASTER_ENROLLMENT' | 'EVENT' | 'SUBSCRIPTION' | 'SESSION' | 'ALL' = 'ALL';
  startDate: string = '';
  endDate: string = '';
  /** Total of the rows listed — the fallback headline if the summary call fails. */
  totalRevenue: number = 0;
  activePreset = signal<string>('month');

  /**
   * Period totals from /revenues/summary, under EVERY filter the table uses —
   * branch, dates and source. The headline read the whole company's income while
   * the table showed one source, which is the one thing a total must never do.
   * Null while loading, or if the call failed (the page then falls back to the
   * listed total).
   */
  summary = signal<RevenueSummary | null>(null);

  /**
   * The per-source tiles, gross. Sources worth nothing this period are dropped
   * rather than shown as a row of zeros — an academy that sells no products
   * should not have to read past "Products 0" every time. With a source filter
   * on, only that one has a value, so the row collapses to it.
   */
  sourceTiles = computed<{ key: RevenueSource; value: number }[]>(() => {
    const s = this.summary();
    if (!s) return [];
    return ([
      { key: 'ENROLLMENT', value: s.enrollmentRevenue },
      { key: 'SUBSCRIPTION', value: s.subscriptionRevenue },
      { key: 'SESSION', value: s.sessionRevenue },
      { key: 'MASTER_ENROLLMENT', value: s.masterRevenue },
      { key: 'EVENT', value: s.eventRevenue },
      { key: 'PRODUCT_SALE', value: s.productRevenue },
    ] as { key: RevenueSource; value: number }[]).filter(t => t.value > 0);
  });

  /** Gross collections — what the per-source tiles add up to, before refunds. */
  grossRevenue = computed<number>(() => {
    const s = this.summary();
    return s ? s.totalRevenue + s.totalRefunds : 0;
  });

  /** Round a value up to a clean axis number (1 / 2 / 2.5 / 5 × a power of ten). */
  private niceCeil(n: number): number {
    if (n <= 0) return 0;
    const mag = Math.pow(10, Math.floor(Math.log10(n)));
    const step = [1, 2, 2.5, 5, 10].find(s => n <= s * mag) ?? 10;
    return step * mag;
  }

  /**
   * The by-month columns, oldest first (the API returns newest first).
   *
   * A month can be NEGATIVE now that refunds are netted — more given back than
   * taken in — so the plot has a zero baseline with a downward arm, sized only
   * when something is actually below it. Months with no money at all are absent
   * from the API; they're filled back in as zeros, because a gap silently closed
   * would put January next to March and read as consecutive.
   *
   * Empty below two buckets: one column is not a trend.
   */
  monthPlot = computed<{
    axisMax: number;
    axisMin: number;
    posShare: number;
    bars: { key: string; label: string; title: string; value: number; posPct: number; negPct: number; labelled: boolean }[];
  } | null>(() => {
    const s = this.summary();
    if (!s || s.byMonth.length < 2) return null;

    const byKey = new Map(s.byMonth.map(m => [m.month, m.revenue]));
    const keys = [...byKey.keys()].sort();
    const [firstY, firstM] = keys[0].split('-').map(Number);
    const [lastY, lastM] = keys[keys.length - 1].split('-').map(Number);

    const rows: { key: string; date: Date; value: number }[] = [];
    for (let k = firstY * 12 + (firstM - 1); k <= lastY * 12 + (lastM - 1); k++) {
      const date = new Date(Math.floor(k / 12), k % 12, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      rows.push({ key, date, value: byKey.get(key) ?? 0 });
    }

    const axisMax = this.niceCeil(Math.max(0, ...rows.map(r => r.value)));
    const axisMin = -this.niceCeil(Math.max(0, ...rows.map(r => -r.value)));
    const span = (axisMax - axisMin) || 1;
    // The extreme and the latest month get a direct label; the rest are carried
    // by the axis and the hover tooltip — a number on every column reads as noise.
    const peakKey = rows.reduce((a, b) => (Math.abs(b.value) > Math.abs(a.value) ? b : a)).key;
    const lastKey = rows[rows.length - 1].key;

    return {
      axisMax,
      axisMin,
      posShare: (axisMax / span) * 100,
      bars: rows.map(r => ({
        key: r.key,
        label: r.date.toLocaleDateString('en-US', { month: 'short' }),
        title: `${r.date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
        value: r.value,
        posPct: r.value > 0 && axisMax > 0 ? (r.value / axisMax) * 100 : 0,
        negPct: r.value < 0 && axisMin < 0 ? (r.value / axisMin) * 100 : 0,
        labelled: r.key === peakKey || r.key === lastKey,
      })),
    };
  });

  ngOnInit() {
    this.loadBranches();
    // Default to the current month (matches the dashboard's default range).
    this.setPreset('month');
  }

  private toIso(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** Apply a named date range (This Month / This Year / Last 12 Months) and reload. */
  setPreset(preset: string) {
    const now = new Date();
    this.activePreset.set(preset);
    let start: Date;
    switch (preset) {
      case 'today':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'year':
        start = new Date(now.getFullYear(), 0, 1);
        break;
      case '12months':
        start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
        break;
      case 'month':
      default:
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
    }
    this.startDate = this.toIso(start);
    this.endDate = this.toIso(now);
    this.loadRevenues();
  }

  loadBranches() {
    this.lookupService.branches().subscribe({
      next: (branches) => this.branches.set(branches)
    });
  }

  loadRevenues() {
    this.loading.set(true);
    const params: any = {};
    if (this.selectedBranchId) params.branchId = this.selectedBranchId;
    if (this.selectedSource !== 'ALL') params.source = this.selectedSource;
    if (this.startDate) params.startDate = this.startDate;
    if (this.endDate) params.endDate = this.endDate;

    this.revenueService.getRevenues(params).subscribe({
      next: (revenues: RevenueItem[]) => {
        this.revenues.set(revenues);
        this.totalRevenue = revenues.reduce((sum: number, r: RevenueItem) => sum + r.amount - (r.totalRefunded || 0), 0);
        this.loading.set(false);
      },
      error: () => {
        this.notificationService.error('Failed to load revenues');
        this.loading.set(false);
      }
    });

    // The SAME filters as the table, source included — the headline has to be
    // the total of what is on screen. A failure here is silent: the table is the
    // page, and it has already reported its own error if one occurred.
    this.revenueService.getRevenueSummary(params).subscribe({
      next: (summary: RevenueSummary) => this.summary.set(summary),
      error: () => this.summary.set(null),
    });
  }

  onFilterChange() {
    this.loadRevenues();
  }

  /** Manual date-input change: drop the preset highlight, then reload. */
  onDateChange() {
    this.activePreset.set('');
    this.loadRevenues();
  }

  getSourceBadge(source: string): { severity: 'success' | 'info' | 'warn' | 'secondary'; label: string } {
    if (source === 'ENROLLMENT') return { severity: 'success', label: 'Course' };
    if (source === 'MASTER_ENROLLMENT') return { severity: 'secondary', label: 'Bundle' };
    if (source === 'EVENT') return { severity: 'warn', label: 'Event' };
    if (source === 'SUBSCRIPTION') return { severity: 'success', label: 'Subscription' };
    if (source === 'SESSION') return { severity: 'info', label: 'Session' };
    return { severity: 'info', label: 'Product' };
  }

  getRefundStatus(revenue: RevenueItem): 'NONE' | 'PARTIAL' | 'FULL' {
    if (!revenue.totalRefunded || revenue.totalRefunded === 0) return 'NONE';
    if (revenue.totalRefunded < revenue.amount) return 'PARTIAL';
    return 'FULL';
  }

  getRefundStatusSeverity(revenue: RevenueItem): 'success' | 'warn' | 'danger' {
    const status = this.getRefundStatus(revenue);
    if (status === 'NONE') return 'success';
    if (status === 'PARTIAL') return 'warn';
    return 'danger';
  }

  getBranchName(branchId: string | null | undefined): string {
    if (!branchId) return 'Company-level';
    const branch = this.branches().find(b => b.id === branchId);
    return branch ? branch.label : 'Unknown';
  }

  canSeeCompanyLevel(): boolean {
    return this.authService.isGlobalAdmin();
  }

  navigateToSource(revenue: RevenueItem) {
    if (revenue.source === 'ENROLLMENT') {
      this.router.navigate(['/enrollments', revenue.sourceId, 'edit']);
    } else if (revenue.source === 'MASTER_ENROLLMENT') {
      // Master bundles don't have a dedicated edit page — jump to the student
      // so the user can view/cancel/refund the enrollment row.
      if (revenue.studentId) {
        this.router.navigate(['/students', revenue.studentId]);
      }
    } else if (revenue.source === 'EVENT') {
      if (revenue.eventId) {
        this.router.navigate(['/events', revenue.eventId]);
      }
    } else if (revenue.source === 'SUBSCRIPTION') {
      // Monthly subscription bills have no edit page — jump to the student so the
      // user can view the enrollment and its monthly payment history.
      if (revenue.studentId) {
        this.router.navigate(['/students', revenue.studentId]);
      }
    } else if (revenue.source === 'SESSION') {
      // Per-session charges and packages live on the Session Payments dashboard.
      this.router.navigate(['/session-payments']);
    } else {
      this.router.navigate(['/products/sales']);
    }
  }
}
