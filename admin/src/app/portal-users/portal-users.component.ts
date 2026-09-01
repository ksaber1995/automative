import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PortalUsersService } from './portal-users.service';
import { PortalAuthService, PortalUser } from '../auth/portal-auth.service';
import { AdminStore } from '../admin-store.service';
import { DEBUG_USER_ROLES } from '../subscriptions.service';

/** What each permission key lets someone do — the caption beside its checkbox. */
const PERMISSION_LABELS: Record<string, string> = {
  'companies.read': 'See the tenant list and their subscription numbers',
  'companies.read_trial': 'See TRIAL tenants only — hides active and expired tenants everywhere, even with other read grants',
  'companies.write': 'Activate, deactivate, extend and re-type a tenant',
  'companies.delete': 'Permanently delete a tenant and all of its data',
  'cards.read': 'See card pools and card lists',
  'cards.write': 'Enable pools, mint runs, mark printed, set the shipping address',
  'tenant_users.read': 'See the user accounts inside tenants',
  'tenant_users.write': 'Create, delete and move accounts inside tenants',
  'bots.read': 'See the Telegram bot pool',
  'bots.write': 'Add bots to the Telegram pool',
  'portal_users.read': 'See who can sign in to this console',
  'portal_users.write': 'Add, edit and remove console sign-ins',
};

/** The draft behind the create/edit dialog. */
interface Draft {
  id: string | null;
  email: string;
  name: string;
  password: string;
  role: 'OWNER' | 'MEMBER';
  permissions: Set<string>;
  isActive: boolean;
  /**
   * "Also create their own debug user" — a login inside a tenant, owned by
   * this portal user, that they can move between tenants from the Users page.
   * Create only; an existing portal user gets one from the Users page instead.
   */
  withDebug: boolean;
  debugCompanyId: string;
  debugEmail: string;
  debugPassword: string;
  debugRole: string;
}

/**
 * Manage who can sign in to this console, and what each of them may do.
 *
 * Deliberately not the same screen as Users: that one creates accounts inside a
 * customer's tenant, this one hands out keys to the console that can delete
 * those customers. Sharing a page would make the two a slip apart.
 */
