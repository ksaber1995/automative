import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataStoreService } from '../data-store/data-store.service';
import { FILE_PATHS, DATA_KEYS } from '../data-store/file-paths.constant';

interface ExpenseFilters {
  branchId?: string;
  type?: string;
  startDate?: string;
  endDate?: string;
}

@Injectable()
export class ExpensesService {
  constructor(private dataStore: DataStoreService) {}

  async findAll(filters?: ExpenseFilters): Promise<any[]> {
    let expenses = await this.dataStore.findAll(FILE_PATHS.EXPENSES, DATA_KEYS.EXPENSES);

    if (filters) {
      expenses = expenses.filter((exp: any) => {
        let match = true;

        if (filters.branchId) {
          match = match && exp.branchId === filters.branchId;
        }

        if (filters.type) {
          match = match && exp.type === filters.type;
        }

        if (filters.startDate) {
          match = match && new Date(exp.date) >= new Date(filters.startDate);
        }

        if (filters.endDate) {
          match = match && new Date(exp.date) <= new Date(filters.endDate);
        }

        return match;
      });
    }

    return expenses;
  }

  async getRecurring(): Promise<any[]> {
    return await this.dataStore.findBy(
      FILE_PATHS.EXPENSES,
      DATA_KEYS.EXPENSES,
      (expense: any) => expense.isRecurring === true && !expense.parentExpenseId,
    );
  }

  async getByType(type: string): Promise<any[]> {
    return await this.dataStore.findBy(
      FILE_PATHS.EXPENSES,
      DATA_KEYS.EXPENSES,
      (expense: any) => expense.type === type,
    );
  }

  async distributeSharedExpense(
    expenseAmount: number,
    method: 'EQUAL' | 'PROPORTIONAL' = 'EQUAL',
  ): Promise<Record<string, number>> {
    const branches = await this.dataStore.findBy(
      FILE_PATHS.BRANCHES,
      DATA_KEYS.BRANCHES,
      (branch: any) => branch.isActive,
    );

    const distribution = new Map<string, number>();

    if (method === 'EQUAL') {
      const amountPerBranch = expenseAmount / branches.length;
      branches.forEach((branch: any) => {
        distribution.set(branch.id, amountPerBranch);
      });
    } else if (method === 'PROPORTIONAL') {
      const revenues = await this.dataStore.findAll(
        FILE_PATHS.REVENUES,
        DATA_KEYS.REVENUES,
      );

      const branchRevenues = new Map<string, number>();
      let totalRevenue: number = 0;

      branches.forEach((branch: any) => {
        const branchRev: number = (revenues as any[])
          .filter((rev: any) => rev.branchId === branch.id)
          .reduce((sum: number, rev: any) => sum + (rev.amount as number), 0) as number;
        branchRevenues.set(branch.id, branchRev);
        totalRevenue += branchRev;
      });

      if (totalRevenue > 0) {
        branches.forEach((branch: any) => {
          const branchRev = branchRevenues.get(branch.id) || 0;
          const percentage = branchRev / totalRevenue;
          distribution.set(branch.id, expenseAmount * percentage);
        });
      } else {
        // Fallback to equal distribution if no revenue data
        const amountPerBranch = expenseAmount / branches.length;
        branches.forEach((branch: any) => {
          distribution.set(branch.id, amountPerBranch);
        });
      }
    }

    return Object.fromEntries(distribution);
  }

  @Cron('0 0 1 * *') // Run at midnight on the 1st of every month
  async autoGenerateRecurringExpenses(): Promise<{ message: string }> {
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth();
    const currentYear = currentDate.getFullYear();

    const recurringExpenses = await this.getRecurring();

    for (const expense of recurringExpenses) {
      const exp = expense as any;

      // Check if already generated for this month
      const existingExpenses = await this.dataStore.findBy(
        FILE_PATHS.EXPENSES,
        DATA_KEYS.EXPENSES,
        (e: any) =>
          e.parentExpenseId === exp.id &&
          new Date(e.date).getMonth() === currentMonth &&
          new Date(e.date).getFullYear() === currentYear,
      );

      if (existingExpenses.length === 0) {
        // Generate new expense
        await this.dataStore.create(FILE_PATHS.EXPENSES, DATA_KEYS.EXPENSES, {
          branchId: exp.branchId,
          type: exp.type,
          category: exp.category,
          amount: exp.amount,
          description: `${exp.description} - ${currentMonth + 1}/${currentYear}`,
          date: new Date(currentYear, currentMonth, exp.recurringDay || 1).toISOString(),
          isRecurring: false,
          recurringDay: null,
          parentExpenseId: exp.id,
          distributionMethod: exp.distributionMethod,
          vendor: exp.vendor,
          invoiceNumber: null,
          notes: `Auto-generated from recurring expense ${exp.id}`,
        });
      }
    }

    return { message: 'Recurring expenses generated successfully' };
  }

  async calculateTotalSalaries(branchId?: string): Promise<number> {
    const employees = await this.dataStore.findBy(
      FILE_PATHS.EMPLOYEES,
      DATA_KEYS.EMPLOYEES,
      (emp: any) => {
        if (!emp.isActive) return false;
        if (!branchId) return true;
        return emp.branchId === branchId || emp.isGlobal;
      },
    );

    const totalSalaries = employees.reduce(
      (sum: number, emp: any) => sum + (emp.salary || 0),
      0,
    );

    return totalSalaries;
  }
}
