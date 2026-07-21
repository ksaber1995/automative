import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/services/api.service';

export interface PublicStudentCourse {
  courseName: string;
  className: string | null;
  status: string;
  paymentStatus: string;
  enrollmentDate: string | null;
}

export interface PublicStudentAttendanceRecent {
  sessionStartDate: string;
  sessionNumber?: number | null;
  className: string;
  roomCode: string | null;
  isPresent: boolean;
  status?: 'PRESENT' | 'ABSENT' | 'SUBSTITUTED';
  /** When the student was marked in; null for an absence. */
  checkedInAt?: string | null;
  substitutedInClassName?: string | null;
}

/** A billed month of a monthly subscription. */
export interface PublicMonthlyPayment {
  courseName: string;
  className: string | null;
  billingYear: number;
  billingMonth: number;
  amountDue: number;
  amountPaid: number;
  status: string;
  dueDate: string | null;
  paidDate: string | null;
}

/** A per-session charge. */
export interface PublicSessionPayment {
  courseName: string;
  className: string | null;
  sessionNumber: number | null;
  sessionStartDate: string | null;
  attendanceState: string | null;
  amountDue: number;
  amountPaid: number;
  status: string;
  paidDate: string | null;
}

/** A prepaid bundle of sessions. */
export interface PublicSessionPackage {
  courseName: string;
  sessionsTotal: number;
  sessionsUsed: number;
  amountDue: number;
  amountPaid: number;
  status: string;
  purchasedAt: string | null;
}

/** A one-time (or instalment) course purchase. */
export interface PublicOneTimePayment {
  courseName: string;
  className: string | null;
  paymentMode: string;
  originalPrice: number;
  discountAmount: number;
  finalPrice: number;
  downPayment: number;
  amountPaid: number;
  totalRefunded: number;
  remaining: number;
  status: string;
  enrollmentDate: string | null;
  instalments: { amount: number; paymentDate: string | null }[];
}

export interface PublicRefund {
  courseName: string | null;
  amount: number;
  refundDate: string | null;
  type: string | null;
}

export interface PublicStudentPayments {
  monthly: PublicMonthlyPayment[];
  sessions: PublicSessionPayment[];
  packages: PublicSessionPackage[];
  oneTime: PublicOneTimePayment[];
  refunds: PublicRefund[];
  totalPaid: number;
  totalOutstanding: number;
  totalRefunded: number;
}

export interface PublicStudentExam {
  examName: string;
  courseName: string;
  examDate: string;
  grade: string;
  maxGrade?: number | null;
}

export interface PublicStudentProfile {
  student: {
    name: string;
    branchName: string;
    academyName: string;
  };
  courses: PublicStudentCourse[];
  attendance: {
    totalSessions: number;
    presentCount: number;
    absentCount: number;
    attendanceRate: number;
    recent: PublicStudentAttendanceRecent[];
  };
  exams?: PublicStudentExam[];
  payments?: PublicStudentPayments;
}

/**
 * Fetches the public, unauthenticated student profile by QR token. The
 * auth interceptor skips token attachment for `/public/` URLs, so this works
 * for a logged-out visitor (e.g. a parent scanning the printed QR).
 */
@Injectable({ providedIn: 'root' })
export class PublicStudentService {
  private api = inject(ApiService);

  getProfile(qrToken: string): Observable<PublicStudentProfile> {
    return this.api.get<PublicStudentProfile>(`public/students/${qrToken}`);
  }
}
