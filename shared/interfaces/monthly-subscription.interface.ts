export type MonthlyPaymentStatus = 'PENDING' | 'PAID' | 'PARTIAL' | 'OVERDUE' | 'REFUNDED';

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
  /** Cumulative money returned for this bill (0 unless refunded). */
  refundedAmount?: number;
  refundNote?: string | null;
  refundedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MonthlyPaymentWithDetails extends MonthlySubscriptionPayment {
  studentName: string;
  /** The student's sequential code, and the QR state that decides whether it may be shown. */
  studentCode?: number | string | null;
  courseName: string;
  branchName: string;
  className?: string | null;
  studentPhone?: string | null;
  parentPhone?: string | null;
  parentName?: string | null;
  /** Current status of the underlying enrollment (e.g. ACTIVE, ON_HOLD). */
  enrollmentStatus?: string | null;
  /**
   * True for a VIRTUAL future-month row: what the student would owe, computed on
   * the fly and not stored. It has no real bill id (id is "proj-…"), so it cannot
   * be paid via /:id/pay — collecting on it goes through `collect` instead, which
   * creates the real bill at that moment.
   */
  projected?: boolean;
}

/** A monthly subscription currently on hold (generates no bills until resumed). */
export interface HeldSubscription {
  enrollmentId: string;
  studentId: string;
  courseId: string;
  branchId: string;
  studentName: string;
  studentCode?: number | string | null;
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
  /** Money reaches only users with `revenues: read` — undefined for everyone else. */
  totalRevenue?: number;
  totalExpected?: number;
  totalRefunded?: number;
}

export interface RecordMonthlyPaymentDto {
  amount: number;
  paymentDate: string;
  notes?: string;
}

/**
 * Collect a payment for a month that has no bill yet (a projected future month).
 * The server creates the single bill for that enrollment+month, then records the
 * payment — the only path that writes a future bill.
 */
export interface CollectMonthlyPaymentDto {
  enrollmentId: string;
  billingYear: number;
  billingMonth: number;
  amount: number;
  paymentDate?: string;
  notes?: string;
}

export interface RefundMonthlyPaymentDto {
  type: 'FULL' | 'PARTIAL';
  /** Required for PARTIAL; ignored for FULL (which refunds the whole paid amount). */
  amount?: number;
  note?: string;
  /** What to do with the underlying subscription after refunding. */
  subscriptionAction?: 'KEEP' | 'HOLD' | 'CANCEL';
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
