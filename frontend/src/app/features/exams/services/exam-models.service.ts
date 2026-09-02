import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import {
  ExamModelDistribution,
  ExamModelLibrary,
  ExamModelsForExam,
  ExamPaperModel,
  ExamPoolQuestion,
  ExamPrintablePaper,
} from '@shared/interfaces/exam.interface';

/**
 * Exam models: a LIBRARY of ready-made papers per course, plus which of them a
 * given exam hands out.
 *
 * Every mutation answers with the whole list rather than the row it touched, so
 * the screens never patch their own state and cannot drift from the server —
 * counts, locks and class pinning all move together.
 */
@Injectable({ providedIn: 'root' })
export class ExamModelsService {
  private api = inject(ApiService);

  // ── The library ───────────────────────────────────────────────────────────

  library(courseId: string): Observable<ExamModelLibrary> {
    return this.api.get<ExamModelLibrary>('exam-models', { courseId });
  }

  /** The bank to build from, optionally narrowed to some lessons. */
  questionPool(courseId: string, lessonIds?: string[]): Observable<ExamPoolQuestion[]> {
    return this.api.get<ExamPoolQuestion[]>('exam-models/question-pool', {
      courseId,
      ...(lessonIds?.length ? { lessonIds: lessonIds.join(',') } : {}),
    });
  }

  /**
   * Add a model to a course's library. Either hand-pick `questionIds` (their
   * order is the paper order), or pass `lessonIds` + `questionCount` to draw
   * that many at random once, now — after which the model is fixed.
   */
  create(body: {
    courseId: string;
    name?: string | null;
    questionIds?: string[];
    lessonIds?: string[];
    questionCount?: number;
  }): Observable<{ models: ExamPaperModel[] }> {
    return this.api.post<{ models: ExamPaperModel[] }>('exam-models', body);
  }

  update(modelId: string, body: {
    name?: string | null;
    questionIds?: string[];
    lessonIds?: string[];
    questionCount?: number;
  }): Observable<{ models: ExamPaperModel[] }> {
    return this.api.patch<{ models: ExamPaperModel[] }>(`exam-models/${modelId}`, body);
  }

  remove(modelId: string): Observable<{ models: ExamPaperModel[] }> {
    return this.api.delete<{ models: ExamPaperModel[] }>(`exam-models/${modelId}`);
  }

  /**
   * The model as a printable paper — questions in order WITH their options,
   * which the list routes omit. `withAnswers` marks the correct one, for the
   * marking copy; the plain sheet is what gets handed to students.
   */
  paper(modelId: string, withAnswers = false): Observable<ExamPrintablePaper> {
    return this.api.get<ExamPrintablePaper>(
      `exam-models/${modelId}/paper`,
      withAnswers ? { withAnswers: 'true' } : undefined,
    );
  }

  // ── Per exam ──────────────────────────────────────────────────────────────

  forExam(examId: string): Observable<ExamModelsForExam> {
    return this.api.get<ExamModelsForExam>(`exams/${examId}/models`);
  }

  /**
   * Everything about how this exam hands out models, in one call. Replaced
   * wholesale — it is the state, not a patch. An empty `modelIds` puts the exam
   * back to a random pooled paper.
   */
  setForExam(examId: string, body: {
    modelIds: string[];
    distribution?: ExamModelDistribution;
    assignments?: { classId: string; modelId: string }[];
  }): Observable<{
    questionSource: 'RANDOM' | 'FIXED';
    distribution: ExamModelDistribution | null;
    models: ExamPaperModel[];
  }> {
    return this.api.put(`exams/${examId}/models`, body);
  }
}
