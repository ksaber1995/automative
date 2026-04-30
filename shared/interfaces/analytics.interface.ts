export interface FinancialSummary {
  totalRevenue: number;
  enrollmentRevenue?: number;
  productRevenue?: number;
  totalRefunds?: number;
  fixedExpenses: number;
  variableExpenses: number;
  salaries: number;
  sharedExpenses: number;
  totalExpenses: number;
  netProfit: number;
  currentCash?: number;
  totalOutstandingDebts?: number;
  availableCash?: number;
  allocationMethod: string;
  globalOverhead: number;
  unallocatedRevenue?: number;
  unallocatedExpenses?: number;
  unallocatedNetProfit?: number;
  sumBranchNetProfit?: number;
}

export interface BranchFinancialSummary extends FinancialSummary {
  branchId: string;
  branchName: string;
  branchCode: string;
}

export interface DashboardMetrics {
  companyWideSummary: FinancialSummary;
  branchSummaries: BranchFinancialSummary[];
  revenueByMonth: MonthlyMetric[];
  expensesByCategory: CategoryMetric[];
  topPerformingBranches: BranchPerformance[];
  period: {
    startDate: string;
    endDate: string;
  };
}

export interface MonthlyMetric {
  month: number;
  year: number;
  revenue: number;
  expenses: number;
  refunds: number;
  profit: number;
}

export interface CategoryMetric {
  category: string;
  amount: number;
  percentage: number;
}

export interface BranchPerformance {
  branchId: string;
  branchName: string;
  revenue: number;
  profit: number;
  profitMargin: number;
  studentCount: number;
  courseCount: number;
}

export interface DateRangeQuery {
  startDate: string;
  endDate: string;
  branchId?: string;
}

export interface ReportRequest {
  type: 'FINANCIAL' | 'BRANCH' | 'STUDENT' | 'REVENUE' | 'EXPENSE';
  format: 'EXCEL' | 'PDF';
  startDate: string;
  endDate: string;
  branchId?: string;
}
