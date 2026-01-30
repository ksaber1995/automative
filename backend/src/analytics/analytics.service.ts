import { Injectable } from '@nestjs/common';
import { DataStoreService } from '../data-store/data-store.service';
import { FILE_PATHS, DATA_KEYS } from '../data-store/file-paths.constant';
import { RevenuesService } from '../revenues/revenues.service';
import { ExpensesService } from '../expenses/expenses.service';
import {
  FinancialSummary,
  DashboardMetrics,
  BranchFinancialSummary,
  MonthlyMetric,
  CategoryMetric,
  BranchPerformance
} from '../../../shared/interfaces/analytics.interface';

@Injectable()
export class AnalyticsService {
  constructor(
    private dataStore: DataStoreService,
    private revenuesService: RevenuesService,
    private expensesService: ExpensesService,
  ) {}

  async getDashboard(startDate?: string, endDate?: string): Promise<DashboardMetrics> {
    // Return dummy data for testing
    return this.getDummyDashboardData();

    // Original implementation (commented out for now)
    /*
    const companyWideSummary = await this.calculateFinancialSummary(
      null,
      startDate,
      endDate,
    );

    const branches = await this.dataStore.findBy(
      FILE_PATHS.BRANCHES,
      DATA_KEYS.BRANCHES,
      (branch: any) => branch.isActive,
    );

    const branchSummaries = await Promise.all(
      branches.map(async (branch: any) => {
        const summary = await this.calculateFinancialSummary(
          branch.id,
          startDate,
          endDate,
        );
        return {
          branchId: branch.id,
          branchName: branch.name,
          branchCode: branch.code,
          ...summary,
        };
      }),
    );

    const revenueByMonth = await this.getRevenueByMonth(startDate, endDate);
    const expensesByCategory = await this.getExpensesByCategory(startDate, endDate);
    const topPerformingBranches = await this.getTopPerformingBranches(
      startDate,
      endDate,
    );

    return {
      companyWideSummary,
      branchSummaries,
      revenueByMonth,
      expensesByCategory,
      topPerformingBranches,
      period: {
        startDate: startDate || 'all',
        endDate: endDate || 'all',
      },
    };
    */
  }

  async getBranchAnalytics(branchId: string, startDate?: string, endDate?: string) {
    const branch = await this.dataStore.findById(
      FILE_PATHS.BRANCHES,
      DATA_KEYS.BRANCHES,
      branchId,
    );

    if (!branch) {
      throw new Error('Branch not found');
    }

    const financialSummary = await this.calculateFinancialSummary(
      branchId,
      startDate,
      endDate,
    );

    const courses = await this.dataStore.findBy(
      FILE_PATHS.COURSES,
      DATA_KEYS.COURSES,
      (course: any) => course.branchId === branchId && course.isActive,
    );

    const students = await this.dataStore.findBy(
      FILE_PATHS.STUDENTS,
      DATA_KEYS.STUDENTS,
      (student: any) => student.branchId === branchId && student.isActive,
    );

    const employees = await this.dataStore.findBy(
      FILE_PATHS.EMPLOYEES,
      DATA_KEYS.EMPLOYEES,
      (emp: any) => (emp.branchId === branchId || emp.isGlobal) && emp.isActive,
    );

    return {
      branch,
      financialSummary,
      courseCount: courses.length,
      studentCount: students.length,
      employeeCount: employees.length,
    };
  }

