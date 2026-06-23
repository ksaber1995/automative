import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ExamService } from '../services/exam.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { NotificationService } from '../../../core/services/notification.service';

@Component({
  selector: 'app-exam-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    DatePickerModule,
    TranslateModule,
  ],
  templateUrl: './exam-form.component.html',
})
export class ExamFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private service = inject(ExamService);
  private lookup = inject(LookupService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notifications = inject(NotificationService);
  private translate = inject(TranslateService);

  form: FormGroup;
  loading = signal(false);
  isEditMode = signal(false);
  id: string | null = null;
  courses = signal<LookupOption[]>([]);

  statusOptions = signal<{ label: string; value: string }[]>([]);

  constructor() {
    this.rebuildOptions();
    this.translate.onLangChange.subscribe(() => this.rebuildOptions());

    this.form = this.fb.group({
      courseId: ['', [Validators.required]],
      name: ['', [Validators.required, Validators.minLength(1)]],
      examDate: [new Date(), [Validators.required]],
      maxGrade: [100, [Validators.min(0)]],
      status: ['SCHEDULED', [Validators.required]],
    });
  }

  ngOnInit() {
    this.lookup.courses().subscribe({
      next: (c) => this.courses.set(c),
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
          courseId: row.courseId,
          name: row.name,
          examDate: row.examDate ? new Date(row.examDate) : new Date(),
          maxGrade: row.maxGrade ?? null,
          status: row.status,
        });
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.router.navigate(['/exams']);
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
      courseId: v.courseId,
      name: v.name?.trim(),
      examDate: this.toIsoDate(v.examDate),
      maxGrade: v.maxGrade ?? null,
      status: v.status,
    };
    this.loading.set(true);
    if (this.isEditMode() && this.id) {
      this.service.update(this.id, payload).subscribe({
        next: () => {
          this.notifications.success(this.translate.instant('EXAMS.FORM.UPDATE_SUCCESS'));
          this.router.navigate(['/exams']);
        },
        error: () => this.loading.set(false),
      });
    } else {
      this.service.create(payload).subscribe({
        next: (created) => {
          this.notifications.success(this.translate.instant('EXAMS.FORM.CREATE_SUCCESS'));
          // Go straight to the detail page so staff can flip to DONE + record.
          this.router.navigate(['/exams', created.id]);
        },
        error: () => this.loading.set(false),
      });
    }
  }

  cancel() { this.router.navigate(['/exams']); }

  get courseId() { return this.form.get('courseId'); }
  get name() { return this.form.get('name'); }
  get examDate() { return this.form.get('examDate'); }

  private rebuildOptions() {
    this.statusOptions.set([
      { label: this.translate.instant('EXAMS.STATUS.SCHEDULED'), value: 'SCHEDULED' },
      { label: this.translate.instant('EXAMS.STATUS.DONE'), value: 'DONE' },
    ]);
  }

  private toIsoDate(d: any): string {
    if (d instanceof Date) return d.toISOString().split('T')[0];
    return d;
  }
}
