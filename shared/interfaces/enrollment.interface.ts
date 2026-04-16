import { EnrollmentStatus, PaymentMode, PaymentStatus } from '../enums/enrollment-status.enum';

export interface Enrollment {
  id: string;
  companyId: string;
  studentId: string;
  classId: string;
  courseId: string;
  branchId: string;
  enrollmentDate: string;
  status: EnrollmentStatus;
  originalPrice: number;
  discountPercent: number;
  discountAmount: number;
  finalPrice: number;
  paymentMode: PaymentMode;
  downPayment: number;
  amountPaid: number;
  totalRefunded: number;
  paymentStatus: PaymentStatus;
  completionDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnrollmentPayment {
  id: string;
  enrollmentId: string;
  companyId: string;
  amount: number;
  paymentDate: string;
  notes: string | null;
  createdAt: string;
}

export interface AddPaymentDto {
  amount: number;
  paymentDate: string;
  notes?: string;
}

export interface Refund {
  id: string;
  enrollmentId: string | null;
  masterEnrollmentId: string | null;
  companyId: string;
  studentId: string;
  amount: number;
  refundDate: string;
  type: 'FULL' | 'PARTIAL';
  reason: string | null;
  createdAt: string;
}

export interface RefundWithDetails extends Refund {
  studentName: string;
  courseName: string;
  branchName: string;
  branchId: string;
}

export interface DueEnrollment {
  id: string;
  studentId: string;
  studentName: string;
  courseId: string;
  courseName: string;
  branchId: string;
  branchName: string;
  enrollmentDate: string;
  finalPrice: number;
  amountPaid: number;
  remaining: number;
  paymentStatus: string;
  status: string;
}

export interface CreateRefundDto {
  type: 'FULL' | 'PARTIAL';
  amount: number;
  refundDate: string;
  reason?: string;
}

export interface EnrollmentWithDetails extends Enrollment {
  studentName?: string;
  courseName?: string;
  courseCode?: string;
  branchName?: string;
}

export interface EnrollmentCreateDto {
  studentId: string;
  classId: string;
  courseId: string;
  branchId: string;
  enrollmentDate: string;
  status: EnrollmentStatus;
  originalPrice: number;
  discountPercent?: number;
  discountAmount?: number;
  finalPrice: number;
  paymentMode: PaymentMode;
  downPayment?: number;
  notes?: string;
}

export interface EnrollmentUpdateDto {
  status?: EnrollmentStatus;
  paymentStatus?: PaymentStatus;
  completionDate?: string;
  notes?: string;
}

export interface PaymentInstallment {
  id: string;
  enrollmentId: string;
  amount: number;
  dueDate: string;
  paidDate: string | null;
  status: 'PENDING' | 'PAID' | 'OVERDUE';
  notes: string | null;
}
