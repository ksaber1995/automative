import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CompanySubscription, PoolType, POOL_TYPES, SubscriptionsService,
} from '../subscriptions.service';
import { PortalAuthService } from '../auth/portal-auth.service';
import { AdminStore } from '../admin-store.service';
import { syncQueryParams } from '../shared/query-sync';

/**
 * Companies & Subscriptions — the tenant table and everything you can do to one
 * row: activate, park, extend, re-type, delete, and switch its QR card pool on.
 *
 * Was the bulk of AppComponent until the sections became routes. The tenant list
 * itself lives in AdminStore, because the sidebar counts it and the Users page
 * needs it for its tenant pickers; the dialogs and their in-flight state are
 * local to this screen.
 */
@Component({
  selector: 'app-companies-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrls: ['../shared/admin-ui.css'],
  styles: [`
    .sms-cell { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .sms-until { font-size: 12px; white-space: nowrap; }
    .sms-toggle { display: flex; align-items: center; gap: 8px; margin: 6px 0 4px; font-size: 14px; cursor: pointer; }
    .lbl { display: block; font-size: 12px; font-weight: 700; color: #334155; margin: 14px 0 5px; }
  `],
  template: `
    <header>
      <div>
        <h1>Companies &amp; Subscriptions</h1>
        <p class="sub">Every tenant in the system · {{ rows().length }} in total</p>
      </div>
      <button class="refresh" (click)="refresh()" [disabled]="loading()">
        {{ loading() ? 'Loading…' : 'Refresh' }}
      </button>
    </header>

    <div class="filters">
      <button class="filter" [class.on]="statusFilter() === ''" (click)="statusFilter.set('')">
        All <span class="fcount">{{ rows().length }}</span>
      </button>
      <button class="filter" [class.on]="statusFilter() === 'ACTIVE'" (click)="statusFilter.set('ACTIVE')">
        Active <span class="fcount">{{ store.statusCount('ACTIVE') }}</span>
      </button>
      <button class="filter" [class.on]="statusFilter() === 'TRIAL'" (click)="statusFilter.set('TRIAL')">
        Trial <span class="fcount">{{ store.statusCount('TRIAL') }}</span>
      </button>
      <button class="filter" [class.on]="statusFilter() === 'EXPIRED'" (click)="statusFilter.set('EXPIRED')">
        Expired <span class="fcount">{{ store.statusCount('EXPIRED') }}</span>
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

    @if (error(); as e) {
      <div class="error">{{ e }}</div>
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
              <th>Start</th>
              <th>End</th>
              <th>Status</th>
              <th>SMS</th>
              <th>QR cards</th>
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
                <td>{{ formatDate(r.start_date) }}</td>
                <td>{{ formatDate(r.end_date) }}</td>
                <td>
                  <span class="dot" [class.off]="!r.company_active"></span>
                  {{ r.company_active ? 'Active' : 'Inactive' }}
                </td>
                <td>
                  <!-- The derived state, not the raw flag: a tenant switched on
                       whose date ran out last week is OFF, and saying "on" here
                       would be the console disagreeing with the sender. -->
                  <div class="sms-cell">
                    @if (r.sms_active) {
                      <span class="badge">on</span>
                    } @else if (r.sms_activated) {
                      <span class="badge expired" title="Activated, but the end date has passed">lapsed</span>
                    } @else {
                      <span class="sub">off</span>
                    }
                    @if (r.sms_expiration) {
                      <span class="sub sms-until">to {{ formatDate(r.sms_expiration) }}</span>
                    } @else if (r.sms_active) {
                      <span class="sub sms-until">no end date</span>
                    }
                    @if (auth.can('companies.write')) {
                      <button class="act" [disabled]="busyId() === r.company_id" (click)="openSms(r)">
                        {{ r.sms_activated ? 'Edit' : 'Activate' }}
                      </button>
                    }
                  </div>
                </td>
                <td>
                  @if (!auth.can('cards.read')) {
                    <span class="sub">—</span>
                  } @else if (qrStats()[r.company_id]; as q) {
                    <div class="qr-cell">
                      @if (auth.can('cards.write')) {
                        <button class="act" [class.activate]="!q.qr_cards_enabled"
                          [disabled]="busyId() === r.company_id"
                          (click)="toggleQrCards(r)">
                          {{ q.qr_cards_enabled ? 'Disable' : 'Enable' }}
                        </button>
                      }
                      @if (q.qr_cards_enabled) {
                        @if (auth.can('cards.write')) {
                          <button class="act" [disabled]="busyId() === r.company_id" (click)="openQrCards(r)">
                            + Cards
                          </button>
                        }
                        <span class="qr-count">{{ q.linked }} / {{ q.total }}</span>
                      } @else if (!auth.can('cards.write')) {
                        <span class="sub">off</span>
                      }
                    </div>
                  } @else {
                    <button class="act" [disabled]="busyId() === r.company_id" (click)="loadQrStats(r.company_id)">
                      Check
                    </button>
                  }
                </td>
                <td>
                  <div class="actions">
                    @if (auth.can('companies.write')) {
                      @if (r.subscription_type !== 'ACTIVE') {
                        <button class="act activate" [disabled]="busyId() === r.company_id" (click)="activate(r)">
                          Activate
                        </button>
                      }
                      @if (r.subscription_type !== 'EXPIRED') {
                        <button class="act" [disabled]="busyId() === r.company_id" (click)="openDeactivate(r)">
                          Deactivate
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
                    }
                    @if (auth.can('companies.delete')) {
                      <button class="act danger" [disabled]="busyId() === r.company_id" (click)="openDelete(r)">
                        Delete
                      </button>
                    }
                    @if (!auth.can('companies.write') && !auth.can('companies.delete')) {
                      <span class="sub">read only</span>
                    }
                  </div>
                </td>
              </tr>
            }
            @if (filtered().length === 0) {
              <tr><td colspan="16" class="state">No matches.</td></tr>
            }
          </tbody>
        </table>
      </div>
    }

    <!-- SMS entitlement -->
    @if (smsRow(); as row) {
      <div class="overlay" (click)="closeSms()">
        <div class="modal" (click)="$event.stopPropagation()">
          <h2>SMS for {{ row.company_name }}</h2>
          <p class="modal-sub">
            Whether this tenant may send SMS, and the date it runs to.
          </p>

          <label class="sms-toggle">
            <input type="checkbox" [ngModel]="smsActivated()" (ngModelChange)="smsActivated.set($event)" />
            <span>SMS activated</span>
          </label>

          <label class="lbl">Runs until</label>
          <input class="search" type="date" [ngModel]="smsExpiration()" (ngModelChange)="smsExpiration.set($event)" />
          <p class="modal-sub">
            Leave the date empty for <strong>no end date</strong> — that is not the same as expired.
            A tenant with no end date stays on until switched off here.
          </p>

          @if (smsError(); as e) { <div class="error">{{ e }}</div> }

          <div class="modal-foot">
            <button class="act" [disabled]="busyId() === row.company_id" (click)="closeSms()">Cancel</button>
            <button class="act activate" [disabled]="busyId() === row.company_id" (click)="confirmSms(row)">
              {{ busyId() === row.company_id ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Park a tenant -->
    @if (deactivateRow(); as row) {
      <div class="overlay" (click)="deactivateRow.set(null)">
        <div class="modal" (click)="$event.stopPropagation()">
          <h2>Deactivate subscription</h2>
          <p class="modal-sub">
            <strong>{{ row.company_name }}</strong> will be marked EXPIRED and ends today, so the app
            locks them out. Nothing is deleted — Activate puts them straight back.
          </p>
          <div class="modal-foot">
            <button class="act" [disabled]="busyId() === row.company_id" (click)="deactivateRow.set(null)">Cancel</button>
            <button class="act danger" [disabled]="busyId() === row.company_id" (click)="confirmDeactivate(row)">
              Deactivate
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Extend subscription -->
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

    <!-- Print a batch of blank QR cards FOR a client. The cards are pooled and
         unowned until the academy scans one onto a student. -->
    @if (qrRow(); as row) {
      <div class="overlay" (click)="qrRow.set(null)">
        <div class="modal" (click)="$event.stopPropagation()">
          <h2>Create QR cards</h2>
          <p class="modal-sub"><strong>{{ row.company_name }}</strong></p>
          @if (qrStats()[row.company_id]; as q) {
            <p class="modal-sub">{{ q.total }} cards so far · {{ q.linked }} linked to a student.</p>
          }
          <p class="modal-sub">
            Blank cards, tied to no student. Serials are reserved above 100000 but print
            short — <code>A1</code>, <code>A2</code>, … — so a card number can never be
            confused with a student's own code. The academy downloads and prints them itself.
          </p>
          <input class="search" type="number" min="1" max="2000" [(ngModel)]="qrCount" placeholder="How many?" />
          <!--
            setPoolType, not qrPoolType.set(+$event): <option [value]="t"> hands back
            a STRING and PoolType is 1 | 2 | 3, so the inline version needed a widening
            the compiler rejects (TS2345) — which is what got the whole handler deleted,
            taking the picker's only effect with it. The narrowing lives in the class.
          -->
          <select class="search" [ngModel]="qrPoolType()" (ngModelChange)="setPoolType($event)">
            @for (t of poolTypes; track t) {
              <option [value]="t">Type {{ t }}</option>
            }
          </select>
          <p class="modal-sub">
            The type stamps this run so it can be told apart later. Nothing behaves
            differently yet, and it does not change the serials.
          </p>
          <div class="modal-foot">
            <button class="act" [disabled]="busyId() === row.company_id" (click)="qrRow.set(null)">Cancel</button>
            <button class="act activate" [disabled]="busyId() === row.company_id" (click)="confirmQrCards()">
              Create cards
            </button>
          </div>

          <!-- Throwing the pool away. Deliberately below the fold and behind a
               second click: emptying a pool renumbers the next run back to A1,
               so any card already printed is dead paper. -->
          @if (qrStats()[row.company_id]; as q) {
            @if (q.total > 0) {
              <hr style="margin:16px 0;border:none;border-top:1px solid #eee" />
              @if (!qrDeleteArmed()) {
                <button class="act danger" [disabled]="busyId() === row.company_id" (click)="qrDeleteArmed.set(true)">
                  Delete pool…
                </button>
              } @else {
                <p class="modal-sub">
                  Delete <strong>{{ q.total - q.linked }}</strong> unassigned
                  {{ q.total - q.linked === 1 ? 'card' : 'cards' }}.
                  @if (q.linked > 0) {
                    <strong>{{ q.linked }}</strong> {{ q.linked === 1 ? 'card is' : 'cards are' }} linked to a
                    student and will be kept unless you tick below.
                  }
                  The next run starts again from <code>A1</code>, so anything already printed stops working.
                </p>
                @if (q.linked > 0) {
                  <label class="modal-sub" style="display:flex;gap:8px;align-items:center">
                    <input type="checkbox" [ngModel]="qrDeleteLinked()" (ngModelChange)="qrDeleteLinked.set($event)" />
                    Also delete the {{ q.linked }} linked {{ q.linked === 1 ? 'card' : 'cards' }} —
                    {{ q.linked === 1 ? 'that student loses' : 'those students lose' }} the card in their pocket.
                  </label>
                }
                <div class="modal-foot">
                  <button class="act" [disabled]="busyId() === row.company_id" (click)="qrDeleteArmed.set(false)">
                    Keep them
                  </button>
                  <button class="act danger" [disabled]="busyId() === row.company_id" (click)="confirmDeleteQrCards()">
                    Delete
                  </button>
                </div>
              }
            }
          }
        </div>
      </div>
    }

    <!-- Change registration type -->
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

    <!-- Delete company -->
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
  `,
})
export class CompaniesPageComponent {
  private service = inject(SubscriptionsService);
  protected store = inject(AdminStore);
  protected auth = inject(PortalAuthService);