  private async calculateFinancialSummary(
    branchId: string | null,
    startDate?: string,
    endDate?: string,
  ): Promise<FinancialSummary> {
    // Calculate total revenue
    const revenues = await this.revenuesService.findAll({
      branchId: branchId || undefined,
      startDate,
      endDate,
    });
    const totalRevenue = revenues.reduce(
      (sum: number, rev: any) => sum + rev.amount,
      0,
    );

    // Calculate fixed expenses (branch-specific recurring)
    const fixedExpenses = await this.expensesService.findAll({
      branchId: branchId || undefined,
      type: 'FIXED',
      startDate,
      endDate,
    });
    const totalFixedExpenses = fixedExpenses.reduce(
      (sum: number, exp: any) => sum + exp.amount,
      0,
    );

    // Calculate variable expenses (one-time branch expenses)
    const variableExpenses = await this.expensesService.findAll({
      branchId: branchId || undefined,
      type: 'VARIABLE',
      startDate,
      endDate,
    });
    const totalVariableExpenses = variableExpenses.reduce(
      (sum: number, exp: any) => sum + exp.amount,
      0,
    );

    // Calculate salaries
    const totalSalaries = await this.expensesService.calculateTotalSalaries(
      branchId || undefined,
    );

    // Calculate shared expenses (distributed portion)
    const sharedExpenses = await this.expensesService.findAll({
      type: 'SHARED',
      startDate,
      endDate,
    });

    let totalSharedExpenses = 0;
    if (branchId) {
      // For specific branch, calculate its portion of shared expenses
      const branches = await this.dataStore.findBy(
        FILE_PATHS.BRANCHES,
        DATA_KEYS.BRANCHES,
        (branch: any) => branch.isActive,
      );

      for (const expense of sharedExpenses) {
        const exp = expense as any;
        const distribution = await this.expensesService.distributeSharedExpense(
          exp.amount,
          exp.distributionMethod || 'EQUAL',
        );
        totalSharedExpenses += distribution[branchId] || 0;
      }
    } else {
      // For company-wide, sum all shared expenses
      totalSharedExpenses = sharedExpenses.reduce(
        (sum: number, exp: any) => sum + exp.amount,
        0,
      );
    }

    const totalExpenses =
      totalFixedExpenses + totalVariableExpenses + totalSalaries + totalSharedExpenses;
    const netProfit = totalRevenue - totalExpenses;

    return {
      totalRevenue,
      fixedExpenses: totalFixedExpenses,
      variableExpenses: totalVariableExpenses,
      salaries: totalSalaries,
      sharedExpenses: totalSharedExpenses,
      totalExpenses,
      netProfit,
    };
  }

