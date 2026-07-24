export interface Course {
  id: string;
  companyId: string;
  branchId: string | null; // Can be null for global courses available to all branches
  name: string;
  description: string | null;
  price: number;
  /** The branch's name, supplied by the course list. Null for a global course. */
  branchName?: string | null;
  instructorId: string | null;
  /** The assigned teacher's name, supplied by the course list. */
  instructorName?: string | null;
  defaultRoomId: string | null;
  levelId?: string | null;
  levelName?: string | null;
  levelIds?: string[];
  levels?: { id: string; name: string | null }[];
  subjectIds?: string[];
  subjects?: { id: string; name: string | null }[];
  isActive: boolean;
  paymentType: 'ONE_TIME' | 'MONTHLY_SUBSCRIPTION' | 'PER_SESSION';
  // PER_SESSION settings (price holds the per-session fee):
  sessionPackageSize?: number | null;
  sessionPackagePrice?: number | null;
  chargeAbsentSessions?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CourseWithEnrollmentCount extends Course {
  enrollmentCount: number;
  directEnrollmentCount: number;
  masterEnrollmentCount: number;
}

export interface CourseCreateDto {
  branchId: string | null; // Can be null for global courses
  name: string;
  description?: string;
  price: number;
  instructorId?: string;
  levelId?: string | null;
  levelIds?: string[];
  subjectIds?: string[];
  paymentType?: 'ONE_TIME' | 'MONTHLY_SUBSCRIPTION' | 'PER_SESSION';
  sessionPackageSize?: number | null;
  sessionPackagePrice?: number | null;
  chargeAbsentSessions?: boolean;
}

export interface CourseUpdateDto {
  branchId?: string;
  name?: string;
  description?: string;
  price?: number;
  instructorId?: string;
  levelId?: string | null;
  levelIds?: string[];
  subjectIds?: string[];
  isActive?: boolean;
  paymentType?: 'ONE_TIME' | 'MONTHLY_SUBSCRIPTION' | 'PER_SESSION';
  sessionPackageSize?: number | null;
  sessionPackagePrice?: number | null;
  chargeAbsentSessions?: boolean;
}
