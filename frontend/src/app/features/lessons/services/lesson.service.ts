import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import {
  LessonModel,
  LessonCreateDto,
  LessonUpdateDto,
  LessonQuestionModel,
  LessonQuestionCreateDto,
  LessonQuestionUpdateDto,
} from '@shared/interfaces/lesson.interface';

/**
 * Lessons — a course's curriculum, in order. Part of the online-exams feature, so
 * every endpoint here is behind the per-tenant flag (`AuthService.canUseOnlineExams`).
 */
@Injectable({ providedIn: 'root' })
export class LessonService {
  private api = inject(ApiService);

  getAll(filters?: { courseId?: string; branchId?: string; includeInactive?: string }): Observable<LessonModel[]> {
    return this.api.get<LessonModel[]>('lessons', filters);
  }

  getById(id: string): Observable<LessonModel> {
    return this.api.get<LessonModel>(`lessons/${id}`);
  }

  create(dto: LessonCreateDto): Observable<LessonModel> {
    return this.api.post<LessonModel>('lessons', dto);
  }

  update(id: string, dto: LessonUpdateDto): Observable<LessonModel> {
    return this.api.patch<LessonModel>(`lessons/${id}`, dto);
  }

  delete(id: string): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`lessons/${id}`);
  }

  /** Rewrites the order of a course's lessons from the order of the ids. */
  reorder(courseId: string, lessonIds: string[]): Observable<{ success: boolean; count: number }> {
    return this.api.post<{ success: boolean; count: number }>('lessons/reorder', { courseId, lessonIds });
  }

  // ─── Question bank ──────────────────────────────────────────────────────────

  getQuestions(lessonId: string): Observable<LessonQuestionModel[]> {
    return this.api.get<LessonQuestionModel[]>(`lessons/${lessonId}/questions`);
  }

  createQuestion(lessonId: string, dto: LessonQuestionCreateDto): Observable<LessonQuestionModel> {
    return this.api.post<LessonQuestionModel>(`lessons/${lessonId}/questions`, dto);
  }

  updateQuestion(lessonId: string, questionId: string, dto: LessonQuestionUpdateDto): Observable<LessonQuestionModel> {
    return this.api.patch<LessonQuestionModel>(`lessons/${lessonId}/questions/${questionId}`, dto);
  }

  deleteQuestion(lessonId: string, questionId: string): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`lessons/${lessonId}/questions/${questionId}`);
  }
}
