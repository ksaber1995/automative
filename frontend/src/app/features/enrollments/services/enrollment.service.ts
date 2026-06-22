import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { AddPaymentDto, CreateRefundDto, Enrollment, EnrollmentCreateDto, EnrollmentPayment, EnrollmentUpdateDto, EnrollmentWithDetails, Refund } from '@shared/interfaces/enrollment.interface';

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

  getPayments(enrollmentId: string): Observable<EnrollmentPayment[]> {
    return this.api.get<EnrollmentPayment[]>(`enrollments/${enrollmentId}/payments`);
  }

  addPayment(enrollmentId: string, payment: AddPaymentDto): Observable<EnrollmentPayment> {
    return this.api.post<EnrollmentPayment>(`enrollments/${enrollmentId}/payments`, payment);
  }

  getRefunds(enrollmentId: string): Observable<Refund[]> {
    return this.api.get<Refund[]>(`enrollments/${enrollmentId}/refunds`);
  }

  createRefund(enrollmentId: string, refund: CreateRefundDto): Observable<Refund> {
    return this.api.post<Refund>(`enrollments/${enrollmentId}/refunds`, refund);
  }

  /** Hold a monthly subscription indefinitely (paused until resumed). */
  holdSubscription(enrollmentId: string): Observable<Enrollment> {
    return this.api.post<Enrollment>(`enrollments/${enrollmentId}/hold`, {});
  }

  resumeSubscription(enrollmentId: string): Observable<Enrollment> {
    return this.api.post<Enrollment>(`enrollments/${enrollmentId}/resume`, {});
  }

  /** Move the enrollment to a different class of the same course. */
  changeClass(enrollmentId: string, classId: string): Observable<Enrollment> {
    return this.api.post<Enrollment>(`enrollments/${enrollmentId}/change-class`, { classId });
  }
}
