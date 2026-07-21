import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CompanySubscription, PoolBot, PoolType, POOL_TYPES, SubscriptionsService,
  TenantUser, USER_ROLES,
} from './subscriptions.service';

/**
 * The vendor's debugging login. It is the reason the move-between-tenants
 * feature exists, and the only account offered a Move button. Hidden from the
 * customer's own /users page by the API (see HIDDEN_DEBUG_EMAIL).
 */
const DEBUG_EMAIL = 'master@master.com';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="app">
      <aside class="sidebar">
        <div class="brand">Netrofit <span>Admin</span></div>
        <nav>
          <button class="navitem" [class.on]="view() === 'companies'" (click)="view.set('companies')">
            <span>Companies</span><span class="navcount">{{ rows().length }}</span>
          </button>
          <button class="navitem" [class.on]="view() === 'users'" (click)="showUsers()">
            <span>Users</span><span class="navcount">{{ users().length }}</span>
          </button>
          <button class="navitem" [class.on]="view() === 'bots'" (click)="view.set('bots')">
            <span>Telegram bots</span><span class="navcount">{{ poolTotal() }}</span>
          </button>
        </nav>
        <button class="refresh side" (click)="refreshAll()">Refresh all</button>
      </aside>
      <main class="main">

      @if (view() === 'companies') {
      <header>
        <div>
          <h1>Companies &amp; Subscriptions</h1>
          <p class="sub">Every tenant in the system · read-only superadmin view</p>
        </div>
        <button class="refresh" (click)="load()" [disabled]="loading()">
          {{ loading() ? 'Loading…' : 'Refresh' }}
        </button>
      </header>
      }

      @if (view() === 'bots') {
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
      }

      @if (view() === 'companies') {
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
                <th>Start</th>
                <th>End</th>
                <th>Status</th>
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
                    @if (qrStats()[r.company_id]; as q) {
                      <div class="qr-cell">
                        <button class="act" [class.activate]="!q.qr_cards_enabled"
                          [disabled]="busyId() === r.company_id"
                          (click)="toggleQrCards(r)">
                          {{ q.qr_cards_enabled ? 'Disable' : 'Enable' }}
                        </button>
                        @if (q.qr_cards_enabled) {
                          <button class="act" [disabled]="busyId() === r.company_id" (click)="openQrCards(r)">
                            + Cards
                          </button>
                          <span class="qr-count">{{ q.linked }} / {{ q.total }}</span>
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

      }

      @if (view() === 'users') {
      <header>
        <div>
          <h1>Users</h1>
          <p class="sub">Every account in every tenant · create and remove them here</p>
        </div>
        <button class="refresh" (click)="loadUsers()" [disabled]="usersLoading()">
          {{ usersLoading() ? 'Loading…' : 'Refresh' }}
        </button>
      </header>

      <div class="card" style="margin: 20px 0; padding: 16px;">
        <div class="lic-toolbar">
          <input class="search" type="text"
            [ngModel]="userSearch()" (ngModelChange)="userSearch.set($event)"
            placeholder="Search name, email or role…" />
          <!-- Filter per tenant -->
          <select class="search" style="max-width:260px;"
            [ngModel]="userCompany()" (ngModelChange)="userCompany.set($event)">
            <option value="">All tenants ({{ users().length }})</option>
            @for (c of rows(); track c.company_id) {
              <option [value]="c.company_id">{{ c.company_name }}</option>
            }
          </select>
          <button class="act activate" (click)="openCreateUser()">+ New user</button>
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
                      @if (isDebugUser(u)) {
                        <button class="act" [disabled]="busyId() === u.id" (click)="openMoveUser(u)">
                          Move
                        </button>
                      }
                      <button class="act danger" [disabled]="busyId() === u.id" (click)="openDeleteUser(u)">
                        Delete
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
      }

      <!-- Create a user inside a tenant -->
      @if (createUserOpen()) {
        <div class="overlay" (click)="createUserOpen.set(false)">
          <div class="modal" (click)="$event.stopPropagation()">
            <h2>New user</h2>
            <p class="modal-sub">The account is created verified and active, so they can log in straight away.</p>
            <select class="search" [ngModel]="newUser.companyId" (ngModelChange)="newUser.companyId = $event">
              <option value="">Choose a tenant…</option>
              @for (c of rows(); track c.company_id) {
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

      <!-- Delete a user -->
      @if (deleteUserRow(); as u) {
        <div class="overlay" (click)="deleteUserRow.set(null)">
          <div class="modal" (click)="$event.stopPropagation()">
            <h2 class="danger-title">Delete user</h2>
            <p class="modal-sub">
              <strong>{{ u.first_name }} {{ u.last_name }}</strong> ({{ u.email }}) in
              <strong>{{ u.company_name || 'no tenant' }}</strong>. This cannot be undone.
            </p>
            <div class="modal-foot">
              <button class="act" [disabled]="busyId() === u.id" (click)="deleteUserRow.set(null)">Cancel</button>
              <button class="act danger" [disabled]="busyId() === u.id" (click)="confirmDeleteUser(u)">Delete</button>
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
            <select class="search" [ngModel]="moveTarget()" (ngModelChange)="moveTarget.set($event)">
              <option value="">Choose a tenant…</option>
              @for (c of rows(); track c.company_id) {
                @if (c.company_id !== u.company_id) {
                  <option [value]="c.company_id">{{ c.company_name }}</option>
                }
              }
            </select>
            <div class="modal-foot">
              <button class="act" [disabled]="busyId() === u.id" (click)="moveUserRow.set(null)">Cancel</button>
              <button class="act activate" [disabled]="busyId() === u.id || !moveTarget()" (click)="confirmMoveUser(u)">
                {{ busyId() === u.id ? 'Moving…' : 'Move user' }}
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
                      {{ q.linked === 1 ? 'that student loses' : 'those students lose' }} the card in
                      {{ q.linked === 1 ? 'their' : 'their' }} pocket.
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

      </main>
    </div>
  `,
  styles: [`
    .app { display: flex; align-items: stretch; min-height: 100vh; }
    .sidebar {
      width: 236px; flex: 0 0 236px; background: #0f172a; color: #e2e8f0;
      padding: 20px 14px; display: flex; flex-direction: column; gap: 6px;
      position: sticky; top: 0; height: 100vh;
    }
    .brand { font-size: 18px; font-weight: 800; color: #fff; padding: 6px 10px 18px; }
    .brand span { color: #818cf8; font-weight: 600; }
    .sidebar nav { display: flex; flex-direction: column; gap: 4px; }
    .navitem {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      width: 100%; text-align: left; border: 0; background: transparent; color: #cbd5e1;
      padding: 10px 12px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;
    }
    .navitem:hover { background: rgba(255, 255, 255, .06); color: #fff; }
    .navitem.on { background: #4f46e5; color: #fff; }
    .navcount {
      background: rgba(255, 255, 255, .15); border-radius: 999px; padding: 1px 8px;
      font-size: 12px; font-variant-numeric: tabular-nums;
    }
    .refresh.side { margin-top: auto; background: rgba(255, 255, 255, .08); border-color: transparent; color: #e2e8f0; }
    .refresh.side:hover { background: rgba(255, 255, 255, .16); }
    .main { flex: 1 1 auto; min-width: 0; padding: 30px 28px 60px; }
    .lic-toolbar { display: flex; align-items: center; gap: 12px; margin-top: 14px; flex-wrap: wrap; }
    .lic-toolbar .search { flex: 1; min-width: 220px; }
    .lic-chips { display: flex; gap: 6px; flex-wrap: wrap; }
    th.sortable { cursor: pointer; user-select: none; }
    th.sortable:hover { background: #eef2ff; color: #4f46e5; }
    .menu-btn { font-size: 16px; line-height: 1; padding: 4px 12px; font-weight: 700; letter-spacing: 1px; }
    .menu-modal { max-width: 320px; }
    .menu-list { display: flex; flex-direction: column; gap: 2px; margin: 10px 0 6px; }
    .menu-item {
      text-align: left; width: 100%; border: 0; background: transparent; color: #0f172a;
      padding: 9px 12px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;
    }
    .menu-item:hover:not(:disabled) { background: #f1f5f9; }
    .menu-item:disabled { opacity: .45; cursor: default; }
    .menu-item.activate { color: #166534; }
    .menu-item.danger { color: #b91c1c; }
    .menu-item.danger:hover:not(:disabled) { background: #fef2f2; }
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

  /** Which section the sidebar is showing. */
  view = signal<'companies' | 'bots' | 'users'>('companies');

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
  deleteRow = signal<CompanySubscription | null>(null);
  deleteConfirmText = signal('');
  readonly extendPresets = [1, 3, 6, 12];

  // Telegram bot pool
  bots = signal<PoolBot[]>([]);
  poolTotal = signal(0);
  poolAvailable = signal(0);
  poolToken = signal('');
  addingBot = signal(false);

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

  /** Sidebar "Refresh all" — reload every section. */
  refreshAll(): void {
    this.load();
    this.loadBots();
  }

  ngOnInit() {
    this.load();
    this.loadBots();
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

  // ── Pre-printed QR cards, per client ────────────────────────────────────────
  // The pool is sold per academy: off until we switch it on. Stats are fetched
  // per row rather than in the big companies query, so the table stays cheap.
  qrStats = signal<Record<string, { qr_cards_enabled: boolean; total: number; linked: number }>>({});
  qrRow = signal<CompanySubscription | null>(null);
  qrCount = 100;
  // Stamped on the run being minted. Defaults to 1, which is what every card
  // printed before types existed reads as.
  readonly poolTypes = POOL_TYPES;
  qrPoolType = signal<PoolType>(1);

  /**
   * Narrow the <select>'s value to a real PoolType.
   *
   * The select hands back a STRING, and PoolType is 1 | 2 | 3, so the obvious inline
   * `qrPoolType.set(+$event)` does not compile — it widens to number. Validating here
   * against POOL_TYPES rather than casting means an unexpected value falls back to 1
   * (what every card printed before types existed reads as) instead of stamping the
   * run with something the API will reject.
   */
  setPoolType(value: unknown): void {
    const n = Number(value);
    const match = POOL_TYPES.find((t) => t === n);
    this.qrPoolType.set(match ?? 1);
  }
  // Two-step, and reset every time the dialog opens: this one is not undoable.
  qrDeleteArmed = signal(false);
  qrDeleteLinked = signal(false);

  loadQrStats(companyId: string) {
    this.busyId.set(companyId);
    this.service.qrCardStats(companyId).subscribe({
      next: (stats) => {
        this.busyId.set(null);
        this.qrStats.update((m) => ({ ...m, [companyId]: stats }));
      },
      error: (err) => {
        this.busyId.set(null);
        this.error.set(`QR cards: ${err?.error?.message || err?.message || 'Request failed'}`);
      },
    });
  }

  toggleQrCards(r: CompanySubscription) {
    const current = this.qrStats()[r.company_id];
    const next = !(current?.qr_cards_enabled);
    this.busyId.set(r.company_id);
    this.service.setQrCardsEnabled(r.company_id, next).subscribe({
      next: () => {
        this.busyId.set(null);
        this.showFlash(`QR cards ${next ? 'enabled' : 'disabled'} for ${r.company_name}.`);
        this.loadQrStats(r.company_id);
      },
      error: (err) => {
        this.busyId.set(null);
        this.error.set(`QR cards: ${err?.error?.message || err?.message || 'Request failed'}`);
      },
    });
  }

  openQrCards(r: CompanySubscription) {
    this.qrCount = 100;
    this.qrPoolType.set(1);
    // Never inherit an armed delete from the last company looked at.
    this.qrDeleteArmed.set(false);
    this.qrDeleteLinked.set(false);
    this.qrRow.set(r);
  }

  confirmDeleteQrCards() {
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
        this.showFlash(`${res.deleted} cards deleted for ${r.company_name}${unlinked}${kept}.`);
        this.loadQrStats(r.company_id);
      },
      error: (err) => {
        this.busyId.set(null);
        this.error.set(`Delete cards: ${err?.error?.message || err?.message || 'Request failed'}`);
      },
    });
  }

  confirmQrCards() {
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
        this.showFlash(`${res.created} type ${res.poolType} cards for ${r.company_name} (${label(res.from)} … ${label(res.to)}).`);
        this.loadQrStats(r.company_id);
      },
      error: (err) => {
        this.busyId.set(null);
        this.error.set(`Generate failed: ${err?.error?.message || err?.message || 'Request failed'}`);
      },
    });
  }
  // ── Users, per tenant ───────────────────────────────────────────────────────
  // The vendor creates and removes accounts here. The API refuses to delete a
  // tenant's last admin, which would lock the customer out of their own app.
  readonly roles = USER_ROLES;
  users = signal<TenantUser[]>([]);
  usersLoading = signal(false);
  userSearch = signal('');
  userCompany = signal('');
  createUserOpen = signal(false);
  creatingUser = signal(false);
  deleteUserRow = signal<TenantUser | null>(null);
  newUser = { companyId: '', email: '', password: '', firstName: '', lastName: '', role: 'ADMIN' };

  visibleUsers = computed(() => {
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

  showUsers() {
    this.view.set('users');
    if (!this.users().length) this.loadUsers();
  }

  loadUsers() {
    this.usersLoading.set(true);
    this.service.listUsers().subscribe({
      next: (rows) => { this.users.set(rows); this.usersLoading.set(false); },
      error: (err) => {
        this.usersLoading.set(false);
        this.error.set(`Users: ${err?.error?.message || err?.message || 'Request failed'}`);
      },
    });
  }

  openCreateUser() {
    // Pre-select whatever tenant is being filtered on — that is almost always the
    // one being added to.
    this.newUser = {
      companyId: this.userCompany(), email: '', password: '',
      firstName: '', lastName: '', role: 'ADMIN',
    };
    this.createUserOpen.set(true);
  }

  confirmCreateUser() {
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
        this.showFlash(`${u.email} created.`);
        this.loadUsers();
      },
      error: (err) => {
        this.creatingUser.set(false);
        this.error.set(`Create user: ${err?.error?.message || err?.message || 'Request failed'}`);
      },
    });
  }

  openDeleteUser(u: TenantUser) {
    this.deleteUserRow.set(u);
  }

  // Moving an account between tenants — for a debugging login that needs to sit
  // inside a customer's data. The API refuses to move a tenant's last admin out,
  // for the same reason it refuses to delete them.
  //
  // Offered for the debug login only. Moving a real customer's account is not a
  // thing anyone here means to do: it strips their branch, linked employee and
  // permissions, and drops them into a company that isn't theirs. The button sat
  // on every row, one misclick from doing that quietly.
  moveUserRow = signal<TenantUser | null>(null);
  moveTarget = signal('');

  isDebugUser(u: TenantUser): boolean {
    return u.email.trim().toLowerCase() === DEBUG_EMAIL;
  }

  openMoveUser(u: TenantUser) {
    this.moveTarget.set('');
    this.moveUserRow.set(u);
  }

  confirmMoveUser(u: TenantUser) {
    const companyId = this.moveTarget();
    if (!companyId) { this.error.set('Choose a tenant.'); return; }

    this.busyId.set(u.id);
    this.service.moveUserCompany(u.id, companyId).subscribe({
      next: (moved) => {
        this.busyId.set(null);
        this.moveUserRow.set(null);
        this.showFlash(`${u.email} moved to ${moved.company_name || 'the new tenant'} — they must log in again.`);
        this.loadUsers();
      },
      error: (err) => {
        this.busyId.set(null);
        // e.g. "last admin" — keep the dialog open so the message is read in context.
        this.error.set(`Move user: ${err?.error?.message || err?.message || 'Request failed'}`);
      },
    });
  }

  confirmDeleteUser(u: TenantUser) {
    this.busyId.set(u.id);
    this.service.deleteUser(u.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.deleteUserRow.set(null);
        this.showFlash(`${u.email} deleted.`);
        this.loadUsers();
      },
      error: (err) => {
        this.busyId.set(null);
        // e.g. "last admin" — keep the dialog open so the message is read in context.
        this.error.set(`Delete user: ${err?.error?.message || err?.message || 'Request failed'}`);
      },
    });
  }

  // ── Park a tenant ───────────────────────────────────────────────────────────
  deactivateRow = signal<CompanySubscription | null>(null);

  openDeactivate(r: CompanySubscription) {
    this.deactivateRow.set(r);
  }

  confirmDeactivate(r: CompanySubscription) {
    this.busyId.set(r.company_id);
    this.service.deactivate(r.company_id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.deactivateRow.set(null);
        this.showFlash(`${r.company_name} deactivated.`);
        this.load();
      },
      error: (err) => {
        this.busyId.set(null);
        this.error.set(`Deactivate: ${err?.error?.message || err?.message || 'Request failed'}`);
      },
    });
  }
}
