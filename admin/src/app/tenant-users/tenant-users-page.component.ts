import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgSelectModule } from '@ng-select/ng-select';
import {
  DEBUG_USER_ROLES, SubscriptionsService, TenantUser, USER_ROLES,
} from '../subscriptions.service';
import { PortalAuthService, PortalUser } from '../auth/portal-auth.service';
import { PortalUsersService } from '../portal-users/portal-users.service';
import { AdminStore } from '../admin-store.service';
import { syncQueryParams } from '../shared/query-sync';

/**
 * The vendor's debug logins — the reason the move-between-tenants feature
 * exists. The API lists ONLY debug users here now (users.is_debug): an OWNER
 * sees all of them, a MEMBER their own plus the shared ones. Customers' real
 * accounts are no longer browsed from this console, and every debug login is
 * hidden from the customer's own /users page by the API.
 */
@Component({
  selector: 'app-tenant-users-page',
  standalone: true,
  imports: [CommonModule, FormsModule, NgSelectModule],
  styleUrls: ['../shared/admin-ui.css'],
  template: `
    <header>
      <div>
        <h1>Debug users</h1>
        <p class="sub">The vendor's debug logins · one per portal user · move them between tenants</p>
      </div>
      <button class="refresh" (click)="refresh()" [disabled]="usersLoading()">
        {{ usersLoading() ? 'Loading…' : 'Refresh' }}
      </button>
    </header>

    @if (error(); as e) { <div class="error" style="margin-top:16px">{{ e }}</div> }

    <div class="card" style="margin: 20px 0; padding: 16px;">
      <div class="lic-toolbar">
        <input class="search" type="text"
          [ngModel]="userSearch()" (ngModelChange)="userSearch.set($event)"
          placeholder="Search name, email or role…" />
        <!-- Filter per tenant -->
        <select class="search" style="max-width:260px;"
          [ngModel]="userCompany()" (ngModelChange)="userCompany.set($event)">
          <option value="">All tenants ({{ users().length }})</option>
          @for (c of companies(); track c.company_id) {
            <option [value]="c.company_id">{{ c.company_name }}</option>
          }
        </select>
        @if (auth.can('tenant_users.write')) {
          <button class="act activate" (click)="openCreateUser()">+ New debug user</button>
        }
        <span class="count">{{ visibleUsers().length }} / {{ users().length }}</span>
      </div>

      @if (usersLoading()) {
        <div class="state">Loading…</div>
      } @else if (visibleUsers().length === 0) {
        <div class="state">No debug users match.</div>
      } @else {
        <div style="margin-top:12px; overflow-x:auto;">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Owner</th>
                <th>Tenant</th>
                <th>Role</th>
                <th>Debug</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (u of visibleUsers(); track u.id) {
                <tr>
                  <td>{{ u.first_name }} {{ u.last_name }}</td>
                  <td>{{ u.email }}</td>
                  <td>
                    @if (u.debug_owner_id) {
                      <span class="reg" [class.academy]="isMine(u)">
                        {{ isMine(u) ? 'you' : (u.debug_owner_email || 'a portal user') }}
                      </span>
                    } @else {
                      <span class="reg">shared</span>
                    }
                  </td>
                  <td>{{ u.company_name || '—' }}</td>
                  <td><span class="reg">{{ u.role }}</span></td>
                  <td>
                    <span class="reg" [class.academy]="u.is_debug" [class.teacher]="!u.is_debug">
                      {{ u.is_debug ? 'true' : 'false' }}
                    </span>
                  </td>
                  <td>
                    <span class="reg" [class.academy]="u.is_active" [class.teacher]="!u.is_active">
                      {{ u.is_active ? 'active' : 'inactive' }}
                    </span>
                  </td>
                  <td>{{ formatDate(u.created_at) }}</td>
                  <td>
                    @if (auth.can('tenant_users.write')) {
                      <button class="act" [disabled]="busyId() === u.id" (click)="openMoveUser(u)">
                        Move
                      </button>
                      @if (canDelete(u)) {
                        <button class="act danger" [disabled]="busyId() === u.id" (click)="deleting.set(u)">
                          Delete
                        </button>
                      }
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>

    <!-- Create a debug user (or, unticked, a plain account) inside a tenant -->
    @if (createUserOpen()) {
      <div class="overlay" (click)="createUserOpen.set(false)">
        <div class="modal" (click)="$event.stopPropagation()">
          <h2>{{ newUser.isDebug ? 'New debug user' : 'New user' }}</h2>
          <p class="modal-sub">
            The account is created verified and active, so it can log in straight away.
            A debug user is hidden from the tenant's own user list and can be moved between tenants.
          </p>
          <select class="search" [ngModel]="newUser.companyId" (ngModelChange)="newUser.companyId = $event">
            <option value="">Choose a tenant…</option>
            @for (c of companies(); track c.company_id) {
              <option [value]="c.company_id">{{ c.company_name }}</option>
            }
          </select>
          <input class="search" type="text" [(ngModel)]="newUser.firstName" placeholder="First name" />
          <input class="search" type="text" [(ngModel)]="newUser.lastName" placeholder="Last name" />
          <input class="search" type="email" [(ngModel)]="newUser.email" placeholder="Email" />
          <input class="search" type="text" [(ngModel)]="newUser.password" placeholder="Password (min 6 chars)" />
          <select class="search" [ngModel]="newUser.role" (ngModelChange)="newUser.role = $event">
            @for (r of (newUser.isDebug ? debugRoles : roles); track r) {
              <option [value]="r">{{ r }}</option>
            }
          </select>

          <label class="chk">
            <input type="checkbox" [(ngModel)]="newUser.isDebug" />
            Debug user — hidden from the tenant, movable between tenants
          </label>

          @if (newUser.isDebug && iAmOwner() && portalUsers().length) {
            <!-- Whose debug login this is. Only an owner chooses; a member's
                 creations are owned by them regardless of what is sent. -->
            <select class="search" [ngModel]="newUser.debugOwnerId" (ngModelChange)="newUser.debugOwnerId = $event">
              <option value="">Shared — every portal user sees it</option>
              @for (p of portalUsers(); track p.id) {
                <option [value]="p.id">{{ p.email }}{{ p.id === myId() ? ' (you)' : '' }}</option>
              }
            </select>
          }

          <div class="modal-foot">
            <button class="act" [disabled]="creatingUser()" (click)="createUserOpen.set(false)">Cancel</button>
            <button class="act activate" [disabled]="creatingUser()" (click)="confirmCreateUser()">
              {{ creatingUser() ? 'Creating…' : (newUser.isDebug ? 'Create debug user' : 'Create user') }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Move a debug user to another tenant -->
    @if (moveUserRow(); as u) {
      <div class="overlay" (click)="moveUserRow.set(null)">
        <div class="modal" (click)="$event.stopPropagation()">
          <h2>Move user</h2>
          <p class="modal-sub">
            <strong>{{ u.first_name }} {{ u.last_name }}</strong> ({{ u.email }}) is in
            <strong>{{ u.company_name || 'no tenant' }}</strong>. Their branch, linked employee
            and permissions are dropped — they belong to the old tenant. They must log out and
            back in before they see the new one.
          </p>
          <ng-select
            class="move-select"
            [items]="moveTargets()"
            bindLabel="company_name"
            bindValue="company_id"
            [ngModel]="moveTarget()"
            (ngModelChange)="moveTarget.set($event || '')"
            placeholder="Search a tenant…"
            [clearable]="true"
          ></ng-select>
          <div class="modal-foot">
            <button class="act" [disabled]="busyId() === u.id" (click)="moveUserRow.set(null)">Cancel</button>
            <button class="act activate" [disabled]="busyId() === u.id || !moveTarget()" (click)="confirmMoveUser(u)">
              {{ busyId() === u.id ? 'Moving…' : 'Move user' }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Delete a debug user -->
    @if (deleting(); as u) {
      <div class="overlay" (click)="deleting.set(null)">
        <div class="modal" (click)="$event.stopPropagation()">
          <h2>Delete debug user</h2>
          <p class="modal-sub">
            <strong>{{ u.email }}</strong> will be deleted from
            <strong>{{ u.company_name || 'its tenant' }}</strong>. This removes the login itself —
            there is no undo.
          </p>
          <div class="modal-foot">
            <button class="act" [disabled]="busyId() === u.id" (click)="deleting.set(null)">Cancel</button>
            <button class="act danger" [disabled]="busyId() === u.id" (click)="confirmDeleteUser(u)">
              {{ busyId() === u.id ? 'Deleting…' : 'Delete' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .chk {
      display: flex; gap: 8px; align-items: center; margin: 12px 0 4px;
      font-size: 13px; color: #334155; cursor: pointer;
    }
    .act.danger { border-color: #fca5a5; color: #b91c1c; margin-left: 6px; }
  `],
})
export class TenantUsersPageComponent {
  private service = inject(SubscriptionsService);
  private portalUsersService = inject(PortalUsersService);
  private store = inject(AdminStore);
  protected auth = inject(PortalAuthService);

