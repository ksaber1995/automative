import { Component, signal, OnInit, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
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

interface NavItem {
  labelKey?: string;
  icon?: string;
  routerLink?: string[];
  separator?: boolean;
  sectionLabel?: boolean;
  visible: boolean;
}

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
          <nav class="p-4">
            <div class="space-y-0.5">
              @for (item of visibleMenuItems(); track $index) {
                @if (item.sectionLabel) {
                  <div class="px-3 pt-4 pb-1 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    {{ item.labelKey! | translate }}
                  </div>
                } @else if (item.separator) {
                  <div class="border-t border-gray-100 my-2"></div>
                } @else {
                  <a
                    [routerLink]="item.routerLink"
                    routerLinkActive="bg-blue-50 text-blue-600 border-blue-500"
                    [routerLinkActiveOptions]="{ exact: item.routerLink?.length === 1 }"
                    class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-all border-l-4 border-transparent text-sm"
                    [class.border-r-4]="languageService.isRtl()"
                    [class.border-l-4]="!languageService.isRtl()">
                    <i [class]="item.icon + ' text-base'"></i>
                    <span class="font-medium">{{ item.labelKey! | translate }}</span>
                  </a>
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
  }

  // ─── Computed menu (permission-aware) ────────────────────────────────────

  visibleMenuItems = computed<NavItem[]>(() => {
    const auth = this.authService;
    const all: NavItem[] = [
      {
        labelKey: 'NAV.DASHBOARD', icon: 'pi pi-home', routerLink: ['/dashboard'],
        visible: auth.canRead('dashboard'),
      },
      { separator: true, visible: true },
      { labelKey: 'NAV.SECTIONS.MANAGEMENT', sectionLabel: true, visible: true },
      {
        labelKey: 'NAV.BRANCHES', icon: 'pi pi-building', routerLink: ['/branches'],
        visible: auth.canRead('branches'),
      },
      {
        labelKey: 'NAV.COURSES', icon: 'pi pi-book', routerLink: ['/courses'],
        visible: auth.canRead('courses'),
      },
      {
        labelKey: 'NAV.MASTER_COURSES', icon: 'pi pi-th-large', routerLink: ['/master-courses'],
        visible: auth.canRead('master_courses'),
      },
      {
        labelKey: 'NAV.EVENTS', icon: 'pi pi-flag', routerLink: ['/events'],
        visible: auth.canRead('events'),
      },
      {
        labelKey: 'NAV.CLASSES', icon: 'pi pi-calendar', routerLink: ['/classes'],
        visible: auth.canRead('classes'),
      },
      {
        labelKey: 'NAV.ROOMS', icon: 'pi pi-building', routerLink: ['/rooms'],
        visible: auth.canRead('branches'),
      },
      {
        labelKey: 'NAV.SESSIONS', icon: 'pi pi-clock', routerLink: ['/sessions'],
        visible: auth.canRead('branches'),
      },
      {
        labelKey: 'NAV.TIMETABLE', icon: 'pi pi-calendar-clock', routerLink: ['/timetable'],
        visible: auth.canRead('classes'),
      },
      {
        labelKey: 'NAV.STUDENTS', icon: 'pi pi-users', routerLink: ['/students'],
        visible: auth.canRead('students'),
      },
      {
        labelKey: 'NAV.EMPLOYEES', icon: 'pi pi-user', routerLink: ['/employees'],
        visible: auth.canRead('employees'),
      },
      { separator: true, visible: auth.canAccessFinancials() },
      { labelKey: 'NAV.SECTIONS.FINANCIAL', sectionLabel: true, visible: auth.canAccessFinancials() },
      {
        labelKey: 'NAV.REVENUES', icon: 'pi pi-dollar', routerLink: ['/revenues'],
        visible: auth.canRead('revenues'),
      },
      {
        labelKey: 'NAV.EXPENSES', icon: 'pi pi-money-bill', routerLink: ['/expenses'],
        visible: auth.canRead('expenses'),
      },
      {
        labelKey: 'NAV.WITHDRAWALS', icon: 'pi pi-wallet', routerLink: ['/withdrawals'],
        visible: auth.canRead('withdrawals'),
      },
      {
        labelKey: 'NAV.REFUNDS', icon: 'pi pi-replay', routerLink: ['/refunds'],
        visible: auth.canRead('refunds'),
      },
      {
        labelKey: 'NAV.DUES', icon: 'pi pi-credit-card', routerLink: ['/dues'],
        visible: auth.canRead('enrollments'),
      },
      { separator: true, visible: auth.canRead('products') },
      { labelKey: 'NAV.SECTIONS.INVENTORY', sectionLabel: true, visible: auth.canRead('products') },
      {
        labelKey: 'NAV.PRODUCTS', icon: 'pi pi-box', routerLink: ['/products/list'],
        visible: auth.canRead('products'),
      },
      {
        labelKey: 'NAV.SELL_PRODUCT', icon: 'pi pi-shopping-cart', routerLink: ['/products/sell'],
        visible: auth.canWrite('product_sales'),
      },
      {
        labelKey: 'NAV.SALES_HISTORY', icon: 'pi pi-history', routerLink: ['/products/sales'],
        visible: auth.canRead('product_sales'),
      },
      { separator: true, visible: auth.canRead('reports') },
      {
        labelKey: 'NAV.REPORTS', icon: 'pi pi-chart-bar', routerLink: ['/reports'],
        visible: auth.canRead('reports'),
      },
      { separator: true, visible: true },
      {
        labelKey: 'NAV.USERS', icon: 'pi pi-user-edit', routerLink: ['/users'],
        visible: auth.canRead('users'),
      },
      {
        labelKey: 'NAV.SETTINGS', icon: 'pi pi-cog', routerLink: ['/settings'],
        visible: true,
      },
    ];

    return all.filter(item => item.visible);
  });

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
