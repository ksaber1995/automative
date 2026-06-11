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
                <th>Mobile</th>
                <th>Registration</th>
                <th>Type</th>
                <th class="num">Price</th>
                <th class="num">Students</th>
                <th class="num">Employees</th>
                <th class="num">Branches</th>
                <th>Start</th>
                <th>End</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (r of filtered(); track r.company_id) {
                <tr>
                  <td class="name">{{ r.company_name }}</td>
                  <td>
                    @if (r.mobile) {
                      <a class="mobile" [href]="'tel:' + r.mobile">{{ r.mobile }}</a>
                    } @else {
                      —
                    }
                  </td>
                  <td>
                    <span class="reg" [class.teacher]="r.company_type === 'TEACHER'" [class.academy]="r.company_type === 'ACADEMY'">
                      {{ r.company_type || '—' }}
                    </span>
                  </td>
                  <td>
                    <span class="badge" [class.trial]="r.subscription_type === 'TRIAL'">
                      {{ r.subscription_type || '—' }}
                    </span>
                  </td>
                  <td class="num">{{ formatPrice(r) }}</td>
                  <td class="num">{{ r.student_count }}</td>
                  <td class="num">{{ r.employee_count }}</td>
                  <td class="num">{{ r.branch_count }}</td>
                  <td>{{ formatDate(r.start_date) }}</td>
                  <td>{{ formatDate(r.end_date) }}</td>
                  <td>
                    <span class="dot" [class.off]="!r.company_active"></span>
                    {{ r.company_active ? 'Active' : 'Inactive' }}
                  </td>
                  <td>
                    <div class="actions">
                      @if (r.subscription_type !== 'ACTIVE') {
                        <button class="act activate" [disabled]="busyId() === r.company_id" (click)="activate(r)">
                          Activate
                        </button>
                      }
                      <button class="act" [disabled]="busyId() === r.company_id" (click)="openExtend(r)">
                        Extend
                      </button>
                      @if (r.company_type === 'ACADEMY' || r.company_type === 'TEACHER') {
                        <button class="act" [disabled]="busyId() === r.company_id" (click)="openType(r)">
                          Make {{ r.company_type === 'ACADEMY' ? 'Teacher' : 'Academy' }}
                        </button>
                      }
                      <button class="act danger" [disabled]="busyId() === r.company_id" (click)="openDelete(r)">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              }
              @if (filtered().length === 0) {
                <tr><td colspan="12" class="state">No matches.</td></tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (flash()) {
        <div class="flash">{{ flash() }}</div>
      }

      <!-- Extend subscription dialog -->
      @if (extendRow(); as row) {
        <div class="overlay" (click)="closeExtend()">
          <div class="modal" (click)="$event.stopPropagation()">
            <h2>Extend subscription</h2>
            <p class="modal-sub"><strong>{{ row.company_name }}</strong> · ends {{ formatDate(row.end_date) }}</p>
            <p class="modal-sub">Add time onto the current end date (or from today if expired):</p>
            <div class="preset-grid">
              @for (m of extendPresets; track m) {
                <button class="act" [disabled]="busyId() === row.company_id" (click)="doExtend(row, m)">
                  +{{ m }} {{ m === 1 ? 'month' : 'months' }}
                </button>
              }
            </div>
            <div class="modal-foot">
              <button class="act" [disabled]="busyId() === row.company_id" (click)="closeExtend()">Cancel</button>
            </div>
          </div>
        </div>
      }

      <!-- Change registration type dialog -->
      @if (typeRow(); as row) {
        <div class="overlay" (click)="closeType()">
          <div class="modal" (click)="$event.stopPropagation()">
            <h2>Change registration type</h2>
            <p class="modal-sub">
              Switch <strong>{{ row.company_name }}</strong> from
              <strong>{{ row.company_type }}</strong> to <strong>{{ otherType(row) }}</strong>.
            </p>
            <p class="modal-sub">
              This changes which features the tenant sees (academy-only vs teacher-only).
              No other data is affected.
            </p>
            <div class="modal-foot">
              <button class="act" [disabled]="busyId() === row.company_id" (click)="closeType()">Cancel</button>
              <button class="act" [disabled]="busyId() === row.company_id" (click)="confirmType(row)">
                {{ busyId() === row.company_id ? 'Saving…' : 'Make ' + otherType(row) }}
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Delete company confirmation dialog -->
      @if (deleteRow(); as row) {
        <div class="overlay" (click)="closeDelete()">
          <div class="modal" (click)="$event.stopPropagation()">
            <h2 class="danger-title">Delete company</h2>
            <p class="modal-sub">
              This permanently deletes <strong>{{ row.company_name }}</strong> and
              <strong>all of its data</strong> — students, employees, branches, enrollments,
              payments, users and subscription. This <strong>cannot be undone</strong>.
            </p>
            <p class="modal-sub">Type the company name <code>{{ row.company_name }}</code> to confirm:</p>
            <input
              class="search"
              type="text"
              [ngModel]="deleteConfirmText()"
              (ngModelChange)="deleteConfirmText.set($event)"
              [placeholder]="row.company_name"
            />
            <div class="modal-foot">
              <button class="act" [disabled]="busyId() === row.company_id" (click)="closeDelete()">Cancel</button>
              <button
                class="act danger"
                [disabled]="busyId() === row.company_id || deleteConfirmText().trim() !== row.company_name.trim()"
                (click)="confirmDelete(row)"
              >
                {{ busyId() === row.company_id ? 'Deleting…' : 'Delete permanently' }}
              </button>
            </div>
          </div>
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
    .mobile { color: #1d4ed8; text-decoration: none; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .mobile:hover { text-decoration: underline; }
    .badge {
      display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px;
      font-weight: 600; background: #dcfce7; color: #166534;
    }
    .badge.trial { background: #fef9c3; color: #854d0e; }
    .reg {
      display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px;
      font-weight: 600; background: #e2e8f0; color: #475569;
    }
    .reg.teacher { background: #ede9fe; color: #6d28d9; }
    .reg.academy { background: #dbeafe; color: #1d4ed8; }
    .dot {
      display: inline-block; width: 8px; height: 8px; border-radius: 999px;
      background: #22c55e; margin-right: 6px; vertical-align: middle;
    }
    .dot.off { background: #cbd5e1; }
    .state { padding: 40px; text-align: center; color: #94a3b8; }
    .actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .act {
      border: 1px solid #cbd5e1; background: #fff; color: #0f172a; border-radius: 6px;
      padding: 5px 10px; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap;
    }
    .act:hover:not(:disabled) { background: #f1f5f9; }
    .act:disabled { opacity: .5; cursor: default; }
    .act.activate { border-color: #86efac; color: #166534; }
    .act.activate:hover:not(:disabled) { background: #f0fdf4; }
    .act.danger { border-color: #fca5a5; color: #b91c1c; }
    .act.danger:hover:not(:disabled) { background: #fef2f2; }
    .overlay {
      position: fixed; inset: 0; background: rgba(15, 23, 42, .45);
      display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 50;
    }
    .modal {
      background: #fff; border-radius: 12px; padding: 24px; width: 100%; max-width: 440px;
      box-shadow: 0 20px 40px rgba(0,0,0,.2);
    }
    .modal h2 { margin: 0 0 8px; font-size: 18px; }
    .modal h2.danger-title { color: #b91c1c; }
    .modal-sub { margin: 0 0 12px; color: #475569; font-size: 14px; line-height: 1.5; }
    .modal code { background: #f1f5f9; padding: 1px 6px; border-radius: 4px; font-size: 13px; }
    .preset-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 16px; }
    .preset-grid .act { padding: 10px; font-size: 13px; text-align: center; }
    .modal-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
    .flash {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      background: #0f172a; color: #fff; padding: 10px 18px; border-radius: 8px;
      font-size: 14px; box-shadow: 0 8px 20px rgba(0,0,0,.25); z-index: 60;
    }
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

  // Row-action state
  busyId = signal<string | null>(null);
  flash = signal<string | null>(null);
  private flashTimer?: ReturnType<typeof setTimeout>;
  extendRow = signal<CompanySubscription | null>(null);
  typeRow = signal<CompanySubscription | null>(null);
  deleteRow = signal<CompanySubscription | null>(null);
  deleteConfirmText = signal('');
  readonly extendPresets = [1, 3, 6, 12];

  filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const list = this.rows();
    if (!q) return list;
    return list.filter(
      (r) =>
        r.company_name?.toLowerCase().includes(q) ||
        (r.mobile || '').toLowerCase().includes(q) ||
        (r.company_type || '').toLowerCase().includes(q) ||
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
        this.error.set(`Could not load subscriptions: ${msg}`);
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

  private showFlash(msg: string) {
    this.flash.set(msg);
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.flash.set(null), 3500);
  }

  // ── Activate (TRIAL/etc → ACTIVE) ────────────────────────────────────────────
  activate(r: CompanySubscription) {
    this.busyId.set(r.company_id);
    this.service.activate(r.company_id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.showFlash(`${r.company_name} activated.`);
        this.load();
      },
      error: (err) => {
        this.busyId.set(null);
        this.error.set(`Activate failed: ${err?.error?.message || err?.message || 'Request failed'}`);
      },
    });
  }

  // ── Extend subscription ──────────────────────────────────────────────────────
  openExtend(r: CompanySubscription) {
    this.extendRow.set(r);
  }

  closeExtend() {
    if (this.busyId()) return;
    this.extendRow.set(null);
  }

  doExtend(r: CompanySubscription, months: number) {
    this.busyId.set(r.company_id);
    this.service.extend(r.company_id, months).subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.extendRow.set(null);
        this.showFlash(`${r.company_name} extended to ${this.formatDate(res.end_date)}.`);
        this.load();
      },
      error: (err) => {
        this.busyId.set(null);
        this.error.set(`Extend failed: ${err?.error?.message || err?.message || 'Request failed'}`);
      },
    });
  }

  // ── Change registration type (ACADEMY ↔ TEACHER) ─────────────────────────────
  otherType(r: CompanySubscription): 'ACADEMY' | 'TEACHER' {
    return r.company_type === 'ACADEMY' ? 'TEACHER' : 'ACADEMY';
  }

  openType(r: CompanySubscription) {
    this.typeRow.set(r);
  }

  closeType() {
    if (this.busyId()) return;
    this.typeRow.set(null);
  }

  confirmType(r: CompanySubscription) {
    const target = this.otherType(r);
    this.busyId.set(r.company_id);
    this.service.setType(r.company_id, target).subscribe({
      next: () => {
        this.busyId.set(null);
        this.typeRow.set(null);
        this.showFlash(`${r.company_name} is now ${target}.`);
        this.load();
      },
      error: (err) => {
        this.busyId.set(null);
        this.error.set(`Change type failed: ${err?.error?.message || err?.message || 'Request failed'}`);
      },
    });
  }

  // ── Delete company ───────────────────────────────────────────────────────────
  openDelete(r: CompanySubscription) {
    this.deleteConfirmText.set('');
    this.deleteRow.set(r);
  }

  closeDelete() {
    if (this.busyId()) return;
    this.deleteRow.set(null);
    this.deleteConfirmText.set('');
  }

  confirmDelete(r: CompanySubscription) {
    if (this.deleteConfirmText().trim() !== r.company_name.trim()) return;
    this.busyId.set(r.company_id);
    this.service.delete(r.company_id).subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.deleteRow.set(null);
        this.deleteConfirmText.set('');
        this.showFlash(`${res.company_name} deleted permanently.`);
        this.load();
      },
      error: (err) => {
        this.busyId.set(null);
        this.error.set(`Delete failed: ${err?.error?.message || err?.message || 'Request failed'}`);
      },
    });
  }
}