@Component({
  selector: 'app-portal-users',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <header>
      <div>
        <h1>Portal users</h1>
        <p class="sub">Who can sign in to this console · {{ users().length }} account{{ users().length === 1 ? '' : 's' }}</p>
      </div>
      <div class="head-acts">
        @if (canWrite()) {
          <button class="act activate" (click)="openCreate()">+ New portal user</button>
        }
        <button class="refresh" (click)="load()" [disabled]="loading()">
          {{ loading() ? 'Loading…' : 'Refresh' }}
        </button>
      </div>
    </header>

    @if (error(); as e) { <div class="error">{{ e }}</div> }

    <div class="card">
      @if (loading()) {
        <div class="state">Loading…</div>
      } @else if (!users().length) {
        <div class="state">No portal users.</div>
      } @else {
        <table>
          <thead>
            <tr>
              <th>Email</th><th>Name</th><th>Role</th><th>Permissions</th>
              <th>Status</th><th>Last sign-in</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            @for (u of users(); track u.id) {
              <tr>
                <td class="name">
                  {{ u.email }}
                  @if (u.id === me()?.id) { <span class="you">you</span> }
                </td>
                <td>{{ u.name || '—' }}</td>
                <td>
                  <span class="reg" [class.owner]="u.role === 'OWNER'">{{ u.role }}</span>
                </td>
                <td class="perms">
                  @if (u.role === 'OWNER') {
                    <span class="sub">Everything</span>
                  } @else if (!u.permissions.length) {
                    <span class="sub">None — can sign in, sees nothing</span>
                  } @else {
                    <div class="chips">
                      @for (p of u.permissions; track p) { <span class="chip">{{ p }}</span> }
                    </div>
                  }
                </td>
                <td>
                  <span class="reg" [class.ok]="u.is_active" [class.no]="!u.is_active">
                    {{ u.is_active ? 'active' : 'disabled' }}
                  </span>
                </td>
                <td>{{ formatDate(u.last_login_at) }}</td>
                <td>
                  @if (canWrite()) {
                    <div class="actions">
                      <button class="act" [disabled]="busyId() === u.id" (click)="openEdit(u)">Edit</button>
                      <button class="act danger" [disabled]="busyId() === u.id || u.id === me()?.id"
                        [title]="u.id === me()?.id ? 'You cannot delete your own account' : 'Delete this sign-in'"
                        (click)="confirmDelete(u)">Delete</button>
                    </div>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </div>

    @if (draft(); as d) {
      <div class="overlay" (click)="close()">
        <div class="modal wide" (click)="$event.stopPropagation()">
          <h2>{{ d.id ? 'Edit portal user' : 'New portal user' }}</h2>

          @if (d.id) {
            <p class="modal-sub"><strong>{{ d.email }}</strong></p>
          } @else {
            <label class="lbl">Email</label>
            <input class="search" type="email" spellcheck="false"
              [ngModel]="d.email" (ngModelChange)="patch({ email: $event })" placeholder="name@example.com" />
          }

          <label class="lbl">Name</label>
          <input class="search" type="text"
            [ngModel]="d.name" (ngModelChange)="patch({ name: $event })" placeholder="Optional" />

          <label class="lbl">{{ d.id ? 'New password' : 'Password' }}</label>
          <input class="search" type="text" autocomplete="new-password"
            [ngModel]="d.password" (ngModelChange)="patch({ password: $event })"
            [placeholder]="d.id ? 'Leave blank to keep the current one' : 'At least 8 characters'" />

          <label class="lbl">Role</label>
          <select class="search" [ngModel]="d.role" (ngModelChange)="patch({ role: $event })"
            [disabled]="!iAmOwner()">
            <option value="MEMBER">Member — exactly the permissions ticked below</option>
            <option value="OWNER">Owner — everything, including future sections</option>
          </select>
          @if (!iAmOwner()) {
            <p class="modal-sub">Only an owner can grant or remove owner.</p>
          }

          @if (d.role === 'MEMBER') {
            <label class="lbl">Permissions</label>
            <div class="perm-list">
              @for (p of allPermissions(); track p) {
                <label class="perm">
                  <input type="checkbox" [checked]="d.permissions.has(p)" (change)="toggle(p)" />
                  <span>
                    <code>{{ p }}</code>
                    <em>{{ labelFor(p) }}</em>
                  </span>
                </label>
              }
            </div>
          } @else {
            <p class="modal-sub">An owner holds every permission — there is nothing to tick.</p>
          }

          @if (!d.id && canCreateDebug()) {
            <label class="perm standalone">
              <input type="checkbox" [checked]="d.withDebug" (change)="patch({ withDebug: !d.withDebug })" />
              <span>
                <em><strong>Also create their own debug user</strong> — a login inside a tenant, owned by
                this person. Hidden from the tenant's user list; they move it between tenants from
                the Users page.</em>
              </span>
            </label>
            @if (d.withDebug) {
              <div class="debug-box">
                <label class="lbl">Debug user tenant</label>
                <select class="search" [ngModel]="d.debugCompanyId" (ngModelChange)="patch({ debugCompanyId: $event })">
                  <option value="">Choose a tenant to park it in…</option>
                  @for (c of companies(); track c.company_id) {
                    <option [value]="c.company_id">{{ c.company_name }}</option>
                  }
                </select>
                <label class="lbl">Debug user email</label>
                <input class="search" type="email" spellcheck="false"
                  [ngModel]="d.debugEmail" (ngModelChange)="patch({ debugEmail: $event })"
                  placeholder="e.g. debug.name@master.com" />
                <label class="lbl">Debug user password</label>
                <input class="search" type="text" autocomplete="new-password"
                  [ngModel]="d.debugPassword" (ngModelChange)="patch({ debugPassword: $event })"
                  placeholder="At least 6 characters" />
                <label class="lbl">Debug user role (its permissions inside the tenant)</label>
                <select class="search" [ngModel]="d.debugRole" (ngModelChange)="patch({ debugRole: $event })">
                  @for (r of debugRoles; track r) {
                    <option [value]="r">{{ r }}</option>
                  }
                </select>
              </div>
            }
          }

          @if (d.id && d.id !== me()?.id) {
            <label class="perm standalone">
              <input type="checkbox" [checked]="d.isActive" (change)="patch({ isActive: !d.isActive })" />
              <span><em>Account is active (untick to block sign-in without deleting it)</em></span>
            </label>
          }

          @if (formError(); as e) { <div class="error">{{ e }}</div> }

          <div class="modal-foot">
            <button class="act" [disabled]="saving()" (click)="close()">Cancel</button>
            <button class="act activate" [disabled]="saving()" (click)="save()">
              {{ saving() ? 'Saving…' : (d.id ? 'Save changes' : 'Create user') }}
            </button>
          </div>
        </div>
      </div>
    }

    @if (deleting(); as u) {
      <div class="overlay" (click)="deleting.set(null)">
        <div class="modal" (click)="$event.stopPropagation()">
          <h2 class="danger-title">Remove access</h2>
          <p class="modal-sub">
            <strong>{{ u.email }}</strong> will no longer be able to sign in to this console.
            Nothing else is affected — this is not a tenant account.
          </p>
          <div class="modal-foot">
            <button class="act" [disabled]="busyId() === u.id" (click)="deleting.set(null)">Cancel</button>
            <button class="act danger" [disabled]="busyId() === u.id" (click)="doDelete(u)">
              {{ busyId() === u.id ? 'Removing…' : 'Remove' }}
            </button>
          </div>
        </div>
      </div>
    }

    @if (flash(); as f) { <div class="flash">{{ f }}</div> }
  `,
  styles: [`
    header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    h1 { margin: 0; font-size: 24px; }
    .sub { margin: 4px 0 0; color: #64748b; font-size: 14px; }
    .head-acts { display: flex; gap: 8px; align-items: center; }
    .refresh {
      border: 1px solid #cbd5e1; background: #fff; color: #0f172a; border-radius: 8px;
      padding: 8px 16px; font-size: 14px; cursor: pointer;
    }
    .refresh:disabled { opacity: .6; cursor: default; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; margin-top: 20px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    thead th {
      text-align: left; background: #f8fafc; color: #475569; font-weight: 600;
      padding: 12px 14px; border-bottom: 1px solid #e2e8f0; white-space: nowrap;
    }
    tbody td { padding: 12px 14px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
    tbody tr:last-child td { border-bottom: none; }
    .name { font-weight: 600; white-space: nowrap; }
    .you {
      background: #eef2ff; color: #4f46e5; border-radius: 999px; padding: 1px 7px;
      font-size: 11px; font-weight: 700; margin-left: 6px;
    }
    .reg {
      display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px;
      font-weight: 600; background: #e2e8f0; color: #475569; white-space: nowrap;
    }
    .reg.owner { background: #ede9fe; color: #6d28d9; }
    .reg.ok { background: #dcfce7; color: #166534; }
    .reg.no { background: #fee2e2; color: #b91c1c; }
    .perms { max-width: 420px; }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .chip {
      background: #f1f5f9; color: #334155; border-radius: 5px; padding: 1px 6px;
      font-size: 11px; font-family: ui-monospace, monospace;
    }
    .state { padding: 40px; text-align: center; color: #94a3b8; }
    .actions { display: flex; gap: 6px; }
    .act {
      border: 1px solid #cbd5e1; background: #fff; color: #0f172a; border-radius: 6px;
      padding: 5px 10px; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap;
    }
    .act:hover:not(:disabled) { background: #f1f5f9; }
    .act:disabled { opacity: .5; cursor: default; }
    .act.activate { border-color: #86efac; color: #166534; }
    .act.danger { border-color: #fca5a5; color: #b91c1c; }
    .overlay {
      position: fixed; inset: 0; background: rgba(15, 23, 42, .45);
      display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 50;
      overflow-y: auto;
    }
    .modal {
      background: #fff; border-radius: 12px; padding: 24px; width: 100%; max-width: 440px;
      box-shadow: 0 20px 40px rgba(0,0,0,.2);
    }
    .modal.wide { max-width: 620px; max-height: 90vh; overflow-y: auto; }
    .modal h2 { margin: 0 0 8px; font-size: 18px; }
    .modal h2.danger-title { color: #b91c1c; }
    .modal-sub { margin: 0 0 12px; color: #475569; font-size: 14px; line-height: 1.5; }
    .lbl { display: block; font-size: 12px; font-weight: 700; color: #334155; margin: 14px 0 5px; }
    .search {
      width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 8px;
      padding: 9px 12px; font-size: 14px; font-family: inherit;
    }
    .search:focus { outline: 2px solid #c7d2fe; border-color: #4f46e5; }
    .search:disabled { background: #f8fafc; color: #94a3b8; }
    .perm-list {
      display: grid; gap: 2px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px;
      max-height: 280px; overflow-y: auto;
    }
    .perm { display: flex; gap: 9px; align-items: flex-start; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
    .perm:hover { background: #f8fafc; }
    .perm.standalone { margin-top: 16px; border: 1px solid #e2e8f0; }
    .debug-box {
      border: 1px dashed #cbd5e1; border-radius: 8px; padding: 4px 12px 12px;
      margin-top: 8px; background: #f8fafc;
    }
    .perm input { margin-top: 3px; }
    .perm code { display: block; font-size: 12px; font-weight: 700; color: #0f172a; }
    .perm em { display: block; font-style: normal; font-size: 12px; color: #64748b; }
    .modal-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
    .error {
      background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c;
      padding: 10px 14px; border-radius: 8px; margin-top: 14px; font-size: 13px; white-space: pre-wrap;
    }
    .flash {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      background: #0f172a; color: #fff; padding: 10px 18px; border-radius: 8px;
      font-size: 14px; box-shadow: 0 8px 20px rgba(0,0,0,.25); z-index: 60;
    }
  `],
})
export class PortalUsersComponent {
  private service = inject(PortalUsersService);
  private auth = inject(PortalAuthService);
  private store = inject(AdminStore);

  protected readonly debugRoles = DEBUG_USER_ROLES;
  /** The tenant picker for the optional debug user. */
  protected companies = this.store.companies;

  protected users = signal<PortalUser[]>([]);
  protected allPermissions = signal<string[]>([]);
  protected loading = signal(true);
  protected error = signal<string | null>(null);
  protected busyId = signal<string | null>(null);
  protected flash = signal<string | null>(null);
  private flashTimer?: ReturnType<typeof setTimeout>;

  protected draft = signal<Draft | null>(null);
  protected saving = signal(false);
  protected formError = signal<string | null>(null);
  protected deleting = signal<PortalUser | null>(null);

  protected me = computed(() => this.auth.user());
  protected iAmOwner = computed(() => this.auth.user()?.role === 'OWNER');
  protected canWrite = computed(() => this.auth.can('portal_users.write'));
  /**
   * Creating a debug user is a tenant_users.write act (the API insists), and
   * the tenant picker rides on the company list — no grant, no section.
   */
  protected canCreateDebug = computed(() =>
    this.auth.can('tenant_users.write') && this.auth.can(['companies.read', 'companies.read_trial']));

  constructor() {
    this.load();
    if (this.canCreateDebug()) this.store.loadCompanies();
  }

  protected labelFor(key: string): string {
    return PERMISSION_LABELS[key] ?? '';
  }

  protected formatDate(d: string | null): string {
    if (!d) return 'never';
    const date = new Date(d);
    if (isNaN(date.getTime())) return d;
    return date.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.list().subscribe({
      next: (res) => {
        this.users.set(res.users);
        // Prefer the server's list — it is the one the API actually enforces.
        this.allPermissions.set(res.allPermissions.length ? res.allPermissions : this.auth.allPermissions());
        this.loading.set(false);
      },
      error: (err: any) => {
        this.loading.set(false);
        this.error.set(err?.error?.message || 'Could not load portal users.');
      },
    });
  }

  private showFlash(msg: string): void {
    this.flash.set(msg);
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.flash.set(null), 3500);
  }

  // ── The dialog ─────────────────────────────────────────────────────────────

  protected openCreate(): void {
    this.formError.set(null);
    this.draft.set({
      id: null, email: '', name: '', password: '',
      role: 'MEMBER', permissions: new Set<string>(), isActive: true,
      withDebug: false, debugCompanyId: '', debugEmail: '', debugPassword: '',
      debugRole: 'GLOBAL_ADMIN',
    });
  }

  protected openEdit(u: PortalUser): void {
    this.formError.set(null);
    this.draft.set({
      id: u.id, email: u.email, name: u.name ?? '', password: '',
      role: u.role === 'OWNER' ? 'OWNER' : 'MEMBER',
      permissions: new Set(u.permissions), isActive: u.is_active,
      withDebug: false, debugCompanyId: '', debugEmail: '', debugPassword: '',
      debugRole: 'GLOBAL_ADMIN',
    });
  }

  protected close(): void {
    if (this.saving()) return;
    this.draft.set(null);
  }

  /** Signals hold the draft, so every edit replaces the object. */
  protected patch(change: Partial<Draft>): void {
    this.draft.update((d) => (d ? { ...d, ...change } : d));
  }

  protected toggle(permission: string): void {
    this.draft.update((d) => {
      if (!d) return d;
      const next = new Set(d.permissions);
      next.has(permission) ? next.delete(permission) : next.add(permission);
      return { ...d, permissions: next };
    });
  }

  protected save(): void {
    const d = this.draft();
    if (!d || this.saving()) return;
    this.formError.set(null);

    const permissions = d.role === 'OWNER' ? [] : [...d.permissions];

    if (!d.id) {
      const email = d.email.trim();
      if (!email.includes('@')) { this.formError.set('A valid email is required.'); return; }
      if (d.password.length < 8) { this.formError.set('The password must be at least 8 characters.'); return; }

      const withDebug = d.withDebug && this.canCreateDebug();
      if (withDebug) {
        if (!d.debugCompanyId) { this.formError.set('Choose a tenant to park the debug user in.'); return; }
        if (!d.debugEmail.trim().includes('@')) { this.formError.set('The debug user needs a valid email.'); return; }
        if (d.debugPassword.length < 6) { this.formError.set('The debug user password must be at least 6 characters.'); return; }
      }

      this.saving.set(true);
      this.service.create({
        email, password: d.password, name: d.name.trim() || null, role: d.role, permissions,
        ...(withDebug
          ? {
              debugUser: {
                companyId: d.debugCompanyId,
                email: d.debugEmail.trim(),
                password: d.debugPassword,
                // The person's name lands on the row so the Users page reads
                // "Debug <name>" rather than a wall of identical rows.
                lastName: d.name.trim() || undefined,
                role: d.debugRole,
              },
            }
          : {}),
      }).subscribe({
        next: (u) => {
          this.saving.set(false);
          this.draft.set(null);
          this.showFlash(u.debug_user
            ? `${u.email} can now sign in — debug user ${u.debug_user.email} created.`
            : `${u.email} can now sign in.`);
          this.load();
        },
        error: (err: any) => {
          this.saving.set(false);
          this.formError.set(err?.error?.message || 'Could not create the user.');
        },
      });
      return;
    }

    if (d.password && d.password.length < 8) {
      this.formError.set('The password must be at least 8 characters.');
      return;
    }
    this.saving.set(true);
    this.service.update(d.id, {
      name: d.name.trim() || null,
      role: d.role,
      permissions,
      isActive: d.isActive,
      // Blank means "leave the current password alone", which is why it is only
      // sent when something was typed.
      ...(d.password ? { password: d.password } : {}),
    }).subscribe({
      next: (u) => {
        this.saving.set(false);
        this.draft.set(null);
        this.showFlash(`${u.email} updated.`);
        this.load();
        // Editing yourself changes what you may do — re-read the session so the
        // sidebar matches immediately.
        if (u.id === this.auth.user()?.id) this.auth.restore();
      },
      error: (err: any) => {
        this.saving.set(false);
        this.formError.set(err?.error?.message || 'Could not save the changes.');
      },
    });
  }

  // ── Removal ────────────────────────────────────────────────────────────────

  protected confirmDelete(u: PortalUser): void {
    this.deleting.set(u);
  }

  protected doDelete(u: PortalUser): void {
    this.busyId.set(u.id);
    this.service.remove(u.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.deleting.set(null);
        this.showFlash(`${u.email} can no longer sign in.`);
        this.load();
      },
      error: (err: any) => {
        this.busyId.set(null);
        this.deleting.set(null);
        this.error.set(err?.error?.message || 'Could not remove the user.');
      },
    });
  }
}
