/**
 * How a master course is sold. ONE_TIME is the original bundle: one price, paid
 * once, its member courses free thereafter. MONTHLY_SUBSCRIPTION charges its fee
 * every month and covers whatever is inside it — the only kind that can hold
 * per-month and per-session courses, since their own prices stop applying.
 */
export type MasterCoursePaymentType = 'ONE_TIME' | 'MONTHLY_SUBSCRIPTION';

export interface MasterCourse {
  id: string;
  companyId: string;
  branchId: string;
  branchName?: string | null;
  name: string;
  description: string | null;
  /** The bundle price when ONE_TIME, the monthly fee when MONTHLY_SUBSCRIPTION. */
  defaultPrice: number;
  paymentType: MasterCoursePaymentType;
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
  paymentType?: MasterCoursePaymentType;
  defaultDuration: number;
  defaultMaxStudents?: number;
  levelId?: string | null;
}

export interface MasterCourseUpdateDto {
  name?: string;
  description?: string;
  defaultPrice?: number;
  paymentType?: MasterCoursePaymentType;
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
  isActive: boolean;
}

