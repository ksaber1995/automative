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
  studentPhone?: string | null;
  parentPhone?: string | null;
  parentName?: string | null;
  /** Current status of the underlying enrollment (e.g. ACTIVE, ON_HOLD). */
  enrollmentStatus?: string | null;
}

/** A monthly subscription currently on hold (generates no bills until resumed). */
export interface HeldSubscription {
  enrollmentId: string;
  studentId: string;
  courseId: string;
  branchId: string;
  studentFirstName: string;
  studentLastName: string;
  courseName: string;
  branchName: string;
  className?: string | null;
  holdStartMonth?: number | null;
  holdStartYear?: number | null;
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

export interface CourseMonthlyPriceOverride {
  id: string;
  courseId: string;
  companyId: string;
  billingYear: number;
  billingMonth: number;
  overridePrice: number;
  createdAt: string;
  updatedAt: string;
}

export interface SetPriceOverrideDto {
  courseId: string;
  billingYear: number;
  billingMonth: number;
  overridePrice: number;
}
