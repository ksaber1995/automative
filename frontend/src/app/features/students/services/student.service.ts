import { Injectable, inject } from '@angular/core';
import { normalizeStudentCode } from '../../../core/utils/student-code.util';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { Student, StudentCreateDto, StudentUpdateDto, StudentImportRow, StudentImportResult } from '@shared/interfaces/student.interface';

export interface EnrollmentDto {
  courseId: string;
  enrollmentDate: string;
  discountPercent?: number;
  discountAmount?: number;
  notes?: string;
}

export interface Enrollment {
  id: string;
  studentId: string;
  courseId: string;
  branchId: string;
  enrollmentDate: string;
  status: string;
  originalPrice: number;
  discountPercent: number;
  discountAmount: number;
  finalPrice: number;
  paymentStatus: string;
  completionDate: string | null;
  notes: string | null;
  course?: any;
}

/**
 * A "you may already have this person" hint, raised while a name is typed.
 *
 * EXACT means the names match once Arabic spelling variants and word order are
 * folded away (أحمد/احمد, فاطمة/فاطمه, "دنيا حجازي"/"حجازي دنيا"). SIMILAR means
 * they merely read alike, e.g. عمر / عمرو.
 */
export interface SimilarStudent {
  id: string;
  name: string;
  studentCode: number | null;
  phone: string | null;
  parentPhone: string | null;
  branchName: string | null;
  /** In the branch being registered into. Others are shown but labelled. */
  sameBranch: boolean;
  isActive: boolean;
  createdAt: string;
  matchType: 'EXACT' | 'SIMILAR';
}

@Injectable({
  providedIn: 'root'
})
export class StudentService {
  private api = inject(ApiService);

  getAllStudents(): Observable<Student[]> {
    return this.api.get<Student[]>('students');
  }

  /**
   * Existing students whose name reads like this one, across the whole company.
   * Never blocks anything — two children really can share a name, so this only
   * ever informs.
   *
   * `branchId` does not narrow the search; it ranks that branch's matches first
   * so they cannot be pushed out of the result by matches from elsewhere.
   */
  findSimilar(name: string, excludeId?: string | null, branchId?: string | null): Observable<SimilarStudent[]> {
    return this.api.get<SimilarStudent[]>('students/similar', {
      name,
      ...(excludeId ? { excludeId } : {}),
      ...(branchId ? { branchId } : {}),
    });
  }

  getStudentsByBranch(branchId: string): Observable<Student[]> {
    return this.api.get<Student[]>('students', { branchId });
  }

  getStudentById(id: string): Observable<Student> {
    return this.api.get<Student>(`students/${id}`);
  }

  createStudent(student: StudentCreateDto): Observable<Student> {
    return this.api.post<Student>('students', student);
  }

  /** Bulk-create students from a parsed spreadsheet, all into one branch. */
  bulkImportStudents(branchId: string, students: StudentImportRow[]): Observable<StudentImportResult> {
    return this.api.post<StudentImportResult>('students/bulk-import', { branchId, students });
  }

  updateStudent(id: string, student: StudentUpdateDto): Observable<Student> {
    return this.api.patch<Student>(`students/${id}`, student);
  }

  deleteStudent(id: string): Observable<Student> {
    return this.api.delete<Student>(`students/${id}`);
  }

  reactivateStudent(id: string): Observable<Student> {
    return this.api.patch<Student>(`students/${id}/reactivate`, {});
  }

  hardDeleteStudent(id: string): Observable<{ message: string; code: string }> {
    return this.api.delete<{ message: string; code: string }>(`students/${id}/permanent`);
  }

  /** Rotate the student's QR token (invalidates any previously printed code). */
  regenerateQr(id: string): Observable<Student> {
    return this.api.post<Student>(`students/${id}/regenerate-qr`, {});
  }

  /** Lookup a student by their QR token. Returns just the student ID. */
  lookupByQr(qrToken: string): Observable<{ id: string }> {
    return this.api.get<{ id: string }>(`students/lookup-by-qr/${encodeURIComponent(qrToken)}`);
  }

  /**
   * Resolve a student by their short sequential code (QR-less fallback). Returns
   * the student's id and qrToken so callers can reuse the existing QR check-in /
   * payment flows. 404s when no active student has that code.
   */
  lookupByCode(code: string | number): Observable<{ id: string; qrToken: string }> {
    return this.api.get<{ id: string; qrToken: string }>(
      // Pool cards print their number as "A-100001"; the code is an integer.
      `students/lookup-by-code/${encodeURIComponent(normalizeStudentCode(code))}`,
    );
  }

  enrollStudent(studentId: string, enrollment: EnrollmentDto): Observable<Enrollment> {
    return this.api.post<Enrollment>(`students/${studentId}/enroll`, enrollment);
  }

  getEnrollments(studentId: string): Observable<Enrollment[]> {
    return this.api.get<Enrollment[]>(`students/${studentId}/enrollments`);
  }

  updateEnrollment(studentId: string, enrollmentId: string, updateData: any): Observable<Enrollment> {
    return this.api.patch<Enrollment>(`students/${studentId}/enrollments/${enrollmentId}`, updateData);
  }

  deleteEnrollment(studentId: string, enrollmentId: string): Observable<Enrollment> {
    return this.api.delete<Enrollment>(`students/${studentId}/enrollments/${enrollmentId}`);
  }
}
