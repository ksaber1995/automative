import { ExpenseType, ExpenseCategory, DistributionMethod } from '../enums/expense-type.enum';

export interface Expense {
  id: string;
  branchId?: string | null;
  type: ExpenseType;
  category: ExpenseCategory;
  amount: number;
  description: string;
  date: string;
  isRecurring: boolean;
  recurringDay?: number;
  parentExpenseId?: string | null;
  distributionMethod?: DistributionMethod;
  vendor?: string;
  invoiceNumber?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseCreateDto {
  branchId?: string | null;
  type: ExpenseType;
  category: ExpenseCategory;
  amount: number;
  description: string;
  date: string;
  isRecurring?: boolean;
  recurringDay?: number;
  distributionMethod?: DistributionMethod;
  vendor?: string;
  invoiceNumber?: string;
  notes?: string;
}

export interface ExpenseUpdateDto {
  amount?: number;
  description?: string;
  date?: string;
  category?: ExpenseCategory;
  isRecurring?: boolean;
  recurringDay?: number;
  distributionMethod?: DistributionMethod;
  vendor?: string;
  invoiceNumber?: string;
  notes?: string;
}
