import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  ExamModelDistribution,
  ExamModel as Exam,
  ExamPaperModel,
  ExamPoolQuestion,
} from '@shared/interfaces/exam.interface';
import { ExamModelsService } from '../services/exam-models.service';
import { ExamService } from '../services/exam.service';
import { LessonService } from '../../lessons/services/lesson.service';
import { NotificationService } from '../../../core/services/notification.service';

/** What the add/edit dialog is doing, and how the paper is being chosen. */
type BuildMode = 'PICK' | 'DRAW';

/**
 * The models (variants) of one online exam — "Test 1" with Model A / B / C.
 *
 * Its own screen rather than a section of the exam form, for two reasons: a
 * model needs the exam to exist before it can reference it, and picking
 * questions out of a bank of a hundred needs the whole width.
 *
 * Everything here is frozen once a single student has started (`locked`), the
 * same rule the exam's lesson scope already has — papers already drawn came
 * from these models, and editing them afterwards would leave two students
 * marked against different things under one exam name.
 */
@Component({
  selector: 'app-exam-models',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ButtonModule, CardModule, CheckboxModule,
    DialogModule, InputNumberModule, InputTextModule, MultiSelectModule, SelectModule,
    TagModule, TooltipModule, ConfirmDialogModule, TranslateModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './exam-models.component.html',
})
export class ExamModelsComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private service = inject(ExamModelsService);
  private examService = inject(ExamService);
  private lessonService = inject(LessonService);
  private notify = inject(NotificationService);
  private confirm = inject(ConfirmationService);
  private translate = inject(TranslateService);

  protected examId = '';
  protected exam = signal<Exam | null>(null);
  protected models = signal<ExamPaperModel[]>([]);
  protected classes = signal<{ id: string; name: string }[]>([]);
  protected distribution = signal<ExamModelDistribution | null>(null);
  protected locked = signal(false);
  protected loading = signal(true);
  protected saving = signal(false);

  /** Lessons of this exam's course, for the "draw from lessons" mode. */
  protected lessons = signal<{ id: string; name: string; questionCount?: number }[]>([]);

  // ── The add / edit dialog ────────────────────────────────────────────────
  protected dialogOpen = signal(false);
  protected editing = signal<ExamPaperModel | null>(null);
  protected mode = signal<BuildMode>('DRAW');
  protected draftName = signal('');
  protected draftLessonIds = signal<string[]>([]);
  protected draftCount = signal<number>(10);
  protected draftPicked = signal<string[]>([]);
  protected pool = signal<ExamPoolQuestion[]>([]);
  protected poolLoading = signal(false);
  protected poolSearch = signal('');
  protected poolLessonFilter = signal<string[]>([]);
  protected formError = signal<string | null>(null);

  /** Per-class model choice, edited locally then saved in one call. */
  protected assignments = signal<Record<string, string>>({});

  protected readonly distributionOptions = computed(() => [
    { label: this.translate.instant('EXAMS.MODELS.DIST_RANDOM'), value: 'RANDOM' },
    { label: this.translate.instant('EXAMS.MODELS.DIST_BY_CLASS'), value: 'BY_CLASS' },
  ]);

  protected modelOptions = computed(() =>
    this.models().map((m) => ({ label: `${m.name} (${m.questionCount})`, value: m.id })));

  /** Models differ in length — worth saying plainly, since marks then differ too. */
  protected uneven = computed(() => {
    const counts = new Set(this.models().map((m) => m.questionCount));
    return this.models().length > 1 && counts.size > 1;
  });

  protected canAdd = computed(() => !this.locked() && this.models().length < 6);

  /** The pool, after the dialog's own search and lesson filter. */
  protected visiblePool = computed(() => {
    const q = this.poolSearch().trim().toLowerCase();
    const lessonIds = this.poolLessonFilter();
    return this.pool().filter((p) => {
      if (lessonIds.length && (!p.lessonId || !lessonIds.includes(p.lessonId))) return false;
      return !q || p.questionText.toLowerCase().includes(q);
    });
  });

  ngOnInit(): void {
    this.examId = this.route.snapshot.paramMap.get('id') ?? '';
    if (!this.examId) {
      this.router.navigate(['/exams']);
      return;
    }
    this.examService.getById(this.examId).subscribe({
      next: (e) => {
        this.exam.set(e);
        this.loadLessons(e.courseId);
      },
      error: () => {},
    });
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.service.list(this.examId).subscribe({
      next: (res) => {
        this.models.set(res.models);
        this.classes.set(res.classes);
        this.distribution.set(res.distribution);
        this.locked.set(res.locked);
        // Rebuild the local per-class picks from what the server holds.
        const map: Record<string, string> = {};
        for (const m of res.models) for (const c of m.classIds) map[c] = m.id;
        this.assignments.set(map);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.notify.error(err?.error?.message || this.translate.instant('EXAMS.MODELS.LOAD_ERROR'));
      },
    });
  }

  private loadLessons(courseId?: string | null): void {
    if (!courseId) return;
    this.lessonService.getAll({ courseId }).subscribe({
      next: (rows: any[]) => this.lessons.set(
        rows.map((l) => ({ id: l.id, name: l.name, questionCount: l.questionCount }))),
      error: () => {},
    });
  }

  // ── Dialog ───────────────────────────────────────────────────────────────

  protected openAdd(): void {
    this.editing.set(null);
    this.mode.set('DRAW');
    this.draftName.set('');
    this.draftLessonIds.set([]);
    this.draftCount.set(10);
    this.draftPicked.set([]);
    this.formError.set(null);
    this.poolSearch.set('');
    this.poolLessonFilter.set([]);
    this.dialogOpen.set(true);
    this.loadPool();
  }

  protected openEdit(m: ExamPaperModel): void {
    this.editing.set(m);
    // Editing starts from what the model already holds, which is a hand-picked
    // list by definition — redrawing is an explicit switch to DRAW.
    this.mode.set('PICK');
    this.draftName.set(m.name);
    this.draftPicked.set(m.questions.map((q) => q.questionId));
    this.draftLessonIds.set([]);
    this.draftCount.set(m.questionCount || 10);
    this.formError.set(null);
    this.poolSearch.set('');
    this.poolLessonFilter.set([]);
    this.dialogOpen.set(true);
    this.loadPool();
  }

  private loadPool(): void {
    this.poolLoading.set(true);
    this.service.questionPool(this.examId).subscribe({
      next: (rows) => { this.pool.set(rows); this.poolLoading.set(false); },
      error: () => this.poolLoading.set(false),
    });
  }

  protected togglePick(id: string): void {
    this.draftPicked.update((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  }

  protected isPicked(id: string): boolean {
    return this.draftPicked().includes(id);
  }

  /** 1-based position in the paper, so the order being built is visible. */
  protected pickPosition(id: string): number {
    return this.draftPicked().indexOf(id) + 1;
  }

  protected pickAllVisible(): void {
    const ids = this.visiblePool().map((p) => p.id);
    this.draftPicked.update((cur) => [...cur, ...ids.filter((i) => !cur.includes(i))]);
  }

  protected clearPicks(): void {
    this.draftPicked.set([]);
  }

  /** How many questions the chosen lessons can offer, for the DRAW mode cap. */
  protected drawPoolSize = computed(() => {
    const ids = this.draftLessonIds();
    if (!ids.length) return 0;
    return this.pool().filter((p) => p.lessonId && ids.includes(p.lessonId)).length;
  });

  protected save(): void {
    if (this.saving()) return;
    this.formError.set(null);

    const name = this.draftName().trim() || null;
    let body: any;
    if (this.mode() === 'PICK') {
      const ids = this.draftPicked();
      if (!ids.length) {
        this.formError.set(this.translate.instant('EXAMS.MODELS.PICK_SOME'));
        return;
      }
      body = { name, questionIds: ids };
    } else {
      const lessonIds = this.draftLessonIds();
      const count = Number(this.draftCount());
      if (!lessonIds.length) {
        this.formError.set(this.translate.instant('EXAMS.MODELS.CHOOSE_LESSONS'));
        return;
      }
      if (!Number.isFinite(count) || count < 1) {
        this.formError.set(this.translate.instant('EXAMS.MODELS.BAD_COUNT'));
        return;
      }
      if (count > this.drawPoolSize()) {
        this.formError.set(this.translate.instant('EXAMS.MODELS.NOT_ENOUGH', { count: this.drawPoolSize() }));
        return;
      }
      body = { name, lessonIds, questionCount: count };
    }

    this.saving.set(true);
    const editing = this.editing();
    const call = editing
      ? this.service.update(editing.id, body)
      : this.service.create(this.examId, body);

    call.subscribe({
      next: (res) => {
        this.saving.set(false);
        this.dialogOpen.set(false);
        this.models.set(res.models);
        this.notify.success(this.translate.instant(
          editing ? 'EXAMS.MODELS.SAVED' : 'EXAMS.MODELS.ADDED'));
        // The first model turns the exam into a model exam server-side, and a
        // redraw changes the counts — re-read rather than guess.
        this.load();
      },
      error: (err) => {
        this.saving.set(false);
        this.formError.set(err?.error?.message || this.translate.instant('EXAMS.MODELS.SAVE_ERROR'));
      },
    });
  }

  protected confirmRemove(m: ExamPaperModel): void {
    this.confirm.confirm({
      header: this.translate.instant('EXAMS.MODELS.DELETE_TITLE'),
      message: this.translate.instant('EXAMS.MODELS.DELETE_MSG', { name: m.name }),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.service.remove(m.id).subscribe({
          next: () => {
            this.notify.success(this.translate.instant('EXAMS.MODELS.DELETED'));
            this.load();
          },
          error: (err) => this.notify.error(
            err?.error?.message || this.translate.instant('EXAMS.MODELS.SAVE_ERROR')),
        });
      },
    });
  }

  // ── Distribution ─────────────────────────────────────────────────────────

  protected setDistribution(value: ExamModelDistribution): void {
    this.distribution.set(value);
    this.saveDistribution();
  }

  protected assignClass(classId: string, modelId: string): void {
    this.assignments.update((m) => ({ ...m, [classId]: modelId }));
  }

  protected saveDistribution(): void {
    const distribution = this.distribution();
    if (!distribution || !this.models().length) return;

    const assignments = Object.entries(this.assignments())
      .filter(([, modelId]) => !!modelId)
      .map(([classId, modelId]) => ({ classId, modelId }));

    this.saving.set(true);
    this.service.setDistribution(this.examId, { distribution, assignments }).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.models.set(res.models);
        this.notify.success(this.translate.instant('EXAMS.MODELS.DIST_SAVED'));
      },
      error: (err) => {
        this.saving.set(false);
        this.notify.error(err?.error?.message || this.translate.instant('EXAMS.MODELS.SAVE_ERROR'));
      },
    });
  }

  /** Classes with no model chosen — they fall back to a random one. */
  protected unassignedClasses = computed(() =>
    this.classes().filter((c) => !this.assignments()[c.id]));

  protected back(): void {
    this.router.navigate(['/exams', this.examId]);
  }
}
