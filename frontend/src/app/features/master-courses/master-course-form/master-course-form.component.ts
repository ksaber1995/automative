import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { TranslateModule } from '@ngx-translate/core';
import { MasterCourseService } from '../services/master-course.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Branch } from '@shared/interfaces/branch.interface';

@Component({
  selector: 'app-master-course-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    TextareaModule,
    InputNumberModule,
    SelectModule,
    TranslateModule,
  ],
  template: `
    <div class="container-custom py-8">
      <div class="max-w-3xl mx-auto">
        <div class="mb-6">
          <h1 class="text-3xl font-bold text-gray-900">
            {{ isEditMode() ? ('MASTER_COURSES.FORM.EDIT_TITLE' | translate) : ('MASTER_COURSES.FORM.CREATE_TITLE' | translate) }}
          </h1>
          <p class="text-gray-600 mt-2">{{ 'MASTER_COURSES.FORM.SUBTITLE' | translate }}</p>
        </div>

        <p-card>
          <form [formGroup]="form" (ngSubmit)="onSubmit()">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="col-span-2">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  {{ 'MASTER_COURSES.FORM.BRANCH' | translate }} <span class="text-red-500">*</span>
                </label>
                <p-select
                  formControlName="branchId"
                  [options]="branches()"
                  optionLabel="name"
                  optionValue="id"
                  [placeholder]="'MASTER_COURSES.FORM.SELECT_BRANCH' | translate"
                  [style]="{ width: '100%' }"
                  appendTo="body"
                ></p-select>
                @if (isEditMode()) {
                  <p class="text-xs text-gray-500 mt-1">{{ 'MASTER_COURSES.FORM.BRANCH_LOCKED_HINT' | translate }}</p>
                }
              </div>
              <div class="col-span-2">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  {{ 'MASTER_COURSES.FORM.NAME' | translate }} <span class="text-red-500">*</span>
                </label>
                <input pInputText formControlName="name" class="w-full" />
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  {{ 'MASTER_COURSES.FORM.CODE' | translate }} <span class="text-red-500">*</span>
                </label>
                <input pInputText formControlName="code" class="w-full" />
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  {{ 'MASTER_COURSES.FORM.DEFAULT_PRICE' | translate }} <span class="text-red-500">*</span>
                </label>
                <p-inputnumber formControlName="defaultPrice" mode="currency" currency="USD" [min]="0" [style]="{ width: '100%' }"></p-inputnumber>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  {{ 'MASTER_COURSES.FORM.DEFAULT_DURATION' | translate }} <span class="text-red-500">*</span>
                </label>
                <p-inputnumber formControlName="defaultDuration" [min]="1" [max]="52" [style]="{ width: '100%' }"></p-inputnumber>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  {{ 'MASTER_COURSES.FORM.DEFAULT_MAX_STUDENTS' | translate }}
                </label>
                <p-inputnumber formControlName="defaultMaxStudents" [min]="1" [style]="{ width: '100%' }"></p-inputnumber>
              </div>

              <div class="col-span-2">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  {{ 'MASTER_COURSES.FORM.DESCRIPTION' | translate }}
                </label>
                <textarea pTextarea formControlName="description" rows="4" class="w-full"></textarea>
              </div>
            </div>

            <div class="flex justify-end gap-3 mt-6 pt-4 border-t">
              <p-button
                [label]="'MASTER_COURSES.FORM.CANCEL' | translate"
                severity="secondary"
                [outlined]="true"
                (onClick)="cancel()"
                type="button"
              ></p-button>
              <p-button
                [label]="isEditMode() ? ('MASTER_COURSES.FORM.UPDATE' | translate) : ('MASTER_COURSES.FORM.CREATE' | translate)"
                type="submit"
                [loading]="loading()"
                [disabled]="form.invalid"
              ></p-button>
            </div>
          </form>
        </p-card>
      </div>
    </div>
  `,
})
export class MasterCourseFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private service = inject(MasterCourseService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notifications = inject(NotificationService);

  form: FormGroup;
  loading = signal(false);
  isEditMode = signal(false);
  branches = signal<Branch[]>([]);
  id: string | null = null;

  constructor() {
    this.form = this.fb.group({
      branchId: [null, Validators.required],
      name: ['', [Validators.required, Validators.minLength(3)]],
      code: ['', [Validators.required, Validators.minLength(2)]],
      description: [''],
      defaultPrice: [0, [Validators.required, Validators.min(0)]],
      defaultDuration: [8, [Validators.required, Validators.min(1), Validators.max(52)]],
      defaultMaxStudents: [null],
    });
  }

  ngOnInit() {
    this.branchService.getActiveBranches().subscribe({
      next: (rows) => this.branches.set(rows),
    });
    this.id = this.route.snapshot.paramMap.get('id');
    if (this.id) {
      this.isEditMode.set(true);
      this.load(this.id);
    }
  }

  load(id: string) {
    this.loading.set(true);
    this.service.getById(id).subscribe({
      next: (row) => {
        this.form.patchValue({
          branchId: row.branchId,
          name: row.name,
          code: row.code,
          description: row.description || '',
          defaultPrice: row.defaultPrice,
          defaultDuration: row.defaultDuration,
          defaultMaxStudents: row.defaultMaxStudents,
        });
        this.form.get('branchId')?.disable();
        this.loading.set(false);
      },
      error: () => {
        this.notifications.error('Failed to load master course');
        this.loading.set(false);
        this.router.navigate(['/master-courses']);
      },
    });
  }

  onSubmit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.loading.set(true);
    if (this.isEditMode() && this.id) {
      const updatePayload = {
        name: v.name,
        code: v.code,
        description: v.description?.trim() || undefined,
        defaultPrice: v.defaultPrice,
        defaultDuration: v.defaultDuration,
        defaultMaxStudents: v.defaultMaxStudents || undefined,
      };
      this.service.update(this.id, updatePayload).subscribe({
        next: () => {
          this.notifications.success('Master course updated');
          this.router.navigate(['/master-courses']);
        },
        error: (err) => {
          this.loading.set(false);
          this.notifications.error(err?.error?.message || 'Update failed');
        },
      });
    } else {
      const createPayload = {
        branchId: v.branchId,
        name: v.name,
        code: v.code,
        description: v.description?.trim() || undefined,
        defaultPrice: v.defaultPrice,
        defaultDuration: v.defaultDuration,
        defaultMaxStudents: v.defaultMaxStudents || undefined,
      };
      this.service.create(createPayload).subscribe({
        next: () => {
          this.notifications.success('Master course created');
          this.router.navigate(['/master-courses']);
        },
        error: (err) => {
          this.loading.set(false);
          this.notifications.error(err?.error?.message || 'Create failed');
        },
      });
    }
  }

  cancel() { this.router.navigate(['/master-courses']); }
}
