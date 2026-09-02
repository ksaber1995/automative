import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import {
  ExamModelDistribution,
  ExamModelsResponse,
  ExamPaperModel,
  ExamPoolQuestion,
} from '@shared/interfaces/exam.interface';

/**
 * The models (variants) of one online exam.
 *
 * Every mutation answers with the WHOLE model list rather than the one row it
 * touched, so the editor never has to patch its own state and can never drift
 * from the server — the counts, the class pinning and the lock all move
 * together.
 */
@Injectable({ providedIn: 'root' })
export class ExamModelsService {
  private api = inject(ApiService);

  list(examId: string): Observable<ExamModelsResponse> {
    return this.api.get<ExamModelsResponse>(`exams/${examId}/models`);
  }

  /** The bank to build from, optionally narrowed to some lessons. */
  questionPool(examId: string, lessonIds?: string[]): Observable<ExamPoolQuestion[]> {
    return this.api.get<ExamPoolQuestion[]>(
      `exams/${examId}/question-pool`,
      lessonIds?.length ? { lessonIds: lessonIds.join(',') } : undefined,
    );
  }

  /**
   * Add a model. Either hand-pick `questionIds` (their order is the paper
   * order), or pass `lessonIds` + `questionCount` to draw that many at random
   * once, now — after which the model is fixed.
   */
  create(examId: string, body: {
    name?: string | null;
    questionIds?: string[];
    lessonIds?: string[];
    questionCount?: number;
  }): Observable<{ models: ExamPaperModel[] }> {
    return this.api.post<{ models: ExamPaperModel[] }>(`exams/${examId}/models`, body);
  }

  update(modelId: string, body: {
    name?: string | null;
    questionIds?: string[];
    lessonIds?: string[];
    questionCount?: number;
  }): Observable<{ models: ExamPaperModel[] }> {
    return this.api.patch<{ models: ExamPaperModel[] }>(`exams/models/${modelId}`, body);
  }

  remove(modelId: string): Observable<{ models: ExamPaperModel[] }> {
    return this.api.delete<{ models: ExamPaperModel[] }>(`exams/models/${modelId}`);
  }

  setDistribution(examId: string, body: {
    distribution: ExamModelDistribution;
    assignments?: { classId: string; modelId: string }[];
  }): Observable<{ distribution: ExamModelDistribution; models: ExamPaperModel[] }> {
    return this.api.put<{ distribution: ExamModelDistribution; models: ExamPaperModel[] }>(
      `exams/${examId}/model-distribution`,
      body,
    );
  }
}
