import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DividerModule } from 'primeng/divider';
import { EmployeeService } from '../services/employee.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Employee } from '@shared/interfaces/employee.interface';

@Component({
  selector: 'app-employee-detail',
  standalone: true,
  imports: [CommonModule, CardModule, ButtonModule, TagModule, DividerModule],
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
  `
})
export class EmployeeDetailComponent implements OnInit {
  private employeeService = inject(EmployeeService);
  private branchService = inject(BranchService);
  private notificationService = inject(NotificationService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  employee = signal<Employee | null>(null);
  loading = signal(true);
  branchName = signal('—');

  ngOnInit() {
    const id = this.route.snapshot.params['id'];
    this.employeeService.getEmployeeById(id).subscribe({
      next: (emp) => {
        this.employee.set(emp);
        this.loading.set(false);
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
}
