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
}
