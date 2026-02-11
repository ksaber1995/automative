import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { EmployeeService } from '../services/employee.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Branch } from '@shared/interfaces/branch.interface';

@Component({
  selector: 'app-employee-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    ButtonModule,
    CheckboxModule,
    InputTextModule,
    InputNumberModule,
    SelectModule
  ],
  templateUrl: './employee-form.component.html',
  styleUrl: './employee-form.component.scss'
})
export class EmployeeFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private employeeService = inject(EmployeeService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);

  employeeForm: FormGroup;
  loading = signal(false);
  isEditMode = signal(false);
  employeeId: string | null = null;
  branches = signal<Branch[]>([]);

  constructor() {
    const today = new Date().toISOString().split('T')[0];
    this.employeeForm = this.fb.group({
      firstName: ['', [Validators.required, Validators.minLength(2)]],
      lastName: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', [Validators.required]],
      position: ['', [Validators.required]],
      department: ['', [Validators.required]],
      isGlobal: [false],
      branchId: [''],
      salary: [0, [Validators.required, Validators.min(0)]],
      hireDate: [today, [Validators.required]],
      notes: ['']
    });

    // Toggle branch requirement based on isGlobal
    this.employeeForm.get('isGlobal')?.valueChanges.subscribe(isGlobal => {
      const branchControl = this.employeeForm.get('branchId');
      if (isGlobal) {
        branchControl?.clearValidators();
        branchControl?.setValue('');
      } else {
        branchControl?.setValidators([Validators.required]);
      }
      branchControl?.updateValueAndValidity();
    });
  }

  ngOnInit() {
    this.loadBranches();
    this.employeeId = this.route.snapshot.paramMap.get('id');
    if (this.employeeId) {
      this.isEditMode.set(true);
      this.loadEmployee(this.employeeId);
    }
  }

  loadBranches() {
    this.branchService.getActiveBranches().subscribe({
      next: (branches) => {
        this.branches.set(branches);
      }
    });
  }

  loadEmployee(id: string) {
    this.loading.set(true);
    this.employeeService.getEmployeeById(id).subscribe({
      next: (employee) => {
        this.employeeForm.patchValue({
          ...employee,
          hireDate: employee.hireDate.split('T')[0]
        });
        this.loading.set(false);
      },
      error: () => {
        this.notificationService.error('Failed to load employee');
        this.loading.set(false);
        this.router.navigate(['/employees']);
      }
    });
  }

  onSubmit() {
    if (this.employeeForm.invalid) {
      this.employeeForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    const employeeData = {
      ...this.employeeForm.value,
      branchId: this.employeeForm.value.isGlobal ? null : this.employeeForm.value.branchId
    };

    if (this.isEditMode() && this.employeeId) {
      this.employeeService.updateEmployee(this.employeeId, employeeData).subscribe({
        next: () => {
          this.notificationService.success('Employee updated successfully');
          this.router.navigate(['/employees']);
        },
        error: (error) => {
          this.loading.set(false);
          this.notificationService.error('Failed to update employee');
        }
      });
    } else {
      this.employeeService.createEmployee(employeeData).subscribe({
        next: () => {
          this.notificationService.success('Employee created successfully');
          this.router.navigate(['/employees']);
        },
        error: (error) => {
          this.loading.set(false);
          this.notificationService.error('Failed to create employee');
        }
      });
    }
  }

  cancel() {
    this.router.navigate(['/employees']);
  }

  get firstName() { return this.employeeForm.get('firstName'); }
  get lastName() { return this.employeeForm.get('lastName'); }
  get email() { return this.employeeForm.get('email'); }
  get phone() { return this.employeeForm.get('phone'); }
  get position() { return this.employeeForm.get('position'); }
  get department() { return this.employeeForm.get('department'); }
  get salary() { return this.employeeForm.get('salary'); }
  get hireDate() { return this.employeeForm.get('hireDate'); }
  get branchId() { return this.employeeForm.get('branchId'); }
  get isGlobal() { return this.employeeForm.get('isGlobal'); }
}
