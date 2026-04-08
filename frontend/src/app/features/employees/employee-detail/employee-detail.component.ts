import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DividerModule } from 'primeng/divider';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { EmployeeService } from '../services/employee.service';
import { BranchService } from '../../branches/services/branch.service';
import { UserService } from '../../users/services/user.service';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Employee } from '@shared/interfaces/employee.interface';
import { UserRole } from '@shared/enums/user-role.enum';
import { Branch } from '@shared/interfaces/branch.interface';

@Component({
  selector: 'app-employee-detail',
  standalone: true,
  imports: [
    CommonModule, FormsModule, CardModule, ButtonModule, TagModule, DividerModule,
    DialogModule, InputTextModule, PasswordModule, SelectModule, MultiSelectModule,
  ],
  template: `
    <div class="container mx-auto p-6 max-w-4xl">
      @if (loading()) {
        <div class="flex justify-center py-16">
          <i class="pi pi-spin pi-spinner text-4xl text-gray-400"></i>
        </div>
      } @else if (employee()) {
        <div class="flex justify-between items-center mb-6">
          <div class="flex items-center gap-3">
            <p-button icon="pi pi-arrow-left" [text]="true" severity="secondary" (onClick)="back()"></p-button>
            <h1 class="text-2xl font-bold">{{ employee()!.firstName }} {{ employee()!.lastName }}</h1>
            <p-tag
              [value]="employee()!.isActive ? 'Active' : 'Inactive'"
              [severity]="employee()!.isActive ? 'success' : 'danger'">
            </p-tag>
          </div>
          <p-button label="Edit" icon="pi pi-pencil" severity="warn" (onClick)="edit()"></p-button>
          @if (canManageUsers() && true) {
            <p-button label="Convert to User" icon="pi pi-user-plus" severity="info"
              (onClick)="showConvertDialog = true">
            </p-button>
          } @else if (false) {
            <span class="inline-flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-3 py-2 rounded-lg border border-blue-200">
              <i class="pi pi-link"></i> Has user account
            </span>
          }
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">

          <!-- Personal Info -->
          <p-card>
            <ng-template pTemplate="header">
              <div class="flex items-center gap-2 px-4 pt-4">
                <i class="pi pi-user text-blue-500"></i>
                <span class="font-semibold text-gray-700">Personal Information</span>
              </div>
            </ng-template>
            <div class="space-y-3">
              <div class="flex justify-between">
                <span class="text-gray-500 text-sm">Full Name</span>
                <span class="font-medium">{{ employee()!.firstName }} {{ employee()!.lastName }}</span>
              </div>
              <p-divider styleClass="my-2"></p-divider>
              <div class="flex justify-between">
                <span class="text-gray-500 text-sm">Email</span>
                <span class="font-medium">{{ employee()!.email || '—' }}</span>
              </div>
              <p-divider styleClass="my-2"></p-divider>
              <div class="flex justify-between">
                <span class="text-gray-500 text-sm">Phone</span>
                <span class="font-medium">{{ employee()!.phone || '—' }}</span>
              </div>
              <p-divider styleClass="my-2"></p-divider>
              <div class="flex justify-between">
                <span class="text-gray-500 text-sm">Hire Date</span>
                <span class="font-medium">{{ employee()!.hireDate ? (employee()!.hireDate | date:'mediumDate') : '—' }}</span>
              </div>
            </div>
          </p-card>

          <!-- Job Info -->
          <p-card>
            <ng-template pTemplate="header">
              <div class="flex items-center gap-2 px-4 pt-4">
                <i class="pi pi-briefcase text-green-500"></i>
                <span class="font-semibold text-gray-700">Job Details</span>
              </div>
            </ng-template>
            <div class="space-y-3">
              <div class="flex justify-between">
                <span class="text-gray-500 text-sm">Position</span>
                <span class="font-medium">{{ employee()!.position || '—' }}</span>
              </div>
              <p-divider styleClass="my-2"></p-divider>
              <div class="flex justify-between">
                <span class="text-gray-500 text-sm">Department</span>
                <span class="font-medium">{{ employee()!.department || '—' }}</span>
              </div>
              <p-divider styleClass="my-2"></p-divider>
              <div class="flex justify-between">
                <span class="text-gray-500 text-sm">Branch</span>
                <span class="font-medium">{{ branchName() }}</span>
              </div>
              <p-divider styleClass="my-2"></p-divider>
              <div class="flex justify-between">
                <span class="text-gray-500 text-sm">Scope</span>
                <p-tag
                  [value]="employee()!.isGlobal ? 'Global' : 'Branch'"
                  [severity]="employee()!.isGlobal ? 'success' : 'info'">
                </p-tag>
              </div>
            </div>
          </p-card>

          <!-- Salary -->
          <p-card>
            <ng-template pTemplate="header">
              <div class="flex items-center gap-2 px-4 pt-4">
                <i class="pi pi-dollar text-amber-500"></i>
                <span class="font-semibold text-gray-700">Compensation</span>
              </div>
            </ng-template>
            <div class="space-y-3">
              <div class="flex justify-between items-center">
                <span class="text-gray-500 text-sm">Monthly Salary</span>
                <span class="text-2xl font-bold text-green-600">
                  {{ employee()!.salary ? (employee()!.salary | number:'1.2-2') : '—' }}
                </span>
              </div>
              @if (employee()!.salary && employee()!.salary > 0) {
                <p-divider styleClass="my-2"></p-divider>
                <div class="flex justify-between">
                  <span class="text-gray-500 text-sm">Annual (est.)</span>
                  <span class="font-medium text-gray-700">{{ (employee()!.salary * 12) | number:'1.2-2' }}</span>
                </div>
              }
            </div>
          </p-card>

          <!-- Metadata -->
          <p-card>
            <ng-template pTemplate="header">
              <div class="flex items-center gap-2 px-4 pt-4">
                <i class="pi pi-info-circle text-gray-400"></i>
                <span class="font-semibold text-gray-700">Record Info</span>
              </div>
            </ng-template>
            <div class="space-y-3">
              <div class="flex justify-between">
                <span class="text-gray-500 text-sm">Employee ID</span>
                <span class="font-mono text-xs text-gray-500">{{ employee()!.id.substring(0, 8) }}...</span>
              </div>
              <p-divider styleClass="my-2"></p-divider>
              <div class="flex justify-between">
                <span class="text-gray-500 text-sm">Created</span>
                <span class="font-medium text-sm">{{ employee()!.createdAt | date:'mediumDate' }}</span>
              </div>
              <p-divider styleClass="my-2"></p-divider>
              <div class="flex justify-between">
                <span class="text-gray-500 text-sm">Status</span>
                <p-tag
                  [value]="employee()!.isActive ? 'Active' : 'Terminated'"
                  [severity]="employee()!.isActive ? 'success' : 'danger'">
                </p-tag>
              </div>
            </div>
          </p-card>

        </div>
      } @else {
        <div class="text-center py-16 text-gray-500">
          <i class="pi pi-exclamation-circle text-4xl mb-4 block"></i>
          <p>Employee not found.</p>
          <p-button label="Back to Employees" severity="secondary" (onClick)="back()" styleClass="mt-4"></p-button>
        </div>
      }
    </div>

    <!-- Convert to User Dialog -->
    <p-dialog [(visible)]="showConvertDialog" header="Convert Employee to User"
      [modal]="true" [style]="{ width: '520px' }" [closable]="true">
      <div class="space-y-5 pt-2">
        <div class="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <i class="pi pi-info-circle text-blue-500 mt-0.5"></i>
          <p class="text-sm text-blue-700">
            This will create a system user account linked to
            <strong>{{ employee()?.firstName }} {{ employee()?.lastName }}</strong>.
            They will be able to log in with the email and password you set.
          </p>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div class="col-span-2 field">
            <label class="block text-sm font-medium text-gray-700 mb-1">Login Email <span class="text-red-500">*</span></label>
            <input pInputText [(ngModel)]="convertForm.email" type="email"
              [placeholder]="employee()?.email || 'user@company.com'"
              class="w-full" />
          </div>
          <div class="col-span-2 field">
            <label class="block text-sm font-medium text-gray-700 mb-1">Password <span class="text-red-500">*</span></label>
            <p-password [(ngModel)]="convertForm.password" [toggleMask]="true" [feedback]="true"
              placeholder="Min. 6 characters" styleClass="w-full" [inputStyleClass]="'w-full'">
            </p-password>
          </div>
          <div class="col-span-2 field">
            <label class="block text-sm font-medium text-gray-700 mb-1">Role <span class="text-red-500">*</span></label>
            <p-select [(ngModel)]="convertForm.role" [options]="roleOptions"
              placeholder="Select role" styleClass="w-full">
            </p-select>
          </div>
          <div class="col-span-2 field">
            <label class="block text-sm font-medium text-gray-700 mb-1">Branch Access</label>
            <p-multiSelect [(ngModel)]="convertForm.branchIds" [options]="branches()"
              optionLabel="name" optionValue="id" placeholder="Select branches"
              styleClass="w-full">
            </p-multiSelect>
          </div>
        </div>
      </div>
      <ng-template pTemplate="footer">
        <button pButton label="Cancel" severity="secondary" class="p-button-outlined"
          (click)="showConvertDialog = false">
        </button>
        <button pButton label="Create User Account" icon="pi pi-user-plus"
          [loading]="converting()" (click)="convertToUser()">
        </button>
      </ng-template>
    </p-dialog>
  `
})
export class EmployeeDetailComponent implements OnInit {
  private employeeService = inject(EmployeeService);
  private branchService = inject(BranchService);
  private userService = inject(UserService);
  private authService = inject(AuthService);
  private notificationService = inject(NotificationService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  employee = signal<Employee | null>(null);
  loading = signal(true);
  branchName = signal('—');
  branches = signal<Branch[]>([]);
  converting = signal(false);

  showConvertDialog = false;
  convertForm = {
    email: '',
    password: '',
    role: UserRole.ACADEMIC_MANAGER,
    branchIds: [] as string[],
  };

  roleOptions = [
    { label: 'Branch Admin', value: UserRole.BRANCH_ADMIN },
    { label: 'Academic Manager', value: UserRole.ACADEMIC_MANAGER },
    { label: 'Sales Manager', value: UserRole.SALES_MANAGER },
    { label: 'Accountant', value: UserRole.ACCOUNTANT },
    { label: 'Viewer', value: UserRole.VIEWER },
  ];

  canManageUsers(): boolean {
    return this.authService.canManageUsers();
  }

  ngOnInit() {
    const id = this.route.snapshot.params['id'];
    this.branchService.getActiveBranches().subscribe({ next: (b) => this.branches.set(b) });
    this.employeeService.getEmployeeById(id).subscribe({
      next: (emp) => {
        this.employee.set(emp);
        this.loading.set(false);
        // Pre-fill convert form email from employee
        if (emp.email) this.convertForm.email = emp.email;
        if (emp.branchId) this.convertForm.branchIds = [emp.branchId];
        if (emp.branchId) {
          this.branchService.getActiveBranches().subscribe({
            next: (branches) => {
              const branch = branches.find(b => b.id === emp.branchId);
              this.branchName.set(branch?.name || 'Unknown');
            }
          });
        } else {
          this.branchName.set(emp.isGlobal ? 'All Branches' : '—');
        }
      },
      error: () => {
        this.notificationService.error('Employee not found');
        this.loading.set(false);
        this.router.navigate(['/employees']);
      }
    });
  }

  edit() {
    this.router.navigate(['/employees', this.employee()!.id, 'edit']);
  }

  back() {
    this.router.navigate(['/employees']);
  }

  convertToUser() {
    const f = this.convertForm;
    if (!f.email || !f.password || f.password.length < 6 || !f.role) {
      this.notificationService.error('Please fill all required fields (password min. 6 chars)');
      return;
    }
    this.converting.set(true);
    this.userService.convertEmployee({
      employeeId: this.employee()!.id,
      email: f.email,
      password: f.password,
      role: f.role,
      branchIds: f.branchIds,
    }).subscribe({
      next: (user) => {
        this.notificationService.success(`User account created for ${user.firstName} ${user.lastName}`);
        this.showConvertDialog = false;
        this.converting.set(false);
      },
      error: (e) => {
        this.notificationService.error(e.error?.message || 'Failed to create user account');
        this.converting.set(false);
      }
    });
  }
}
