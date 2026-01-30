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
