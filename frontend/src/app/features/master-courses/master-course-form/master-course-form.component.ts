import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MasterCourseService } from '../services/master-course.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { NotificationService } from '../../../core/services/notification.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { LanguageService } from '../../../core/services/language.service';
import { MasterCoursePaymentType } from '@shared/interfaces/master-course.interface';

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
  templateUrl: './master-course-form.component.html',
})
export class MasterCourseFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private service = inject(MasterCourseService);
  private lookupService = inject(LookupService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notifications = inject(NotificationService);
  protected branchState = inject(BranchStateService);
  private translate = inject(TranslateService);
  private language = inject(LanguageService);

  form: FormGroup;
  loading = signal(false);

  /**
   * The two ways a master can be sold. The hint matters more than the label:
   * which one is picked decides what courses the master is then allowed to hold.
   */
  /**
   * Translated here rather than piped in the template, because `optionLabel`
   * is what p-select falls back to whenever a template does not apply — and a
   * label holding a translation KEY renders that key on screen. Recomputed on
   * every language change, since instant() is a snapshot.
   */
  readonly paymentTypeOptions = computed(() => {
    this.language.currentLang();
    return [
      {
        value: 'ONE_TIME' as MasterCoursePaymentType,
        label: this.translate.instant('MASTER_COURSES.FORM.PAYMENT_TYPE_ONE_TIME'),
        hint: this.translate.instant('MASTER_COURSES.FORM.PAYMENT_TYPE_ONE_TIME_HINT'),
      },
      {
        value: 'MONTHLY_SUBSCRIPTION' as MasterCoursePaymentType,
        label: this.translate.instant('MASTER_COURSES.FORM.PAYMENT_TYPE_MONTHLY'),
        hint: this.translate.instant('MASTER_COURSES.FORM.PAYMENT_TYPE_MONTHLY_HINT'),
      },
    ];
  });

  isMonthly = (): boolean => this.form?.get('paymentType')?.value === 'MONTHLY_SUBSCRIPTION';
  isEditMode = signal(false);
  branches = signal<LookupOption[]>([]);
  levels = signal<LookupOption[]>([]);
  id: string | null = null;

  constructor() {
    this.form = this.fb.group({
      branchId: [null, Validators.required],
      name: ['', [Validators.required, Validators.minLength(3)]],
      description: [''],
      defaultPrice: [0, [Validators.required, Validators.min(0)]],
      paymentType: ['ONE_TIME' as MasterCoursePaymentType, Validators.required],
      defaultDuration: [8, [Validators.required, Validators.min(1), Validators.max(52)]],
      defaultMaxStudents: [null],
      levelId: [null],
    });
  }

  ngOnInit() {
    this.lookupService.branches().subscribe({
      next: (rows) => {
        this.branches.set(rows);
        if (rows.length === 1 && !this.isEditMode()) {
          const c = this.form.get('branchId');
          if (c && !c.value) c.setValue(rows[0].id);
        }
      },
    });
    this.lookupService.levels().subscribe({
      next: (rows) => this.levels.set(rows),
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
          description: row.description || '',
          defaultPrice: row.defaultPrice,
          paymentType: row.paymentType || 'ONE_TIME',
          defaultDuration: row.defaultDuration,
          defaultMaxStudents: row.defaultMaxStudents,
          levelId: row.levelId || null,
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
        description: v.description?.trim() || undefined,
        defaultPrice: v.defaultPrice,
        paymentType: v.paymentType,
        defaultDuration: v.defaultDuration,
        defaultMaxStudents: v.defaultMaxStudents || undefined,
        levelId: v.levelId || null,
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
        description: v.description?.trim() || undefined,
        defaultPrice: v.defaultPrice,
        paymentType: v.paymentType,
        defaultDuration: v.defaultDuration,
        defaultMaxStudents: v.defaultMaxStudents || undefined,
        levelId: v.levelId || null,
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
