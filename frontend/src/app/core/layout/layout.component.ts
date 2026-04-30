import { Component, signal, OnInit, inject, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { ButtonModule } from 'primeng/button';
import { AvatarModule } from 'primeng/avatar';
import { MenuModule } from 'primeng/menu';
import { DialogModule } from 'primeng/dialog';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../services/auth.service';
import { SubscriptionService } from '../services/subscription.service';
import { LanguageService } from '../services/language.service';
import { UserRole, ROLE_LABELS } from '@shared/enums/user-role.enum';

interface NavLeaf {
  labelKey: string;
  icon: string;
  routerLink: string[];
  visible: boolean;
}

interface NavGroup {
  groupKey: string;
  labelKey: string;
  icon: string;
  children: NavLeaf[];
}

type NavEntry =
  | { kind: 'leaf'; leaf: NavLeaf }
  | { kind: 'group'; group: NavGroup };

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ButtonModule,
    AvatarModule,
    MenuModule,
    DialogModule,
    TooltipModule,
    TranslateModule,
  ],
  template: `
    <div class="min-h-screen bg-gray-100">
      <!-- Top Header -->
      <header class="bg-white shadow-sm border-b border-gray-200 fixed top-0 left-0 right-0 z-10">
        <div class="flex items-center justify-between px-6 py-4">
          <div class="flex items-center gap-4">
            <button pButton icon="pi pi-bars" class="p-button-text p-button-rounded"
              (click)="toggleSidebar()">
            </button>
            <img src="assets/img/logo.png" alt="Automate Magic" class="h-9 w-auto">
          </div>

          <div class="flex items-center gap-4">
            @if (currentUser(); as user) {
              <!-- Company Badge -->
              <div class="hidden md:flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg">
                <i class="pi pi-building text-blue-600 text-sm"></i>
                <span class="text-sm font-medium text-blue-700">{{ getCompanyName(user) }}</span>
              </div>

              <!-- User Info -->
              <div class="flex items-center gap-3">
                <div class="text-right hidden sm:block" [class.text-left]="languageService.isRtl()">
                  <p class="font-medium text-gray-900">{{ user.firstName }} {{ user.lastName }}</p>
                  <p class="text-xs text-gray-500">{{ formatRole(user.role) }}</p>
                </div>
                <div class="relative">
                  <p-avatar
                    [label]="getUserInitials(user)"
                    shape="circle"
                    [style]="{ background: getAvatarColor(user.role), color: 'white', fontWeight: '600' }">
                  </p-avatar>
                  <span class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white"
                    [class]="getRoleDotClass(user.role)">
                  </span>
                </div>
              </div>
            }

            <!-- Language Toggle -->
            <button pButton
              [label]="'HEADER.TOGGLE_LANGUAGE' | translate"
              class="p-button-outlined p-button-sm"
              (click)="languageService.toggle()">
            </button>

            <button pButton
              icon="pi pi-sign-out"
              [label]="'HEADER.LOGOUT' | translate"
              class="p-button-text"
              (click)="logout()">
            </button>
          </div>
        </div>
      </header>

      <!-- Sidebar -->
      <aside
        class="fixed top-16 bottom-0 bg-white border-gray-200 transition-all duration-300 z-20 overflow-y-auto"
        [class.left-0]="!languageService.isRtl()"
        [class.right-0]="languageService.isRtl()"
        [class.border-r]="!languageService.isRtl()"
        [class.border-l]="languageService.isRtl()"
        [class.w-64]="sidebarVisible()"
        [class.w-0]="!sidebarVisible()">
        @if (sidebarVisible()) {
          <nav class="p-3">
            <div class="space-y-0.5">
              @for (entry of visibleMenuEntries(); track entryTrackBy($index, entry)) {
                @if (entry.kind === 'leaf') {
                  <a
                    [routerLink]="entry.leaf.routerLink"
                    routerLinkActive="bg-blue-50 text-blue-600 border-blue-500"
                    [routerLinkActiveOptions]="{ exact: entry.leaf.routerLink.length === 1 }"
                    class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-all border-l-4 border-transparent text-sm"
                    [class.border-r-4]="languageService.isRtl()"
                    [class.border-l-4]="!languageService.isRtl()">
                    <i [class]="entry.leaf.icon + ' text-base'"></i>
                    <span class="font-medium">{{ entry.leaf.labelKey | translate }}</span>
                  </a>
                } @else {
                  <button type="button"
                    (click)="toggleGroup(entry.group.groupKey)"
                    class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-all text-sm">
                    <i [class]="entry.group.icon + ' text-base'"></i>
                    <span class="font-medium flex-1 text-start">{{ entry.group.labelKey | translate }}</span>
                    <i class="pi text-xs text-gray-400 transition-transform"
                       [class.pi-chevron-down]="isGroupOpen(entry.group.groupKey)"
                       [class.pi-chevron-right]="!isGroupOpen(entry.group.groupKey) && !languageService.isRtl()"
                       [class.pi-chevron-left]="!isGroupOpen(entry.group.groupKey) && languageService.isRtl()"></i>
                  </button>
                  @if (isGroupOpen(entry.group.groupKey)) {
                    <div class="space-y-0.5 mb-1"
                         [class.ms-4]="!languageService.isRtl()"
                         [class.me-4]="languageService.isRtl()">
                      @for (child of entry.group.children; track child.routerLink[0]) {
                        <a
                          [routerLink]="child.routerLink"
                          routerLinkActive="bg-blue-50 text-blue-600 border-blue-500"
                          [routerLinkActiveOptions]="{ exact: child.routerLink.length === 1 }"
                          class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-all border-l-4 border-transparent text-sm"
                          [class.border-r-4]="languageService.isRtl()"
                          [class.border-l-4]="!languageService.isRtl()">
                          <i [class]="child.icon + ' text-sm'"></i>
                          <span>{{ child.labelKey | translate }}</span>
                        </a>
                      }
                    </div>
                  }
                }
              }
            </div>
          </nav>
        }
      </aside>

      <!-- Expiry Warning Banner -->
      @if (subscriptionService.showExpiryWarning()) {
        <div class="fixed top-16 left-0 right-0 z-30 bg-amber-50 border-b border-amber-300 px-6 py-2 flex items-center justify-between"
          [class.ml-64]="sidebarVisible() && !languageService.isRtl()"
          [class.mr-64]="sidebarVisible() && languageService.isRtl()">
          <div class="flex items-center gap-2 text-amber-800">
            <i class="pi pi-exclamation-triangle text-amber-600"></i>
            <span class="text-sm font-medium">
              {{ 'SUBSCRIPTION.EXPIRY_WARNING' | translate: { days: subscriptionService.daysUntilExpiry() } }}
            </span>
          </div>
        </div>
      }

      <!-- Main Content -->
      <main
        class="transition-all duration-300"
        [class.pt-16]="!subscriptionService.showExpiryWarning()"
        [class.pt-24]="subscriptionService.showExpiryWarning()"
        [class.ml-64]="sidebarVisible() && !languageService.isRtl()"
        [class.ml-0]="!sidebarVisible() && !languageService.isRtl()"
        [class.mr-64]="sidebarVisible() && languageService.isRtl()"
        [class.mr-0]="!sidebarVisible() && languageService.isRtl()">
        <div class="p-6">
          <router-outlet></router-outlet>
        </div>
      </main>
    </div>

    <!-- Trial Expired Dialog -->
    <p-dialog [visible]="subscriptionService.isTrialExpired()" [modal]="true"
      [closable]="false" [style]="{ width: '480px' }"
      [header]="'SUBSCRIPTION.TRIAL_EXPIRED_TITLE' | translate">
      <div class="text-center py-6 px-4">
        <i class="pi pi-clock text-6xl text-red-400 mb-4 block"></i>
        <h3 class="text-xl font-bold text-gray-800 mb-2">{{ 'SUBSCRIPTION.TRIAL_EXPIRED_HEADING' | translate }}</h3>
        <p class="text-gray-500 mb-4">{{ 'SUBSCRIPTION.TRIAL_EXPIRED_MESSAGE' | translate }}</p>
      </div>
      <ng-template pTemplate="footer">
        <button pButton
          [label]="'SUBSCRIPTION.TRIAL_LOGOUT' | translate"
          icon="pi pi-sign-out"
          severity="secondary"
          (click)="logout()">
        </button>
      </ng-template>
    </p-dialog>

    <!-- Subscription Expired Dialog -->
    <p-dialog [visible]="subscriptionService.isSubscriptionExpired()" [modal]="true"
      [closable]="false" [style]="{ width: '480px' }"
      [header]="'SUBSCRIPTION.SUBSCRIPTION_EXPIRED_TITLE' | translate">
      <div class="text-center py-6 px-4">
        <i class="pi pi-ban text-6xl text-red-400 mb-4 block"></i>
        <h3 class="text-xl font-bold text-gray-800 mb-2">{{ 'SUBSCRIPTION.SUBSCRIPTION_EXPIRED_HEADING' | translate }}</h3>
        <p class="text-gray-500 mb-4">{{ 'SUBSCRIPTION.SUBSCRIPTION_EXPIRED_MESSAGE' | translate }}</p>
      </div>
      <ng-template pTemplate="footer">
        <button pButton
          [label]="'SUBSCRIPTION.SUBSCRIPTION_LOGOUT' | translate"
          icon="pi pi-sign-out"
          severity="secondary"
          (click)="logout()">
        </button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`:host { display: block; }`]
})
export class LayoutComponent implements OnInit {
  sidebarVisible = signal(true);
  currentUser = this.authService.currentUser;
  subscriptionService = inject(SubscriptionService);
  languageService = inject(LanguageService);

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit() {
    this.subscriptionService.load().subscribe({ error: () => {} });
    this.syncOpenGroupFromUrl(this.router.url);
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => this.syncOpenGroupFromUrl(e.urlAfterRedirects || e.url));
  }

  // ─── Computed menu (permission-aware, grouped) ──────────────────────────

  openGroups = signal<Set<string>>(new Set<string>());

  visibleMenuEntries = computed<NavEntry[]>(() => {
    const auth = this.authService;
    const entries: NavEntry[] = [];

    // Dashboard (standalone)
    if (auth.canRead('dashboard')) {
      entries.push({ kind: 'leaf', leaf: {
        labelKey: 'NAV.DASHBOARD', icon: 'pi pi-home', routerLink: ['/dashboard'], visible: true,
      }});
    }

    // Academic
    const academic: NavLeaf[] = [
      { labelKey: 'NAV.COURSES', icon: 'pi pi-book', routerLink: ['/courses'], visible: auth.canRead('courses') },
      { labelKey: 'NAV.MASTER_COURSES', icon: 'pi pi-th-large', routerLink: ['/master-courses'], visible: auth.canRead('master_courses') },
      { labelKey: 'NAV.CLASSES', icon: 'pi pi-calendar', routerLink: ['/classes'], visible: auth.canRead('classes') },
      { labelKey: 'NAV.ROOMS', icon: 'pi pi-building', routerLink: ['/rooms'], visible: auth.canRead('rooms') },
      { labelKey: 'NAV.SESSIONS', icon: 'pi pi-clock', routerLink: ['/sessions'], visible: auth.canRead('sessions') },
      { labelKey: 'NAV.TIMETABLE', icon: 'pi pi-calendar-clock', routerLink: ['/timetable'], visible: auth.canRead('timetable') },
      { labelKey: 'NAV.EVENTS', icon: 'pi pi-flag', routerLink: ['/events'], visible: auth.canRead('events') },
    ].filter(c => c.visible);
    if (academic.length) {
      entries.push({ kind: 'group', group: {
        groupKey: 'academic', labelKey: 'NAV.GROUPS.ACADEMIC', icon: 'pi pi-graduation-cap', children: academic,
      }});
    }

    // People & Branches
    const people: NavLeaf[] = [
      { labelKey: 'NAV.BRANCHES', icon: 'pi pi-building', routerLink: ['/branches'], visible: auth.canRead('branches') },
      { labelKey: 'NAV.STUDENTS', icon: 'pi pi-users', routerLink: ['/students'], visible: auth.canRead('students') },
      { labelKey: 'NAV.EMPLOYEES', icon: 'pi pi-user', routerLink: ['/employees'], visible: auth.canRead('employees') },
    ].filter(c => c.visible);
    if (people.length) {
      entries.push({ kind: 'group', group: {
        groupKey: 'people', labelKey: 'NAV.GROUPS.PEOPLE', icon: 'pi pi-users', children: people,
      }});
    }

    // Financial
    const financial: NavLeaf[] = [
      { labelKey: 'NAV.CASH', icon: 'pi pi-wallet', routerLink: ['/cash'], visible: auth.canRead('cash') },
      { labelKey: 'NAV.REVENUES', icon: 'pi pi-dollar', routerLink: ['/revenues'], visible: auth.canRead('revenues') },
      { labelKey: 'NAV.EXPENSES', icon: 'pi pi-money-bill', routerLink: ['/expenses'], visible: auth.canRead('expenses') },
      { labelKey: 'NAV.WITHDRAWALS', icon: 'pi pi-wallet', routerLink: ['/withdrawals'], visible: auth.canRead('withdrawals') },
      { labelKey: 'NAV.REFUNDS', icon: 'pi pi-replay', routerLink: ['/refunds'], visible: auth.canRead('refunds') },
      { labelKey: 'NAV.DUES', icon: 'pi pi-credit-card', routerLink: ['/dues'], visible: auth.canRead('enrollments') },
    ].filter(c => c.visible);
    if (financial.length) {
      entries.push({ kind: 'group', group: {
        groupKey: 'financial', labelKey: 'NAV.GROUPS.FINANCIAL', icon: 'pi pi-money-bill', children: financial,
      }});
    }

    // Inventory
    const inventory: NavLeaf[] = [
      { labelKey: 'NAV.PRODUCTS', icon: 'pi pi-box', routerLink: ['/products/list'], visible: auth.canRead('products') },
      { labelKey: 'NAV.SELL_PRODUCT', icon: 'pi pi-shopping-cart', routerLink: ['/products/sell'], visible: auth.canWrite('product_sales') },
      { labelKey: 'NAV.SALES_HISTORY', icon: 'pi pi-history', routerLink: ['/products/sales'], visible: auth.canRead('product_sales') },
    ].filter(c => c.visible);
    if (inventory.length) {
      entries.push({ kind: 'group', group: {
        groupKey: 'inventory', labelKey: 'NAV.GROUPS.INVENTORY', icon: 'pi pi-box', children: inventory,
      }});
    }

    // Reports (standalone)
    if (auth.canRead('reports')) {
      entries.push({ kind: 'leaf', leaf: {
        labelKey: 'NAV.REPORTS', icon: 'pi pi-chart-bar', routerLink: ['/reports'], visible: true,
      }});
    }

    // Admin
    const admin: NavLeaf[] = [
      { labelKey: 'NAV.USERS', icon: 'pi pi-user-edit', routerLink: ['/users'], visible: auth.canRead('users') },
      { labelKey: 'NAV.SETTINGS', icon: 'pi pi-cog', routerLink: ['/settings'], visible: true },
    ].filter(c => c.visible);
    if (admin.length) {
      entries.push({ kind: 'group', group: {
        groupKey: 'admin', labelKey: 'NAV.GROUPS.ADMIN', icon: 'pi pi-shield', children: admin,
      }});
    }

    return entries;
  });

  toggleGroup(key: string) {
    this.openGroups.update(s => {
      const next = new Set(s);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  isGroupOpen(key: string): boolean {
    return this.openGroups().has(key);
  }

  entryTrackBy(index: number, entry: NavEntry): string {
    return entry.kind === 'leaf' ? 'L:' + entry.leaf.routerLink[0] : 'G:' + entry.group.groupKey;
  }

  /** Auto-open the group that contains the current URL so the active item is visible. */
  private syncOpenGroupFromUrl(url: string) {
    const groups = this.visibleMenuEntries().filter(e => e.kind === 'group');
    for (const e of groups) {
      if (e.kind !== 'group') continue;
      const match = e.group.children.some(c => url === c.routerLink[0] || url.startsWith(c.routerLink[0] + '/'));
      if (match) {
        this.openGroups.update(s => {
          if (s.has(e.group.groupKey)) return s;
          const next = new Set(s);
          next.add(e.group.groupKey);
          return next;
        });
      }
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  toggleSidebar() { this.sidebarVisible.update(v => !v); }

  getUserInitials(user: any): string {
    return `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase();
  }

  getCompanyName(_user: any): string {
    return localStorage.getItem('company_name') || 'My Company';
  }

  getAvatarColor(role: string): string {
    const map: Record<string, string> = {
      GLOBAL_ADMIN: '#7C3AED', ADMIN: '#7C3AED',
      BRANCH_ADMIN: '#2563EB', BRANCH_MANAGER: '#2563EB',
      ACADEMIC_MANAGER: '#059669', SALES_MANAGER: '#D97706',
      ACCOUNTANT: '#0891B2', VIEWER: '#6B7280',
    };
    return map[role] || '#3B82F6';
  }

  getRoleDotClass(role: string): string {
    const map: Record<string, string> = {
      GLOBAL_ADMIN: 'bg-purple-500', ADMIN: 'bg-purple-500',
      BRANCH_ADMIN: 'bg-blue-500', BRANCH_MANAGER: 'bg-blue-500',
      ACADEMIC_MANAGER: 'bg-emerald-500', SALES_MANAGER: 'bg-amber-500',
      ACCOUNTANT: 'bg-cyan-500', VIEWER: 'bg-gray-400',
    };
    return map[role] || 'bg-gray-400';
  }

  formatRole(role: string): string {
    return ROLE_LABELS[role as UserRole] || role;
  }

  logout() {
    this.authService.logout();
    this.router.navigate(['/auth/login']);
  }
}
