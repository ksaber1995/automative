import { Component, OnInit, inject, signal, computed, effect } from '@angular/core';
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
import { CompanyService } from '../../../core/services/company.service';
import { HOMEWORK_RATINGS, HOMEWORK_RATING_MAX } from '../homework-rating.util';
import { toLocalYmd } from '../../../core/utils/date.util';

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
  private companyService = inject(CompanyService);

  form: FormGroup;
  loading = signal(false);
  isEditMode = signal(false);
  id: string | null = null;
  courses = signal<LookupOption[]>([]);
  classes = signal<LookupOption[]>([]);

  statusOptions = signal<{ label: string; value: string }[]>([]);
  kindOptions = signal<{ label: string; value: boolean }[]>([]);

  // ── Rating mode (company setting) ───────────────────────────────────────────
  /** The company marks homework by rating rather than by number. */
  ratingMode = signal(false);
  ratingMax = HOMEWORK_RATING_MAX;

  /** Mirrors the kind control, so the template can react to it. */
  private isHomeworkKind = signal(false);

  /**
   * Whether THIS row may be a rating one. A homework already stored out of 100
   * keeps its number box: relabelling a recorded 73 as "Very good" would invent
   * a meaning nobody gave it — the same rule the marking panel applies. Anything
   * created from here while the setting is on is out of 5, so it qualifies.
   */
  private ratingEligible = signal(true);

  /** Homework, in a rating company, on a row that hasn't already been numbered. */
  useRating = computed(() => this.ratingMode() && this.isHomeworkKind() && this.ratingEligible());

  /** The scale itself, so the form can show what marking will look like. */
  ratingLabels = computed(() => HOMEWORK_RATINGS.map((r) => this.translate.instant(r.labelKey)));

  constructor() {
    this.rebuildOptions();
    this.translate.onLangChange.subscribe(() => this.rebuildOptions());

    this.form = this.fb.group({
      // Homework created here has no session behind it — that is the whole point
      // of this screen. The class is what scopes it; the session stays null.
      isHomework: [false],
      courseId: ['', [Validators.required]],
      classId: [null],
      name: ['', [Validators.required, Validators.minLength(1)]],
      examDate: [new Date(), [Validators.required]],
      maxGrade: [100, [Validators.min(0)]],
      status: ['SCHEDULED', [Validators.required]],
    });

    this.form.get('isHomework')!.valueChanges.subscribe((v: boolean) => this.isHomeworkKind.set(v === true));

    // Which marking control this row will get. Read once, like the session panel:
    // an admin flipping the setting mid-form is not worth polling for.
    this.companyService.getSettings().subscribe({
      next: (s) => this.ratingMode.set(s.homeworkGradingMode === 'RATING'),
      error: () => {}, // stay on the number box if settings can't be read
    });

    // Keep the stored value honest even though the box is hidden — the server
    // enforces this on create, but an edit posts whatever is in the form.
    effect(() => {
      if (this.useRating()) this.form.get('maxGrade')!.setValue(HOMEWORK_RATING_MAX, { emitEvent: false });
    });
  }

  ngOnInit() {
    this.lookup.courses().subscribe({
      next: (c) => this.courses.set(c),
    });

    // The class list only makes sense within a course, and a class from the old
    // course would fail the server's class/course check — so switching course
    // reloads the options and drops the stale pick.
    this.form.get('courseId')!.valueChanges.subscribe((courseId: string) => {
      this.form.get('classId')!.setValue(null);
      this.loadClasses(courseId);
    });

    this.id = this.route.snapshot.paramMap.get('id');
    if (this.id) {
      this.isEditMode.set(true);
      this.load(this.id);
    }
  }

  private loadClasses(courseId: string | null) {
    if (!courseId) {
      this.classes.set([]);
      return;
    }
    this.lookup.classes({ courseId }).subscribe({
      next: (c) => this.classes.set(c),
    });
  }

  load(id: string) {
    this.loading.set(true);
    this.service.getById(id).subscribe({
      next: (row) => {
        // A homework already stored out of something other than the rating scale
        // stays on the number box, whatever the company setting says.
        this.ratingEligible.set(row.maxGrade == null || row.maxGrade === HOMEWORK_RATING_MAX);
        this.form.patchValue({
          isHomework: row.isHomework === true,
          courseId: row.courseId,
          name: row.name,
          examDate: row.examDate ? new Date(row.examDate) : new Date(),
          maxGrade: row.maxGrade ?? null,
          status: row.status,
        });
        // The courseId patch above synchronously fired valueChanges, which cleared
        // classId and kicked off the class load — so restore the saved class on
        // top of it. The select shows the name once the options land.
        this.form.get('classId')!.setValue(row.classId ?? null);
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
      isHomework: v.isHomework === true,
      courseId: v.courseId,
      // Always sent, so clearing the class widens the row back to the whole course.
      classId: v.classId || null,
      name: v.name?.trim(),
      examDate: this.toIsoDate(v.examDate),
      // Rating homework is always out of the scale's top mark, so a stored mark
      // maps back to exactly one label.
      maxGrade: this.useRating() ? HOMEWORK_RATING_MAX : (v.maxGrade ?? null),
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
    this.kindOptions.set([
      { label: this.translate.instant('EXAMS.KIND.EXAM'), value: false },
      { label: this.translate.instant('EXAMS.KIND.HOMEWORK'), value: true },
    ]);
  }

  private toIsoDate(d: any): string {
    if (d instanceof Date) return toLocalYmd(d);
    return d;
  }
}
