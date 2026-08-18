import { Injectable, inject } from '@angular/core';
import { normalizeStudentCode } from '../../../core/utils/student-code.util';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import {
  ExamModel,
  ExamCreateDto,
  ExamUpdateDto,
  ExamResultRow,
  ExamAttemptsResponse,
  QrExamResult,
  StudentCredentialInfo,
  StudentExamResult,
} from '@shared/interfaces/exam.interface';

@Injectable({ providedIn: 'root' })
export class ExamService {
  private api = inject(ApiService);

  /**
   * Exams AND homework — they share this table and the Exams & Homework screen.
   * Pass isHomework to narrow to one kind (the in-session panel does).
   */
  getAll(filters?: { branchId?: string; courseId?: string; status?: string; classId?: string; isHomework?: string }): Observable<ExamModel[]> {
    return this.api.get<ExamModel[]>('exams', filters);
  }

  /**
   * Everything set for one class, newest first — homework AND exams, since the
   * in-session panel can now create either and both must show up in its picker.
   * Course-wide exams have no class_id, so they stay out of this list.
   */
  getForClass(classId: string): Observable<ExamModel[]> {
    return this.api.get<ExamModel[]>('exams', { classId });
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

  /**
   * A fresh access code for an online exam — for a leaked code, or a second group
   * sitting the same exam later. Attempts already running are unaffected.
   */
  regenerateCode(id: string): Observable<{ accessCode: string }> {
    return this.api.post<{ accessCode: string }>(`exams/${id}/regenerate-code`, {});
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

  /** Record/update a grade by the student's short code (resolved server-side). */
  recordByCode(id: string, code: string, grade: string): Observable<QrExamResult> {
    code = normalizeStudentCode(code);   // cards print "A-100001"
    return this.api.post<QrExamResult>(`exams/${id}/record-by-code`, { code, grade });
  }

  /** Manual (no-camera) grade entry from the roster. */
  saveResult(id: string, studentId: string, grade: string): Observable<{ success: boolean }> {
    return this.api.post<{ success: boolean }>(`exams/${id}/results`, { studentId, grade });
  }

  deleteResult(id: string, studentId: string): Observable<{ success: boolean }> {
    return this.api.delete<{ success: boolean }>(`exams/${id}/results/${studentId}`);
  }

  /** Mark a student absent for the exam (absent=true) or clear it (absent=false). */
  markAbsent(id: string, studentId: string, absent: boolean): Observable<{ success: boolean }> {
    return this.api.post<{ success: boolean }>(`exams/${id}/absent`, { studentId, absent });
  }

  /** Send every graded/absent student's result to their Telegram chats. */
  sendTelegramResults(id: string): Observable<{ success: boolean; sent: number }> {
    return this.api.post<{ success: boolean; sent: number }>(`exams/${id}/send-telegram`, {});
  }

  /** Mark every still-unmarked enrolled student as absent. */
  markRemainingAbsent(id: string): Observable<{ success: boolean; count: number }> {
    return this.api.post<{ success: boolean; count: number }>(`exams/${id}/mark-remaining-absent`, {});
  }

  /** All of a student's recorded grades (student-detail page). */
  getByStudent(studentId: string): Observable<StudentExamResult[]> {
    return this.api.get<StudentExamResult[]>(`exams/student/${studentId}`);
  }

  /**
   * The online-exam monitor: everyone expected to sit, with their attempt state.
   * The server grades any expired attempt on the way through, so polling this is
   * also what lands abandoned papers' marks.
   */
  getAttempts(id: string): Observable<ExamAttemptsResponse> {
    return this.api.get<ExamAttemptsResponse>(`exams/${id}/attempts`);
  }

  /**
   * Let a student back in: deletes their attempt (the drawn paper with it) AND
   * their exam_results row. The one escape hatch from one-attempt-per-student.
   */
  resetAttempt(id: string, studentId: string): Observable<{ success: boolean }> {
    return this.api.delete<{ success: boolean }>(`exams/${id}/attempts/${studentId}`);
  }

  /** The student's exam-portal credential — existence + audit stamps only. */
  getStudentCredentials(studentId: string): Observable<StudentCredentialInfo> {
    return this.api.get<StudentCredentialInfo>(`exams/students/${studentId}/credentials`);
  }

  /** Revoke: the student is signed out on their next call and claims afresh. */
  revokeStudentCredentials(studentId: string): Observable<{ success: boolean }> {
    return this.api.delete<{ success: boolean }>(`exams/students/${studentId}/credentials`);
  }
}