  private async getRevenueByMonth(startDate?: string, endDate?: string): Promise<MonthlyMetric[]> {
    const revenues = await this.revenuesService.findAll({ startDate, endDate });

    const monthlyData = new Map<string, { revenue: number; expenses: number }>();

    revenues.forEach((rev: any) => {
      const date = new Date(rev.date);
      const key = `${date.getFullYear()}-${date.getMonth() + 1}`;

      if (!monthlyData.has(key)) {
        monthlyData.set(key, { revenue: 0, expenses: 0 });
      }

      const data = monthlyData.get(key)!;
      data.revenue += rev.amount;
    });

    const expenses = await this.expensesService.findAll({ startDate, endDate });

    expenses.forEach((exp: any) => {
      const date = new Date(exp.date);
      const key = `${date.getFullYear()}-${date.getMonth() + 1}`;

      if (!monthlyData.has(key)) {
        monthlyData.set(key, { revenue: 0, expenses: 0 });
      }

      const data = monthlyData.get(key)!;
      data.expenses += exp.amount;
    });

    const result = Array.from(monthlyData.entries()).map(([key, data]) => {
      const [year, month] = key.split('-');
      return {
        month: parseInt(month),
        year: parseInt(year),
        revenue: data.revenue,
        expenses: data.expenses,
        profit: data.revenue - data.expenses,
      };
    });

    return result.sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });
  }

  private async getExpensesByCategory(startDate?: string, endDate?: string): Promise<CategoryMetric[]> {
    const expenses = await this.expensesService.findAll({ startDate, endDate });

    const categoryTotals = new Map<string, number>();
    let total = 0;

    expenses.forEach((exp: any) => {
      const category = exp.category;
      categoryTotals.set(category, (categoryTotals.get(category) || 0) + exp.amount);
      total += exp.amount;
    });

    return Array.from(categoryTotals.entries()).map(([category, amount]) => ({
      category,
      amount,
      percentage: total > 0 ? (amount / total) * 100 : 0,
    }));
  }

  private async getTopPerformingBranches(startDate?: string, endDate?: string): Promise<BranchPerformance[]> {
    const branches = await this.dataStore.findBy(
      FILE_PATHS.BRANCHES,
      DATA_KEYS.BRANCHES,
      (branch: any) => branch.isActive,
    );

    const performances = await Promise.all(
      branches.map(async (branch: any) => {
        const summary = await this.calculateFinancialSummary(
          branch.id,
          startDate,
          endDate,
        );

        const students = await this.dataStore.findBy(
          FILE_PATHS.STUDENTS,
          DATA_KEYS.STUDENTS,
          (student: any) => student.branchId === branch.id && student.isActive,
        );

        const courses = await this.dataStore.findBy(
          FILE_PATHS.COURSES,
          DATA_KEYS.COURSES,
          (course: any) => course.branchId === branch.id && course.isActive,
        );

        const profitMargin =
          summary.totalRevenue > 0
            ? (summary.netProfit / summary.totalRevenue) * 100
            : 0;

        return {
          branchId: branch.id,
          branchName: branch.name,
          revenue: summary.totalRevenue,
          profit: summary.netProfit,
          profitMargin,
          studentCount: students.length,
          courseCount: courses.length,
        };
      }),
    );

    return performances.sort((a, b) => b.profit - a.profit).slice(0, 5);
  }

  async getRevenueTrends(startDate?: string, endDate?: string): Promise<MonthlyMetric[]> {
    return this.getRevenueByMonth(startDate, endDate);
  }

  async getProfitLoss(branchId?: string, startDate?: string, endDate?: string): Promise<FinancialSummary> {
    return this.calculateFinancialSummary(branchId || null, startDate, endDate);
  }

  private getDummyDashboardData(): DashboardMetrics {
    return {
      companyWideSummary: {
        totalRevenue: 1250000,
        fixedExpenses: 350000,
        variableExpenses: 150000,
        salaries: 420000,
        sharedExpenses: 80000,
        totalExpenses: 1000000,
        netProfit: 250000,
      },
      branchSummaries: [
        {
          branchId: '1',
          branchName: 'Downtown Branch',
          branchCode: 'DTN-001',
          totalRevenue: 450000,
          fixedExpenses: 120000,
          variableExpenses: 50000,
          salaries: 150000,
          sharedExpenses: 30000,
          totalExpenses: 350000,
          netProfit: 100000,
        },
        {
          branchId: '2',
          branchName: 'Uptown Branch',
          branchCode: 'UPT-002',
          totalRevenue: 380000,
          fixedExpenses: 100000,
          variableExpenses: 45000,
          salaries: 130000,
          sharedExpenses: 25000,
          totalExpenses: 300000,
          netProfit: 80000,
        },
        {
          branchId: '3',
          branchName: 'Westside Branch',
          branchCode: 'WST-003',
          totalRevenue: 420000,
          fixedExpenses: 130000,
          variableExpenses: 55000,
          salaries: 140000,
          sharedExpenses: 25000,
          totalExpenses: 350000,
          netProfit: 70000,
        },
      ],
      revenueByMonth: [
        { month: 1, year: 2025, revenue: 95000, expenses: 78000, profit: 17000 },
        { month: 2, year: 2025, revenue: 102000, expenses: 82000, profit: 20000 },
        { month: 3, year: 2025, revenue: 108000, expenses: 85000, profit: 23000 },
        { month: 4, year: 2025, revenue: 115000, expenses: 88000, profit: 27000 },
        { month: 5, year: 2025, revenue: 122000, expenses: 90000, profit: 32000 },
        { month: 6, year: 2025, revenue: 130000, expenses: 92000, profit: 38000 },
        { month: 7, year: 2025, revenue: 125000, expenses: 89000, profit: 36000 },
        { month: 8, year: 2025, revenue: 118000, expenses: 87000, profit: 31000 },
        { month: 9, year: 2025, revenue: 112000, expenses: 85000, profit: 27000 },
        { month: 10, year: 2025, revenue: 105000, expenses: 83000, profit: 22000 },
        { month: 11, year: 2025, revenue: 98000, expenses: 80000, profit: 18000 },
        { month: 12, year: 2025, revenue: 100000, expenses: 81000, profit: 19000 },
      ],
      expensesByCategory: [
        { category: 'SALARIES', amount: 420000, percentage: 42 },
        { category: 'RENT', amount: 180000, percentage: 18 },
        { category: 'UTILITIES', amount: 95000, percentage: 9.5 },
        { category: 'MARKETING', amount: 120000, percentage: 12 },
        { category: 'SUPPLIES', amount: 85000, percentage: 8.5 },
        { category: 'MAINTENANCE', amount: 60000, percentage: 6 },
        { category: 'OTHER', amount: 40000, percentage: 4 },
      ],
      topPerformingBranches: [
        {
          branchId: '1',
          branchName: 'Downtown Branch',
          revenue: 450000,
          profit: 100000,
          profitMargin: 22.22,
          studentCount: 285,
          courseCount: 18,
        },
        {
          branchId: '3',
          branchName: 'Westside Branch',
          revenue: 420000,
          profit: 70000,
          profitMargin: 16.67,
          studentCount: 245,
          courseCount: 15,
        },
        {
          branchId: '2',
          branchName: 'Uptown Branch',
          revenue: 380000,
          profit: 80000,
          profitMargin: 21.05,
          studentCount: 220,
          courseCount: 14,
        },
      ],
      period: {
        startDate: 'all',
        endDate: 'all',
      },
    };
  }
}
