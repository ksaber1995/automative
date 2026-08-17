import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgSelectModule } from '@ng-select/ng-select';
import { SubscriptionsService, TenantUser, USER_ROLES } from '../subscriptions.service';
import { PortalAuthService } from '../auth/portal-auth.service';
import { AdminStore } from '../admin-store.service';

/**
 * The vendor's debugging login. It is the reason the move-between-tenants
 * feature exists, and the only account offered a Move button. Hidden from the
 * customer's own /users page by the API (see HIDDEN_DEBUG_EMAIL).
 */
const DEBUG_EMAIL = 'master@master.com';

/**
 * Accounts INSIDE customer tenants — not the console's own sign-ins, which live
 * under Portal users. The API refuses to delete or move a tenant's last admin,
 * which would lock the customer out of their own app.
 */
@Component({
  selector: 'app-tenant-users-page',
  standalone: true,
  imports: [CommonModule, FormsModule, NgSelectModule],
  styleUrls: ['../shared/admin-ui.css'],
  template: `
    <header>
      <div>
        <h1>Users</h1>
        <p class="sub">Every account in every tenant · create and remove them here</p>
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
          <button class="act activate" (click)="openCreateUser()">+ New user</button>
        }
        <span class="count">{{ visibleUsers().length }} / {{ users().length }}</span>
      </div>

      @if (usersLoading()) {
        <div class="state">Loading…</div>
      } @else if (visibleUsers().length === 0) {
        <div class="state">No users match.</div>
      } @else {
        <div style="margin-top:12px; overflow-x:auto;">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Tenant</th>
                <th>Role</th>
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
                  <td>{{ u.company_name || '—' }}</td>
                  <td><span class="reg">{{ u.role }}</span></td>
                  <td>
                    <span class="reg" [class.academy]="u.is_active" [class.teacher]="!u.is_active">
                      {{ u.is_active ? 'active' : 'inactive' }}
                    </span>
                  </td>
                  <td>{{ formatDate(u.created_at) }}</td>
                  <td>
                    @if (isDebugUser(u) && auth.can('tenant_users.write')) {
                      <button class="act" [disabled]="busyId() === u.id" (click)="openMoveUser(u)">
                        Move
                      </button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>

    <!-- Create a user inside a tenant -->
    @if (createUserOpen()) {
      <div class="overlay" (click)="createUserOpen.set(false)">
        <div class="modal" (click)="$event.stopPropagation()">
          <h2>New user</h2>
          <p class="modal-sub">The account is created verified and active, so they can log in straight away.</p>
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
            @for (r of roles; track r) {
              <option [value]="r">{{ r }}</option>
            }
          </select>
          <div class="modal-foot">
            <button class="act" [disabled]="creatingUser()" (click)="createUserOpen.set(false)">Cancel</button>
            <button class="act activate" [disabled]="creatingUser()" (click)="confirmCreateUser()">
              {{ creatingUser() ? 'Creating…' : 'Create user' }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Move a user to another tenant -->
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
  `,
})
export class TenantUsersPageComponent {
  private service = inject(SubscriptionsService);
  private store = inject(AdminStore);
  protected auth = inject(PortalAuthService);

  protected users = this.store.users;
  protected usersLoading = this.store.usersLoading;
  protected companies = this.store.companies;
  protected error = signal<string | null>(null);

  protected readonly roles = USER_ROLES;
  protected busyId = signal<string | null>(null);
  protected userSearch = signal('');
  protected userCompany = signal('');
  protected createUserOpen = signal(false);
  protected creatingUser = signal(false);
  newUser = { companyId: '', email: '', password: '', firstName: '', lastName: '', role: 'ADMIN' };

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
    this.store.loadUsers();
    // The tenant pickers need the company list even when this page is opened
    // directly by URL, so it can no longer be assumed already loaded.
    this.store.loadCompanies();
    this.error.set(this.store.usersError());
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

  protected isDebugUser(u: TenantUser): boolean {
    return u.email.trim().toLowerCase() === DEBUG_EMAIL;
  }

  protected openCreateUser(): void {
    // Pre-select whatever tenant is being filtered on — that is almost always the
    // one being added to.
    this.newUser = {
      companyId: this.userCompany(), email: '', password: '',
      firstName: '', lastName: '', role: 'ADMIN',
    };
    this.createUserOpen.set(true);
  }

  protected confirmCreateUser(): void {
    const u = this.newUser;
    if (!u.companyId) { this.error.set('Choose a tenant.'); return; }
    if (!u.firstName.trim() || !u.lastName.trim()) { this.error.set('First and last name are required.'); return; }
    if (!u.email.trim()) { this.error.set('Email is required.'); return; }
    if (u.password.length < 6) { this.error.set('Password must be at least 6 characters.'); return; }

    this.creatingUser.set(true);
    this.service.createUser({
      companyId: u.companyId,
      email: u.email.trim(),
      password: u.password,
      firstName: u.firstName.trim(),
      lastName: u.lastName.trim(),
      role: u.role,
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
  // for the same reason it refuses to delete them.
  //
  // Offered for the debug login only. Moving a real customer's account is not a
  // thing anyone here means to do: it strips their branch, linked employee and
  // permissions, and drops them into a company that isn't theirs. The button sat
  // on every row, one misclick from doing that quietly.
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
}
