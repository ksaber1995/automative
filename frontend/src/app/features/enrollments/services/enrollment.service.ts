import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { AddPaymentDto, CreateRefundDto, Enrollment, EnrollmentCreateDto, EnrollmentPayment, EnrollmentUpdateDto, EnrollmentWithDetails, Refund } from '@shared/interfaces/enrollment.interface';

/** What moving an enrollment's join date would touch — the dialog's numbers. */
export interface JoinDateImpact {
  paymentType: string;
  oldDate: string;
  newDate: string;
  monthlyFee: number | null;
  billsToAdd: number;
  billsToWipe: number;
  billsKeptWithMoney: number;
  attendanceBefore: number;
  attendanceBeforeHasMoney: boolean;
  /** Marks recorded before the new date — a later join must not strand them. */
  examResultsBefore: number;
  sessionsBecomingAbsent: number;
  canMarkPresent: boolean;
}

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

  /** Dry run of a join-date change — the dialog shows these numbers before saving. */
  joinDateImpact(id: string, newDate: string): Observable<JoinDateImpact> {
    return this.api.get<JoinDateImpact>(`enrollments/${id}/join-date-impact`, { newDate });
  }

  /** What enrolling on `date` implies, before the form saves (backdated joins). */
  createImpact(classId: string, date: string): Observable<{
    paymentType: string; heldSessions: number; monthsToBill: number; canMarkPresent: boolean;
  }> {
    return this.api.get(`enrollments/create-impact`, { classId, date });
  }

  /** Apply the previewed join-date change; the attendance rewrites are opt-in. */
  changeJoinDate(id: string, dto: { newDate: string; wipeAttendanceBefore?: boolean; markPresentSince?: boolean }):
    Observable<{ billsAdded: number; billsWiped: number; attendanceWiped: number; markedPresent: number }> {
    return this.api.post(`enrollments/${id}/join-date`, dto);
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
