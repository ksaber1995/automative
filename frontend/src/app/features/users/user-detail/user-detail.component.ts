import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DividerModule } from 'primeng/divider';
import { DialogModule } from 'primeng/dialog';
import { PasswordModule } from 'primeng/password';
import { TabsModule, Tab, TabList, TabPanel, TabPanels } from 'primeng/tabs';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { TranslateModule } from '@ngx-translate/core';
import { UserService } from '../services/user.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { SafeUser } from '@shared/interfaces/user.interface';
import { UserRole, ROLE_LABELS } from '@shared/enums/user-role.enum';
import {
  PERMISSION_RESOURCES, ROLE_DEFAULT_PERMISSIONS, PermissionResource,
} from '@shared/interfaces/permissions.interface';
import { Branch } from '@shared/interfaces/branch.interface';

const RESOURCE_META: Record<PermissionResource, { label: string; icon: string; financial?: boolean }> = {
  dashboard:    { label: 'Dashboard',      icon: 'pi pi-home' },
  branches:     { label: 'Branches',       icon: 'pi pi-building' },
  courses:      { label: 'Courses',        icon: 'pi pi-book' },
  master_courses: { label: 'Master Courses', icon: 'pi pi-th-large' },
  events:       { label: 'Events',          icon: 'pi pi-flag' },
  classes:      { label: 'Classes',        icon: 'pi pi-calendar' },
  students:     { label: 'Students',       icon: 'pi pi-users' },
  enrollments:  { label: 'Enrollments',    icon: 'pi pi-id-card' },
  employees:    { label: 'Employees',      icon: 'pi pi-user' },
  revenues:     { label: 'Revenues',       icon: 'pi pi-dollar',      financial: true },
  expenses:     { label: 'Expenses',       icon: 'pi pi-money-bill',  financial: true },
  withdrawals:  { label: 'Withdrawals',    icon: 'pi pi-wallet',      financial: true },
  refunds:      { label: 'Refunds',        icon: 'pi pi-replay',      financial: true },
  debts:        { label: 'Debts',          icon: 'pi pi-credit-card', financial: true },
  products:     { label: 'Products',       icon: 'pi pi-box' },
  product_sales:{ label: 'Product Sales',  icon: 'pi pi-shopping-cart' },
  reports:      { label: 'Reports',        icon: 'pi pi-chart-bar',   financial: true },
  users:        { label: 'User Mgmt',      icon: 'pi pi-user-edit' },
  rooms:        { label: 'Rooms',          icon: 'pi pi-building' },
  sessions:     { label: 'Sessions',       icon: 'pi pi-clock' },
  timetable:    { label: 'Timetable',      icon: 'pi pi-calendar-clock' },
};

