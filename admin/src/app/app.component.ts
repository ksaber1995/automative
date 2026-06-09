import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CompanySubscription, SubscriptionsService } from './subscriptions.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="wrap">
      <header>
        <div>
          <h1>Companies &amp; Subscriptions</h1>
          <p class="sub">Every tenant in the system · read-only superadmin view</p>
        </div>
        <button class="refresh" (click)="load()" [disabled]="loading()">
          {{ loading() ? 'Loading…' : 'Refresh' }}
        </button>
      </header>

      <div class="toolbar">
        <input
          class="search"
          type="text"
          [ngModel]="search()"
          (ngModelChange)="search.set($event)"
          placeholder="Search by company or subscription type…"
        />
        <span class="count">{{ filtered().length }} / {{ rows().length }}</span>
      </div>

      @if (error()) {
        <div class="error">{{ error() }}</div>
      }

      @if (loading()) {
        <div class="state">Loading…</div>
      } @else if (rows().length === 0 && !error()) {
        <div class="state">No companies found.</div>
      } @else {
        <div class="card">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Type</th>
                <th class="num">Price</th>
                <th class="num">Employees</th>
                <th class="num">Branches</th>
                <th>Start</th>
                <th>End</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              @for (r of filtered(); track r.company_id) {
                <tr>
                  <td class="name">{{ r.company_name }}</td>
                  <td>
                    <span class="badge" [class.trial]="r.subscription_type === 'TRIAL'">
                      {{ r.subscription_type || '—' }}
                    </span>
                  </td>
                  <td class="num">{{ formatPrice(r) }}</td>
                  <td class="num">{{ r.employee_count }}</td>
                  <td class="num">{{ r.branch_count }}</td>
                  <td>{{ formatDate(r.start_date) }}</td>
                  <td>{{ formatDate(r.end_date) }}</td>
                  <td>
                    <span class="dot" [class.off]="!r.company_active"></span>
                    {{ r.company_active ? 'Active' : 'Inactive' }}
                  </td>
                </tr>
              }
              @if (filtered().length === 0) {
                <tr><td colspan="8" class="state">No matches.</td></tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
  styles: [`
    .wrap { max-width: 1100px; margin: 0 auto; padding: 32px 20px 60px; }
    header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    h1 { margin: 0; font-size: 24px; }
    .sub { margin: 4px 0 0; color: #64748b; font-size: 14px; }
    .refresh {
      border: 1px solid #cbd5e1; background: #fff; color: #0f172a; border-radius: 8px;
      padding: 8px 16px; font-size: 14px; cursor: pointer;
    }
    .refresh:disabled { opacity: .6; cursor: default; }
    .toolbar { display: flex; align-items: center; gap: 12px; margin: 20px 0 12px; }
    .search {
      flex: 1; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 14px; font-size: 14px;
    }
    .search:focus { outline: 2px solid #c7d2fe; border-color: #4f46e5; }
    .count { color: #64748b; font-size: 13px; white-space: nowrap; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    thead th {
      text-align: left; background: #f8fafc; color: #475569; font-weight: 600;
      padding: 12px 14px; border-bottom: 1px solid #e2e8f0; white-space: nowrap;
    }
    tbody td { padding: 12px 14px; border-bottom: 1px solid #f1f5f9; }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:hover { background: #fafafa; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .name { font-weight: 600; }
    .badge {
      display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px;
      font-weight: 600; background: #dcfce7; color: #166534;
    }
    .badge.trial { background: #fef9c3; color: #854d0e; }
    .dot {
      display: inline-block; width: 8px; height: 8px; border-radius: 999px;
      background: #22c55e; margin-right: 6px; vertical-align: middle;
    }
    .dot.off { background: #cbd5e1; }
    .state { padding: 40px; text-align: center; color: #94a3b8; }
    .error {
      background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c;
      padding: 12px 16px; border-radius: 8px; margin-bottom: 12px; font-size: 14px;
      white-space: pre-wrap;
    }
  `],
})
export class AppComponent implements OnInit {
  private service = inject(SubscriptionsService);

  rows = signal<CompanySubscription[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  search = signal('');

  filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const list = this.rows();
    if (!q) return list;
    return list.filter(
      (r) =>
        r.company_name?.toLowerCase().includes(q) ||
        (r.subscription_type || '').toLowerCase().includes(q),
    );
  });

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.error.set(null);
    this.service.getAll().subscribe({
      next: (data) => {
        this.rows.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        const msg = err?.error?.message || err?.message || 'Request failed';
        this.error.set(`Could not load subscriptions: ${msg}\nIs the local server running (npm run server) and is .env filled in?`);
        this.loading.set(false);
      },
    });
  }

  formatDate(d: string | null): string {
    if (!d) return '—';
    const date = new Date(d);
    if (isNaN(date.getTime())) return d;
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  formatPrice(r: CompanySubscription): string {
    if (r.price == null) return '—';
    const cur = r.currency || '';
    return `${cur} ${Number(r.price).toLocaleString()}`.trim();
  }
}
