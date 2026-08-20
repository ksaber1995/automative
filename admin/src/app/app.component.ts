import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { PortalAuthService } from './auth/portal-auth.service';
import { LoginComponent } from './auth/login.component';
import { AdminStore } from './admin-store.service';
import { SECTIONS, firstAllowedPath } from './app.routes';

/**
 * The shell: the sidebar, who you are signed in as, and the outlet the sections
 * render into.
 *
 * It used to be the whole console — every section inline, switched by a `view`
 * signal. That meant a reload always came back on Companies, because the URL
 * never said otherwise. Each section is a route now; this holds only what is
 * common to all of them.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    RouterOutlet, RouterLink, RouterLinkActive,
    LoginComponent,
  ],
  template: `
    <!-- Until the stored token has been checked, show neither the console nor
         the login form — a valid session would otherwise flash the login page on
         every reload. -->
    @if (!auth.ready()) {
      <div class="booting">Checking your session…</div>
    } @else if (!auth.signedIn()) {
      <app-login />
    } @else {
    <div class="app">
      <aside class="sidebar" [class.collapsed]="sidebarCollapsed()">
        <button class="collapse-btn" (click)="toggleSidebar()"
          [title]="sidebarCollapsed() ? 'Expand sidebar' : 'Collapse sidebar'">
          {{ sidebarCollapsed() ? '»' : '«' }}
        </button>
        <div class="brand">Netrofit <span>Admin</span></div>
        <nav>
          @for (s of sections; track s.path) {
            @if (!s.permission || auth.can(s.permission)) {
              <a class="navitem" [routerLink]="'/' + s.path" routerLinkActive="on">
                <span>{{ s.label }}</span>
                @if (countFor(s.path); as n) { <span class="navcount">{{ n }}</span> }
              </a>
            }
          }
        </nav>

        <div class="who">
          <div class="who-name">{{ auth.user()?.name || auth.user()?.email }}</div>
          <div class="who-role">{{ auth.user()?.role }}</div>
          <div class="who-acts">
            <button class="linkish" (click)="openChangePassword()">Password</button>
            <button class="linkish" (click)="auth.logout()">Sign out</button>
          </div>
        </div>
        <button class="refresh side" (click)="refreshAll()">Refresh all</button>
      </aside>

      <main class="main">
        @if (!anySectionVisible()) {
          <div class="state">
            <h1>Nothing to show</h1>
            <p class="sub">
              Your account can sign in but has no permissions yet. Ask an owner to grant some.
            </p>
          </div>
        } @else {
          <router-outlet />
        }
      </main>
    </div>

    @if (store.flash(); as f) {
      <div class="flash">{{ f }}</div>
    }

    <!-- Changing your own password. Needs the current one, so an unlocked
         laptop is not enough to lock the owner out. -->
    @if (passwordOpen()) {
      <div class="overlay" (click)="closeChangePassword()">
        <div class="modal" (click)="$event.stopPropagation()">
          <h2>Change your password</h2>
          <p class="modal-sub">You will stay signed in on this browser.</p>
          <input class="search" type="password" autocomplete="current-password"
            [ngModel]="currentPassword()" (ngModelChange)="currentPassword.set($event)"
            placeholder="Current password" />
          <input class="search" type="password" autocomplete="new-password" style="margin-top:10px"
            [ngModel]="newPassword()" (ngModelChange)="newPassword.set($event)"
            placeholder="New password (at least 8 characters)" />
          @if (passwordError(); as e) { <div class="error" style="margin-top:12px">{{ e }}</div> }
          <div class="modal-foot">
            <button class="act" [disabled]="savingPassword()" (click)="closeChangePassword()">Cancel</button>
            <button class="act activate" [disabled]="savingPassword()" (click)="submitPassword()">
              {{ savingPassword() ? 'Saving…' : 'Change password' }}
            </button>
          </div>
        </div>
      </div>
    }
    }
  `,
  styleUrls: ['./shared/admin-ui.css'],
  styles: [`
    .booting { padding: 80px 20px; text-align: center; color: #64748b; font-size: 14px; }
    .app { display: flex; align-items: stretch; min-height: 100vh; }
    .sidebar {
      width: 236px; flex: 0 0 236px; background: #0f172a; color: #e2e8f0;
      padding: 20px 14px; display: flex; flex-direction: column; gap: 6px;
      position: sticky; top: 0; height: 100vh;
    }
    /* Collapsed: a slim rail with only the expand button — the wide tables get
       the room. The choice sticks (localStorage). */
    .sidebar.collapsed { width: 52px; flex-basis: 52px; padding: 20px 8px; }
    .sidebar.collapsed .brand, .sidebar.collapsed nav,
    .sidebar.collapsed .who, .sidebar.collapsed .refresh.side { display: none; }
    .collapse-btn {
      border: 0; background: rgba(255, 255, 255, .08); color: #e2e8f0;
      border-radius: 8px; padding: 6px 10px; cursor: pointer; font-size: 16px;
      font-family: inherit; align-self: flex-end; line-height: 1;
    }
    .sidebar.collapsed .collapse-btn { align-self: center; }
    .collapse-btn:hover { background: rgba(255, 255, 255, .16); }
    .brand { font-size: 18px; font-weight: 800; color: #fff; padding: 6px 10px 18px; }
    .brand span { color: #818cf8; font-weight: 600; }
    .sidebar nav { display: flex; flex-direction: column; gap: 4px; }
    /* Anchors rather than buttons now, so the browser gets real URLs — middle
       click, copy link address, and the back button all work. */
    .navitem {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      width: 100%; text-align: left; border: 0; background: transparent; color: #cbd5e1;
      padding: 10px 12px; border-radius: 8px; font-size: 14px; font-weight: 600;
      cursor: pointer; text-decoration: none;
    }
    .navitem:hover { background: rgba(255, 255, 255, .06); color: #fff; }
    .navitem.on { background: #4f46e5; color: #fff; }
    .navcount {
      background: rgba(255, 255, 255, .15); border-radius: 999px; padding: 1px 8px;
      font-size: 12px; font-variant-numeric: tabular-nums;
    }
    /* .who owns the auto margin that pushes the block to the bottom. */
    .who { margin-top: auto; padding: 12px 12px 10px; border-top: 1px solid rgba(255,255,255,.10); }
    .who-name { font-size: 13px; font-weight: 700; color: #fff; word-break: break-all; }
    .who-role { font-size: 11px; color: #818cf8; font-weight: 700; letter-spacing: .04em; margin-top: 1px; }
    .who-acts { display: flex; gap: 12px; margin-top: 7px; }
    .linkish {
      border: 0; background: none; padding: 0; cursor: pointer; color: #cbd5e1;
      font-size: 12px; font-family: inherit; text-decoration: underline;
    }
    .linkish:hover { color: #fff; }
    .refresh.side { margin-top: 8px; background: rgba(255, 255, 255, .08); border-color: transparent; color: #e2e8f0; }
    .refresh.side:hover { background: rgba(255, 255, 255, .16); }
    .main { flex: 1 1 auto; min-width: 0; padding: 30px 28px 60px; }
    .flash {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      background: #0f172a; color: #fff; padding: 10px 18px; border-radius: 8px;
      font-size: 14px; box-shadow: 0 8px 20px rgba(0,0,0,.25); z-index: 60;
    }
  `],
})
export class AppComponent {
  readonly auth = inject(PortalAuthService);
  readonly store = inject(AdminStore);
  private router = inject(Router);

  protected readonly sections = SECTIONS;

  protected sidebarCollapsed = signal(localStorage.getItem('adminSidebarCollapsed') === '1');
  protected toggleSidebar(): void {
    this.sidebarCollapsed.update((v) => !v);
    localStorage.setItem('adminSidebarCollapsed', this.sidebarCollapsed() ? '1' : '0');
  }

  constructor() {
    this.auth.restore();

    // The data loads and the landing redirect used to run from ngOnInit. They
    // cannot any more: both need a session, and firing them before one is known
    // would 401 on the way in and clear it. This runs once a user appears —
    // whether from a stored token or a fresh sign-in.
    let settledFor: string | null = null;
    effect(() => {
      const user = this.auth.user();
      if (!user) { settledFor = null; return; }
      if (settledFor === user.id) return;
      settledFor = user.id;

      // A URL typed, bookmarked or reloaded into a section this account cannot
      // open. The route guard cannot catch this one: it ran while the session
      // was still resolving, when everything was permitted.
      if (!this.currentSectionAllowed()) {
        this.router.navigateByUrl(firstAllowedPath(this.auth));
      }

      // Sidebar counts, which are shown before any section is opened.
      if (this.auth.can(['companies.read', 'cards.read', 'tenant_users.read'])) this.store.loadCompanies();
      if (this.auth.can('tenant_users.read')) this.store.loadUsers();
      if (this.auth.can('bots.read')) this.store.loadBots();
    });
  }

  /** Is the section currently in the URL one this account holds? */
  private currentSectionAllowed(): boolean {
    const path = this.router.url.split('?')[0].split('/').filter(Boolean)[0] ?? '';
    const section = this.sections.find((s) => s.path === path);
    // An unknown path is about to be redirected by the ** route; leave it alone.
    if (!section) return true;
    return !section.permission || this.auth.can(section.permission);
  }

  protected anySectionVisible(): boolean {
    return this.sections.some((s) => !s.permission || this.auth.can(s.permission));
  }

  /** The badge beside a nav item, or 0 for sections that do not have one. */
  protected countFor(path: string): number {
    switch (path) {
      case 'companies': return this.store.companies().length;
      case 'users': return this.store.users().length;
      case 'cards': return this.store.activeClientCount();
      case 'bots': return this.store.poolTotal();
      default: return 0;
    }
  }

  /** Sidebar "Refresh all" — reload every section this account can see. */
  protected refreshAll(): void {
    if (this.auth.can(['companies.read', 'cards.read', 'tenant_users.read'])) this.store.loadCompanies(true);
    if (this.auth.can('tenant_users.read')) this.store.loadUsers(true);
    if (this.auth.can('bots.read')) this.store.loadBots(true);
  }

  // ── Your own password ───────────────────────────────────────────────────────
  protected passwordOpen = signal(false);
  protected currentPassword = signal('');
  protected newPassword = signal('');
  protected savingPassword = signal(false);
  protected passwordError = signal<string | null>(null);

  protected openChangePassword(): void {
    this.currentPassword.set('');
    this.newPassword.set('');
    this.passwordError.set(null);
    this.passwordOpen.set(true);
  }

  protected closeChangePassword(): void {
    if (this.savingPassword()) return;
    this.passwordOpen.set(false);
  }

  protected submitPassword(): void {
    if (this.savingPassword()) return;
    if (this.newPassword().length < 8) {
      this.passwordError.set('The new password must be at least 8 characters.');
      return;
    }
    this.savingPassword.set(true);
    this.passwordError.set(null);
    this.auth.changeOwnPassword(this.currentPassword(), this.newPassword()).subscribe({
      next: () => {
        this.savingPassword.set(false);
        this.passwordOpen.set(false);
        this.store.showFlash('Password changed.');
      },
      error: (err) => {
        this.savingPassword.set(false);
        this.passwordError.set(err?.error?.message || 'Could not change the password.');
      },
    });
  }
}
