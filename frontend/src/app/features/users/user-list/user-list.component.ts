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
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { UserService } from '../services/user.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
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
  templateUrl: './user-list.component.html',
})
export class UserListComponent implements OnInit {
  router = inject(Router);
  private userService = inject(UserService);
  private branchService = inject(BranchService);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);
  private authService = inject(AuthService);
  private translate = inject(TranslateService);

  currentUserId = computed(() => this.authService.currentUser()?.id);

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
    // Include deactivated branches so users still assigned to one render with
    // the correct branch name in the list/filter.
    this.branchService.getAllBranches().subscribe({
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
    const isDeactivating = user.isActive;
    const name = `${user.firstName} ${user.lastName}`;
    this.confirmationService.confirm({
      message: this.translate.instant(
        isDeactivating ? 'USERS.DEACTIVATE_CONFIRM' : 'USERS.ACTIVATE_CONFIRM',
        { name }
      ),
      header: this.translate.instant(
        isDeactivating ? 'USERS.DEACTIVATE_HEADER' : 'USERS.ACTIVATE_HEADER'
      ),
      icon: isDeactivating ? 'pi pi-ban' : 'pi pi-check',
      accept: () => {
        const call = isDeactivating
          ? this.userService.deactivate(user.id)
          : this.userService.activate(user.id);
        call.subscribe({
          next: () => {
            this.notificationService.success(
              this.translate.instant(isDeactivating ? 'USERS.DEACTIVATED' : 'USERS.ACTIVATED')
            );
            this.loadUsers();
          },
          error: () => {
            // Interceptor toasted the translated error.
          },
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
