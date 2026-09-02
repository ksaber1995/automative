import { Component, OnInit, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { CheckboxModule } from 'primeng/checkbox';
import { TooltipModule } from 'primeng/tooltip';
import { DatePickerModule } from 'primeng/datepicker';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ExamService } from '../services/exam.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { NotificationService } from '../../../core/services/notification.service';
import { CompanyService } from '../../../core/services/company.service';
import { AuthService } from '../../../core/services/auth.service';
import { LessonService } from '../../lessons/services/lesson.service';
import { SessionService } from '../../rooms/services/session.service';
import { LessonModel } from '@shared/interfaces/lesson.interface';
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
    MultiSelectModule,
    CheckboxModule,
    TooltipModule,
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
  private auth = inject(AuthService);
  private lessonService = inject(LessonService);
  private sessionService = inject(SessionService);

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

  // ── Online exam ─────────────────────────────────────────────────────────────
  /** The whole online section is hidden unless the tenant has the feature. */
  canUseOnlineExams = computed(() => this.auth.canUseOnlineExams());
  private isOnlineKind = signal(false);
  isOnline = computed(() => this.isOnlineKind());

  /**
   * The exam hands out ready-made models instead of drawing a random paper. Its
   * lessons and question count are then irrelevant, so the form stops asking
   * for them — the exam is created with just a name and set up afterwards on its
   * Models screen.
   */
  private fixedModels = signal(false);
  isFixed = computed(() => this.fixedModels());

  /** Lessons of the selected course, each carrying its question count. */
  lessons = signal<LessonModel[]>([]);
  loadingLessons = signal(false);
  private selectedLessonIds = signal<string[]>([]);
  loadingTaught = signal(false);

  /**
   * How many questions the chosen lessons hold between them — the ceiling on the
   * paper length. Summed client-side from the lesson list, which already carries a
   * count per lesson, so the number moves as lessons are ticked.
   */
  poolSize = computed(() => {
    const chosen = new Set(this.selectedLessonIds());
    return this.lessons()
      .filter((l) => chosen.has(l.id))
      .reduce((sum, l) => sum + (l.questionCount ?? 0), 0);
  });

  /**
   * The typed question count, mirrored into a signal like isOnlineKind /
   * selectedLessonIds above. questionCountTooHigh used to read the form control
   * directly — but a computed() only re-runs when a SIGNAL it read changes, so
   * lowering the count re-evaluated nothing and "only N available" stuck on
   * screen until the next lesson tick.
   */
  private askedQuestionCount = signal(0);

  /** Asking for more questions than exist would give everyone a short paper. */
  questionCountTooHigh = computed(() => {
    if (!this.isOnline()) return false;
    return this.askedQuestionCount() > this.poolSize();
  });

  /**
   * The lesson scope and paper length freeze once anybody has started: papers
   * already drawn came from that pool, so changing it would mark two students out
   * of different things.
   *
   * Set from `attemptCounts.started` on load; the server stays the enforcement
   * (409 ERRORS.EXAMS.ALREADY_STARTED) for the race where the first student
   * starts while this form is already open.
   */
  scopeLocked = signal(false);

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
      // ── Online exam ──────────────────────────────────────────────────────
      isOnline: [false],
      // RANDOM draws a paper per student from the lessons below; FIXED hands out
      // exam models attached to the exam after it is saved.
      questionSource: ['RANDOM'],
      lessonIds: [[] as string[]],
      questionCount: [10],
      durationMinutes: [30],
      opensAt: [null as Date | null],
      closesAt: [null as Date | null],
      shuffleOptions: [true],
      showAnswers: [true],
    });

    this.form.get('isOnline')!.valueChanges.subscribe((v: boolean) => this.isOnlineKind.set(v === true));
    this.form.get('questionSource')!.valueChanges
      .subscribe((v: string) => this.fixedModels.set(v === 'FIXED'));
    this.form.get('lessonIds')!.valueChanges.subscribe((ids: string[]) => this.selectedLessonIds.set(ids ?? []));
    this.form.get('questionCount')!.valueChanges.subscribe((v: unknown) => this.askedQuestionCount.set(Number(v ?? 0)));
    this.askedQuestionCount.set(Number(this.form.get('questionCount')!.value ?? 0));

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
      // Same reasoning for lessons: they belong to a course, and the server refuses
      // a lesson from another one.
      this.form.get('lessonIds')!.setValue([]);
      this.loadLessons(courseId);
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

  private loadLessons(courseId: string | null) {
    if (!courseId || !this.canUseOnlineExams()) {
      this.lessons.set([]);
      return;
    }
    this.loadingLessons.set(true);
    this.lessonService.getAll({ courseId }).subscribe({
      next: (lessons) => {
        this.lessons.set(lessons);
        this.loadingLessons.set(false);
      },
      error: () => this.loadingLessons.set(false),
    });
  }

  /** Tick every lesson of the course. */
  selectAllLessons() {
    this.form.get('lessonIds')!.setValue(this.lessons().map((l) => l.id));
  }

  /**
   * Tick only the lessons THIS class has actually been taught.
   *
   * Classes of one course move through the curriculum at their own pace, so the
   * course's whole lesson list would examine material a given class has not reached.
   * The answer comes from the lesson tags on the class's sessions — and it expands
   * into an ordinary selection the teacher can still edit, because the exam stores
   * lesson ids, never a rule that could quietly widen later.
   */
  selectTaughtLessons() {
    const classId = this.form.get('classId')!.value;
    if (!classId) return;
    this.loadingTaught.set(true);
    this.sessionService.lessonsTaught(classId).subscribe({
      next: (taught) => {
        this.loadingTaught.set(false);
        if (!taught.length) {
          this.notifications.error(this.translate.instant('EXAMS.ONLINE.NO_TAUGHT_LESSONS'));
          return;
        }
        this.form.get('lessonIds')!.setValue(taught.map((l) => l.id));
      },
      error: () => this.loadingTaught.set(false),
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
          isOnline: row.isOnline === true,
          questionSource: row.questionSource === 'FIXED' ? 'FIXED' : 'RANDOM',
          questionCount: row.questionCount ?? 10,
          durationMinutes: row.durationMinutes ?? 30,
          opensAt: row.opensAt ? new Date(row.opensAt) : null,
          closesAt: row.closesAt ? new Date(row.closesAt) : null,
          shuffleOptions: row.shuffleOptions !== false,
          showAnswers: row.showAnswers !== false,
        });
        // Somebody has a paper drawn from this pool — the scope and count are
        // frozen (the server's 409 ALREADY_STARTED remains the backstop).
        this.scopeLocked.set((row.attemptCounts?.started ?? 0) > 0);
        // The courseId patch above synchronously fired valueChanges, which cleared
        // classId and lessonIds and kicked off both loads — so restore the saved
        // picks on top of them. The selects show names once the options land.
        this.form.get('classId')!.setValue(row.classId ?? null);
        this.form.get('lessonIds')!.setValue(row.lessonIds ?? []);
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
    // Both are enforced server-side; blocking here means the teacher is told at the
    // field rather than by a failed save.
    // A FIXED exam's paper comes from the models attached to it afterwards, so
    // it needs no lessons and no count — the point of it is to create the exam
    // first and decide what is on it later.
    if (v.isOnline === true && v.questionSource !== 'FIXED') {
      if (!v.lessonIds?.length) {
        this.notifications.error(this.translate.instant('ERRORS.EXAMS.LESSONS_REQUIRED'));
        return;
      }
      if (this.questionCountTooHigh()) {
        this.notifications.error(this.translate.instant('EXAMS.ONLINE.POOL_EXCEEDED', { count: this.poolSize() }));
        return;
      }
    }
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

    if (v.isOnline === true) {
      const fixed = v.questionSource === 'FIXED';
      payload.isOnline = true;
      payload.questionSource = fixed ? 'FIXED' : 'RANDOM';
      // A fixed exam sends neither: its paper is whichever model a student is
      // handed, and sending a stale count would put a wrong "out of" on the row.
      payload.lessonIds = fixed ? [] : (v.lessonIds ?? []);
      if (!fixed) payload.questionCount = Number(v.questionCount);
      payload.durationMinutes = Number(v.durationMinutes);
      payload.opensAt = v.opensAt ? new Date(v.opensAt).toISOString() : null;
      payload.closesAt = v.closesAt ? new Date(v.closesAt).toISOString() : null;
      payload.shuffleOptions = v.shuffleOptions === true;
      payload.showAnswers = v.showAnswers === true;
      // The server mirrors questionCount into maxGrade (one mark per question), so
      // don't send a stale number from the hidden box and start an argument.
      delete payload.maxGrade;
    } else if (this.isEditMode()) {
      // Explicitly off, so turning an online exam back into a paper one clears its
      // scope rather than leaving a stale one behind.
      payload.isOnline = false;
    }

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
