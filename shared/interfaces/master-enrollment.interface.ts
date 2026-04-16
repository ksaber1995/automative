export type MasterEnrollmentStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
export type MasterEnrollmentPaymentMode = 'FULL' | 'INSTALLMENTS';
export type MasterEnrollmentPaymentStatus = 'PENDING' | 'PARTIAL' | 'PAID';

export interface MasterEnrollment {
  id: string;
  companyId: string;
  studentId: string;
  studentName?: string;
  masterCourseId: string;
  masterCourseName?: string;
  masterCourseCode?: string;
  masterCoursePrice?: number;
  branchId: string;
  branchName?: string;
  enrollmentDate: string;
  originalPrice: number;
  discountPercent: number;
  discountAmount: number;
  finalPrice: number;
  paymentMode: MasterEnrollmentPaymentMode;
  downPayment: number;
  amountPaid: number;
  totalRefunded: number;
  paymentStatus: MasterEnrollmentPaymentStatus;
  paymentMethod: string | null;
  notes: string | null;
  status: MasterEnrollmentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MasterEnrollmentProgress extends MasterEnrollment {
  totalCourses: number;
  completedCourses: number;
  activeCourses: number;
  pendingCourses: number;
}

export interface MasterEnrollmentCreateDto {
  studentId: string;
  masterCourseId: string;
  enrollmentDate: string;
  originalPrice?: number;
  discountPercent?: number;
  discountAmount?: number;
  finalPrice?: number;
  paymentMode?: MasterEnrollmentPaymentMode;
  downPayment?: number;
  amountPaid?: number;
  paymentMethod?: string;
  notes?: string;
}
