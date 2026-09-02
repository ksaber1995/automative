import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  ExamModelDistribution,
  ExamModel as Exam,
  ExamPaperModel,
} from '@shared/interfaces/exam.interface';
import { ExamModelsService } from '../services/exam-models.service';
import { ExamService } from '../services/exam.service';
import { NotificationService } from '../../../core/services/notification.service';

/**
 * How ONE exam gets its paper: a fresh random draw per student, or the
 * ready-made models from its course library — and, if models, whether they go
 * out at random or one per class.
 *
 * The models themselves are built in the library (the Exam models screen); this
 * screen only chooses and distributes them, which is why it lives on the exam.
 *
 * Frozen once anybody has started, the same rule the exam's lesson scope has:
 * papers already drawn came from this choice.
 */
@Component({
  selector: 'app-exam-model-assign',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ButtonModule, CardModule, SelectModule,
    TagModule, TooltipModule, TranslateModule,
  ],
  templateUrl: './exam-model-assign.component.html',
})
export class ExamModelAssignComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private service = inject(ExamModelsService);
  private examService = inject(ExamService);
  private notify = inject(NotificationService);
  private translate = inject(TranslateService);

  protected examId = '';
  protected exam = signal<Exam | null>(null);
  protected loading = signal(true);
  protected saving = signal(false);
  protected locked = signal(false);

  protected source = signal<'RANDOM' | 'FIXED'>('RANDOM');
  protected distribution = signal<ExamModelDistribution>('RANDOM');
  /** Library models of this exam's course. */
  protected available = signal<ExamPaperModel[]>([]);
  /** Which of them this exam hands out, in the order chosen. */
  protected chosen = signal<string[]>([]);
  protected classes = signal<{ id: string; name: string }[]>([]);
  /** classId → modelId, edited locally and saved with everything else. */
  protected assignments = signal<Record<string, string>>({});

  protected readonly MAX = 6;

  protected chosenModels = computed(() => {
    const byId = new Map(this.available().map((m) => [m.id, m]));
    return this.chosen().map((id) => byId.get(id)).filter((m): m is ExamPaperModel => !!m);
  });

  /** Only the models this exam hands out may be pinned to a class. */
  protected modelOptions = computed(() =>
    this.chosenModels().map((m) => ({ label: `${m.name} (${m.questionCount})`, value: m.id })));

  protected uneven = computed(() => {
    const counts = new Set(this.chosenModels().map((m) => m.questionCount));
    return this.chosenModels().length > 1 && counts.size > 1;
  });

  protected unassignedClasses = computed(() =>
    this.classes().filter((c) => !this.assignments()[c.id]));

  protected canSave = computed(() =>
    !this.locked() && (this.source() === 'RANDOM' || this.chosen().length > 0));

  ngOnInit(): void {
    this.examId = this.route.snapshot.paramMap.get('id') ?? '';
    if (!this.examId) { this.router.navigate(['/exams']); return; }

    this.examService.getById(this.examId).subscribe({
      next: (e) => this.exam.set(e),
      error: () => {},
    });
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.service.forExam(this.examId).subscribe({
      next: (res) => {
        this.source.set(res.questionSource);
        this.distribution.set(res.distribution ?? 'RANDOM');
        this.available.set(res.available);
        this.chosen.set(res.models.map((m) => m.id));
        this.classes.set(res.classes);
        this.locked.set(res.locked);
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

  protected toggleModel(id: string): void {
    this.chosen.update((cur) => {
      if (cur.includes(id)) {
        // Dropping a model drops any class pinned to it — a pin to a model this
        // exam no longer hands out would be refused on save anyway.
        this.assignments.update((m) => {
          const next = { ...m };
          for (const [classId, modelId] of Object.entries(next)) {
            if (modelId === id) delete next[classId];
          }
          return next;
        });
        return cur.filter((x) => x !== id);
      }
      return cur.length >= this.MAX ? cur : [...cur, id];
    });
  }

  protected isChosen(id: string): boolean {
    return this.chosen().includes(id);
  }

  protected assignClass(classId: string, modelId: string): void {
    this.assignments.update((m) => ({ ...m, [classId]: modelId }));
  }

  protected save(): void {
    if (this.saving() || this.locked()) return;

    // RANDOM is expressed as "no models": the server reads an empty list as a
    // pooled paper, so there is one source of truth rather than two flags that
    // can disagree.
    const modelIds = this.source() === 'FIXED' ? this.chosen() : [];
    const assignments = modelIds.length
      ? Object.entries(this.assignments())
          .filter(([, modelId]) => modelIds.includes(modelId))
          .map(([classId, modelId]) => ({ classId, modelId }))
      : [];

    this.saving.set(true);
    this.service.setForExam(this.examId, {
      modelIds,
      distribution: this.distribution(),
      assignments,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.notify.success(this.translate.instant('EXAMS.MODELS.DIST_SAVED'));
        this.load();
      },
      error: (err) => {
        this.saving.set(false);
        this.notify.error(err?.error?.message || this.translate.instant('EXAMS.MODELS.SAVE_ERROR'));
      },
    });
  }

  protected openLibrary(): void {
    const courseId = this.exam()?.courseId;
    this.router.navigate(['/exam-models'], courseId ? { queryParams: { courseId } } : {});
  }

  protected back(): void {
    this.router.navigate(['/exams', this.examId]);
  }
}
