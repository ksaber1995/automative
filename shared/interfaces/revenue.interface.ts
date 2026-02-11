import { PaymentMethod } from '../enums/enrollment-status.enum';

export interface Revenue {
  id: string;
  companyId: string;
  branchId: string;
  courseId?: string | null;
  enrollmentId?: string | null;
  studentId?: string | null;
  amount: number;
  description: string;
  date: string;
  paymentMethod: PaymentMethod;
  receiptNumber?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RevenueCreateDto {
  branchId: string;
  courseId?: string | null;
  enrollmentId?: string | null;
  studentId?: string | null;
  amount: number;
  description: string;
  date: string;
  paymentMethod: PaymentMethod;
  receiptNumber?: string;
  notes?: string;
}

export interface RevenueUpdateDto {
  amount?: number;
  description?: string;
  date?: string;
  paymentMethod?: PaymentMethod;
  receiptNumber?: string;
  notes?: string;
}
