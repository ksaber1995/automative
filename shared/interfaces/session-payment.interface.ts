export type SessionPaymentStatus = 'PENDING' | 'PAID' | 'COVERED' | 'WAIVED' | 'REFUNDED';

export interface SessionPayment {
  id: string;
  enrollmentId: string;
  sessionId: string;
  companyId: string;
  studentId: string;
  courseId: string;
  branchId: string;
  packageId: string | null;
  attendanceState: 'PRESENT' | 'ABSENT';
  amountDue: number;
  amountPaid: number;
  paymentStatus: SessionPaymentStatus;
  paidDate: string | null;
  notes: string | null;
  refundedAmount?: number;
  refundNote?: string | null;
  refundedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionPaymentWithDetails extends SessionPayment {
  studentFirstName: string;
  studentLastName: string;
  courseName: string;
  branchName: string;
  className?: string | null;
  sessionNumber?: number | null;
  sessionDate?: string | null;
  studentPhone?: string | null;
  parentPhone?: string | null;
  parentName?: string | null;
  /** Course's advance-package offer (null when the course offers none). */
  coursePackageSize?: number | null;
  coursePackagePrice?: number | null;
  /** Enrollment lifecycle status (e.g. ON_HOLD) for the charge's enrollment. */
  enrollmentStatus?: string | null;
  /** Usage of the prepaid package covering this charge (null for single-session charges). */
  pkgSessionsTotal?: number | null;
  pkgSessionsUsed?: number | null;
  /** Present on attendance-check-in responses only. */
  packageRemaining?: number | null;
  isNew?: boolean;
  /** True when this enrollment ever bought a prepaid package (a "package customer"). */
  hadPackage?: boolean;
}

/** A package customer whose prepaid sessions ran out — owes the next package. */
export interface PackageRenewalDue {
  enrollmentId: string;
  studentId: string;
  branchId: string;
  courseId: string;
  studentFirstName: string;
  studentLastName: string;
  courseName: string;
  branchName: string;
  packageSize: number | null;
  packagePrice: number | null;
  lastSessionsTotal: number;
  lastSessionsUsed: number;
  /** Attended-but-unpaid sessions racked up after the bundle ran out. */
  unpaidSessions: number;
  exhaustedAt: string | null;
}

export interface SessionPaymentSummary {
  totalCharges: number;
  paidCount: number;
  coveredCount: number;
  pendingCount: number;
  refundedCount: number;
  /** Earned revenue: sessions attended in range; packages spread as price ÷ size per session. */
  totalRevenue: number;
  totalExpected: number;
  /** Cash collected in range (payment-dated); packages count in full on purchase day. */
  cashCollected?: number;
  /** Of cashCollected, the portion from prepaid packages only. */
  packageCashCollected?: number;
}

export interface SessionPackage {
  id: string;
  enrollmentId: string;
  companyId: string;
  studentId: string;
  courseId: string;
  branchId: string;
  sessionsTotal: number;
  sessionsUsed: number;
  amountDue?: number;
  amountPaid: number;
  status: 'ACTIVE' | 'EXHAUSTED' | 'REFUNDED';
  refundedAmount?: number;
  refundNote?: string | null;
  refundedAt?: string | null;
  purchasedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionPackageWithDetails extends SessionPackage {
  studentFirstName: string;
  studentLastName: string;
  courseName: string;
  branchName: string;
}

export interface RecordSessionPaymentDto {
  amount: number;
  paymentDate: string;
  notes?: string;
}

export interface RefundSessionPaymentDto {
  /** FULL refunds the whole remaining paid amount; PARTIAL requires `amount`. */
  type?: 'FULL' | 'PARTIAL';
  amount?: number;
  note?: string;
}

export interface BuySessionPackageDto {
  enrollmentId: string;
  sessionsTotal?: number;
  amount?: number;
  amountDue?: number;
  notes?: string;
}
