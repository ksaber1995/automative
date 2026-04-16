export interface MasterCourse {
  id: string;
  companyId: string;
  branchId: string;
  branchName?: string | null;
  name: string;
  code: string;
  description: string | null;
  defaultPrice: number;
  defaultDuration: number;
  defaultMaxStudents: number | null;
  isActive: boolean;
  linkedCourseCount?: number;
  branchCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface MasterCourseCreateDto {
  branchId: string;
  name: string;
  code: string;
  description?: string;
  defaultPrice: number;
  defaultDuration: number;
  defaultMaxStudents?: number;
}

export interface MasterCourseUpdateDto {
  name?: string;
  code?: string;
  description?: string;
  defaultPrice?: number;
  defaultDuration?: number;
  defaultMaxStudents?: number;
  isActive?: boolean;
}

export interface LinkedCourseSummary {
  id: string;
  branchId: string | null;
  branchName: string | null;
  name: string;
  code: string;
  price: number;
  duration: number;
  maxStudents: number | null;
  isActive: boolean;
}

