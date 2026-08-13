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
  /** Per-session fee when paymentType is PER_SESSION; otherwise the course price. */
  price: number;
  paymentType: 'ONE_TIME' | 'MONTHLY_SUBSCRIPTION' | 'PER_SESSION';
  /**
   * How often the course meets, from its running classes' schedules. What turns
   * a per-session fee into a monthly figure comparable to the bundle price.
   * Null when no class is scheduled yet — no honest estimate exists then.
   */
  sessionsPerWeek: number | null;
  isActive: boolean;
}

