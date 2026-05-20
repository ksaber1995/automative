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
import { TranslateModule, TranslateService } from '@ngx-translate/core';
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

const RESOURCE_META: Record<PermissionResource, { label: string; icon: string; hint?: string; financial?: boolean }> = {
  dashboard:    { label: 'USERS.FORM.RESOURCE_DASHBOARD',     icon: 'pi pi-home' },
  branches:     { label: 'USERS.FORM.RESOURCE_BRANCHES',      icon: 'pi pi-building' },
  academy:      { label: 'USERS.FORM.RESOURCE_ACADEMY',       icon: 'pi pi-graduation-cap',
    hint: 'USERS.FORM.RESOURCE_ACADEMY_HINT' },
  students:     { label: 'USERS.FORM.RESOURCE_STUDENTS',      icon: 'pi pi-users' },
  enrollments:  { label: 'USERS.FORM.RESOURCE_ENROLLMENTS',   icon: 'pi pi-id-card' },
  employees:    { label: 'USERS.FORM.RESOURCE_EMPLOYEES',     icon: 'pi pi-user' },
  revenues:     { label: 'USERS.FORM.RESOURCE_REVENUES',      icon: 'pi pi-dollar',      financial: true },
  expenses:     { label: 'USERS.FORM.RESOURCE_EXPENSES',      icon: 'pi pi-money-bill',  financial: true },
  refunds:      { label: 'USERS.FORM.RESOURCE_REFUNDS',       icon: 'pi pi-replay',      financial: true },
  debts:        { label: 'USERS.FORM.RESOURCE_DEBTS',         icon: 'pi pi-credit-card', financial: true },
  products:     { label: 'USERS.FORM.RESOURCE_PRODUCTS',      icon: 'pi pi-box' },
  product_sales:{ label: 'USERS.FORM.RESOURCE_PRODUCT_SALES', icon: 'pi pi-shopping-cart' },
  reports:      { label: 'USERS.FORM.RESOURCE_REPORTS',       icon: 'pi pi-chart-bar',   financial: true },
  users:        { label: 'USERS.FORM.RESOURCE_USERS',         icon: 'pi pi-user-edit' },
  cash:         { label: 'USERS.FORM.RESOURCE_CASH',          icon: 'pi pi-wallet',      financial: true,
    hint: 'USERS.FORM.RESOURCE_CASH_HINT' },
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
  templateUrl: './user-detail.component.html',
})
export class UserDetailComponent implements OnInit {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private userService = inject(UserService);
  private branchService = inject(BranchService);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);
  private authService = inject(AuthService);
  private translate = inject(TranslateService);

  UserRole = UserRole;
  RESOURCE_META = RESOURCE_META;
  allResources = PERMISSION_RESOURCES;

  user = signal<SafeUser | null>(null);
  branches = signal<Branch[]>([]);
  loading = signal(true);
  savingPassword = signal(false);

  isSelf = computed(() => this.authService.currentUser()?.id === this.user()?.id);
  canDelete = computed(() => this.authService.isGlobalAdmin() && !this.isSelf() && !!this.user());

  showPasswordDialog = false;
  newPassword = '';

  userBranches = () =>
    (this.user()?.branchIds ?? (this.user()?.branchId ? [this.user()!.branchId!] : []))
      .map(id => this.branches().find(b => b.id === id))
      .filter(Boolean) as Branch[];

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    // Include deactivated branches so the user's assigned branches still
    // resolve to a name when a branch has been deactivated.
    this.branchService.getAllBranches().subscribe({ next: (b) => this.branches.set(b) });
    this.userService.get(id).subscribe({
      next: (user) => { this.user.set(user); this.loading.set(false); },
      error: () => {
        // Interceptor toasted the translated error.
        this.loading.set(false);
      }
    });
  }

  back() { this.router.navigate(['/users']); }
  edit() { this.router.navigate(['/users', this.user()!.id, 'edit']); }

  toggleActive() {
    const u = this.user()!;
    const isDeactivating = u.isActive;
    const name = `${u.firstName} ${u.lastName}`;
    this.confirmationService.confirm({
      message: this.translate.instant(
        isDeactivating ? 'USERS.DEACTIVATE_CONFIRM' : 'USERS.ACTIVATE_CONFIRM',
        { name }
      ),
      header: this.translate.instant(
        isDeactivating ? 'USERS.DEACTIVATE_HEADER' : 'USERS.ACTIVATE_HEADER'
      ),
      accept: () => {
        const call = isDeactivating ? this.userService.deactivate(u.id) : this.userService.activate(u.id);
        call.subscribe({
          next: () => {
            this.notificationService.success(
              this.translate.instant(isDeactivating ? 'USERS.DEACTIVATED' : 'USERS.ACTIVATED')
            );
            this.user.update(prev => prev ? { ...prev, isActive: !prev.isActive } : prev);
          },
          error: () => {
            // Interceptor toasted the translated error.
          },
        });
      }
    });
  }

  deleteUser() {
    const u = this.user();
    if (!u) return;
    const name = `${u.firstName} ${u.lastName}`;
    this.confirmationService.confirm({
      header: this.translate.instant('USERS.DETAIL.DELETE_HEADER'),
      message: this.translate.instant('USERS.DETAIL.DELETE_CONFIRM', { name }),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.userService.delete(u.id).subscribe({
          next: () => {
            this.notificationService.success(this.translate.instant('USERS.DETAIL.DELETED'));
            this.router.navigate(['/users']);
          },
          error: () => {
            // Interceptor toasted the translated error.
          },
        });
      },
    });
  }

  resetPassword() {
    if (!this.newPassword || this.newPassword.length < 6) {
      this.notificationService.error(this.translate.instant('USERS.PASSWORD_TOO_SHORT'));
      return;
    }
    this.savingPassword.set(true);
    this.userService.resetPassword(this.user()!.id, this.newPassword).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('USERS.PASSWORD_RESET'));
        this.showPasswordDialog = false;
        this.newPassword = '';
        this.savingPassword.set(false);
      },
      error: () => {
        // Interceptor toasted the translated error.
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
