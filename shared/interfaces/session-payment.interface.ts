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
  /** Present on attendance-check-in responses only. */
  packageRemaining?: number | null;
  isNew?: boolean;
}

export interface SessionPaymentSummary {
  totalCharges: number;
  paidCount: number;
  coveredCount: number;
  pendingCount: number;
  refundedCount: number;
  totalRevenue: number;
  totalExpected: number;
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
  amountPaid: number;
  status: 'ACTIVE' | 'EXHAUSTED' | 'REFUNDED';
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
  amount: number;
  note?: string;
}

export interface BuySessionPackageDto {
  enrollmentId: string;
  sessionsTotal?: number;
  amount?: number;
  notes?: string;
}
