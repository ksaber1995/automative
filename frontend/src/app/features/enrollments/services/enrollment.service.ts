import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { Enrollment, EnrollmentCreateDto, EnrollmentUpdateDto, EnrollmentWithDetails } from '@shared/interfaces/enrollment.interface';

@Injectable({
  providedIn: 'root'
})
export class EnrollmentService {
  private api = inject(ApiService);

  getAllEnrollments(params?: { studentId?: string; courseId?: string; branchId?: string; status?: string }): Observable<Enrollment[]> {
    return this.api.get<Enrollment[]>('enrollments', params);
  }

  getEnrollmentById(id: string): Observable<Enrollment> {
    return this.api.get<Enrollment>(`enrollments/${id}`);
  }

  getEnrollmentsByStudent(studentId: string): Observable<Enrollment[]> {
    return this.api.get<Enrollment[]>(`enrollments/student/${studentId}`);
  }

  createEnrollment(enrollment: EnrollmentCreateDto): Observable<Enrollment> {
    return this.api.post<Enrollment>('enrollments', enrollment);
  }

  updateEnrollment(id: string, enrollment: EnrollmentUpdateDto): Observable<Enrollment> {
    return this.api.patch<Enrollment>(`enrollments/${id}`, enrollment);
  }

  deleteEnrollment(id: string): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`enrollments/${id}`);
  }
}