  protected users = this.store.users;
  protected usersLoading = this.store.usersLoading;
  protected companies = this.store.companies;
  protected error = signal<string | null>(null);

  protected readonly roles = USER_ROLES;
  protected readonly debugRoles = DEBUG_USER_ROLES;
  protected busyId = signal<string | null>(null);
  protected userSearch = signal('');
  protected userCompany = signal('');
  protected createUserOpen = signal(false);
  protected creatingUser = signal(false);
  protected deleting = signal<TenantUser | null>(null);
  /** For the owner picker; loaded only when the caller may read portal users. */
  protected portalUsers = signal<PortalUser[]>([]);
  newUser = {
    companyId: '', email: '', password: '', firstName: '', lastName: '',
    role: 'GLOBAL_ADMIN', isDebug: true, debugOwnerId: '',
  };

  protected myId = computed(() => this.auth.user()?.id ?? '');
  protected iAmOwner = computed(() => this.auth.user()?.role === 'OWNER');

  protected visibleUsers = computed(() => {
    const q = this.userSearch().trim().toLowerCase();
    const co = this.userCompany();
    return this.users().filter((u) => {
      if (co && u.company_id !== co) return false;
      if (!q) return true;
      return `${u.first_name} ${u.last_name}`.toLowerCase().includes(q)
        || u.email.toLowerCase().includes(q)
        || u.role.toLowerCase().includes(q);
    });
  });

