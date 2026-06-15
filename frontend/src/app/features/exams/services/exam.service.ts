import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import {
  ExamModel,
  ExamCreateDto,
  ExamUpdateDto,
  ExamResultRow,
  QrExamResult,
  StudentExamResult,
} from '@shared/interfaces/exam.interface';

@Injectable({ providedIn: 'root' })
export class ExamService {
  private api = inject(ApiService);

  getAll(filters?: { branchId?: string; courseId?: string; status?: string }): Observable<ExamModel[]> {
    return this.api.get<ExamModel[]>('exams', filters);
  }

  getById(id: string): Observable<ExamModel> {
    return this.api.get<ExamModel>(`exams/${id}`);
  }

  create(dto: ExamCreateDto): Observable<ExamModel> {
    return this.api.post<ExamModel>('exams', dto);
  }

  update(id: string, dto: ExamUpdateDto): Observable<ExamModel> {
    return this.api.patch<ExamModel>(`exams/${id}`, dto);
  }

  delete(id: string): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`exams/${id}`);
  }

  /** Grading roster: every enrolled student of the exam's course + their grade. */
  getResults(id: string): Observable<ExamResultRow[]> {
    return this.api.get<ExamResultRow[]>(`exams/${id}/results`);
  }

  /** Record/update a grade by scanning the student's QR token. */
  recordByQr(id: string, qrToken: string, grade: string): Observable<QrExamResult> {
    return this.api.post<QrExamResult>(`exams/${id}/record-by-qr`, { qrToken, grade });
  }

  /** Manual (no-camera) grade entry from the roster. */
  saveResult(id: string, studentId: string, grade: string): Observable<{ success: boolean }> {
    return this.api.post<{ success: boolean }>(`exams/${id}/results`, { studentId, grade });
  }

  deleteResult(id: string, studentId: string): Observable<{ success: boolean }> {
    return this.api.delete<{ success: boolean }>(`exams/${id}/results/${studentId}`);
  }

  /** All of a student's recorded grades (student-detail page). */
  getByStudent(studentId: string): Observable<StudentExamResult[]> {
    return this.api.get<StudentExamResult[]>(`exams/student/${studentId}`);
  }
}
