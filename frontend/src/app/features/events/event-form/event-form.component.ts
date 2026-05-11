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
import { DatePickerModule } from 'primeng/datepicker';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { EventService } from '../services/event.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Branch } from '@shared/interfaces/branch.interface';

@Component({
  selector: 'app-event-form',
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
    DatePickerModule,
    TranslateModule,
  ],
  template: `
    <div class="container-custom py-8">
      <div class="max-w-3xl mx-auto">
        <div class="mb-6">
          <h1 class="text-3xl font-bold text-gray-900">
            {{ isEditMode() ? ('EVENTS.FORM.EDIT_TITLE' | translate) : ('EVENTS.FORM.CREATE_TITLE' | translate) }}
          </h1>
          <p class="text-gray-600 mt-2">{{ 'EVENTS.FORM.SUBTITLE' | translate }}</p>
        </div>

        <p-card>
          <form [formGroup]="form" (ngSubmit)="onSubmit()">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="col-span-2">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  {{ 'EVENTS.FORM.NAME' | translate }} <span class="text-red-500">*</span>
                </label>
                <input pInputText formControlName="name" class="w-full" />
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  {{ 'EVENTS.FORM.TYPE' | translate }}
                </label>
                <p-select
                  formControlName="eventType"
                  [options]="typeOptions()"
                  optionLabel="label"
                  optionValue="value"
                  [style]="{ width: '100%' }"
                ></p-select>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  {{ 'EVENTS.FORM.STATUS' | translate }}
                </label>
                <p-select
                  formControlName="status"
                  [options]="statusOptions()"
                  optionLabel="label"
                  optionValue="value"
                  [style]="{ width: '100%' }"
                ></p-select>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  {{ 'EVENTS.FORM.CODE' | translate }}
                </label>
                <input pInputText formControlName="code" class="w-full" />
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  {{ 'EVENTS.FORM.BRANCH' | translate }}
                </label>
                <p-select
                  formControlName="branchId"
                  [options]="branches()"
                  optionLabel="name"
                  optionValue="id"
                  [placeholder]="'EVENTS.FORM.BRANCH_PLACEHOLDER' | translate"
                  [showClear]="true"
                  [style]="{ width: '100%' }"
                ></p-select>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  {{ 'EVENTS.FORM.LOCATION' | translate }}
                </label>
                <input pInputText formControlName="location" class="w-full" />
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  {{ 'EVENTS.FORM.START_DATE' | translate }}
                </label>
                <p-datepicker
                  formControlName="startDate"
                  dateFormat="yy-mm-dd"
                  [showIcon]="true"
                  [style]="{ width: '100%' }"
                  styleClass="w-full"
                ></p-datepicker>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  {{ 'EVENTS.FORM.END_DATE' | translate }}
                </label>
                <p-datepicker
                  formControlName="endDate"
                  dateFormat="yy-mm-dd"
                  [showIcon]="true"
                  [style]="{ width: '100%' }"
                  styleClass="w-full"
                ></p-datepicker>
              </div>

              <div class="col-span-2">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  {{ 'EVENTS.FORM.DESCRIPTION' | translate }}
                </label>
                <textarea pTextarea formControlName="description" rows="3" class="w-full"></textarea>
              </div>
            </div>

            <div class="flex justify-end gap-3 mt-6 pt-4 border-t">
              <p-button
                [label]="'EVENTS.FORM.CANCEL' | translate"
                severity="secondary"
                [outlined]="true"
                (onClick)="cancel()"
                type="button"
              ></p-button>
              <p-button
                [label]="isEditMode() ? ('EVENTS.FORM.UPDATE' | translate) : ('EVENTS.FORM.CREATE' | translate)"
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
export class EventFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private service = inject(EventService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notifications = inject(NotificationService);
  private translate = inject(TranslateService);

  form: FormGroup;
  loading = signal(false);
  isEditMode = signal(false);
  id: string | null = null;
  branches = signal<Branch[]>([]);

  private readonly typeValues = ['TRIP', 'COMPETITION', 'WORKSHOP', 'SEMINAR', 'CAMP', 'OTHER'] as const;
  private readonly statusValues = ['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const;

  typeOptions = signal<{ label: string; value: string }[]>([]);
  statusOptions = signal<{ label: string; value: string }[]>([]);

  constructor() {
    this.rebuildOptions();
    this.translate.onLangChange.subscribe(() => this.rebuildOptions());

    this.form = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      code: [''],
      eventType: ['TRIP'],
      status: ['PLANNED'],
      branchId: [null],
      location: [''],
      startDate: [null],
      endDate: [null],
      description: [''],
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
          name: row.name,
          code: row.code || '',
          eventType: row.eventType,
          status: row.status,
          branchId: row.branchId,
          location: row.location || '',
          startDate: row.startDate ? new Date(row.startDate) : null,
          endDate: row.endDate ? new Date(row.endDate) : null,
          description: row.description || '',
        });
        this.loading.set(false);
      },
      error: () => {
        this.notifications.error('Failed to load event');
        this.loading.set(false);
        this.router.navigate(['/events']);
      },
    });
  }

  onSubmit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.value;
    const payload: any = {
      name: v.name,
      code: v.code?.trim() || undefined,
      eventType: v.eventType,
      status: v.status,
      branchId: v.branchId || undefined,
      location: v.location?.trim() || undefined,
      startDate: v.startDate ? this.toIsoDate(v.startDate) : undefined,
      endDate: v.endDate ? this.toIsoDate(v.endDate) : undefined,
      description: v.description?.trim() || undefined,
    };
    this.loading.set(true);
    if (this.isEditMode() && this.id) {
      this.service.update(this.id, payload).subscribe({
        next: () => {
          this.notifications.success('Event updated');
          this.router.navigate(['/events']);
        },
        error: (err) => {
          this.loading.set(false);
          this.notifications.error(err?.error?.message || 'Update failed');
        },
      });
    } else {
      this.service.create(payload).subscribe({
        next: () => {
          this.notifications.success('Event created');
          this.router.navigate(['/events']);
        },
        error: (err) => {
          this.loading.set(false);
          this.notifications.error(err?.error?.message || 'Create failed');
        },
      });
    }
  }

  cancel() { this.router.navigate(['/events']); }

  private rebuildOptions() {
    this.typeOptions.set(this.typeValues.map(v => ({
      label: this.translate.instant('EVENTS.TYPE.' + v), value: v,
    })));
    this.statusOptions.set(this.statusValues.map(v => ({
      label: this.translate.instant('EVENTS.STATUS.' + v), value: v,
    })));
  }

  private toIsoDate(d: any): string {
    if (d instanceof Date) return d.toISOString().split('T')[0];
    return d;
  }
}
