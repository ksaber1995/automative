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
  ExamPaperModel,
  ExamPoolQuestion,
  ExamPrintablePaper,
} from '@shared/interfaces/exam.interface';
import { ExamModelsService } from '../services/exam-models.service';
import { CourseService } from '../../courses/services/course.service';
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
 *
 * The `@media screen` block is the important one. The shared sheet sets
 * `body { margin: 0 }` and leaves the page edges to `@page`, which only applies
 * to actual printing — so in the popup (and in the browser's own print preview)
 * the paper sat flush against the window with nothing around it and looked
 * unstyled. Screen gets its own padding and a readable measure; print keeps the
 * @page margins so the two do not stack.
 */
const PAPER_CSS = `
  @media screen {
    body {
      padding: 32px 36px 48px;
      max-width: 820px;
      margin: 0 auto;
      background: #fff;
    }
  }
  body { font-size: 13.5px; line-height: 1.6; color: #111827; }

  /* ── Header ─────────────────────────────────────────────── */
  .head { border-bottom: 2px solid #111827; padding-bottom: 10px; margin-bottom: 4px; }
  h1 { font-size: 19px; margin: 0 0 6px; }
  .model-line { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .model-name {
    font-size: 14px; font-weight: 700; background: #111827; color: #fff;
    border-radius: 4px; padding: 3px 12px;
  }
  .key-badge {
    border: 1.5px solid #b91c1c; color: #b91c1c; border-radius: 4px;
    padding: 2px 8px; font-size: 10.5px; font-weight: 700; letter-spacing: .04em;
    text-transform: uppercase;
  }
  .meta { color: #6b7280; font-size: 11.5px; margin: 8px 0 0; }

  /* ── Name / class / mark, on the copy that gets handed out ── */
  .fields { display: flex; gap: 18px; margin: 18px 0 26px; }
  .field {
    flex: 1; border-bottom: 1px solid #9ca3af; padding: 0 2px 4px;
    color: #6b7280; font-size: 11px;
  }
  .field.short { flex: 0 0 110px; }

  /* ── Questions ──────────────────────────────────────────── */
  /* Never split a question across a page break — half a question is useless. */
  .q { page-break-inside: avoid; break-inside: avoid; margin: 0 0 18px; }
  .q-head { display: flex; gap: 10px; align-items: baseline; }
  .q-n {
    flex: 0 0 24px; height: 24px; border-radius: 50%; background: #f3f4f6;
    color: #374151; font-weight: 700; font-size: 12px;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .q-t { font-weight: 600; flex: 1; }
  .opts { list-style: none; margin: 8px 0 0; padding: 0; }
  /* Indent under the number bubble, on whichever side the page reads from. */
  .opts li {
    display: flex; gap: 8px; padding: 3px 0; margin-inline-start: 34px;
    align-items: baseline;
  }
  .opts .letter {
    flex: 0 0 auto; min-width: 20px; color: #6b7280; font-weight: 600;
  }
  .opts li.correct { font-weight: 700; color: #065f46; }
  .opts .tick { color: #047857; font-weight: 700; }
  .expl {
    margin: 6px 0 0 34px; padding: 6px 10px; background: #f9fafb;
    border-inline-start: 3px solid #d1d5db;
    color: #4b5563; font-size: 11.5px;
  }
  .empty { color: #6b7280; }
`;

/**
 * THE EXAM MODEL LIBRARY — ready-made papers, built per course.
 *
 * Its own sidebar screen, like the question bank: you build "Model A / B / C"
 * for a course once, and any exam on that course can hand them out (an exam
 * picks its type and models on the exam itself). A retake reuses them instead
 * of rebuilding them.
 *
 * A model locks as soon as an exam using it has been started — editing it then
 * would rewrite a paper already handed out. The lock is per model, so a course
 * can hold both a model already sat and a fresh one being worked on.
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
  private courseService = inject(CourseService);
  private lessonService = inject(LessonService);
  private notify = inject(NotificationService);
  private confirm = inject(ConfirmationService);
  private translate = inject(TranslateService);
  private language = inject(LanguageService);

  /** Which print is being fetched — `<modelId>` or `<modelId>:key`. */
  protected printingId = signal<string | null>(null);

  protected courses = signal<{ id: string; name: string }[]>([]);
  protected courseId = signal<string | null>(null);
  protected models = signal<ExamPaperModel[]>([]);
  /** Ids an exam has already sat — not editable. */
  protected lockedIds = signal<string[]>([]);
  protected loading = signal(false);
  protected loadingCourses = signal(true);
  protected saving = signal(false);

  /** Lessons of the chosen course, for the "draw from lessons" mode. */
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

  /** Models differ in length — worth saying plainly, since marks then differ too. */
  protected uneven = computed(() => {
    const counts = new Set(this.models().map((m) => m.questionCount));
    return this.models().length > 1 && counts.size > 1;
  });

  /** A library has no ceiling; the 2–6 limit is on what ONE exam hands out. */
  protected canAdd = computed(() => !!this.courseId());

  protected isLocked(m: ExamPaperModel): boolean {
    return this.lockedIds().includes(m.id);
  }

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
    this.courseService.getAllCourses().subscribe({
      next: (rows: any[]) => {
        this.courses.set(rows.map((c) => ({ id: c.id, name: c.name })));
        this.loadingCourses.set(false);
        // A models library only means anything beside one course's bank, so it
        // opens on the first course rather than on an empty page.
        const first = this.route.snapshot.queryParamMap.get('courseId') || rows[0]?.id;
        if (first) this.onCourseChange(first);
      },
      error: () => this.loadingCourses.set(false),
    });
  }

  protected onCourseChange(courseId: string | null): void {
    this.courseId.set(courseId);
    this.models.set([]);
    this.lockedIds.set([]);
    if (!courseId) return;
    this.loadLessons(courseId);
    this.load();
  }

  private load(): void {
    const courseId = this.courseId();
    if (!courseId) return;
    this.loading.set(true);
    this.service.library(courseId).subscribe({
      next: (res) => {
        this.models.set(res.models);
        this.lockedIds.set(res.locked ?? []);
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
    const courseId = this.courseId();
    if (!courseId) return;
    this.poolLoading.set(true);
    this.service.questionPool(courseId).subscribe({
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
    const courseId = this.courseId()!;
    const call = editing
      ? this.service.update(editing.id, body)
      : this.service.create({ courseId, ...body });

    call.subscribe({
      next: (res) => {
        this.saving.set(false);
        this.dialogOpen.set(false);
        this.models.set(res.models);
        this.notify.success(this.translate.instant(
          editing ? 'EXAMS.MODELS.SAVED' : 'EXAMS.MODELS.ADDED'));
        // Re-read rather than guess: a redraw changes counts, and the lock list
        // is computed server-side.
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

  // ── Viewing ──────────────────────────────────────────────────────────────

  /**
   * Read the paper on screen before committing it to paper — the common case is
   * "which one is Model B again?", which should not cost a print dialog.
   *
   * Fetched WITH the answers and toggled client-side, so ticking the box does
   * not go back to the server. It is a teacher screen; the question bank editor
   * already shows the key to the same permission.
   */
  protected viewing = signal<ExamPrintablePaper | null>(null);
  protected viewingName = signal('');
  protected showAnswers = signal(false);
  protected viewLoadingId = signal<string | null>(null);

  protected view(m: ExamPaperModel): void {
    this.viewLoadingId.set(m.id);
    this.showAnswers.set(false);
    this.service.paper(m.id, true).subscribe({
      next: (paper) => {
        this.viewLoadingId.set(null);
        this.viewingName.set(m.name);
        this.viewing.set(paper);
      },
      error: (err) => {
        this.viewLoadingId.set(null);
        this.notify.error(err?.error?.message || this.translate.instant('EXAMS.MODELS.PRINT_ERROR'));
      },
    });
  }

  /** A..J for the option letters, matching the printed sheet. */
  protected optionLetter(index: number): string {
    return 'ABCDEFGHIJ'[index] ?? String(index + 1);
  }

  /** Print straight from the preview, without hunting for the row again. */
  protected printFromView(withAnswers: boolean): void {
    const paper = this.viewing();
    if (!paper) return;
    openPrintWindow({
      title: `${paper.examName} — ${paper.modelName}`,
      rtl: this.language.isRtl(),
      extraCss: PAPER_CSS,
      // The preview holds the answers whether or not they are on screen, so the
      // printed copy is built from a filtered view of the same paper.
      body: this.paperHtml(withAnswers ? paper : {
        ...paper,
        withAnswers: false,
        questions: paper.questions.map((q) => ({
          ...q,
          explanation: null,
          options: q.options.map((o) => ({ text: o.text })),
        })),
      }),
    });
  }

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
      <div class="head">
        <h1>${esc(p.examName)}</h1>
        <div class="model-line">
          <span class="model-name">${esc(p.modelName)}</span>
          ${p.withAnswers ? `<span class="key-badge">${esc(t('EXAMS.MODELS.PRINT_KEY_BADGE'))}</span>` : ''}
        </div>
        ${meta ? `<div class="meta">${esc(meta)}</div>` : ''}
      </div>
      ${nameFields}
      ${questions || `<p class="empty">${esc(t('EXAMS.MODELS.PRINT_EMPTY'))}</p>`}`;
  }

  protected back(): void {
    this.router.navigate(['/exams']);
  }
}
