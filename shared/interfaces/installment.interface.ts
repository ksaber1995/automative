import { ExpenseType, ExpenseCategory } from '../enums/expense-type.enum';
import { ExpensePayment } from './expense.interface';

export type InstallmentPlanStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELED';
export type InstallmentScheduleStatus = 'PENDING' | 'PAID' | 'SKIPPED';

export interface InstallmentPlan {
  id: string;
  companyId: string;
  branchId?: string | null;
  name: string;
  description?: string | null;
  type: ExpenseType;
  category: ExpenseCategory;
  totalAmount: number;
  downpaymentAmount: number;
  financedAmount: number;
  monthsCount: number;
  monthlyAmount: number;
  startDate: string;
  vendor?: string | null;
  invoiceNumber?: string | null;
  notes?: string | null;
  status: InstallmentPlanStatus;
  downpaymentPaymentId?: string | null;
  paidCount?: number;
  paidAmount?: number;
  nextDueDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InstallmentScheduleItem {
  id: string;
  planId: string;
  companyId: string;
  installmentNumber: number;
  dueDate: string;
  amount: number;
  status: InstallmentScheduleStatus;
  paymentId?: string | null;
  paidDate?: string | null;
  paidAmount?: number | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InstallmentPlanCreateDto {
  branchId?: string | null;
  name: string;
  description?: string;
  type?: ExpenseType;
  category: ExpenseCategory;
  totalAmount: number;
  downpaymentAmount?: number;
  monthsCount: number;
  startDate: string;
  vendor?: string;
  invoiceNumber?: string;
  notes?: string;
}

export interface InstallmentPlanWithSchedule {
  plan: InstallmentPlan;
  schedule: InstallmentScheduleItem[];
  downpaymentPayment: ExpensePayment | null;
}

export interface InstallmentPayDto {
  date?: string;
  amount?: number;
  notes?: string;
}
