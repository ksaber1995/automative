import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  SessionPayment,
  SessionPaymentWithDetails,
  SessionPaymentSummary,
  SessionPackage,
  SessionPackageWithDetails,
  PackageRenewalDue,
  RecordSessionPaymentDto,
  RefundSessionPaymentDto,
  BuySessionPackageDto,
} from '@shared/interfaces/session-payment.interface';

@Injectable({ providedIn: 'root' })
export class SessionPaymentsService {
  private readonly base = `${environment.apiUrl}/session-payments`;

  constructor(private http: HttpClient) {}

  list(params: {
    from?: string;
    to?: string;
    branchId?: string;
    courseId?: string;
    sessionId?: string;
    studentId?: string;
    status?: string;
  } = {}): Observable<SessionPaymentWithDetails[]> {
    let httpParams = new HttpParams();
    if (params.from) httpParams = httpParams.set('from', params.from);
    if (params.to) httpParams = httpParams.set('to', params.to);
    if (params.branchId) httpParams = httpParams.set('branchId', params.branchId);
    if (params.courseId) httpParams = httpParams.set('courseId', params.courseId);
    if (params.sessionId) httpParams = httpParams.set('sessionId', params.sessionId);
    if (params.studentId) httpParams = httpParams.set('studentId', params.studentId);
    if (params.status) httpParams = httpParams.set('status', params.status);
    return this.http.get<SessionPaymentWithDetails[]>(this.base, { params: httpParams });
  }

  summary(params: { from?: string; to?: string; branchId?: string; courseId?: string } = {}): Observable<SessionPaymentSummary> {
    let httpParams = new HttpParams();
    if (params.from) httpParams = httpParams.set('from', params.from);
    if (params.to) httpParams = httpParams.set('to', params.to);
    if (params.branchId) httpParams = httpParams.set('branchId', params.branchId);
    if (params.courseId) httpParams = httpParams.set('courseId', params.courseId);
    return this.http.get<SessionPaymentSummary>(`${this.base}/summary`, { params: httpParams });
  }

  overdue(branchId?: string): Observable<SessionPaymentWithDetails[]> {
    let httpParams = new HttpParams();
    if (branchId) httpParams = httpParams.set('branchId', branchId);
    return this.http.get<SessionPaymentWithDetails[]>(`${this.base}/overdue`, { params: httpParams });
  }

  recordPayment(id: string, dto: RecordSessionPaymentDto): Observable<SessionPayment> {
    return this.http.post<SessionPayment>(`${this.base}/${id}/pay`, dto);
  }

  voidPayment(id: string, reason?: string): Observable<SessionPayment> {
    return this.http.post<SessionPayment>(`${this.base}/${id}/void`, { reason });
  }

  refund(id: string, dto: RefundSessionPaymentDto): Observable<SessionPayment> {
    return this.http.post<SessionPayment>(`${this.base}/${id}/refund`, dto);
  }

  buyPackage(dto: BuySessionPackageDto): Observable<SessionPackage> {
    return this.http.post<SessionPackage>(`${this.base}/packages`, dto);
  }

  /**
   * Switch an enrollment off bundles — it pays for each session it attends
   * instead. Nothing is billed or written off; the sessions already attended
   * stay as individual charges. Returns how many of those are still unpaid.
   * Buying a bundle for them later undoes it.
   */
  payPerSession(enrollmentId: string): Observable<{ enrollmentId: string; unpaidSessions: number; unpaidAmount: number }> {
    return this.http.post<{ enrollmentId: string; unpaidSessions: number; unpaidAmount: number }>(
      `${this.base}/enrollments/${enrollmentId}/pay-per-session`, {}
    );
  }

  payPackage(id: string, dto: RecordSessionPaymentDto): Observable<SessionPackage> {
    return this.http.post<SessionPackage>(`${this.base}/packages/${id}/pay`, dto);
  }

  refundPackage(id: string, dto: RefundSessionPaymentDto): Observable<SessionPackage> {
    return this.http.post<SessionPackage>(`${this.base}/packages/${id}/refund`, dto);
  }

  renewalsDue(params: { branchId?: string; courseId?: string } = {}): Observable<PackageRenewalDue[]> {
    let httpParams = new HttpParams();
    if (params.branchId) httpParams = httpParams.set('branchId', params.branchId);
    if (params.courseId) httpParams = httpParams.set('courseId', params.courseId);
    return this.http.get<PackageRenewalDue[]>(`${this.base}/renewals-due`, { params: httpParams });
  }

  listPackages(params: { branchId?: string; courseId?: string; studentId?: string; status?: string } = {}): Observable<SessionPackageWithDetails[]> {
    let httpParams = new HttpParams();
    if (params.branchId) httpParams = httpParams.set('branchId', params.branchId);
    if (params.courseId) httpParams = httpParams.set('courseId', params.courseId);
    if (params.studentId) httpParams = httpParams.set('studentId', params.studentId);
    if (params.status) httpParams = httpParams.set('status', params.status);
    return this.http.get<SessionPackageWithDetails[]>(`${this.base}/packages`, { params: httpParams });
  }

  listByCourse(courseId: string): Observable<SessionPaymentWithDetails[]> {
    return this.http.get<SessionPaymentWithDetails[]>(`${this.base}/course/${courseId}`);
  }

  listByStudent(studentId: string): Observable<SessionPaymentWithDetails[]> {
    return this.http.get<SessionPaymentWithDetails[]>(`${this.base}/student/${studentId}`);
  }

  getDueByToken(qrToken: string): Observable<{
    studentId: string;
    studentName: string;
    dueSessions: SessionPaymentWithDetails[];
  }> {
    return this.http.get<{
      studentId: string;
      studentName: string;
      dueSessions: SessionPaymentWithDetails[];
    }>(`${this.base}/by-token/${encodeURIComponent(qrToken)}`);
  }
}
