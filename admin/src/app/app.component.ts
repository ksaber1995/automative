import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CompanySubscription, OfflineLicense, PoolBot, SubscriptionsService } from './subscriptions.service';

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

      <!-- Telegram bot pool (platform-owned; academies auto-claim a free bot on enable) -->
      <div class="card" style="margin: 20px 0; padding: 16px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
          <div>
            <h2 style="margin:0; font-size:16px;">Telegram bot pool</h2>
            <p class="sub" style="margin-top:4px;">
              {{ poolAvailable() }} available · {{ poolTotal() }} total — create bots in &#64;BotFather, paste each token here.
            </p>
          </div>
          <div style="display:flex; gap:8px; flex:1; min-width:280px; max-width:560px;">
            <input class="search" type="text"
              [ngModel]="poolToken()" (ngModelChange)="poolToken.set($event)"
              placeholder="Paste a bot token from @BotFather…" />
            <button class="act activate" [disabled]="addingBot() || !poolToken().trim()" (click)="addBot()">
              {{ addingBot() ? 'Adding…' : 'Add bot' }}
            </button>
          </div>
        </div>
        @if (bots().length) {
          <div style="margin-top:12px; display:flex; flex-wrap:wrap; gap:8px;">
            @for (b of bots(); track b.id) {
              <span class="reg" [class.academy]="!b.assigned_company_id" [class.teacher]="b.assigned_company_id">
                {{ '@' + b.bot_username }} · {{ b.company_name || 'available' }}
              </span>
            }
          </div>
        }
      </div>

      <!-- Offline licenses (desktop app keys the owner emails to customers) -->
      <div class="card" style="margin: 20px 0; padding: 16px;">
        <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap;">
          <div>
            <h2 style="margin:0; font-size:16px;">Offline licenses</h2>
            <p class="sub" style="margin-top:4px;">
              {{ licenses().length }} issued — mint a key, email it to the customer, then activate once they install.
            </p>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
            <select class="search" style="flex:0 0 auto; min-width:130px;"
              [ngModel]="newLicenseTier()" (ngModelChange)="newLicenseTier.set($event)">
              <option value="TEACHER">TEACHER</option>
              <option value="ACADEMY">ACADEMY</option>
            </select>
            <input class="search" style="min-width:200px;" type="text"
              [ngModel]="newLicenseLabel()" (ngModelChange)="newLicenseLabel.set($event)"
              placeholder="Label (e.g. customer name)…" />
            <button class="act activate" [disabled]="creatingLicense()" (click)="createLicense()">
              {{ creatingLicense() ? 'Creating…' : 'Create' }}
            </button>
          </div>
        </div>

        @if (newLicenseKey(); as key) {
          <div class="keybox">
            <div>
              <div class="keybox-label">New license key — send this to the customer</div>
              <code class="keybox-key">{{ key }}</code>
            </div>
            <div style="display:flex; gap:8px;">
              <button class="act activate" (click)="copyKey(key)">Copy</button>
              <button class="act" (click)="newLicenseKey.set(null)">Dismiss</button>
            </div>
          </div>
        }

        @if (licensesLoading()) {
          <div class="state">Loading…</div>
        } @else if (licenses().length === 0) {
          <div class="state">No licenses issued yet.</div>
        } @else {
          <div style="margin-top:12px; overflow-x:auto;">
            <table>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Tier</th>
                  <th>Label</th>
                  <th>Device</th>
                  <th>Status</th>
                  <th>Trial ends</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (l of licenses(); track l.id) {
                  <tr>
                    <td>
                      <code class="lic-key">{{ l.licenseKey }}</code>
                      <button class="act" style="margin-left:6px;" (click)="copyKey(l.licenseKey)">Copy</button>
                    </td>
                    <td>
                      <span class="reg" [class.teacher]="l.tier === 'TEACHER'" [class.academy]="l.tier === 'ACADEMY'">
                        {{ l.tier }}
                      </span>
                    </td>
                    <td>{{ l.label || '—' }}</td>
                    <td>
                      @if (l.deviceId) {
                        <code class="lic-key" title="{{ l.deviceId }}">{{ shortDevice(l.deviceId) }}</code>
                      } @else {
                        —
                      }
                    </td>
                    <td>
                      <span class="badge"
                        [class.trial]="licenseStatus(l).kind === 'TRIAL'"
                        [class.expired]="licenseStatus(l).kind === 'EXPIRED'"
                        [class.revoked]="licenseStatus(l).kind === 'REVOKED'">
                        {{ licenseStatus(l).text }}
                      </span>
                    </td>
                    <td>{{ formatDate(l.trialEndsAt) }}</td>
                    <td>{{ formatDate(l.createdAt) }}</td>
                    <td>
                      <div class="actions">
                        <button class="act activate" [disabled]="busyId() === l.id" (click)="activateLicense(l)">
                          Activate
                        </button>
                        <button class="act" [disabled]="busyId() === l.id" (click)="extendTrial(l)">
                          Extend trial
                        </button>
                        <button class="act" [disabled]="busyId() === l.id || !l.deviceId" (click)="resetDevice(l)">
                          Reset device
                        </button>
                        <button class="act" [disabled]="busyId() === l.id" (click)="toggleTier(l)">
                          Make {{ l.tier === 'ACADEMY' ? 'Teacher' : 'Academy' }}
                        </button>
                        <button class="act" [disabled]="busyId() === l.id" (click)="toggleRevoked(l)">
                          {{ l.revoked ? 'Unrevoke' : 'Revoke' }}
                        </button>
                        <button class="act danger" [disabled]="busyId() === l.id" (click)="deleteLicense(l)">
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>

      <div class="filters">
        <button class="filter" [class.on]="statusFilter() === ''" (click)="statusFilter.set('')">
          All <span class="fcount">{{ rows().length }}</span>
        </button>
        <button class="filter" [class.on]="statusFilter() === 'ACTIVE'" (click)="statusFilter.set('ACTIVE')">
          Active <span class="fcount">{{ statusCount('ACTIVE') }}</span>
        </button>
        <button class="filter" [class.on]="statusFilter() === 'TRIAL'" (click)="statusFilter.set('TRIAL')">
          Trial <span class="fcount">{{ statusCount('TRIAL') }}</span>
        </button>
        <button class="filter" [class.on]="statusFilter() === 'EXPIRED'" (click)="statusFilter.set('EXPIRED')">
          Expired <span class="fcount">{{ statusCount('EXPIRED') }}</span>
        </button>
      </div>

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
                <th>Email</th>
                <th>Registration</th>
                <th>Type</th>
                <th class="num">Price</th>
                <th class="num">Students</th>
                <th class="num">Courses</th>
                <th class="num">Employees</th>
                <th class="num">Branches</th>
                <th class="num">QR</th>
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
                    @if (r.owner_email) {
                      <a class="mobile" [href]="'mailto:' + r.owner_email">{{ r.owner_email }}</a>
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
                  <td class="num">{{ r.course_count }}</td>
                  <td class="num">{{ r.employee_count }}</td>
                  <td class="num">{{ r.branch_count }}</td>
                  <td class="num">
                    @if (r.qr_activated_count > 0) {
                      <span>{{ r.qr_activated_count }}</span>
                      @if (r.qr_unpaid_cost > 0) {
                        <span class="qr-due">· {{ r.qr_unpaid_cost }} {{ r.currency }} due</span>
                      } @else {
                        <span class="qr-paid">· paid</span>
                      }
                    } @else {
                      —
                    }
                  </td>
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
                      @if (r.qr_activated_count > 0) {
                        <button class="act" [disabled]="busyId() === r.company_id" (click)="openQr(r)">
                          QR billing
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
                <tr><td colspan="13" class="state">No matches.</td></tr>
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

      <!-- QR billing dialog -->
      @if (qrRow(); as row) {
        <div class="overlay" (click)="closeQr()">
          <div class="modal" (click)="$event.stopPropagation()">
            <h2>QR activation billing</h2>
            <p class="modal-sub">
              <strong>{{ row.company_name }}</strong> has
              <strong>{{ row.qr_activated_count }}</strong> activated QR code(s),
              total <strong>{{ row.qr_total_cost }} {{ row.currency }}</strong>,
              of which <strong>{{ row.qr_unpaid_cost }} {{ row.currency }}</strong> is outstanding.
            </p>
            <p class="modal-sub">
              Mark this company's activations as paid once they settle the bill, or revert to unpaid.
            </p>
            <div class="modal-foot">
              <button class="act" [disabled]="busyId() === row.company_id" (click)="closeQr()">Cancel</button>
              <button class="act" [disabled]="busyId() === row.company_id" (click)="doSetQrPaid(row, false)">
                {{ busyId() === row.company_id ? '…' : 'Mark unpaid' }}
              </button>
              <button class="act activate" [disabled]="busyId() === row.company_id" (click)="doSetQrPaid(row, true)">
                {{ busyId() === row.company_id ? 'Saving…' : 'Mark paid' }}
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .wrap {  margin: 0 auto; padding: 32px 20px 60px; }
    header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    h1 { margin: 0; font-size: 24px; }
    .sub { margin: 4px 0 0; color: #64748b; font-size: 14px; }
    .refresh {
      border: 1px solid #cbd5e1; background: #fff; color: #0f172a; border-radius: 8px;
      padding: 8px 16px; font-size: 14px; cursor: pointer;
    }
    .refresh:disabled { opacity: .6; cursor: default; }
    .filters { display: flex; align-items: center; gap: 8px; margin: 20px 0 0; flex-wrap: wrap; }
    .filter {
      border: 1px solid #cbd5e1; background: #fff; color: #334155; border-radius: 999px;
      padding: 6px 14px; font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex;
      align-items: center; gap: 6px;
    }
    .filter:hover { background: #f1f5f9; }
    .filter.on { background: #4f46e5; border-color: #4f46e5; color: #fff; }
    .fcount {
      background: rgba(15, 23, 42, .08); border-radius: 999px; padding: 0 7px; font-size: 12px;
      font-variant-numeric: tabular-nums;
    }
    .filter.on .fcount { background: rgba(255, 255, 255, .25); }
    .toolbar { display: flex; align-items: center; gap: 12px; margin: 12px 0; }
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
    .badge.expired { background: #f1f5f9; color: #64748b; }
    .badge.revoked { background: #fee2e2; color: #b91c1c; }
    .lic-key { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 12px; font-family: ui-monospace, monospace; }
    .keybox {
      margin-top: 12px; display: flex; align-items: center; justify-content: space-between;
      gap: 12px; flex-wrap: wrap; background: #f0fdf4; border: 1px solid #86efac;
      border-radius: 8px; padding: 12px 14px;
    }
    .keybox-label { font-size: 12px; font-weight: 600; color: #166534; margin-bottom: 4px; }
    .keybox-key {
      font-family: ui-monospace, monospace; font-size: 15px; font-weight: 700; color: #14532d;
      letter-spacing: .5px; word-break: break-all;
    }
    .reg {
      display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px;
      font-weight: 600; background: #e2e8f0; color: #475569;
    }
    .reg.teacher { background: #ede9fe; color: #6d28d9; }
    .reg.academy { background: #dbeafe; color: #1d4ed8; }
    .qr-due { color: #b45309; font-size: 12px; }
    .qr-paid { color: #16a34a; font-size: 12px; }
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
  /** '' = all, otherwise a subscription_type to match (e.g. ACTIVE, TRIAL). */
  statusFilter = signal('');

  // Row-action state
  busyId = signal<string | null>(null);
  flash = signal<string | null>(null);
  private flashTimer?: ReturnType<typeof setTimeout>;
  extendRow = signal<CompanySubscription | null>(null);
  typeRow = signal<CompanySubscription | null>(null);
  qrRow = signal<CompanySubscription | null>(null);
  deleteRow = signal<CompanySubscription | null>(null);
  deleteConfirmText = signal('');
  readonly extendPresets = [1, 3, 6, 12];

  // Telegram bot pool
  bots = signal<PoolBot[]>([]);
  poolTotal = signal(0);
  poolAvailable = signal(0);
  poolToken = signal('');
  addingBot = signal(false);

  // Offline licenses
  licenses = signal<OfflineLicense[]>([]);
  licensesLoading = signal(true);
  newLicenseTier = signal<'TEACHER' | 'ACADEMY'>('TEACHER');
  newLicenseLabel = signal('');
  creatingLicense = signal(false);
  newLicenseKey = signal<string | null>(null);

  filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const status = this.statusFilter();
    let list = this.rows();
    if (status) {
      list = list.filter((r) => (r.subscription_type || '').toUpperCase() === status);
    }
    if (!q) return list;
    return list.filter(
      (r) =>
        r.company_name?.toLowerCase().includes(q) ||
        (r.mobile || '').toLowerCase().includes(q) ||
        (r.company_type || '').toLowerCase().includes(q) ||
        (r.subscription_type || '').toLowerCase().includes(q),
    );
  });

  /** How many tenants currently carry the given subscription_type. */
  statusCount(status: string): number {
    return this.rows().filter((r) => (r.subscription_type || '').toUpperCase() === status).length;
  }

  ngOnInit() {
    this.load();
    this.loadBots();
    this.loadLicenses();
  }

  loadBots() {
    this.service.listTelegramBots().subscribe({
      next: (res) => {
        this.bots.set(res.bots);
        this.poolTotal.set(res.total);
        this.poolAvailable.set(res.available);
      },
      error: () => {},
    });
  }

  addBot() {
    const token = this.poolToken().trim();
    if (!token || this.addingBot()) return;
    this.addingBot.set(true);
    this.service.addTelegramBot(token).subscribe({
      next: (res) => {
        this.addingBot.set(false);
        this.poolToken.set('');
        this.showFlash(`Added @${res.bot_username} · ${res.available} available`);
        this.loadBots();
      },
      error: (err) => {
        this.addingBot.set(false);
        this.showFlash(err?.error?.message || 'Could not add bot');
      },
    });
  }

  // ── Offline licenses ─────────────────────────────────────────────────────────
  loadLicenses() {
    this.licensesLoading.set(true);
    this.service.listLicenses().subscribe({
      next: (data) => {
        this.licenses.set(data);
        this.licensesLoading.set(false);
      },
      error: () => {
        this.licensesLoading.set(false);
      },
    });
  }

  createLicense() {
    if (this.creatingLicense()) return;
    this.creatingLicense.set(true);
    this.service
      .createLicense({ tier: this.newLicenseTier(), label: this.newLicenseLabel().trim() || undefined })
      .subscribe({
        next: (lic) => {
          this.creatingLicense.set(false);
          this.newLicenseLabel.set('');
          this.newLicenseKey.set(lic.licenseKey);
          this.showFlash(`License created: ${lic.licenseKey}`);
          this.loadLicenses();
        },
        error: (err) => {
          this.creatingLicense.set(false);
          this.error.set(`Create license failed: ${err?.error?.message || err?.message || 'Request failed'}`);
        },
      });
  }

  copyKey(key: string) {
    navigator.clipboard?.writeText(key).then(
      () => this.showFlash('Key copied to clipboard.'),
      () => this.showFlash('Could not copy — select and copy manually.'),
    );
  }

  /** Short display for a bound device id. */
  shortDevice(id: string): string {
    return id.length > 12 ? id.slice(0, 12) + '…' : id;
  }

  /** Compute a status badge for a license row. */
  licenseStatus(l: OfflineLicense): { kind: 'ACTIVE' | 'TRIAL' | 'EXPIRED' | 'REVOKED'; text: string } {
    if (l.revoked) return { kind: 'REVOKED', text: 'Revoked' };
    const now = Date.now();
    if (l.activated && (!l.activationEndsAt || new Date(l.activationEndsAt).getTime() > now)) {
      return { kind: 'ACTIVE', text: 'Active' };
    }
    if (!l.activated && l.trialEndsAt && new Date(l.trialEndsAt).getTime() > now) {
      return { kind: 'TRIAL', text: `Trial (ends ${this.formatDate(l.trialEndsAt)})` };
    }
    return { kind: 'EXPIRED', text: 'Expired' };
  }

  activateLicense(l: OfflineLicense) {
    this.busyId.set(l.id);
    this.service.activateLicense(l.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.showFlash(`${l.label || l.licenseKey} activated.`);
        this.loadLicenses();
      },
      error: (err) => {
        this.busyId.set(null);
        this.error.set(`Activate failed: ${err?.error?.message || err?.message || 'Request failed'}`);
      },
    });
  }

  extendTrial(l: OfflineLicense) {
    const input = window.prompt('Extend trial by how many days?', '7');
    if (input === null) return;
    const days = parseInt(input, 10);
    if (isNaN(days) || days <= 0) {
      this.showFlash('Enter a positive number of days.');
      return;
    }
    this.busyId.set(l.id);
    this.service.extendTrial(l.id, days).subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.showFlash(`Trial extended to ${this.formatDate(res.trialEndsAt)}.`);
        this.loadLicenses();
      },
      error: (err) => {
        this.busyId.set(null);
        this.error.set(`Extend trial failed: ${err?.error?.message || err?.message || 'Request failed'}`);
      },
    });
  }

  resetDevice(l: OfflineLicense) {
    if (!window.confirm('Unbind this license from its current device? The customer can then activate on a new machine.')) return;
    this.busyId.set(l.id);
    this.service.resetDevice(l.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.showFlash('Device reset — license is unbound.');
        this.loadLicenses();
      },
      error: (err) => {
        this.busyId.set(null);
        this.error.set(`Reset device failed: ${err?.error?.message || err?.message || 'Request failed'}`);
      },
    });
  }

  toggleTier(l: OfflineLicense) {
    const target: 'TEACHER' | 'ACADEMY' = l.tier === 'ACADEMY' ? 'TEACHER' : 'ACADEMY';
    this.busyId.set(l.id);
    this.service.setTier(l.id, target).subscribe({
      next: () => {
        this.busyId.set(null);
        this.showFlash(`License is now ${target}.`);
        this.loadLicenses();
      },
      error: (err) => {
        this.busyId.set(null);
        this.error.set(`Change tier failed: ${err?.error?.message || err?.message || 'Request failed'}`);
      },
    });
  }

  toggleRevoked(l: OfflineLicense) {
    const target = !l.revoked;
    if (target && !window.confirm('Revoke this license? The customer will lose access.')) return;
    this.busyId.set(l.id);
    this.service.setRevoked(l.id, target).subscribe({
      next: () => {
        this.busyId.set(null);
        this.showFlash(target ? 'License revoked.' : 'License un-revoked.');
        this.loadLicenses();
      },
      error: (err) => {
        this.busyId.set(null);
        this.error.set(`Revoke failed: ${err?.error?.message || err?.message || 'Request failed'}`);
      },
    });
  }

  deleteLicense(l: OfflineLicense) {
    if (!window.confirm(`Permanently delete license ${l.licenseKey}? This cannot be undone.`)) return;
    this.busyId.set(l.id);
    this.service.deleteLicense(l.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.showFlash('License deleted.');
        this.loadLicenses();
      },
      error: (err) => {
        this.busyId.set(null);
        this.error.set(`Delete failed: ${err?.error?.message || err?.message || 'Request failed'}`);
      },
    });
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

  // ── QR activation billing (mark paid / unpaid) ───────────────────────────────
  openQr(r: CompanySubscription) {
    this.qrRow.set(r);
  }

  closeQr() {
    if (this.busyId()) return;
    this.qrRow.set(null);
  }

  doSetQrPaid(r: CompanySubscription, paid: boolean) {
    this.busyId.set(r.company_id);
    this.service.setQrPaid(r.company_id, paid).subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.qrRow.set(null);
        this.showFlash(`${r.company_name}: ${res.updated_count} activation(s) marked ${paid ? 'paid' : 'unpaid'}.`);
        this.load();
      },
      error: (err) => {
        this.busyId.set(null);
        this.error.set(`QR billing update failed: ${err?.error?.message || err?.message || 'Request failed'}`);
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
