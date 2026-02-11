export interface Course {
  id: string;
  branchId: string;
  name: string;
  code: string;
  description: string | null;
  price: number;
  duration: number;
  maxStudents: number | null;
  instructorId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CourseWithEnrollmentCount extends Course {
  enrollmentCount: number;
}

export interface CourseCreateDto {
  branchId: string;
  name: string;
  code: string;
  description?: string;
  price: number;
  duration: number;
  maxStudents?: number;
  instructorId?: string;
}

export interface CourseUpdateDto {
  branchId?: string;
  name?: string;
  code?: string;
  description?: string;
  price?: number;
  duration?: number;
  maxStudents?: number;
  instructorId?: string;
  isActive?: boolean;
}
