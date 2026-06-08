export type MonthlyPaymentStatus = 'PENDING' | 'PAID' | 'PARTIAL' | 'OVERDUE';

export interface MonthlySubscriptionPayment {
  id: string;
  enrollmentId: string;
  companyId: string;
  studentId: string;
  courseId: string;
  branchId: string;
  billingYear: number;
  billingMonth: number;
  amountDue: number;
  amountPaid: number;
  paymentStatus: MonthlyPaymentStatus;
  dueDate: string;
  paidDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MonthlyPaymentWithDetails extends MonthlySubscriptionPayment {
  studentFirstName: string;
  studentLastName: string;
  courseName: string;
  branchName: string;
  className?: string | null;
}

export interface MonthlyPaymentSummary {
  billingYear: number;
  billingMonth: number;
  totalStudents: number;
  paidCount: number;
  pendingCount: number;
  overdueCount: number;
  partialCount: number;
  totalRevenue: number;
  totalExpected: number;
}

export interface RecordMonthlyPaymentDto {
  amount: number;
  paymentDate: string;
  notes?: string;
}

export interface GenerateMonthlyBillsDto {
  courseId?: string;
  branchId?: string;
  billingYear: number;
  billingMonth: number;
}
