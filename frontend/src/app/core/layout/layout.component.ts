import { Component, signal, OnInit, inject, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { ButtonModule } from 'primeng/button';
import { AvatarModule } from 'primeng/avatar';
import { MenuModule } from 'primeng/menu';
import { DialogModule } from 'primeng/dialog';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BreadcrumbsComponent } from '../../shared/components/breadcrumbs/breadcrumbs.component';
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
    BreadcrumbsComponent,
  ],
  templateUrl: './layout.component.html',
  styleUrl: './layout.component.scss'})
export class LayoutComponent implements OnInit {
  sidebarVisible = signal(true);
  currentUser = this.authService.currentUser;
  subscriptionService = inject(SubscriptionService);
  languageService = inject(LanguageService);
  private translate = inject(TranslateService);

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
      { labelKey: 'NAV.COURSES', icon: 'pi pi-book', routerLink: ['/courses'], visible: auth.canRead('academy') },
      { labelKey: 'NAV.MONTHLY_SUBSCRIPTIONS', icon: 'pi pi-calendar', routerLink: ['/monthly-subscriptions'], visible: auth.canRead('academy') },
      { labelKey: 'NAV.MASTER_COURSES', icon: 'pi pi-th-large', routerLink: ['/master-courses'], visible: auth.canRead('academy') },
      { labelKey: 'NAV.LEVELS', icon: 'pi pi-sort-amount-up', routerLink: ['/levels'], visible: auth.canRead('academy') },
      { labelKey: 'NAV.CLASSES', icon: 'pi pi-calendar', routerLink: ['/classes'], visible: auth.canRead('academy') },
      { labelKey: 'NAV.ROOMS', icon: 'pi pi-building', routerLink: ['/rooms'], visible: auth.canRead('academy') },
      { labelKey: 'NAV.SESSIONS', icon: 'pi pi-clock', routerLink: ['/sessions'], visible: auth.canRead('academy') },
      { labelKey: 'NAV.TIMETABLE', icon: 'pi pi-calendar-clock', routerLink: ['/timetable'], visible: auth.canRead('academy') },
      { labelKey: 'NAV.EVENTS', icon: 'pi pi-flag', routerLink: ['/events'], visible: auth.canRead('academy') },
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

    // Admin — only Global Admins see this section at all.
    const admin: NavLeaf[] = auth.isGlobalAdmin() ? [
      { labelKey: 'NAV.USERS', icon: 'pi pi-user-edit', routerLink: ['/users'], visible: auth.canRead('users') },
      { labelKey: 'NAV.SETTINGS', icon: 'pi pi-cog', routerLink: ['/settings'], visible: true },
    ].filter(c => c.visible) : [];
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
    return localStorage.getItem('company_name') || this.translate.instant('COMPANY_PROFILE.DEFAULT_NAME');
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
