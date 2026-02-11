export interface Class {
  id: string;
  courseId: string;
  branchId: string;
  instructorId?: string;
  name: string;
  code: string;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  daysOfWeek?: string;
  maxStudents?: number;
  currentEnrollment: number;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClassCreateDto {
  courseId: string;
  branchId: string;
  instructorId?: string;
  name: string;
  code: string;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  daysOfWeek?: string;
  maxStudents?: number;
  notes?: string;
}

export interface ClassUpdateDto {
  courseId?: string;
  branchId?: string;
  instructorId?: string;
  name?: string;
  code?: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  daysOfWeek?: string;
  maxStudents?: number;
  notes?: string;
}

// Extended interface with populated data for frontend display
export interface ClassWithDetails extends Class {
  courseName?: string;
  branchName?: string;
  instructorName?: string;
  teacher?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  studentCount?: number;
  schedule?: {
    daysOfWeek?: string;
    startTime?: string;
    endTime?: string;
  };
  students?: Array<{
    id: string;
    firstName: string;
    lastName: string;
    email?: string;
    enrollmentStatus?: string;
  }>;
}
