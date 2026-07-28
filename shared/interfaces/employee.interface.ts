/**
 * How this person is paid. UNPAID is a teacher who draws nothing — a founder or
 * co-founder teaching their own academy — so no salary ever accrues for them
 * and they never appear on the salaries page.
 */
export type SalaryType = 'MONTHLY' | 'SESSION_BASED' | 'PERCENTAGE' | 'UNPAID';

export interface Employee {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  position: string;
  department: string;
  branchId?: string | null;
  isGlobal: boolean;
  salary: number;
  salaryType: SalaryType;
  /** Pay per taught session, when salaryType === 'SESSION_BASED'. */
  sessionRate?: number | null;
  /** Percent of paid class revenue, when salaryType === 'PERCENTAGE' (0–100). */
  percentageRate?: number | null;
  hireDate: string;
  terminationDate?: string | null;
  isActive: boolean;
  /** A teacher is an employee with this flag set — not a separate table. */
  isTeacher?: boolean;
  /** Optional, teachers only. Subjects are academy-only, like everywhere else. */
  subjectIds?: string[];
  subjects?: { id: string; name: string | null }[];
  /** Optional, teachers only. */
  levelIds?: string[];
  levels?: { id: string; name: string | null }[];
  linkedUserId?: string | null;
  hasSalaryHistory?: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeCreateDto {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  position: string;
  department: string;
  branchId?: string | null;
  isGlobal: boolean;
  salary: number;
  salaryType?: SalaryType;
  sessionRate?: number | null;
  percentageRate?: number | null;
  hireDate: string;
  isTeacher?: boolean;
  subjectIds?: string[];
  levelIds?: string[];
  notes?: string;
}

export interface EmployeeUpdateDto {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  position?: string;
  department?: string;
  branchId?: string | null;
  isGlobal?: boolean;
  salary?: number;
  salaryType?: SalaryType;
  sessionRate?: number | null;
  percentageRate?: number | null;
  terminationDate?: string;
  isActive?: boolean;
  isTeacher?: boolean;
  subjectIds?: string[];
  levelIds?: string[];
  notes?: string;
}