@Component({
  selector: 'app-user-detail',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    CardModule, ButtonModule, TagModule, DividerModule, DialogModule,
    PasswordModule, TabsModule, Tab, TabList, TabPanel, TabPanels, TooltipModule, ConfirmDialogModule,
    TranslateModule,
  ],
  providers: [ConfirmationService],
  template: `
    <p-confirmDialog></p-confirmDialog>

    @if (loading()) {
      <div class="flex justify-center py-20">
        <i class="pi pi-spin pi-spinner text-4xl text-gray-300"></i>
      </div>
    } @else if (user()) {
      <div class="max-w-5xl mx-auto space-y-6">

        <!-- Header -->
        <div class="flex items-start justify-between">
          <div class="flex items-center gap-4">
            <button pButton icon="pi pi-arrow-left" class="p-button-text p-button-rounded p-button-secondary"
              (click)="back()">
            </button>
            <div class="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-xl font-bold"
              [style.background]="getAvatarColor(user()!.role)">
              {{ getInitials(user()!) }}
            </div>
            <div>
              <h1 class="text-2xl font-bold text-gray-900">{{ user()!.firstName }} {{ user()!.lastName }}</h1>
              <div class="flex items-center gap-2 mt-1">
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                  [class]="getRoleBadgeClass(user()!.role)">
                  <i [class]="getRoleIcon(user()!.role) + ' text-xs'"></i>
                  {{ getRoleLabel(user()!.role) }}
                </span>
                <p-tag [value]="user()!.isActive ? ('USERS.DETAIL.ACTIVE' | translate) : ('USERS.DETAIL.INACTIVE' | translate)"
                  [severity]="user()!.isActive ? 'success' : 'danger'"
                  [style]="{ fontSize: '0.7rem' }">
                </p-tag>
                @if (user()!.linkedEmployeeId) {
                  <span class="inline-flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-full">
                    <i class="pi pi-link"></i> {{ 'USERS.LIST.LINKED_BADGE' | translate }}
                  </span>
                }
              </div>
            </div>
          </div>
          <div class="flex gap-2">
            <button pButton icon="pi pi-pencil" [label]="'USERS.DETAIL.EDIT' | translate" severity="warn"
              (click)="edit()">
            </button>
            @if (!isSelf()) {
              @if (user()!.isActive) {
                <button pButton icon="pi pi-ban" [label]="'USERS.DETAIL.DEACTIVATE' | translate" severity="danger"
                  class="p-button-outlined" (click)="toggleActive()">
                </button>
              } @else {
                <button pButton icon="pi pi-check" [label]="'USERS.DETAIL.ACTIVATE' | translate" severity="success"
                  class="p-button-outlined" (click)="toggleActive()">
                </button>
              }
            }
          </div>
        </div>

        <p-tabs value="0">
          <p-tablist>
            <p-tab value="0"><i class="pi pi-user mr-2"></i>{{ 'USERS.DETAIL.TAB_INFO' | translate }}</p-tab>
            <p-tab value="1"><i class="pi pi-shield mr-2"></i>{{ 'USERS.DETAIL.TAB_PERMISSIONS' | translate }}</p-tab>
          </p-tablist>
          <p-tabpanels>
          <!-- Info Tab -->
          <p-tabpanel value="0">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
              <p-card>
                <ng-template pTemplate="header">
                  <div class="flex items-center gap-2 px-4 pt-4">
                    <i class="pi pi-info-circle text-blue-500"></i>
                    <span class="font-semibold text-gray-700">{{ 'USERS.DETAIL.ACCOUNT_DETAILS' | translate }}</span>
                  </div>
                </ng-template>
                <div class="space-y-3">
                  <div class="flex justify-between text-sm">
                    <span class="text-gray-500">{{ 'USERS.DETAIL.EMAIL' | translate }}</span>
                    <span class="font-medium">{{ user()!.email }}</span>
                  </div>
                  <p-divider styleClass="my-2"></p-divider>
                  <div class="flex justify-between text-sm">
                    <span class="text-gray-500">{{ 'USERS.DETAIL.ROLE' | translate }}</span>
                    <span class="font-medium">{{ getRoleLabel(user()!.role) }}</span>
                  </div>
                  <p-divider styleClass="my-2"></p-divider>
                  <div class="flex justify-between text-sm">
                    <span class="text-gray-500">{{ 'USERS.DETAIL.CREATED' | translate }}</span>
                    <span class="font-medium">{{ user()!.createdAt | date:'mediumDate' }}</span>
                  </div>
                  <p-divider styleClass="my-2"></p-divider>
                  <div class="flex justify-between text-sm">
                    <span class="text-gray-500">{{ 'USERS.DETAIL.STATUS' | translate }}</span>
                    <p-tag [value]="user()!.isActive ? ('USERS.DETAIL.ACTIVE' | translate) : ('USERS.DETAIL.INACTIVE' | translate)"
                      [severity]="user()!.isActive ? 'success' : 'danger'">
                    </p-tag>
                  </div>
                </div>
              </p-card>

              <p-card>
                <ng-template pTemplate="header">
                  <div class="flex items-center gap-2 px-4 pt-4">
                    <i class="pi pi-building text-green-500"></i>
                    <span class="font-semibold text-gray-700">{{ 'USERS.DETAIL.BRANCH_ACCESS' | translate }}</span>
                  </div>
                </ng-template>
                <div class="space-y-2">
                  @if (user()!.role === UserRole.GLOBAL_ADMIN || user()!.role === UserRole.ADMIN) {
                    <div class="flex items-center gap-2 p-3 bg-purple-50 rounded-lg">
                      <i class="pi pi-crown text-purple-500"></i>
                      <span class="text-sm font-medium text-purple-700">{{ 'USERS.DETAIL.ALL_BRANCHES' | translate }}</span>
                    </div>
                  } @else if (userBranches().length) {
                    @for (branch of userBranches(); track branch.id) {
                      <div class="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                        <i class="pi pi-building text-gray-400"></i>
                        <span class="text-sm font-medium">{{ branch.name }}</span>
                        @if (branch.id === user()!.branchId) {
                          <span class="ml-auto text-xs text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded">{{ 'USERS.DETAIL.PRIMARY' | translate }}</span>
                        }
                      </div>
                    }
                  } @else {
                    <div class="text-gray-400 text-sm text-center py-4">{{ 'USERS.DETAIL.NO_BRANCHES' | translate }}</div>
                  }
                </div>
              </p-card>
            </div>

            <!-- Reset Password -->
            <div class="mt-6 p-4 bg-gray-50 rounded-xl border border-gray-200">
              <div class="flex items-center justify-between">
                <div>
                  <p class="font-medium text-gray-700">{{ 'USERS.DETAIL.RESET_PASSWORD_LABEL' | translate }}</p>
                  <p class="text-xs text-gray-400 mt-0.5">{{ 'USERS.DETAIL.RESET_PASSWORD_DESC' | translate }}</p>
                </div>
                <button pButton icon="pi pi-key" [label]="'USERS.DETAIL.RESET_PASSWORD_BTN' | translate" severity="secondary"
                  class="p-button-outlined" (click)="showPasswordDialog = true">
                </button>
              </div>
            </div>
          </p-tabpanel>

          <!-- Permissions Tab -->
          <p-tabpanel value="1">
            <div class="pt-4">
              <div class="flex items-center justify-between mb-4">
                <p class="text-sm text-gray-500">
                  {{ 'USERS.DETAIL.EFFECTIVE_PERM' | translate }}
                  <strong>{{ getRoleLabel(user()!.role) }}</strong>
                  @if (user()!.permissions) {
                    {{ 'USERS.DETAIL.CUSTOM_OVERRIDES' | translate }}
                  }
                </p>
                <button pButton icon="pi pi-pencil" [label]="'USERS.DETAIL.EDIT_PERMISSIONS' | translate"
                  class="p-button-sm p-button-outlined"
                  (click)="edit()">
                </button>
              </div>

              <div class="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <table class="w-full text-sm">
                  <thead class="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th class="text-left px-4 py-3 font-semibold text-gray-600">{{ 'USERS.DETAIL.COL_RESOURCE' | translate }}</th>
                      <th class="text-center px-4 py-3 font-semibold text-gray-600">{{ 'USERS.DETAIL.COL_READ' | translate }}</th>
                      <th class="text-center px-4 py-3 font-semibold text-gray-600">{{ 'USERS.DETAIL.COL_WRITE' | translate }}</th>
                      <th class="text-center px-4 py-3 font-semibold text-gray-600">{{ 'USERS.DETAIL.COL_DELETE' | translate }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (resource of allResources; track resource) {
                      <tr class="border-b border-gray-100 hover:bg-gray-50"
                        [class.bg-amber-50]="RESOURCE_META[resource].financial">
                        <td class="px-4 py-2.5">
                          <div class="flex items-center gap-2">
                            <i [class]="RESOURCE_META[resource].icon + ' text-gray-400 text-sm'"></i>
                            <span class="text-gray-700">{{ RESOURCE_META[resource].label }}</span>
                            @if (RESOURCE_META[resource].financial) {
                              <span class="text-xs text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">{{ 'USERS.FORM.SECTION_FINANCIAL' | translate }}</span>
                            }
                          </div>
                        </td>
                        @for (action of ['read', 'write', 'delete']; track action) {
                          <td class="text-center px-4 py-2.5">
                            @if (getEffectivePerm(resource, $any(action))) {
                              <i class="pi pi-check-circle text-green-500 text-base"></i>
                            } @else {
                              <i class="pi pi-times-circle text-gray-300 text-base"></i>
                            }
                          </td>
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          </p-tabpanel>
          </p-tabpanels>
        </p-tabs>
      </div>
    }

    <!-- Reset Password Dialog -->
    <p-dialog [(visible)]="showPasswordDialog" [header]="'USERS.DETAIL.RESET_TITLE' | translate" [modal]="true"
      [style]="{ width: '400px' }">
      <div class="space-y-4 py-2">
        <p class="text-sm text-gray-500">
          {{ 'USERS.DETAIL.RESET_FOR' | translate }} <strong>{{ user()?.firstName }} {{ user()?.lastName }}</strong>
        </p>
        <p-password [(ngModel)]="newPassword" [toggleMask]="true" [feedback]="true"
          [placeholder]="'USERS.DETAIL.NEW_PASSWORD' | translate"
          styleClass="w-full" [inputStyleClass]="'w-full'">
        </p-password>
      </div>
      <ng-template pTemplate="footer">
        <button pButton [label]="'USERS.DETAIL.CANCEL' | translate" severity="secondary" class="p-button-outlined"
          (click)="showPasswordDialog = false; newPassword = ''">
        </button>
        <button pButton [label]="'USERS.DETAIL.RESET' | translate" icon="pi pi-key" [loading]="savingPassword()"
          (click)="resetPassword()">
        </button>
      </ng-template>
    </p-dialog>
  `,
})
export class UserDetailComponent implements OnInit {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private userService = inject(UserService);
  private branchService = inject(BranchService);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);
  private authService = inject(AuthService);

  UserRole = UserRole;
  RESOURCE_META = RESOURCE_META;
  allResources = PERMISSION_RESOURCES;

  user = signal<SafeUser | null>(null);
  branches = signal<Branch[]>([]);
  loading = signal(true);
  savingPassword = signal(false);

  isSelf = computed(() => this.authService.currentUser()?.id === this.user()?.id);

  showPasswordDialog = false;
  newPassword = '';

  userBranches = () =>
    (this.user()?.branchIds ?? (this.user()?.branchId ? [this.user()!.branchId!] : []))
      .map(id => this.branches().find(b => b.id === id))
      .filter(Boolean) as Branch[];

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.branchService.getActiveBranches().subscribe({ next: (b) => this.branches.set(b) });
    this.userService.get(id).subscribe({
      next: (user) => { this.user.set(user); this.loading.set(false); },
      error: () => { this.notificationService.error('User not found'); this.loading.set(false); }
    });
  }

  back() { this.router.navigate(['/users']); }
  edit() { this.router.navigate(['/users', this.user()!.id, 'edit']); }

  toggleActive() {
    const u = this.user()!;
    const action = u.isActive ? 'deactivate' : 'activate';
    this.confirmationService.confirm({
      message: `${action.charAt(0).toUpperCase() + action.slice(1)} ${u.firstName} ${u.lastName}?`,
      header: `${action.charAt(0).toUpperCase() + action.slice(1)} User`,
      accept: () => {
        const call = u.isActive ? this.userService.deactivate(u.id) : this.userService.activate(u.id);
        call.subscribe({
          next: () => {
            this.notificationService.success(`User ${action}d`);
            this.user.update(prev => prev ? { ...prev, isActive: !prev.isActive } : prev);
          },
          error: (e) => this.notificationService.error(e.error?.message || `Failed`),
        });
      }
    });
  }

  resetPassword() {
    if (!this.newPassword || this.newPassword.length < 6) {
      this.notificationService.error('Password must be at least 6 characters');
      return;
    }
    this.savingPassword.set(true);
    this.userService.resetPassword(this.user()!.id, this.newPassword).subscribe({
      next: () => {
        this.notificationService.success('Password reset successfully');
        this.showPasswordDialog = false;
        this.newPassword = '';
        this.savingPassword.set(false);
      },
      error: (e) => {
        this.notificationService.error(e.error?.message || 'Failed to reset password');
        this.savingPassword.set(false);
      }
    });
  }

  getEffectivePerm(resource: PermissionResource, action: 'read' | 'write' | 'delete'): boolean {
    const u = this.user();
    if (!u) return false;
    const custom = u.permissions?.[resource]?.[action];
    if (custom !== undefined) return custom as boolean;
    const role = u.role as UserRole;
    return ROLE_DEFAULT_PERMISSIONS[role]?.[resource]?.[action] ?? false;
  }

  getInitials(user: SafeUser): string {
    return `${user.firstName[0] || ''}${user.lastName[0] || ''}`.toUpperCase();
  }

  getAvatarColor(role: string): string {
    const map: Record<string, string> = {
      GLOBAL_ADMIN: '#7C3AED', ADMIN: '#7C3AED',
      BRANCH_ADMIN: '#2563EB', BRANCH_MANAGER: '#2563EB',
      ACADEMIC_MANAGER: '#059669', SALES_MANAGER: '#D97706',
      ACCOUNTANT: '#0891B2', VIEWER: '#6B7280',
    };
    return map[role] || '#6B7280';
  }

  getRoleLabel(role: string): string {
    return ROLE_LABELS[role as UserRole] || role;
  }

  getRoleBadgeClass(role: string): string {
    const map: Record<string, string> = {
      GLOBAL_ADMIN: 'bg-purple-100 text-purple-700',
      ADMIN: 'bg-purple-100 text-purple-700',
      BRANCH_ADMIN: 'bg-blue-100 text-blue-700',
      BRANCH_MANAGER: 'bg-blue-100 text-blue-700',
      ACADEMIC_MANAGER: 'bg-emerald-100 text-emerald-700',
      SALES_MANAGER: 'bg-amber-100 text-amber-700',
      ACCOUNTANT: 'bg-cyan-100 text-cyan-700',
      VIEWER: 'bg-gray-100 text-gray-600',
    };
    return map[role] || 'bg-gray-100 text-gray-600';
  }

  getRoleIcon(role: string): string {
    const map: Record<string, string> = {
      GLOBAL_ADMIN: 'pi pi-crown', ADMIN: 'pi pi-crown',
      BRANCH_ADMIN: 'pi pi-building', BRANCH_MANAGER: 'pi pi-building',
      ACADEMIC_MANAGER: 'pi pi-book', SALES_MANAGER: 'pi pi-shopping-cart',
      ACCOUNTANT: 'pi pi-calculator', VIEWER: 'pi pi-eye',
    };
    return map[role] || 'pi pi-user';
  }
}
