import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/** Relative for the same reason as student-auth.service.ts — same-origin /api. */
const API = '/api/student';

export type ExamState = 'AVAILABLE' | 'IN_PROGRESS' | 'DONE';

export interface StudentExamListItem {
  examId: string;
  name: string;
  courseName: string;
  questionCount: number | null;
  durationMinutes: number | null;
  closesAt: string | null;
  requiresCode: boolean;
  state: ExamState;
  score: number | null;
  total: number | null;
}

export interface PaperOption {
  id: string;
  text: string;
}

export interface PaperQuestion {
  id: string;
  orderIndex: number;
  questionText: string;
  options: PaperOption[];
  selectedOptionId: string | null;
}

export interface StudentAttempt {
  expiresAt: string | null;
  serverNow: string;
  exam: { name: string; questionCount: number; durationMinutes: number | null };
  questions: PaperQuestion[];
}

export interface ReviewQuestion {
  questionText: string;
  explanation: string | null;
  options: { id: string; text: string; isCorrect: boolean }[];
  selectedOptionId: string | null;
  isCorrect: boolean;
}

export interface SubmitResult {
  score: number;
  total: number;
  attemptStatus: string;
  showAnswers: boolean;
  questions?: ReviewQuestion[];
}

export interface ResultRow {
  examName: string;
  courseName: string;
  className: string | null;
  examDate: string | null;
  grade: string;
  maxGrade: number | null;
  isHomework: boolean;
  isRating: boolean;
  isAbsent: boolean;
  notMarked: boolean;
}

@Injectable({ providedIn: 'root' })
export class StudentExamsService {
  private http = inject(HttpClient);

  /**
   * The attempt handed from the exams list to the sitting screen (and the
   * result handed to the result screen), so the next page paints without a
   * second round trip. Both pages refetch when this is empty — a reload
   * mid-paper resumes from the server, never from stale memory.
   */
  activeAttempt = signal<{ examId: string; attempt: StudentAttempt } | null>(null);
  lastResult = signal<{ examId: string; result: SubmitResult } | null>(null);

  list(): Observable<StudentExamListItem[]> {
    return this.http.get<StudentExamListItem[]>(`${API}/exams`);
  }

  results(): Observable<ResultRow[]> {
    return this.http.get<ResultRow[]>(`${API}/results`);
  }

  start(examId: string): Observable<StudentAttempt> {
    return this.http.post<StudentAttempt>(`${API}/exams/${examId}/start`, {});
  }

  attempt(examId: string): Observable<StudentAttempt> {
    return this.http.get<StudentAttempt>(`${API}/exams/${examId}/attempt`);
  }

  answer(examId: string, questionId: string, optionId: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`${API}/exams/${examId}/answer`, { questionId, optionId });
  }

  submit(examId: string): Observable<SubmitResult> {
    return this.http.post<SubmitResult>(`${API}/exams/${examId}/submit`, {});
  }
}
