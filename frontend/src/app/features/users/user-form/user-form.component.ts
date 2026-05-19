import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { DividerModule } from 'primeng/divider';
import { TabsModule, Tab, TabList, TabPanel, TabPanels } from 'primeng/tabs';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { UserService } from '../services/user.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { SafeUser } from '@shared/interfaces/user.interface';
import { UserRole, ROLE_LABELS, NEW_ROLES } from '@shared/enums/user-role.enum';
import {
  UserPermissions, PERMISSION_RESOURCES, ROLE_DEFAULT_PERMISSIONS,
  PermissionResource, ResourcePermission,
} from '@shared/interfaces/permissions.interface';
import { Branch } from '@shared/interfaces/branch.interface';

interface PermissionRow {
  resource: PermissionResource;
  label: string;
  icon: string;
  read: boolean;
  write: boolean;
  delete: boolean;
  isFinancial?: boolean;
  hint?: string;
}

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
  selector: 'app-user-form',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule,
    CardModule, ButtonModule, InputTextModule, PasswordModule,
    SelectModule, MultiSelectModule, DividerModule,
    TabsModule, Tab, TabList, TabPanel, TabPanels, TooltipModule,
    TranslateModule,
  ],
  templateUrl: './user-form.component.html',
})
export class UserFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private userService = inject(UserService);
  private branchService = inject(BranchService);
  private notificationService = inject(NotificationService);
  private authService = inject(AuthService);
  private translate = inject(TranslateService);

  UserRole = UserRole;
  isEdit = false;
  userId: string | null = null;
  isSelf = false;
  loading = signal(true);
  saving = signal(false);

  branches = signal<Branch[]>([]);
  branchOptions = computed(() => {
    const inactiveSuffix = ` (${this.translate.instant('BRANCHES.LIST.INACTIVE')})`;
    return [...this.branches()]
      .sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map(b => ({
        ...b,
        displayName: b.isActive ? b.name : `${b.name}${inactiveSuffix}`,
      }));
  });
  existingUser = signal<SafeUser | null>(null);
  selectedRole: UserRole = UserRole.ACADEMIC_MANAGER;

  permissionRows: PermissionRow[] = [];

  permissionSections: { title: string; rows: PermissionRow[] }[] = [];

  form: FormGroup = this.fb.group({
    firstName: ['', Validators.required],
    lastName: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    password: [''],
    role: [UserRole.ACADEMIC_MANAGER, Validators.required],
    branchIds: [[]],
  });

  roleOptions = [
    { label: 'USERS.FORM.ROLE_GLOBAL_ADMIN', value: UserRole.GLOBAL_ADMIN },
    { label: 'USERS.FORM.ROLE_BRANCH_ADMIN', value: UserRole.BRANCH_ADMIN },
    { label: 'USERS.FORM.ROLE_ACADEMIC_MANAGER', value: UserRole.ACADEMIC_MANAGER },
    { label: 'USERS.FORM.ROLE_SALES_MANAGER', value: UserRole.SALES_MANAGER },
    { label: 'USERS.FORM.ROLE_ACCOUNTANT', value: UserRole.ACCOUNTANT },
    { label: 'USERS.FORM.ROLE_VIEWER', value: UserRole.VIEWER },
  ];

  ngOnInit() {
    this.userId = this.route.snapshot.paramMap.get('id');
    this.isEdit = !!this.userId;
    this.isSelf = this.isEdit && this.userId === this.authService.currentUser()?.id;
    if (this.isSelf) {
      this.form.get('role')!.disable();
    }

    if (!this.isEdit) {
      this.form.get('password')!.setValidators([Validators.required, Validators.minLength(6)]);
    }

    // Load all branches (active + inactive) so admins can still manage
    // assignments on deactivated branches.
    this.branchService.getAllBranches().subscribe({
      next: (branches) => this.branches.set(branches),
    });

    this.initPermissionRows(UserRole.ACADEMIC_MANAGER);

    if (this.isEdit && this.userId) {
      this.userService.get(this.userId).subscribe({
        next: (user) => {
          this.existingUser.set(user);
          this.form.patchValue({
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            role: user.role,
            branchIds: user.branchIds ?? (user.branchId ? [user.branchId] : []),
          });
          this.selectedRole = user.role as UserRole;
          this.applyPermissionsToRows(user.permissions);
          // GLOBAL_ADMIN/ADMIN always show as fully granted — role defaults are FULL.
          if (this.selectedRole === UserRole.GLOBAL_ADMIN || this.selectedRole === UserRole.ADMIN) {
            this.grantAll();
          }
          this.enforceBranchAdminOnlyActions();
          this.loading.set(false);
        },
        error: () => {
          // Interceptor toasted the translated error.
          this.loading.set(false);
        }
      });
    } else {
      this.loading.set(false);
    }
  }

  initPermissionRows(role: UserRole) {
    const defaults = ROLE_DEFAULT_PERMISSIONS[role] ?? {};
    this.permissionRows = PERMISSION_RESOURCES.map(resource => {
      const def = defaults[resource] ?? { read: false, write: false, delete: false };
      return {
        resource,
        label: RESOURCE_META[resource].label,
        icon: RESOURCE_META[resource].icon,
        isFinancial: RESOURCE_META[resource].financial,
        hint: RESOURCE_META[resource].hint,
        read: def.read ?? false,
        write: def.write ?? false,
        delete: def.delete ?? false,
      };
    });
    this.buildSections();
  }

  buildSections() {
    const academic = this.permissionRows.filter(r =>
      ['dashboard','branches','academy','students','enrollments','employees'].includes(r.resource)
    );
    const financial = this.permissionRows.filter(r =>
      ['revenues','expenses','cash','refunds','debts','reports'].includes(r.resource)
    );
    const inventory = this.permissionRows.filter(r =>
      ['products','product_sales'].includes(r.resource)
    );
    const admin = this.permissionRows.filter(r => r.resource === 'users');

    this.permissionSections = [
      { title: 'USERS.FORM.SECTION_ACADEMIC', rows: academic },
      { title: 'USERS.FORM.SECTION_FINANCIAL', rows: financial },
      { title: 'USERS.FORM.SECTION_INVENTORY', rows: inventory },
      { title: 'USERS.FORM.SECTION_ADMIN', rows: admin },
    ];
  }

  applyPermissionsToRows(perms: UserPermissions | null | undefined) {
    if (!perms) return;
    for (const row of this.permissionRows) {
      const p = perms[row.resource];
      if (p) {
        if (p.read !== undefined) row.read = p.read;
        if (p.write !== undefined) row.write = p.write;
        if (p.delete !== undefined) row.delete = p.delete;
      }
    }
  }

  onRoleChange(role: UserRole) {
    this.selectedRole = role;
    this.initPermissionRows(role);
    // GLOBAL_ADMIN/ADMIN always run with role defaults (FULL access). Force the
    // matrix to that state so the user sees what will actually apply.
    if (role === UserRole.GLOBAL_ADMIN || role === UserRole.ADMIN) {
      this.grantAll();
    }
    // Branches write/delete is admin-only: stripping when downgrading from
    // admin to any other role ensures the saved permissions never carry over
    // privileges the backend would reject anyway.
    this.enforceBranchAdminOnlyActions();
  }

  /** Force-clear branches.write/delete when role isn't admin. */
  private enforceBranchAdminOnlyActions() {
    if (this.isAdminRoleSelected()) return;
    for (const row of this.permissionRows) {
      if (row.resource === 'branches') {
        row.write = false;
        row.delete = false;
      }
    }
  }

  isAdminRoleSelected(): boolean {
    return this.selectedRole === UserRole.GLOBAL_ADMIN || this.selectedRole === UserRole.ADMIN;
  }

  isPermissionsLocked(): boolean {
    return this.isSelf || this.isAdminRoleSelected();
  }

  onPermissionChange(row: PermissionRow) {
    // Keep branches.write/delete tied to admin-only access — even if the
    // checkbox was somehow toggled, force it back off for non-admin roles.
    // Mirrors the backend enforcement in branches.ts.
    if (row.resource === 'branches' && !this.isAdminRoleSelected()) {
      row.write = false;
      row.delete = false;
    }
  }

  /** Branches write/delete is reserved for GLOBAL_ADMIN/ADMIN. */
  isActionDisabled(row: PermissionRow, action: 'read' | 'write' | 'delete'): boolean {
    if (this.isPermissionsLocked()) return true;
    if (row.resource === 'branches' && (action === 'write' || action === 'delete')) {
      return !this.isAdminRoleSelected();
    }
    return false;
  }

  loadRoleDefaults() {
    this.initPermissionRows(this.form.get('role')!.value);
  }

  grantAll() {
    for (const row of this.permissionRows) {
      row.read = row.write = row.delete = true;
    }
  }

  revokeAll() {
    for (const row of this.permissionRows) {
      row.read = row.write = row.delete = false;
    }
  }

  revokeFinancial() {
    for (const row of this.permissionRows) {
      if (row.isFinancial) {
        row.read = row.write = row.delete = false;
      }
    }
  }

  buildPermissionsFromRows(): UserPermissions {
    const perms: UserPermissions = {};
    for (const row of this.permissionRows) {
      perms[row.resource] = { read: row.read, write: row.write, delete: row.delete };
    }
    return perms;
  }

  submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const val = this.form.getRawValue();
    const isAdminRole = val.role === UserRole.GLOBAL_ADMIN || val.role === UserRole.ADMIN;
    // Admin roles use role defaults — never store custom overrides for them.
    const permissions = isAdminRole ? null : this.buildPermissionsFromRows();
    const branchIds: string[] = val.branchIds ?? [];
    const primaryBranchId = branchIds[0] ?? null;

    this.saving.set(true);

    if (this.isEdit) {
      const dto: any = {
        firstName: val.firstName,
        lastName: val.lastName,
        email: val.email,
        branchId: primaryBranchId,
        branchIds,
      };
      // Users cannot change their own role or permissions — backend enforces too
      if (!this.isSelf) {
        dto.role = val.role;
        dto.permissions = permissions;
      }
      if (val.password) dto.password = val.password;

      this.userService.update(this.userId!, dto).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('USERS.UPDATED'));
          this.saving.set(false);
          this.router.navigate(['/users']);
        },
        error: () => {
          // Interceptor toasted the translated error.
          this.saving.set(false);
        }
      });
    } else {
      this.userService.create({
        companyId: '',  // injected server-side from context
        firstName: val.firstName,
        lastName: val.lastName,
        email: val.email,
        password: val.password,
        role: val.role,
        branchId: primaryBranchId,
        branchIds,
        permissions,
      }).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('USERS.CREATED'));
          this.saving.set(false);
          this.router.navigate(['/users']);
        },
        error: () => {
          // Interceptor toasted the translated error.
          this.saving.set(false);
        }
      });
    }
  }

  cancel() {
    this.router.navigate(['/users']);
  }

  isInvalid(field: string): boolean {
    const c = this.form.get(field);
    return !!(c?.invalid && c?.touched);
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

  getRoleIconColor(role: string): string {
    const map: Record<string, string> = {
      GLOBAL_ADMIN: 'text-purple-500', ADMIN: 'text-purple-500',
      BRANCH_ADMIN: 'text-blue-500', BRANCH_MANAGER: 'text-blue-500',
      ACADEMIC_MANAGER: 'text-emerald-500', SALES_MANAGER: 'text-amber-500',
      ACCOUNTANT: 'text-cyan-500', VIEWER: 'text-gray-400',
    };
    return map[role] || 'text-gray-400';
  }

  getRoleDescription(role: string): string {
    const map: Record<string, string> = {
      GLOBAL_ADMIN: 'USERS.FORM.ROLE_DESC_GLOBAL_ADMIN',
      BRANCH_ADMIN: 'USERS.FORM.ROLE_DESC_BRANCH_ADMIN',
      ACADEMIC_MANAGER: 'USERS.FORM.ROLE_DESC_ACADEMIC_MANAGER',
      SALES_MANAGER: 'USERS.FORM.ROLE_DESC_SALES_MANAGER',
      ACCOUNTANT: 'USERS.FORM.ROLE_DESC_ACCOUNTANT',
      VIEWER: 'USERS.FORM.ROLE_DESC_VIEWER',
    };
    return map[role] || '';
  }
}
