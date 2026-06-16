export interface MasterClassEnrollment {
  id: string;
  companyId: string;
  masterEnrollmentId: string;
  studentId: string;
  classId: string;
  courseId: string;
  branchId: string;
  enrolledAt: string;
  status: 'ACTIVE' | 'COMPLETED' | 'DROPPED';
  notes: string | null;
  className: string | null;
  courseName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MasterClassEnrollmentCreateDto {
  masterEnrollmentId: string;
  classId: string;
  courseId: string;
  branchId: string;
  enrolledAt?: string;
  notes?: string;
}
