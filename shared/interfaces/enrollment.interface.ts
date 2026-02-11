import { EnrollmentStatus, PaymentStatus } from '../enums/enrollment-status.enum';

export interface Enrollment {
  id: string;
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
  paymentStatus: PaymentStatus;
  completionDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
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
  paymentStatus: PaymentStatus;
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
