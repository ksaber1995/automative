import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';
import { AvatarModule } from 'primeng/avatar';
import { BadgeModule } from 'primeng/badge';
import { ConfirmationService } from 'primeng/api';
import { TranslateModule } from '@ngx-translate/core';
import { UserService } from '../services/user.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { SafeUser } from '@shared/interfaces/user.interface';
import { UserRole, ROLE_LABELS, NEW_ROLES } from '@shared/enums/user-role.enum';
import { Branch } from '@shared/interfaces/branch.interface';

@Component({
  selector: 'app-user-list',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    TableModule, ButtonModule, TagModule, SelectModule,
    InputTextModule, ConfirmDialogModule, TooltipModule, AvatarModule, BadgeModule,
    TranslateModule,
  ],
  providers: [ConfirmationService],
  template: `
    <p-confirmDialog></p-confirmDialog>

    <div class="space-y-6">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">{{ 'USERS.LIST.TITLE' | translate }}</h1>
          <p class="text-gray-500 text-sm mt-1">{{ 'USERS.LIST.SUBTITLE' | translate }}</p>
        </div>
        <button pButton [label]="'USERS.LIST.ADD' | translate" icon="pi pi-user-plus"
          class="p-button-primary"
          (click)="router.navigate(['/users/create'])">
        </button>
      </div>

      <!-- Stats Row -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        @for (stat of stats(); track stat.label) {
          <div class="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4">
            <div class="w-10 h-10 rounded-lg flex items-center justify-center" [class]="stat.bg">
              <i [class]="stat.icon + ' text-lg ' + stat.iconColor"></i>
            </div>
            <div>
              <div class="text-2xl font-bold text-gray-900">{{ stat.value }}</div>
              <div class="text-xs text-gray-500">{{ stat.label | translate }}</div>
            </div>
          </div>
        }
      </div>

      <!-- Filters -->
      <div class="bg-white rounded-xl border border-gray-200 p-4">
        <div class="flex flex-wrap gap-4 items-end">
          <div class="flex-1 min-w-48">
            <label class="block text-xs font-medium text-gray-500 mb-1">{{ 'USERS.LIST.SEARCH_PLACEHOLDER' | translate }}</label>
            <span class="p-input-icon-left w-full">
              <i class="pi pi-search"></i>
              <input pInputText type="text" [(ngModel)]="searchTerm"
                [placeholder]="'USERS.LIST.SEARCH_PLACEHOLDER' | translate" class="w-full" />
            </span>
          </div>
          <div class="min-w-44">
            <label class="block text-xs font-medium text-gray-500 mb-1">{{ 'USERS.LIST.ROLE_FILTER' | translate }}</label>
            <p-select [options]="roleOptions" [(ngModel)]="selectedRole"
              [placeholder]="'USERS.LIST.ALL_ROLES' | translate" [showClear]="true" styleClass="w-full"
              (onChange)="applyFilters()">
            </p-select>
          </div>
          <div class="min-w-44">
            <label class="block text-xs font-medium text-gray-500 mb-1">{{ 'USERS.LIST.BRANCH_FILTER' | translate }}</label>
            <p-select [options]="branchOptions()" [(ngModel)]="selectedBranchId"
              optionLabel="name" optionValue="id"
              [placeholder]="'USERS.LIST.ALL_BRANCHES' | translate" [showClear]="true" styleClass="w-full"
              (onChange)="applyFilters()">
            </p-select>
          </div>
          <div class="min-w-44">
            <label class="block text-xs font-medium text-gray-500 mb-1">{{ 'USERS.LIST.STATUS_FILTER' | translate }}</label>
            <p-select [options]="statusOptions" [(ngModel)]="selectedStatus"
              [placeholder]="'USERS.LIST.ALL' | translate" [showClear]="true" styleClass="w-full"
              (onChange)="applyFilters()">
            </p-select>
          </div>
          <button pButton icon="pi pi-filter-slash" [label]="'USERS.LIST.CLEAR' | translate" severity="secondary"
            class="p-button-outlined" (click)="clearFilters()">
          </button>
        </div>
      </div>

      <!-- Table -->
      <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <p-table
          [value]="filteredUsers()"
          [loading]="loading()"
          [paginator]="true"
          [rows]="15"
          [rowsPerPageOptions]="[15, 30, 50]"
          styleClass="p-datatable-sm"
          [globalFilterFields]="['email','firstName','lastName','role']">

          <ng-template pTemplate="header">
            <tr class="bg-gray-50">
              <th class="font-semibold text-gray-600">{{ 'USERS.LIST.COL_USER' | translate }}</th>
              <th class="font-semibold text-gray-600">{{ 'USERS.LIST.COL_ROLE' | translate }}</th>
              <th class="font-semibold text-gray-600">{{ 'USERS.LIST.COL_BRANCHES' | translate }}</th>
              <th class="font-semibold text-gray-600">{{ 'USERS.LIST.COL_LINKED' | translate }}</th>
              <th class="font-semibold text-gray-600">{{ 'USERS.LIST.COL_STATUS' | translate }}</th>
              <th class="font-semibold text-gray-600 text-center">{{ 'USERS.LIST.COL_ACTIONS' | translate }}</th>
            </tr>
          </ng-template>

          <ng-template pTemplate="body" let-user>
            <tr class="hover:bg-gray-50 transition-colors cursor-pointer"
              (click)="openUser(user)">
              <td>
                <div class="flex items-center gap-3">
                  <p-avatar [label]="getInitials(user)" shape="circle"
                    [style]="{ background: getAvatarColor(user.role), color: 'white' }"
                    styleClass="font-semibold text-sm">
                  </p-avatar>
                  <div>
                    <div class="font-medium text-gray-900">
                      {{ user.firstName }} {{ user.lastName }}
                      @if (user.linkedEmployeeId) {
                        <i class="pi pi-link text-blue-400 ml-1 text-xs" [pTooltip]="'USERS.LIST.LINKED_BADGE' | translate"></i>
                      }
                    </div>
                    <div class="text-xs text-gray-400">{{ user.email }}</div>
                  </div>
                </div>
              </td>
              <td>
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                  [class]="getRoleBadgeClass(user.role)">
                  <i [class]="getRoleIcon(user.role) + ' text-xs'"></i>
                  {{ getRoleLabel(user.role) }}
                </span>
              </td>
              <td>
                <div class="flex flex-wrap gap-1">
                  @if (isGlobalRole(user.role)) {
                    <span class="px-2 py-0.5 rounded bg-purple-50 text-purple-700 text-xs font-medium">{{ 'USERS.LIST.ALL_BRANCHES' | translate }}</span>
                  } @else if (user.branchIds?.length) {
                    @for (bId of user.branchIds.slice(0, 2); track bId) {
                      <span class="px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-xs">{{ getBranchName(bId) }}</span>
                    }
                    @if (user.branchIds.length > 2) {
                      <span class="px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-xs">+{{ user.branchIds.length - 2 }}</span>
                    }
                  } @else {
                    <span class="text-gray-400 text-xs">—</span>
                  }
                </div>
              </td>
              <td>
                @if (user.linkedEmployeeId) {
                  <span class="inline-flex items-center gap-1 text-xs text-blue-600">
                    <i class="pi pi-user"></i> {{ 'USERS.LIST.LINKED_BADGE' | translate }}
                  </span>
                } @else {
                  <span class="text-gray-400 text-xs">—</span>
                }
              </td>
              <td>
                <p-tag
                  [value]="user.isActive ? ('USERS.LIST.ACTIVE' | translate) : ('USERS.LIST.INACTIVE' | translate)"
                  [severity]="user.isActive ? 'success' : 'danger'"
                  [style]="{ fontSize: '0.7rem' }">
                </p-tag>
              </td>
              <td (click)="$event.stopPropagation()">
                <div class="flex items-center justify-center gap-1">
                  <button pButton icon="pi pi-pencil" class="p-button-text p-button-sm p-button-rounded"
                    [pTooltip]="'USERS.LIST.EDIT' | translate" (click)="editUser(user)">
                  </button>
                  <button pButton icon="pi pi-shield" class="p-button-text p-button-sm p-button-rounded p-button-info"
                    [pTooltip]="'USERS.LIST.PERMISSIONS' | translate" (click)="editPermissions(user)">
                  </button>
                  @if (user.isActive) {
                    <button pButton icon="pi pi-ban" class="p-button-text p-button-sm p-button-rounded p-button-danger"
                      [pTooltip]="'USERS.LIST.DEACTIVATE' | translate" (click)="toggleActive(user)">
                    </button>
                  } @else {
                    <button pButton icon="pi pi-check-circle" class="p-button-text p-button-sm p-button-rounded p-button-success"
                      [pTooltip]="'USERS.LIST.ACTIVATE' | translate" (click)="toggleActive(user)">
                    </button>
                  }
                </div>
              </td>
            </tr>
          </ng-template>

          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="6" class="text-center py-12">
                <i class="pi pi-users text-4xl text-gray-300 mb-3 block"></i>
                <p class="text-gray-400">{{ 'USERS.LIST.NO_DATA' | translate }}</p>
                <button pButton [label]="'USERS.LIST.CREATE_FIRST' | translate" icon="pi pi-plus"
                  class="p-button-text mt-3" (click)="router.navigate(['/users/create'])">
                </button>
              </td>
            </tr>
          </ng-template>
        </p-table>
      </div>
    </div>
  `,
})
export class UserListComponent implements OnInit {
  router = inject(Router);
  private userService = inject(UserService);
  private branchService = inject(BranchService);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);

  users = signal<SafeUser[]>([]);
  branches = signal<Branch[]>([]);
  loading = signal(true);

  searchTerm = '';
  selectedRole: string | null = null;
  selectedBranchId: string | null = null;
  selectedStatus: boolean | null = null;

  roleOptions = [
    { label: 'Global Admin', value: UserRole.GLOBAL_ADMIN },
    { label: 'Branch Admin', value: UserRole.BRANCH_ADMIN },
    { label: 'Academic Manager', value: UserRole.ACADEMIC_MANAGER },
    { label: 'Sales Manager', value: UserRole.SALES_MANAGER },
    { label: 'Viewer', value: UserRole.VIEWER },
    { label: 'Accountant', value: UserRole.ACCOUNTANT },
  ];

  statusOptions = [
    { label: 'Active', value: true },
    { label: 'Inactive', value: false },
  ];

  branchOptions = computed(() => this.branches());

  filteredUsers = computed(() => {
    let result = this.users();
    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      result = result.filter(u =>
        u.firstName.toLowerCase().includes(term) ||
        u.lastName.toLowerCase().includes(term) ||
        u.email.toLowerCase().includes(term)
      );
    }
    if (this.selectedRole) result = result.filter(u => u.role === this.selectedRole);
    if (this.selectedBranchId) {
      result = result.filter(u =>
        u.branchId === this.selectedBranchId ||
        u.branchIds?.includes(this.selectedBranchId!)
      );
    }
    if (this.selectedStatus !== null) {
      result = result.filter(u => u.isActive === this.selectedStatus);
    }
    return result;
  });

  stats = computed(() => {
    const all = this.users();
    return [
      { label: 'USERS.LIST.TOTAL', value: all.length, icon: 'pi pi-users', bg: 'bg-blue-50', iconColor: 'text-blue-500' },
      { label: 'USERS.LIST.ACTIVE_LABEL', value: all.filter(u => u.isActive).length, icon: 'pi pi-check-circle', bg: 'bg-green-50', iconColor: 'text-green-500' },
      { label: 'USERS.LIST.GLOBAL_ADMINS', value: all.filter(u => u.role === UserRole.GLOBAL_ADMIN || u.role === UserRole.ADMIN).length, icon: 'pi pi-crown', bg: 'bg-purple-50', iconColor: 'text-purple-500' },
      { label: 'USERS.LIST.LINKED', value: all.filter(u => u.linkedEmployeeId).length, icon: 'pi pi-link', bg: 'bg-orange-50', iconColor: 'text-orange-500' },
    ];
  });

  ngOnInit() {
    this.branchService.getActiveBranches().subscribe({
      next: (branches) => this.branches.set(branches),
    });
    this.loadUsers();
  }

  loadUsers() {
    this.loading.set(true);
    this.userService.list().subscribe({
      next: ({ users }) => {
        this.users.set(users);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  applyFilters() {
    // filteredUsers is a computed signal, no action needed
  }

  clearFilters() {
    this.searchTerm = '';
    this.selectedRole = null;
    this.selectedBranchId = null;
    this.selectedStatus = null;
  }

  openUser(user: SafeUser) {
    this.router.navigate(['/users', user.id]);
  }

  editUser(user: SafeUser) {
    this.router.navigate(['/users', user.id, 'edit']);
  }

  editPermissions(user: SafeUser) {
    this.router.navigate(['/users', user.id, 'permissions']);
  }

  toggleActive(user: SafeUser) {
    const action = user.isActive ? 'deactivate' : 'activate';
    this.confirmationService.confirm({
      message: `Are you sure you want to ${action} ${user.firstName} ${user.lastName}?`,
      header: `${action.charAt(0).toUpperCase() + action.slice(1)} User`,
      icon: user.isActive ? 'pi pi-ban' : 'pi pi-check',
      accept: () => {
        const call = user.isActive
          ? this.userService.deactivate(user.id)
          : this.userService.activate(user.id);
        call.subscribe({
          next: () => {
            this.notificationService.success(`User ${action}d successfully`);
            this.loadUsers();
          },
          error: (e) => this.notificationService.error(e.error?.message || `Failed to ${action} user`),
        });
      }
    });
  }

  getInitials(user: SafeUser): string {
    return `${user.firstName[0] || ''}${user.lastName[0] || ''}`.toUpperCase();
  }

  getAvatarColor(role: string): string {
    const map: Record<string, string> = {
      GLOBAL_ADMIN: '#7C3AED',
      ADMIN: '#7C3AED',
      BRANCH_ADMIN: '#2563EB',
      BRANCH_MANAGER: '#2563EB',
      ACADEMIC_MANAGER: '#059669',
      SALES_MANAGER: '#D97706',
      ACCOUNTANT: '#0891B2',
      VIEWER: '#6B7280',
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
      GLOBAL_ADMIN: 'pi pi-crown',
      ADMIN: 'pi pi-crown',
      BRANCH_ADMIN: 'pi pi-building',
      BRANCH_MANAGER: 'pi pi-building',
      ACADEMIC_MANAGER: 'pi pi-book',
      SALES_MANAGER: 'pi pi-shopping-cart',
      ACCOUNTANT: 'pi pi-calculator',
      VIEWER: 'pi pi-eye',
    };
    return map[role] || 'pi pi-user';
  }

  isGlobalRole(role: string): boolean {
    return role === UserRole.GLOBAL_ADMIN || role === UserRole.ADMIN;
  }

  getBranchName(branchId: string): string {
    return this.branches().find(b => b.id === branchId)?.name || branchId.slice(0, 8) + '…';
  }
}
