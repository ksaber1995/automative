export type ExamStatus = 'SCHEDULED' | 'DONE';

export interface ExamModel {
  id: string;
  companyId: string;
  branchId: string | null;
  courseId: string;
  courseName?: string;
  name: string;
  examDate: string;
  /** Total possible marks ("out of"). null = no denominator. */
  maxGrade: number | null;
  status: ExamStatus | string;
  /** Number of students graded so far (populated by list/getById). */
  resultCount?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExamCreateDto {
  courseId: string;
  name: string;
  examDate: string;
  maxGrade?: number | null;
  status?: ExamStatus;
}

export interface ExamUpdateDto extends Partial<ExamCreateDto> {
  isActive?: boolean;
}

/** One row of the grading roster: an enrolled student + their grade (if any). */
export interface ExamResultRow {
  studentId: string;
  firstName: string;
  lastName: string;
  /** Short student code (for search / manual entry). */
  code?: number | string | null;
  parentName?: string | null;
  parentPhone?: string | null;
  studentPhone?: string | null;
  grade: string | null;
  /** True when the student was marked absent for this exam (no grade). */
  isAbsent?: boolean;
  recordedAt: string | null;
}

/** Result of a QR scan grade recording. */
export interface QrExamResult {
  studentId: string;
  studentFirstName: string;
  studentLastName: string;
  grade: string;
  alreadyRecorded: boolean;
}

/** A student's exam grade as shown on their detail page / public profile. */
export interface StudentExamResult {
  examName: string;
  courseName: string;
  examDate: string;
  grade: string;
  maxGrade?: number | null;
}
