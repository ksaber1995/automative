import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { BranchService } from '../services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Branch } from '@shared/interfaces/branch.interface';

@Component({
  selector: 'app-branch-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    ButtonModule
  ],
  templateUrl: './branch-form.component.html',
  styleUrl: './branch-form.component.scss'
})
export class BranchFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);

  branchForm: FormGroup;
  loading = signal(false);
  isEditMode = signal(false);
  branchId: string | null = null;

  constructor() {
    const today = new Date().toISOString().split('T')[0];
    this.branchForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(3)]],
      code: ['', [Validators.required, Validators.minLength(2)]],
      address: ['', [Validators.required]],
      city: ['', [Validators.required]],
      state: [''],
      zipCode: [''],
      phone: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
      managerId: [''],
      openingDate: [today, [Validators.required]]
    });
  }

  ngOnInit() {
    this.branchId = this.route.snapshot.paramMap.get('id');
    if (this.branchId) {
      this.isEditMode.set(true);
      this.loadBranch(this.branchId);
    }
  }

  loadBranch(id: string) {
    this.loading.set(true);
    this.branchService.getBranchById(id).subscribe({
      next: (branch) => {
        this.branchForm.patchValue({
          ...branch,
          openingDate: branch.openingDate.split('T')[0]
        });
        this.loading.set(false);
      },
      error: () => {
        this.notificationService.error('Failed to load branch');
        this.loading.set(false);
        this.router.navigate(['/branches']);
      }
    });
  }

  onSubmit() {
    if (this.branchForm.invalid) {
      this.branchForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    const branchData = this.branchForm.value;

    if (this.isEditMode() && this.branchId) {
      this.branchService.updateBranch(this.branchId, branchData).subscribe({
        next: () => {
          this.notificationService.success('Branch updated successfully');
          this.router.navigate(['/branches']);
        },
        error: (error) => {
          this.loading.set(false);
          this.notificationService.error('Failed to update branch');
          console.error('Update error:', error);
        }
      });
    } else {
      this.branchService.createBranch(branchData).subscribe({
        next: () => {
          this.notificationService.success('Branch created successfully');
          this.router.navigate(['/branches']);
        },
        error: (error) => {
          this.loading.set(false);
          this.notificationService.error('Failed to create branch');
          console.error('Create error:', error);
        }
      });
    }
  }

  cancel() {
    this.router.navigate(['/branches']);
  }

  get name() { return this.branchForm.get('name'); }
  get code() { return this.branchForm.get('code'); }
  get address() { return this.branchForm.get('address'); }
  get city() { return this.branchForm.get('city'); }
  get phone() { return this.branchForm.get('phone'); }
  get email() { return this.branchForm.get('email'); }
  get openingDate() { return this.branchForm.get('openingDate'); }
}
