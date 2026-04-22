import { ExpenseType, ExpenseCategory, DistributionMethod } from '../enums/expense-type.enum';

export interface Expense {
  id: string;
  companyId: string;
  branchId?: string | null;
  type: ExpenseType;
  category: ExpenseCategory;
  amount: number;
  description: string;
  date: string;
  isRecurring: boolean;
  parentExpenseId?: string | null;
  distributionMethod?: DistributionMethod;
  vendor?: string;
  invoiceNumber?: string;
  notes?: string;
  assetName?: string | null;
  amortizationMonths?: number | null;
  monthlyAmount?: number | null;
  bonusAmount?: number | null;
  discountAmount?: number | null;
  adjustmentReason?: string | null;
  totalPaid?: number;
  lastPaymentDate?: string | null;
  paymentCount?: number;
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
  distributionMethod?: DistributionMethod;
  vendor?: string;
  invoiceNumber?: string;
  notes?: string;
  assetName?: string;
  amortizationMonths?: number;
}

export interface ExpenseUpdateDto {
  amount?: number;
  description?: string;
  date?: string;
  category?: ExpenseCategory;
  isRecurring?: boolean;
  distributionMethod?: DistributionMethod;
  vendor?: string;
  invoiceNumber?: string;
  notes?: string;
}

export interface ExpensePayment {
  id: string;
  companyId: string;
  expenseId?: string | null;
  branchId?: string | null;
  employeeId?: string | null;
  eventId?: string | null;
  type: ExpenseType;
  category: ExpenseCategory;
  amount: number;
  date: string;
  notes?: string | null;
  vendor?: string | null;
  invoiceNumber?: string | null;
  bonusAmount?: number;
  discountAmount?: number;
  adjustmentReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExpensePaymentCreateDto {
  expenseId?: string | null;
  branchId?: string | null;
  employeeId?: string;
  eventId?: string;
  type: ExpenseType;
  category: ExpenseCategory;
  amount: number;
  date: string;
  notes?: string;
  vendor?: string;
  invoiceNumber?: string;
  bonusAmount?: number;
  discountAmount?: number;
  adjustmentReason?: string;
}
