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
  /**
   * Homework rides on the exams table — same grading, listed separately.
   * `classId` narrows who sits it to one class; left null the row is course-wide,
   * every class of the course. Homework set from a session is stamped with it;
   * homework set from the Exams & Homework screen has no session at all.
   */
  isHomework: boolean;
  classId: string | null;
  className?: string;
  sessionId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExamCreateDto {
  /** Optional for homework: the server derives the course from classId. */
  courseId?: string;
  name: string;
  examDate: string;
  maxGrade?: number | null;
  status?: ExamStatus;
  isHomework?: boolean;
  classId?: string | null;
  sessionId?: string | null;
}

export interface ExamUpdateDto extends Partial<ExamCreateDto> {
  isActive?: boolean;
}

/** One row of the grading roster: an enrolled student + their grade (if any). */
export interface ExamResultRow {
  studentId: string;
  name: string;
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
  studentName: string;
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
  /** Exams and homework share this feed; the student page splits them by this. */
  isHomework?: boolean;
  /**
   * Show this mark as a rating (Excellent…Weak) rather than a number — the
   * company marks by rating and this one is out of 5. The server decides, so the
   * rule can't drift from the marking screen; the label is looked up client-side
   * because it is translated.
   */
  isRating?: boolean;
  className?: string | null;
}
