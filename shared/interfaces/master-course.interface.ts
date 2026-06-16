export interface MasterCourse {
  id: string;
  companyId: string;
  branchId: string;
  branchName?: string | null;
  name: string;
  description: string | null;
  defaultPrice: number;
  defaultDuration: number;
  defaultMaxStudents: number | null;
  levelId?: string | null;
  levelName?: string | null;
  isActive: boolean;
  linkedCourseCount?: number;
  branchCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface MasterCourseCreateDto {
  branchId: string;
  name: string;
  description?: string;
  defaultPrice: number;
  defaultDuration: number;
  defaultMaxStudents?: number;
  levelId?: string | null;
}

export interface MasterCourseUpdateDto {
  name?: string;
  description?: string;
  defaultPrice?: number;
  defaultDuration?: number;
  defaultMaxStudents?: number;
  levelId?: string | null;
  isActive?: boolean;
}

export interface LinkedCourseSummary {
  id: string;
  branchId: string | null;
  branchName: string | null;
  name: string;
  price: number;
  duration: number;
  maxStudents: number | null;
  isActive: boolean;
}

