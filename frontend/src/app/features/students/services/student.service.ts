import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { Student, StudentCreateDto, StudentUpdateDto } from '@shared/interfaces/student.interface';

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

@Injectable({
  providedIn: 'root'
})
export class StudentService {
  private api = inject(ApiService);

  getAllStudents(): Observable<Student[]> {
    return this.api.get<Student[]>('students');
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

  /** Paid QR activation (TEACHER companies). ONE_YEAR = 25 EGP, LIFELONG = 40 EGP. */
  activateQr(id: string, plan: 'ONE_YEAR' | 'LIFELONG'): Observable<Student> {
    return this.api.post<Student>(`students/${id}/activate-qr`, { plan });
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
      `students/lookup-by-code/${encodeURIComponent(String(code))}`,
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
