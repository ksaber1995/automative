import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import {
  MasterEnrollment,
  MasterEnrollmentProgress,
  MasterEnrollmentCreateDto,
} from '@shared/interfaces/master-enrollment.interface';
import { Refund, CreateRefundDto, EnrollmentPayment, AddPaymentDto } from '@shared/interfaces/enrollment.interface';

export interface CoverageInfo {
  covered: boolean;
  masterEnrollmentId?: string;
  masterCourseId?: string;
  masterCourseName?: string;
}

@Injectable({ providedIn: 'root' })
export class MasterEnrollmentService {
  private api = inject(ApiService);

  create(dto: MasterEnrollmentCreateDto): Observable<MasterEnrollmentProgress> {
    return this.api.post<MasterEnrollmentProgress>('master-enrollments', dto);
  }

  list(params?: { status?: string; branchId?: string; studentId?: string }): Observable<MasterEnrollmentProgress[]> {
    return this.api.get<MasterEnrollmentProgress[]>('master-enrollments', params);
  }

  getByStudent(studentId: string): Observable<MasterEnrollmentProgress[]> {
    return this.api.get<MasterEnrollmentProgress[]>(`master-enrollments/by-student/${studentId}`);
  }

  getById(id: string): Observable<MasterEnrollmentProgress> {
    return this.api.get<MasterEnrollmentProgress>(`master-enrollments/${id}`);
  }

  cancel(id: string): Observable<{ message: string }> {
    return this.api.post<{ message: string }>(`master-enrollments/${id}/cancel`, {});
  }

  listRefunds(id: string): Observable<Refund[]> {
    return this.api.get<Refund[]>(`master-enrollments/${id}/refunds`);
  }

  createRefund(id: string, dto: CreateRefundDto): Observable<Refund> {
    return this.api.post<Refund>(`master-enrollments/${id}/refunds`, dto);
  }

  checkCoverage(studentId: string, courseId: string): Observable<CoverageInfo> {
    return this.api.get<CoverageInfo>('master-enrollments/coverage', { studentId, courseId });
  }

  listByMaster(masterCourseId: string): Observable<MasterEnrollmentProgress[]> {
    return this.api.get<MasterEnrollmentProgress[]>(`master-courses/${masterCourseId}/enrollments`);
  }

  getPayments(id: string): Observable<EnrollmentPayment[]> {
    return this.api.get<EnrollmentPayment[]>(`master-enrollments/${id}/payments`);
  }

  addPayment(id: string, dto: AddPaymentDto): Observable<EnrollmentPayment> {
    return this.api.post<EnrollmentPayment>(`master-enrollments/${id}/payments`, dto);
  }
}
