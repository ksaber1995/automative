export interface MasterCourse {
  id: string;
  companyId: string;
  branchId: string | null;
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

export interface CloneMasterCourseDto {
  branchId: string;
  code?: string;
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

export interface ApplyMasterCourseDto {
  applyName?: boolean;
  applyDescription?: boolean;
  applyPrice?: boolean;
  applyDuration?: boolean;
  applyMaxStudents?: boolean;
}

export interface ApplyMasterCourseResult {
  updatedCount: number;
  skippedCount: number;
}

export interface InstantiateMasterCourseDto {
  branchIds: string[];
}

export interface InstantiateMasterCourseResult {
  createdCount: number;
  skippedCount: number;
  created: { id: string; branchId: string }[];
}
