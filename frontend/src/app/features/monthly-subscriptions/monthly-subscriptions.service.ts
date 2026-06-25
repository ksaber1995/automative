import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  MonthlyPaymentWithDetails,
  MonthlyPaymentSummary,
  RecordMonthlyPaymentDto,
  RefundMonthlyPaymentDto,
  GenerateMonthlyBillsDto,
  CourseMonthlyPriceOverride,
  SetPriceOverrideDto,
  HeldSubscription,
} from '@shared/interfaces/monthly-subscription.interface';

@Injectable({ providedIn: 'root' })
export class MonthlySubscriptionsService {
  private readonly base = `${environment.apiUrl}/monthly-subscriptions`;

  constructor(private http: HttpClient) {}

  generate(dto: GenerateMonthlyBillsDto): Observable<{ generated: number; month: string }> {
    return this.http.post<{ generated: number; month: string }>(`${this.base}/generate`, dto);
  }

  list(params: {
    fromYear: number;
    fromMonth: number;
    toYear: number;
    toMonth: number;
    branchId?: string;
    courseId?: string;
    status?: string;
  }): Observable<MonthlyPaymentWithDetails[]> {
    let httpParams = new HttpParams()
      .set('fromYear', params.fromYear.toString())
      .set('fromMonth', params.fromMonth.toString())
      .set('toYear', params.toYear.toString())
      .set('toMonth', params.toMonth.toString());
    if (params.branchId) httpParams = httpParams.set('branchId', params.branchId);
    if (params.courseId) httpParams = httpParams.set('courseId', params.courseId);
    if (params.status) httpParams = httpParams.set('status', params.status);
    return this.http.get<MonthlyPaymentWithDetails[]>(this.base, { params: httpParams });
  }

  summary(params: {
    fromYear: number;
    fromMonth: number;
    toYear: number;
    toMonth: number;
    branchId?: string;
  }): Observable<MonthlyPaymentSummary> {
    let httpParams = new HttpParams()
      .set('fromYear', params.fromYear.toString())
      .set('fromMonth', params.fromMonth.toString())
      .set('toYear', params.toYear.toString())
      .set('toMonth', params.toMonth.toString());
    if (params.branchId) httpParams = httpParams.set('branchId', params.branchId);
    return this.http.get<MonthlyPaymentSummary>(`${this.base}/summary`, { params: httpParams });
  }

  recordPayment(id: string, dto: RecordMonthlyPaymentDto): Observable<any> {
    return this.http.post<any>(`${this.base}/${id}/pay`, dto);
  }

  voidPayment(id: string, reason?: string): Observable<any> {
    return this.http.post<any>(`${this.base}/${id}/void`, { reason });
  }

  /** Refund a paid bill (full or partial), with a note and optional subscription stop. */
  refund(id: string, dto: RefundMonthlyPaymentDto): Observable<any> {
    return this.http.post<any>(`${this.base}/${id}/refund`, dto);
  }

  /** Resolve a scanned student barcode (QR token) to that student and their still-due months. */
  getDueByToken(qrToken: string): Observable<{
    studentId: string;
    studentFirstName: string;
    studentLastName: string;
    dueMonths: MonthlyPaymentWithDetails[];
  }> {
    return this.http.get<{
      studentId: string;
      studentFirstName: string;
      studentLastName: string;
      dueMonths: MonthlyPaymentWithDetails[];
    }>(`${this.base}/by-token/${encodeURIComponent(qrToken)}`);
  }

  listByCourse(courseId: string, billingYear?: number, billingMonth?: number): Observable<MonthlyPaymentWithDetails[]> {
    let httpParams = new HttpParams();
    if (billingYear) httpParams = httpParams.set('billingYear', billingYear.toString());
    if (billingMonth) httpParams = httpParams.set('billingMonth', billingMonth.toString());
    return this.http.get<MonthlyPaymentWithDetails[]>(`${this.base}/course/${courseId}`, { params: httpParams });
  }

  /** Every monthly bill for one student (newest month first). */
  listByStudent(studentId: string): Observable<MonthlyPaymentWithDetails[]> {
    return this.http.get<MonthlyPaymentWithDetails[]>(`${this.base}/student/${studentId}`);
  }

  /** List all price overrides for a course. */
  listPriceOverrides(courseId: string): Observable<CourseMonthlyPriceOverride[]> {
    return this.http.get<CourseMonthlyPriceOverride[]>(`${this.base}/price-overrides/${courseId}`);
  }

  /** Set or update a monthly price override for a course. Recalculates all unpaid bills. */
  setPriceOverride(dto: SetPriceOverrideDto): Observable<{ override: CourseMonthlyPriceOverride; updatedBills: number }> {
    return this.http.post<{ override: CourseMonthlyPriceOverride; updatedBills: number }>(
      `${this.base}/price-override`, dto
    );
  }

  /** Get the current price override for a course+month (returns null if none). */
  getPriceOverride(courseId: string, billingYear: number, billingMonth: number): Observable<CourseMonthlyPriceOverride | null> {
    const params = new HttpParams()
      .set('courseId', courseId)
      .set('billingYear', billingYear.toString())
      .set('billingMonth', billingMonth.toString());
    return this.http.get<CourseMonthlyPriceOverride | null>(`${this.base}/price-override`, { params });
  }

  /** Delete a price override and revert bills to normal pricing. */
  deletePriceOverride(id: string): Observable<{ deleted: boolean; updatedBills: number }> {
    return this.http.delete<{ deleted: boolean; updatedBills: number }>(`${this.base}/price-override/${id}`);
  }

  /** List subscriptions currently on hold (generate no bills until resumed). */
  listHeld(branchId?: string): Observable<HeldSubscription[]> {
    let httpParams = new HttpParams();
    if (branchId) httpParams = httpParams.set('branchId', branchId);
    return this.http.get<HeldSubscription[]>(`${this.base}/held`, { params: httpParams });
  }
}
