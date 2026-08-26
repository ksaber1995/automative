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
  /** The course this session belongs to — drives the page's course filter. */
  courseName?: string | null;
  /** Who teaches the group (class instructor, else the course's). */
  teacherName?: string | null;
  roomCode: string | null;
  isPresent: boolean;
  status?: 'PRESENT' | 'ABSENT' | 'SUBSTITUTED';
  /** When the student was marked in; null for an absence. */
  checkedInAt?: string | null;
  /** How their attendance on this session was recorded, when they were here. */
  attendedAs?: 'NORMAL' | 'SUBSTITUTION' | 'TRIAL' | null;
  /** The group they belonged to when they sat it as a substitution. */
  attendedFromClassName?: string | null;
  substitutedInClassName?: string | null;
  /** The day the make-up was sat, when this session was substituted. */
  substitutedSessionDate?: string | null;
}

/** A billed month of a monthly subscription. */
export interface PublicMonthlyPayment {
  courseName: string;
  className: string | null;
  teacherName?: string | null;
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
  teacherName?: string | null;
  sessionNumber: number | null;
  sessionStartDate: string | null;
  attendanceState: string | null;
  amountDue: number;
  amountPaid: number;
  status: string;
  paidDate: string | null;
}

/** Attendance for one of the student's classes. */
export interface PublicStudentClassAttendance {
  className: string;
  totalSessions: number;
  presentCount: number;
  absentCount: number;
  attendanceRate: number;
}

/** A prepaid bundle of sessions. */
export interface PublicSessionPackage {
  courseName: string;
  teacherName?: string | null;
  sessionsTotal: number;
  sessionsUsed: number;
  sessionsRemaining: number;
  amountDue: number;
  amountPaid: number;
  status: string;
  purchasedAt: string | null;
}

/** A one-time (or instalment) course purchase. */
export interface PublicOneTimePayment {
  courseName: string;
  className: string | null;
  teacherName?: string | null;
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
  /**
   * No longer sent: a paid-to-date total is a statement of account, and this
   * page is behind nothing but the QR token on the student's card. Optional so
   * a cached older payload still parses.
   */
  totalPaid?: number;
  totalOutstanding: number;
  totalRefunded: number;
}

export interface PublicStudentExam {
  examName: string;
  courseName: string;
  /** Null when the exam is course-wide rather than set for one class. */
  className?: string | null;
  /** Who set it (class instructor, else the course's). */
  teacherName?: string | null;
  examDate: string;
  grade: string;
  maxGrade?: number | null;
  /** Homework shares the exams table; the portal lists the two apart. */
  isHomework?: boolean;
  /** Show this mark as a rating (Excellent…Weak) instead of a number. */
  isRating?: boolean;
  /** Recorded as not there. */
  isAbsent?: boolean;
  /** Nobody recorded anything — shown as a miss, same as absent. */
  notMarked?: boolean;
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
    /** The same figures per class, worst attendance first. */
    byClass: PublicStudentClassAttendance[];
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
/** A pool card that hasn't been handed to a student yet. */
export interface PublicUnassignedCard {
  serial: number;
  companyName: string;
  companyType: string;
}

@Injectable({ providedIn: 'root' })
export class PublicStudentService {
  private api = inject(ApiService);

  getProfile(qrToken: string): Observable<PublicStudentProfile> {
    return this.api.get<PublicStudentProfile>(`public/students/${qrToken}`);
  }

  /**
   * Whose blank card is this? Only resolves for a card with no student on it —
   * a linked card belongs on the profile above.
   */
  getUnassignedCard(token: string): Observable<PublicUnassignedCard> {
    return this.api.get<PublicUnassignedCard>(`public/cards/${token}`);
  }
}
