import { EnrollmentStatus, PaymentStatus } from '../enums/enrollment-status.enum';

export interface Enrollment {
  id: string;
  studentId: string;
  courseId: string;
  branchId: string;
  enrollmentDate: string;
  status: EnrollmentStatus;
  originalPrice: number;
  discountPercent: number;
  discountAmount: number;
  finalPrice: number;
  paymentStatus: PaymentStatus;
  completionDate?: string | null;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EnrollmentCreateDto {
  studentId: string;
  courseId: string;
  branchId: string;
  enrollmentDate: string;
  originalPrice: number;
  discountPercent?: number;
  discountAmount?: number;
  notes?: string;
}

export interface EnrollmentUpdateDto {
  status?: EnrollmentStatus;
  paymentStatus?: PaymentStatus;
  completionDate?: string;
  notes?: string;
}