  constructor() {
    // `?q=` and `?tenant=` — the tenant filter especially, since "show me this
    // customer's accounts" is the link worth sending to someone.
    syncQueryParams([
      { key: 'q', get: () => this.userSearch().trim() || null, set: (v) => this.userSearch.set(v ?? '') },
      { key: 'tenant', get: () => this.userCompany() || null, set: (v) => this.userCompany.set(v ?? '') },
    ]);

    this.store.loadUsers();
    // The tenant pickers need the company list even when this page is opened
    // directly by URL, so it can no longer be assumed already loaded.
    this.store.loadCompanies();
    this.error.set(this.store.usersError());

    // The owner picker in the create dialog. Quiet on failure: the picker is a
    // convenience, and the API defaults ownership sensibly without it.
    if (this.auth.can('portal_users.read')) {
      this.portalUsersService.list().subscribe({
        next: (res) => this.portalUsers.set(res.users),
        error: () => {},
      });
    }
  }

  protected refresh(): void {
    this.error.set(null);
    this.store.loadUsers(true);
  }

  protected formatDate(d: string | null): string {
    if (!d) return '—';
    const date = new Date(d);
    if (isNaN(date.getTime())) return d;
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  protected isMine(u: TenantUser): boolean {
    return !!u.debug_owner_id && u.debug_owner_id === this.myId();
  }

  /**
   * Mirrors the API's rule so the button matches what a click would do: an
   * owner may delete any debug login; a member only their own — the shared one
   * (master@master.com) is move-only for them.
   */
  protected canDelete(u: TenantUser): boolean {
    return this.iAmOwner() || this.isMine(u);
  }

  protected openCreateUser(): void {
    // Pre-select whatever tenant is being filtered on — that is almost always the
    // one being added to. A new debug login defaults to being the creator's own.
    this.newUser = {
      companyId: this.userCompany(), email: '', password: '',
      firstName: 'Debug', lastName: '', role: 'GLOBAL_ADMIN',
      isDebug: true, debugOwnerId: this.myId(),
    };
    this.createUserOpen.set(true);
  }

  protected confirmCreateUser(): void {
    const u = this.newUser;
    if (!u.companyId) { this.error.set('Choose a tenant.'); return; }
    if (!u.firstName.trim() || !u.lastName.trim()) { this.error.set('First and last name are required.'); return; }
    if (!u.email.trim()) { this.error.set('Email is required.'); return; }
    if (u.password.length < 6) { this.error.set('Password must be at least 6 characters.'); return; }
    // GLOBAL_ADMIN is offered for debug logins only — a customer's real staff
    // never gets minted at that level from here.
    if (!u.isDebug && !USER_ROLES.includes(u.role)) { this.error.set('Choose a role.'); return; }

    this.creatingUser.set(true);
    this.service.createUser({
      companyId: u.companyId,
      email: u.email.trim(),
      password: u.password,
      firstName: u.firstName.trim(),
      lastName: u.lastName.trim(),
      role: u.role,
      isDebug: u.isDebug,
      ...(u.isDebug ? { debugOwnerId: u.debugOwnerId || null } : {}),
    }).subscribe({
      next: () => {
        this.creatingUser.set(false);
        this.createUserOpen.set(false);
        this.store.showFlash(`${u.email} created.`);
        this.store.loadUsers(true);
      },
      error: (err) => {
        this.creatingUser.set(false);
        this.error.set(`Create user: ${err?.error?.message || err?.message || 'Request failed'}`);
      },
    });
  }

  // Moving an account between tenants — for a debugging login that needs to sit
  // inside a customer's data. The API refuses to move a tenant's last admin out,
  // for the same reason it refuses to delete them, and refuses to move anything
  // that is not a debug login at all.
  protected moveUserRow = signal<TenantUser | null>(null);
  protected moveTarget = signal('');

  // Eligible move targets: active tenants other than the user's current one.
  protected moveTargets = computed(() => {
    const u = this.moveUserRow();
    return this.companies().filter(
      (c) => c.company_active && (!u || c.company_id !== u.company_id),
    );
  });

  protected openMoveUser(u: TenantUser): void {
    this.moveTarget.set('');
    this.moveUserRow.set(u);
  }

  protected confirmMoveUser(u: TenantUser): void {
    const companyId = this.moveTarget();
    if (!companyId) { this.error.set('Choose a tenant.'); return; }

    this.busyId.set(u.id);
    this.service.moveUserCompany(u.id, companyId).subscribe({
      next: (moved) => {
        this.busyId.set(null);
        this.moveUserRow.set(null);
        this.store.showFlash(`${u.email} moved to ${moved.company_name || 'the new tenant'} — they must log in again.`);
        this.store.loadUsers(true);
      },
      error: (err) => {
        this.busyId.set(null);
        // e.g. "last admin" — keep the dialog open so the message is read in context.
        this.error.set(`Move user: ${err?.error?.message || err?.message || 'Request failed'}`);
      },
    });
  }

  protected confirmDeleteUser(u: TenantUser): void {
    this.busyId.set(u.id);
    this.service.deleteUser(u.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.deleting.set(null);
        this.store.showFlash(`${u.email} deleted.`);
        this.store.loadUsers(true);
      },
      error: (err) => {
        this.busyId.set(null);
        this.deleting.set(null);
        this.error.set(`Delete user: ${err?.error?.message || err?.message || 'Request failed'}`);
      },
    });
  }
}
