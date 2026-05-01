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
import { TranslateModule } from '@ngx-translate/core';
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
  courses:      { label: 'USERS.FORM.RESOURCE_COURSES',       icon: 'pi pi-book',
    hint: 'USERS.FORM.RESOURCE_COURSES_HINT' },
  events:       { label: 'USERS.FORM.RESOURCE_EVENTS',       icon: 'pi pi-flag' },
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
  template: `
    <div class="max-w-5xl mx-auto">
      <!-- Header -->
      <div class="flex items-center gap-3 mb-6">
        <button pButton icon="pi pi-arrow-left" class="p-button-text p-button-rounded p-button-secondary"
          (click)="cancel()">
        </button>
        <div>
          <h1 class="text-2xl font-bold text-gray-900">{{ isEdit ? ('USERS.FORM.EDIT_TITLE' | translate) : ('USERS.FORM.CREATE_TITLE' | translate) }}</h1>
          <p class="text-gray-500 text-sm">{{ isEdit ? ('USERS.FORM.EDIT_SUBTITLE' | translate) : ('USERS.FORM.CREATE_SUBTITLE' | translate) }}</p>
        </div>
      </div>

      @if (loading()) {
        <div class="flex justify-center py-20">
          <i class="pi pi-spin pi-spinner text-4xl text-gray-300"></i>
        </div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="submit()">
          <p-tabs value="0">
            <p-tablist>
              <p-tab value="0"><i class="pi pi-user mr-2"></i>{{ 'USERS.FORM.TAB_PROFILE' | translate }}</p-tab>
              <p-tab value="1"><i class="pi pi-shield mr-2"></i>{{ 'USERS.FORM.TAB_PERMISSIONS' | translate }}</p-tab>
            </p-tablist>
            <p-tabpanels>
            <!-- ── TAB 1: Profile ─────────────────────────────────────────── -->
            <p-tabpanel value="0">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                <!-- First Name -->
                <div class="field">
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    {{ 'USERS.FORM.FIRST_NAME' | translate }} <span class="text-red-500">*</span>
                  </label>
                  <input pInputText formControlName="firstName" [placeholder]="'USERS.FORM.FIRST_NAME' | translate"
                    class="w-full" [class.ng-invalid]="isInvalid('firstName')" />
                  @if (isInvalid('firstName')) {
                    <small class="text-red-500">{{ 'USERS.FORM.FIRST_NAME_REQUIRED' | translate }}</small>
                  }
                </div>

                <!-- Last Name -->
                <div class="field">
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    {{ 'USERS.FORM.LAST_NAME' | translate }} <span class="text-red-500">*</span>
                  </label>
                  <input pInputText formControlName="lastName" [placeholder]="'USERS.FORM.LAST_NAME' | translate"
                    class="w-full" [class.ng-invalid]="isInvalid('lastName')" />
                  @if (isInvalid('lastName')) {
                    <small class="text-red-500">{{ 'USERS.FORM.LAST_NAME_REQUIRED' | translate }}</small>
                  }
                </div>

                <!-- Email -->
                <div class="field">
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    {{ 'USERS.FORM.EMAIL' | translate }} <span class="text-red-500">*</span>
                  </label>
                  <input pInputText formControlName="email" type="email" [placeholder]="'USERS.FORM.EMAIL_PLACEHOLDER' | translate"
                    class="w-full" [class.ng-invalid]="isInvalid('email')" />
                  @if (isInvalid('email')) {
                    <small class="text-red-500">{{ 'USERS.FORM.EMAIL_REQUIRED' | translate }}</small>
                  }
                </div>

                <!-- Password -->
                <div class="field">
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    {{ isEdit ? ('USERS.FORM.PASSWORD_EDIT' | translate) : ('AUTH.LOGIN.PASSWORD' | translate) }}
                    @if (!isEdit) { <span class="text-red-500">*</span> }
                  </label>
                  <p-password formControlName="password" [toggleMask]="true" [feedback]="true"
                    [placeholder]="isEdit ? ('USERS.FORM.PASSWORD_HINT_EDIT' | translate) : ('USERS.FORM.PASSWORD_HINT' | translate)"
                    styleClass="w-full" [inputStyleClass]="'w-full'">
                  </p-password>
                  @if (isInvalid('password')) {
                    <small class="text-red-500">{{ 'USERS.FORM.PASSWORD_MIN' | translate }}</small>
                  }
                </div>

                <!-- Role -->
                <div class="field">
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    {{ 'USERS.FORM.ROLE' | translate }} <span class="text-red-500">*</span>
                    @if (isSelf) {
                      <span class="ml-2 text-xs text-amber-600">{{ 'USERS.FORM.SELF_ROLE_LOCKED' | translate }}</span>
                    }
                  </label>
                  <p-select
                    formControlName="role"
                    [options]="roleOptions"
                    [placeholder]="'USERS.FORM.ROLE_PLACEHOLDER' | translate"
                    styleClass="w-full"
                    (onChange)="onRoleChange($event.value)">
                    <ng-template pTemplate="selectedItem" let-item>
                      <div class="flex items-center gap-2">
                        <i [class]="getRoleIcon(item.value) + ' text-sm ' + getRoleIconColor(item.value)"></i>
                        <span>{{ item.label | translate }}</span>
                      </div>
                    </ng-template>
                    <ng-template pTemplate="item" let-item>
                      <div class="flex items-center gap-3 py-1">
                        <i [class]="getRoleIcon(item.value) + ' ' + getRoleIconColor(item.value)"></i>
                        <div>
                          <div class="font-medium">{{ item.label | translate }}</div>
                          <div class="text-xs text-gray-400">{{ getRoleDescription(item.value) | translate }}</div>
                        </div>
                      </div>
                    </ng-template>
                  </p-select>
                </div>

                <!-- Branches -->
                <div class="field">
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    {{ 'USERS.FORM.BRANCH_LABEL' | translate }}
                    @if (selectedRole === UserRole.GLOBAL_ADMIN || selectedRole === UserRole.ADMIN) {
                      <span class="ml-1 text-xs text-purple-500">{{ 'USERS.FORM.ALL_BRANCHES' | translate }}</span>
                    }
                  </label>
                  <p-multiSelect
                    formControlName="branchIds"
                    [options]="branches()"
                    optionLabel="name"
                    optionValue="id"
                    [placeholder]="'USERS.FORM.BRANCH_PLACEHOLDER' | translate"
                    [showToggleAll]="true"
                    styleClass="w-full"
                    [disabled]="selectedRole === UserRole.GLOBAL_ADMIN || selectedRole === UserRole.ADMIN">
                  </p-multiSelect>
                  <small class="text-gray-400 text-xs">
                    @if (selectedRole === UserRole.BRANCH_ADMIN || selectedRole === UserRole.BRANCH_MANAGER) {
                      {{ 'USERS.FORM.BRANCH_MULTI_HINT' | translate }}
                    } @else {
                      {{ 'USERS.FORM.BRANCH_RESTRICT_HINT' | translate }}
                    }
                  </small>
                </div>
              </div>
            </p-tabpanel>

            <!-- ── TAB 2: Permissions ──────────────────────────────────────── -->
            <p-tabpanel value="1">
              <div class="pt-4 space-y-4" [class.opacity-60]="isPermissionsLocked()" [class.pointer-events-none]="isPermissionsLocked()">
                @if (isSelf) {
                  <div class="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                    <i class="pi pi-lock text-amber-600 text-lg mt-0.5"></i>
                    <div>
                      <p class="text-sm font-medium text-amber-900">{{ 'USERS.FORM.SELF_PERM_LOCKED_TITLE' | translate }}</p>
                      <p class="text-xs text-amber-700 mt-0.5">{{ 'USERS.FORM.SELF_PERM_LOCKED_BODY' | translate }}</p>
                    </div>
                  </div>
                }
                @if (isAdminRoleSelected()) {
                  <div class="flex items-start gap-3 p-4 bg-purple-50 border border-purple-200 rounded-xl">
                    <i class="pi pi-shield text-purple-600 text-lg mt-0.5"></i>
                    <div>
                      <p class="text-sm font-medium text-purple-900">{{ 'USERS.FORM.ADMIN_PERM_LOCKED_TITLE' | translate }}</p>
                      <p class="text-xs text-purple-700 mt-0.5">{{ 'USERS.FORM.ADMIN_PERM_LOCKED_BODY' | translate }}</p>
                    </div>
                  </div>
                }
                <!-- Role defaults notice -->
                <div class="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                  <i class="pi pi-info-circle text-blue-500 text-lg mt-0.5"></i>
                  <div>
                    <p class="text-sm font-medium text-blue-800">{{ 'USERS.FORM.PERM_TITLE' | translate }}</p>
                    <p class="text-xs text-blue-600 mt-0.5">
                      {{ 'USERS.FORM.PERM_SUBTITLE' | translate }}
                    </p>
                  </div>
                </div>

                <!-- Permission quick presets -->
                <div class="flex gap-2 flex-wrap">
                  <button type="button" pButton [label]="'USERS.FORM.LOAD_DEFAULTS' | translate" icon="pi pi-refresh"
                    class="p-button-outlined p-button-sm p-button-secondary"
                    (click)="loadRoleDefaults()">
                  </button>
                  <button type="button" pButton [label]="'USERS.FORM.GRANT_ALL' | translate" icon="pi pi-check-circle"
                    class="p-button-outlined p-button-sm p-button-success"
                    (click)="grantAll()">
                  </button>
                  <button type="button" pButton [label]="'USERS.FORM.REVOKE_ALL' | translate" icon="pi pi-times-circle"
                    class="p-button-outlined p-button-sm p-button-danger"
                    (click)="revokeAll()">
                  </button>
                  <button type="button" pButton [label]="'USERS.FORM.REVOKE_FINANCIAL' | translate" icon="pi pi-dollar"
                    class="p-button-outlined p-button-sm p-button-warning"
                    [pTooltip]="'USERS.FORM.REVOKE_FINANCIAL_HINT' | translate"
                    (click)="revokeFinancial()">
                  </button>
                </div>

                <!-- Permissions matrix -->
                <div class="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <table class="w-full text-sm">
                    <thead class="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th class="text-left px-4 py-3 font-semibold text-gray-600 w-48">{{ 'USERS.FORM.COL_RESOURCE' | translate }}</th>
                        <th class="text-center px-4 py-3 font-semibold text-gray-600 w-24">
                          <i class="pi pi-eye mr-1 text-blue-500"></i> {{ 'USERS.FORM.COL_READ' | translate }}
                        </th>
                        <th class="text-center px-4 py-3 font-semibold text-gray-600 w-24">
                          <i class="pi pi-pencil mr-1 text-green-500"></i> {{ 'USERS.FORM.COL_WRITE' | translate }}
                        </th>
                        <th class="text-center px-4 py-3 font-semibold text-gray-600 w-24">
                          <i class="pi pi-trash mr-1 text-red-500"></i> {{ 'USERS.FORM.COL_DELETE' | translate }}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (section of permissionSections; track section.title) {
                        <tr class="bg-gray-50 border-y border-gray-100">
                          <td colspan="4" class="px-4 py-2">
                            <span class="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                              {{ section.title | translate }}
                            </span>
                          </td>
                        </tr>
                        @for (row of section.rows; track row.resource) {
                          <tr class="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                            [class.bg-amber-50]="row.isFinancial">
                            <td class="px-4 py-3">
                              <div class="flex items-center gap-2 flex-wrap">
                                <i [class]="row.icon + ' text-gray-400'"></i>
                                <span class="text-gray-700 font-medium">{{ row.label | translate }}</span>
                                @if (row.isFinancial) {
                                  <span class="text-xs text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">{{ 'USERS.FORM.SECTION_FINANCIAL' | translate }}</span>
                                }
                                @if (row.hint) {
                                  <span class="text-xs text-gray-500 italic w-full">{{ row.hint | translate }}</span>
                                }
                              </div>
                            </td>
                            <td class="text-center px-4 py-3">
                              <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" [(ngModel)]="row.read" [ngModelOptions]="{standalone: true}"
                                  class="sr-only peer" (change)="onPermissionChange(row)" />
                                <div class="w-9 h-5 bg-gray-200 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer
                                  peer-checked:bg-blue-500 after:content-[''] after:absolute after:top-0.5 after:left-0.5
                                  after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all
                                  peer-checked:after:translate-x-4"></div>
                              </label>
                            </td>
                            <td class="text-center px-4 py-3">
                              <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" [(ngModel)]="row.write" [ngModelOptions]="{standalone: true}"
                                  class="sr-only peer" (change)="onPermissionChange(row)" />
                                <div class="w-9 h-5 bg-gray-200 peer-focus:ring-2 peer-focus:ring-green-300 rounded-full peer
                                  peer-checked:bg-green-500 after:content-[''] after:absolute after:top-0.5 after:left-0.5
                                  after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all
                                  peer-checked:after:translate-x-4"></div>
                              </label>
                            </td>
                            <td class="text-center px-4 py-3">
                              <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" [(ngModel)]="row.delete" [ngModelOptions]="{standalone: true}"
                                  class="sr-only peer" (change)="onPermissionChange(row)" />
                                <div class="w-9 h-5 bg-gray-200 peer-focus:ring-2 peer-focus:ring-red-300 rounded-full peer
                                  peer-checked:bg-red-500 after:content-[''] after:absolute after:top-0.5 after:left-0.5
                                  after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all
                                  peer-checked:after:translate-x-4"></div>
                              </label>
                            </td>
                          </tr>
                        }
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            </p-tabpanel>
            </p-tabpanels>
          </p-tabs>

          <!-- Footer actions -->
          <div class="flex justify-end gap-3 mt-6 pt-6 border-t border-gray-200">
            <button type="button" pButton [label]="'USERS.FORM.CANCEL' | translate" severity="secondary"
              class="p-button-outlined" (click)="cancel()">
            </button>
            <button type="submit" pButton [label]="isEdit ? ('USERS.FORM.SAVE' | translate) : ('USERS.FORM.CREATE' | translate)"
              icon="pi pi-check" [loading]="saving()">
            </button>
          </div>
        </form>
      }
    </div>
  `,
})
export class UserFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private userService = inject(UserService);
  private branchService = inject(BranchService);
  private notificationService = inject(NotificationService);
  private authService = inject(AuthService);

  UserRole = UserRole;
  isEdit = false;
  userId: string | null = null;
  isSelf = false;
  loading = signal(true);
  saving = signal(false);

  branches = signal<Branch[]>([]);
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

    this.branchService.getActiveBranches().subscribe({
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
          this.loading.set(false);
        },
        error: () => {
          this.notificationService.error('Failed to load user');
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
      ['dashboard','branches','courses','events','students','enrollments','employees'].includes(r.resource)
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
  }

  isAdminRoleSelected(): boolean {
    return this.selectedRole === UserRole.GLOBAL_ADMIN || this.selectedRole === UserRole.ADMIN;
  }

  isPermissionsLocked(): boolean {
    return this.isSelf || this.isAdminRoleSelected();
  }

  onPermissionChange(_row: PermissionRow) {
    // Angular's ngModel updates the row object directly; nothing extra needed
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
          this.notificationService.success('User updated successfully');
          this.saving.set(false);
          this.router.navigate(['/users']);
        },
        error: (e) => {
          this.notificationService.error(e.error?.message || 'Failed to update user');
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
          this.notificationService.success('User created successfully');
          this.saving.set(false);
          this.router.navigate(['/users']);
        },
        error: (e) => {
          this.notificationService.error(e.error?.message || 'Failed to create user');
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
