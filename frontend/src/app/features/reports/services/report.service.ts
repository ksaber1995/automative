import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';

export interface MonthlyPLRow {
  month: string;
  enrollmentRevenue: number;
  productRevenue: number;
  masterRevenue: number;
  refunds: number;
  revenue: number;
  expenses: number;
  netProfit: number;
}

export interface SalaryMonthRow {
  month: string;
  total: number;
  count: number;
}

export type CourseRowType = 'COURSE' | 'MASTER';

export interface TopCourseRow {
  type: CourseRowType;
  courseId: string;
  courseName: string;
  branchName: string;
  enrollmentCount: number;
  activeCount: number;
  revenue: number;
}

export interface StudentMonthRow {
  month: string;
  newStudents: number;
  churned: number;
  netChange: number;
}

export interface ChurnSummary {
  totalStudents: number;
  // Enrolled in at least one still-running course/class.
  activeStudents: number;
  // Record still active but with no active enrollment.
  dormantStudents: number;
  // Student record itself deactivated (formerly "churned").
  inactiveStudents: number;
  inactiveRate: number;
  dormancyRate: number;
}

export interface ProfitByCourseRow {
  type: CourseRowType;
  courseId: string;
  courseName: string;
  branchName: string;
  enrollments: number;
  revenue: number;
  avgPrice: number;
}

export interface ProfitByBranchRow {
  branchId: string;
  branchName: string;
  branchCode: string;
  enrollmentRevenue: number;
  productRevenue: number;
  masterRevenue: number;
  refunds: number;
  revenue: number;
  expenses: number;
  netProfit: number;
  activeStudents: number;
}

export interface ProfitByProductRow {
  productId: string;
  productName: string;
  productCode: string;
  branchName: string;
  unitsSold: number;
  revenue: number;
  cost: number;
  margin: number;
  currentStock: number;
}

export interface ExpenseCategoryRow {
  category: string;
  total: number;
  count: number;
}

export interface ProfitByEventRow {
  eventId: string;
  name: string;
  eventType: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  branchId: string | null;
  branchName: string | null;
  subscriberCount: number;
  revenue: number;
  expenses: number;
  expenseCount: number;
  refunds: number;
  refundCount: number;
  productRevenue: number;
  productCost: number;
  productMargin: number;
  netProfit: number;
}

export interface ReportFilters {
  startDate?: string;
  endDate?: string;
  branchId?: string;
}

@Injectable({ providedIn: 'root' })
export class ReportService {
  private api = inject(ApiService);

  monthlyPL(filters: ReportFilters = {}): Observable<MonthlyPLRow[]> {
    return this.api.get<MonthlyPLRow[]>('reports/monthly-pl', filters);
  }

  salaryGrowth(filters: ReportFilters = {}): Observable<SalaryMonthRow[]> {
    return this.api.get<SalaryMonthRow[]>('reports/salary-growth', filters);
  }

  topCourses(filters: ReportFilters = {}): Observable<TopCourseRow[]> {
    return this.api.get<TopCourseRow[]>('reports/top-courses', filters);
  }

  studentsOverTime(filters: ReportFilters = {}): Observable<StudentMonthRow[]> {
    return this.api.get<StudentMonthRow[]>('reports/students-over-time', filters);
  }

  studentChurn(branchId?: string): Observable<ChurnSummary> {
    return this.api.get<ChurnSummary>('reports/student-churn', { branchId });
  }

  profitByCourse(filters: ReportFilters = {}): Observable<ProfitByCourseRow[]> {
    return this.api.get<ProfitByCourseRow[]>('reports/profit-by-course', filters);
  }

  profitByBranch(filters: ReportFilters = {}): Observable<ProfitByBranchRow[]> {
    return this.api.get<ProfitByBranchRow[]>('reports/profit-by-branch', filters);
  }

  profitByProduct(filters: ReportFilters = {}): Observable<ProfitByProductRow[]> {
    return this.api.get<ProfitByProductRow[]>('reports/profit-by-product', filters);
  }

  expensesByCategory(filters: ReportFilters = {}): Observable<ExpenseCategoryRow[]> {
    return this.api.get<ExpenseCategoryRow[]>('reports/expenses-by-category', filters);
  }

  profitByEvent(filters: ReportFilters = {}): Observable<ProfitByEventRow[]> {
    return this.api.get<ProfitByEventRow[]>('reports/profit-by-event', filters);
  }
}
