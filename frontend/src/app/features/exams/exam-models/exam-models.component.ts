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
  ExamPrintablePaper,
} from '@shared/interfaces/exam.interface';
import { ExamModelsService } from '../services/exam-models.service';
import { ExamService } from '../services/exam.service';
import { LessonService } from '../../lessons/services/lesson.service';
import { NotificationService } from '../../../core/services/notification.service';
import { LanguageService } from '../../../core/services/language.service';
import { esc, openPrintWindow } from '../../../core/utils/print-report.util';

/** What the add/edit dialog is doing, and how the paper is being chosen. */
type BuildMode = 'PICK' | 'DRAW';

/**
 * An exam paper is not a report: it needs readable body text and room to write,
 * where the shared print stylesheet is a dense 11px table. Appended after the
 * house rules, so it overrides only what it must.
 */
const PAPER_CSS = `
  body { font-size: 13px; line-height: 1.5; }
  h1 { font-size: 20px; }
  .model-line { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
  .model-name { font-size: 15px; font-weight: 700; }
  .key-badge {
    border: 1px solid #b91c1c; color: #b91c1c; border-radius: 4px;
    padding: 1px 6px; font-size: 10px; font-weight: 700; text-transform: uppercase;
  }
  /* Name / class / mark, for the copy that gets handed out. */
  .fields { display: flex; gap: 14px; margin: 12px 0 18px; }
  .field { flex: 1; border-bottom: 1px solid #9ca3af; padding-bottom: 2px; color: #6b7280; font-size: 11px; }
  .field.short { flex: 0 0 90px; }
  /* A question is never split across a page break — half a question is useless. */
  .q { page-break-inside: avoid; margin: 0 0 14px; }
  .q-head { display: flex; gap: 6px; font-weight: 600; }
  .q-n { min-width: 18px; }
  .opts { list-style: none; margin: 6px 0 0; padding: 0 0 0 24px; }
  .opts li { display: flex; gap: 6px; padding: 2px 0; }
  .opts .letter { min-width: 16px; color: #6b7280; }
  .opts li.correct { font-weight: 700; }
  .opts .tick { color: #047857; }
  .expl { margin: 4px 0 0 24px; color: #6b7280; font-size: 11px; font-style: italic; }
`;

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
  private language = inject(LanguageService);

  /** Which print is being fetched — `<modelId>` or `<modelId>:key`. */
  protected printingId = signal<string | null>(null);

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

  // ── Printing ─────────────────────────────────────────────────────────────

  /**
   * Print one model as a paper. `withAnswers` produces the marking copy, with
   * the correct option ticked and any explanation under the question.
   *
   * Options print in the BANK order. On screen each student gets them shuffled
   * (shuffle_options), so this sheet is the paper in its own right rather than a
   * mirror of one student's screen — which is what you want on paper, and worth
   * remembering before marking screens from it by hand.
   */
  protected print(m: ExamPaperModel, withAnswers = false): void {
    this.printingId.set(m.id + (withAnswers ? ':key' : ''));
    this.service.paper(m.id, withAnswers).subscribe({
      next: (paper) => {
        this.printingId.set(null);
        openPrintWindow({
          title: `${paper.examName} — ${paper.modelName}`,
          rtl: this.language.isRtl(),
          extraCss: PAPER_CSS,
          body: this.paperHtml(paper),
        });
      },
      error: (err) => {
        this.printingId.set(null);
        this.notify.error(err?.error?.message || this.translate.instant('EXAMS.MODELS.PRINT_ERROR'));
      },
    });
  }

  private paperHtml(p: ExamPrintablePaper): string {
    const t = (k: string, v?: any) => this.translate.instant(k, v);
    const letters = 'ABCDEFGHIJ';

    const meta = [
      p.examDate,
      p.durationMinutes ? t('EXAMS.MODELS.PRINT_MINUTES', { count: p.durationMinutes }) : null,
      t('EXAMS.MODELS.N_QUESTIONS', { count: p.questionCount }),
    ].filter(Boolean).join(' · ');

    // Name/class lines only on the student copy — the marking copy is the
    // teacher's and has nothing to fill in.
    const nameFields = p.withAnswers ? '' : `
      <div class="fields">
        <div class="field">${esc(t('EXAMS.MODELS.PRINT_NAME'))}</div>
        <div class="field">${esc(t('EXAMS.MODELS.PRINT_CLASS'))}</div>
        <div class="field short">${esc(t('EXAMS.MODELS.PRINT_MARK'))}</div>
      </div>`;

    const questions = p.questions.map((q) => {
      const options = q.options.map((o, i) => `
        <li class="${o.isCorrect ? 'correct' : ''}">
          <span class="letter">${letters[i] ?? i + 1}.</span>
          <span>${esc(o.text)}</span>
          ${o.isCorrect ? `<span class="tick">✔</span>` : ''}
        </li>`).join('');
      return `
        <div class="q">
          <div class="q-head">
            <span class="q-n">${q.orderIndex}.</span>
            <span class="q-t">${esc(q.questionText)}</span>
          </div>
          <ol class="opts">${options}</ol>
          ${q.explanation ? `<div class="expl">${esc(q.explanation)}</div>` : ''}
        </div>`;
    }).join('');

    return `
      <h1>${esc(p.examName)}</h1>
      <div class="model-line">
        <span class="model-name">${esc(p.modelName)}</span>
        ${p.withAnswers ? `<span class="key-badge">${esc(t('EXAMS.MODELS.PRINT_KEY_BADGE'))}</span>` : ''}
      </div>
      <div class="meta">${esc(meta)}</div>
      ${nameFields}
      ${questions || `<p class="empty">${esc(t('EXAMS.MODELS.PRINT_EMPTY'))}</p>`}`;
  }

  protected back(): void {
    this.router.navigate(['/exams', this.examId]);
  }
}
