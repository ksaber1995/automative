import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  MonthlyPaymentWithDetails,
  MonthlyPaymentSummary,
  RecordMonthlyPaymentDto,
  GenerateMonthlyBillsDto,
} from '@shared/interfaces/monthly-subscription.interface';

@Injectable({ providedIn: 'root' })
export class MonthlySubscriptionsService {
  private readonly base = `${environment.apiUrl}/api/monthly-subscriptions`;

  constructor(private http: HttpClient) {}

  generate(dto: GenerateMonthlyBillsDto): Observable<{ generated: number; month: string }> {
    return this.http.post<{ generated: number; month: string }>(`${this.base}/generate`, dto);
  }

  list(params: {
    billingYear: number;
    billingMonth: number;
    branchId?: string;
    courseId?: string;
    status?: string;
  }): Observable<MonthlyPaymentWithDetails[]> {
    let httpParams = new HttpParams()
      .set('billingYear', params.billingYear.toString())
      .set('billingMonth', params.billingMonth.toString());
    if (params.branchId) httpParams = httpParams.set('branchId', params.branchId);
    if (params.courseId) httpParams = httpParams.set('courseId', params.courseId);
    if (params.status) httpParams = httpParams.set('status', params.status);
    return this.http.get<MonthlyPaymentWithDetails[]>(this.base, { params: httpParams });
  }

  summary(params: {
    billingYear: number;
    billingMonth: number;
    branchId?: string;
  }): Observable<MonthlyPaymentSummary> {
    let httpParams = new HttpParams()
      .set('billingYear', params.billingYear.toString())
      .set('billingMonth', params.billingMonth.toString());
    if (params.branchId) httpParams = httpParams.set('branchId', params.branchId);
    return this.http.get<MonthlyPaymentSummary>(`${this.base}/summary`, { params: httpParams });
  }

  recordPayment(id: string, dto: RecordMonthlyPaymentDto): Observable<any> {
    return this.http.post<any>(`${this.base}/${id}/pay`, dto);
  }

  listByCourse(courseId: string, billingYear?: number, billingMonth?: number): Observable<MonthlyPaymentWithDetails[]> {
    let httpParams = new HttpParams();
    if (billingYear) httpParams = httpParams.set('billingYear', billingYear.toString());
    if (billingMonth) httpParams = httpParams.set('billingMonth', billingMonth.toString());
    return this.http.get<MonthlyPaymentWithDetails[]>(`${this.base}/course/${courseId}`, { params: httpParams });
  }
}
