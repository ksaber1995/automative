export interface Course {
  id: string;
  name: string;
  code: string;
  description: string;
  price: number;
  duration: string;
  level: string;
  branchId: string;
  maxStudents?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CourseCreateDto {
  name: string;
  code: string;
  description: string;
  price: number;
  duration: string;
  level: string;
  branchId: string;
  maxStudents?: number;
}

export interface CourseUpdateDto {
  name?: string;
  code?: string;
  description?: string;
  price?: number;
  duration?: string;
  level?: string;
  branchId?: string;
  maxStudents?: number;
  isActive?: boolean;
}