  protected rows = this.store.companies;
  protected loading = this.store.companiesLoading;
  protected error = signal<string | null>(null);

  protected search = signal('');
  /** '' = all, otherwise a subscription_type to match (e.g. ACTIVE, TRIAL). */
  protected statusFilter = signal('');

  protected busyId = signal<string | null>(null);
  protected extendRow = signal<CompanySubscription | null>(null);
  protected typeRow = signal<CompanySubscription | null>(null);
  protected deleteRow = signal<CompanySubscription | null>(null);
  protected deactivateRow = signal<CompanySubscription | null>(null);
  protected deleteConfirmText = signal('');
  protected readonly extendPresets = [1, 3, 6, 12];

  protected filtered = computed(() => {
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

  constructor() {
    // `?q=` and `?status=` — so a filtered table survives a reload and can be
    // sent to someone as a link.
    syncQueryParams([
      { key: 'q', get: () => this.search().trim() || null, set: (v) => this.search.set(v ?? '') },
      { key: 'status', get: () => this.statusFilter() || null, set: (v) => this.statusFilter.set(v ?? '') },
    ]);

    this.store.loadCompanies();
    // The store owns the fetch, so its failure is the one to surface here.
    this.error.set(this.store.companiesError());
  }

  protected refresh(): void {
    this.error.set(null);
    this.store.loadCompanies(true);
  }

  protected formatDate(d: string | null): string {
    if (!d) return '—';
    const date = new Date(d);
    if (isNaN(date.getTime())) return d;
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  protected formatPrice(r: CompanySubscription): string {
    if (r.price == null) return '—';
    const cur = r.currency || '';
    return `${cur} ${Number(r.price).toLocaleString()}`.trim();
  }

  private fail(prefix: string, err: any): void {
    this.busyId.set(null);
    this.error.set(`${prefix}: ${err?.error?.message || err?.message || 'Request failed'}`);
  }

  // ── Activate (TRIAL/etc → ACTIVE) ──────────────────────────────────────────
  protected activate(r: CompanySubscription): void {
    this.busyId.set(r.company_id);
    this.service.activate(r.company_id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.store.showFlash(`${r.company_name} activated.`);
        this.store.loadCompanies(true);
      },
      error: (err) => this.fail('Activate failed', err),
    });
  }

  // ── Extend ─────────────────────────────────────────────────────────────────
  protected openExtend(r: CompanySubscription): void { this.extendRow.set(r); }

  protected closeExtend(): void {
    if (this.busyId()) return;
    this.extendRow.set(null);
  }

  protected doExtend(r: CompanySubscription, months: number): void {
    this.busyId.set(r.company_id);
    this.service.extend(r.company_id, months).subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.extendRow.set(null);
        this.store.showFlash(`${r.company_name} extended to ${this.formatDate(res.end_date)}.`);
        this.store.loadCompanies(true);
      },
      error: (err) => this.fail('Extend failed', err),
    });
  }

  // ── Registration type (ACADEMY ↔ TEACHER) ──────────────────────────────────
  protected otherType(r: CompanySubscription): 'ACADEMY' | 'TEACHER' {
    return r.company_type === 'ACADEMY' ? 'TEACHER' : 'ACADEMY';
  }

  protected openType(r: CompanySubscription): void { this.typeRow.set(r); }

  protected closeType(): void {
    if (this.busyId()) return;
    this.typeRow.set(null);
  }

  protected confirmType(r: CompanySubscription): void {
    const target = this.otherType(r);
    this.busyId.set(r.company_id);
    this.service.setType(r.company_id, target).subscribe({
      next: () => {
        this.busyId.set(null);
        this.typeRow.set(null);
        this.store.showFlash(`${r.company_name} is now ${target}.`);
        this.store.loadCompanies(true);
      },
      error: (err) => this.fail('Change type failed', err),
    });
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  protected openDelete(r: CompanySubscription): void {
    this.deleteConfirmText.set('');
    this.deleteRow.set(r);
  }

  protected closeDelete(): void {
    if (this.busyId()) return;
    this.deleteRow.set(null);
    this.deleteConfirmText.set('');
  }

  protected confirmDelete(r: CompanySubscription): void {
    if (this.deleteConfirmText().trim() !== r.company_name.trim()) return;
    this.busyId.set(r.company_id);
    this.service.delete(r.company_id).subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.deleteRow.set(null);
        this.deleteConfirmText.set('');
        this.store.showFlash(`${res.company_name} deleted permanently.`);
        this.store.loadCompanies(true);
      },
      error: (err) => this.fail('Delete failed', err),
    });
  }

  // ── SMS entitlement ────────────────────────────────────────────────────────
  protected smsRow = signal<CompanySubscription | null>(null);
  protected smsActivated = signal(false);
  /** '' means no end date. The <input type="date"> speaks YYYY-MM-DD, as does the API. */
  protected smsExpiration = signal('');
  protected smsError = signal<string | null>(null);

  protected openSms(r: CompanySubscription): void {
    this.smsError.set(null);
    this.smsActivated.set(r.sms_activated);
    this.smsExpiration.set(r.sms_expiration ?? '');
    this.smsRow.set(r);
  }

  protected closeSms(): void {
    if (this.busyId()) return;
    this.smsRow.set(null);
  }

  protected confirmSms(r: CompanySubscription): void {
    this.smsError.set(null);
    this.busyId.set(r.company_id);
    // Always sends `expiration`, including as null: this dialog shows the date,
    // so whatever is in the box is what the operator means — including having
    // cleared it.
    this.service.setSmsAccess(r.company_id, this.smsActivated(), this.smsExpiration() || null).subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.smsRow.set(null);
        this.store.showFlash(
          res.sms_active
            ? `SMS on for ${r.company_name}${res.sms_expiration ? ` until ${this.formatDate(res.sms_expiration)}` : ''}.`
            : `SMS off for ${r.company_name}.`,
        );
        this.store.loadCompanies(true);
      },
      error: (err) => {
        this.busyId.set(null);
        this.smsError.set(err?.error?.message || 'Could not save the SMS settings.');
      },
    });
  }

  // ── Park a tenant ──────────────────────────────────────────────────────────
  protected openDeactivate(r: CompanySubscription): void { this.deactivateRow.set(r); }

  protected confirmDeactivate(r: CompanySubscription): void {
    this.busyId.set(r.company_id);
    this.service.deactivate(r.company_id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.deactivateRow.set(null);
        this.store.showFlash(`${r.company_name} deactivated.`);
        this.store.loadCompanies(true);
      },
      error: (err) => this.fail('Deactivate', err),
    });
  }

  // ── Pre-printed QR cards, per client ───────────────────────────────────────
  // The pool is sold per academy: off until we switch it on. Stats are fetched
  // per row rather than in the big companies query, so the table stays cheap.
  protected qrStats = signal<Record<string, { qr_cards_enabled: boolean; total: number; linked: number }>>({});
  protected qrRow = signal<CompanySubscription | null>(null);
  qrCount = 100;
  protected readonly poolTypes = POOL_TYPES;
  protected qrPoolType = signal<PoolType>(1);
  // Two-step, and reset every time the dialog opens: this one is not undoable.
  protected qrDeleteArmed = signal(false);
  protected qrDeleteLinked = signal(false);

  /**
   * Narrow the <select>'s value to a real PoolType.
   *
   * The select hands back a STRING, and PoolType is 1 | 2 | 3, so the obvious inline
   * `qrPoolType.set(+$event)` does not compile — it widens to number. Validating here
   * against POOL_TYPES rather than casting means an unexpected value falls back to 1
   * (what every card printed before types existed reads as) instead of stamping the
   * run with something the API will reject.
   */
  protected setPoolType(value: unknown): void {
    const n = Number(value);
    const match = POOL_TYPES.find((t) => t === n);
    this.qrPoolType.set(match ?? 1);
  }

  protected loadQrStats(companyId: string): void {
    this.busyId.set(companyId);
    this.service.qrCardStats(companyId).subscribe({
      next: (stats) => {
        this.busyId.set(null);
        this.qrStats.update((m) => ({ ...m, [companyId]: stats }));
      },
      error: (err) => this.fail('QR cards', err),
    });
  }

  protected toggleQrCards(r: CompanySubscription): void {
    const current = this.qrStats()[r.company_id];
    const next = !(current?.qr_cards_enabled);
    this.busyId.set(r.company_id);
    this.service.setQrCardsEnabled(r.company_id, next).subscribe({
      next: () => {
        this.busyId.set(null);
        this.store.showFlash(`QR cards ${next ? 'enabled' : 'disabled'} for ${r.company_name}.`);
        this.loadQrStats(r.company_id);
      },
      error: (err) => this.fail('QR cards', err),
    });
  }

  protected openQrCards(r: CompanySubscription): void {
    this.qrCount = 100;
    this.qrPoolType.set(1);
    // Never inherit an armed delete from the last company looked at.
    this.qrDeleteArmed.set(false);
    this.qrDeleteLinked.set(false);
    this.qrRow.set(r);
  }

  protected confirmDeleteQrCards(): void {
    const r = this.qrRow();
    if (!r) return;
    const includeLinked = this.qrDeleteLinked();
    this.busyId.set(r.company_id);
    this.service.deleteQrCards(r.company_id, includeLinked).subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.qrDeleteArmed.set(false);
        this.qrDeleteLinked.set(false);
        const unlinked = res.unlinkedStudents
          ? `, ${res.unlinkedStudents} student ${res.unlinkedStudents === 1 ? 'card' : 'cards'} unlinked`
          : '';
        const kept = res.keptLinked ? `, ${res.keptLinked} linked kept` : '';
        this.store.showFlash(`${res.deleted} cards deleted for ${r.company_name}${unlinked}${kept}.`);
        this.loadQrStats(r.company_id);
      },
      error: (err) => this.fail('Delete cards', err),
    });
  }

  protected confirmQrCards(): void {
    const r = this.qrRow();
    if (!r) return;
    const count = Math.floor(Number(this.qrCount));
    if (!Number.isFinite(count) || count < 1 || count > 2000) {
      this.error.set('Count must be between 1 and 2000.');
      return;
    }
    this.busyId.set(r.company_id);
    this.service.generateQrCards(r.company_id, count, this.qrPoolType()).subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.qrRow.set(null);
        // Serials continue from their last run, so say which ones these are.
        // Cards print as "A5", not "A-100005": the serial is stored in the
        // reserved range, but the base is dropped for the printed label.
        const label = (serial: number) => `A${serial - 100000}`;
        this.store.showFlash(`${res.created} type ${res.poolType} cards for ${r.company_name} (${label(res.from)} … ${label(res.to)}).`);
        this.loadQrStats(r.company_id);
      },
      error: (err) => this.fail('Generate failed', err),
    });
  }
}
