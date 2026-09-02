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
  /**
   * An ONLINE exam: the student sits it on a screen, each one gets a different
   * random paper drawn from the question banks of `lessonIds`, and the mark is
   * computed on submit. Same table, same results feed — see online_exams.md.
   */
  isOnline: boolean;
  /** How many questions to draw. Equals `maxGrade`: one mark per question. */
  questionCount: number | null;
  /** The clock each student gets, counted from when THEY start. */
  durationMinutes: number | null;
  opensAt: string | null;
  closesAt: string | null;
  /** Short code the teacher reads out so nobody starts early. Optional. */
  accessCode: string | null;
  shuffleOptions: boolean;
  /** Show the per-question review after submitting; off = score only. */
  showAnswers: boolean;
  /** Lessons the paper is drawn from. Present on the single-exam read only. */
  lessonIds?: string[];
  /**
   * How far the sitting has got — single-exam read only. `started > 0` is what
   * freezes the lesson scope and question count in the edit form (the server's
   * 409 ALREADY_STARTED stays the backstop).
   */
  attemptCounts?: { started: number; submitted: number };
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One row of the online-exam attempts monitor. NOT_STARTED = no attempt yet. */
export interface ExamAttemptRow {
  studentId: string;
  name: string;
  code?: number | string | null;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'EXPIRED';
  startedAt: string | null;
  submittedAt: string | null;
  /** The attempt's server-owned deadline — what the live countdown reads. */
  expiresAt: string | null;
  score: number | null;
  total: number | null;
  answeredCount: number;
  /**
   * The model this student was handed, on an exam that has models. Null on a
   * pooled exam, where each paper is its own random draw.
   */
  modelName?: string | null;
}

export interface ExamAttemptsResponse {
  /** What the monitor corrects the device clock by. */
  serverNow: string;
  attempts: ExamAttemptRow[];
}

/**
 * One MODEL (variant) of an online exam — "Model A" of "Test 1" — and its fixed
 * paper. Every student handed this model sits exactly these questions.
 *
 * Named ExamPaperModel because `ExamModel` above is already this codebase's DTO
 * name for an exam itself; the API calls these `models`, and so does the UI.
 *
 * Models may differ in length. Each student is marked out of the paper they
 * actually sat (ExamAttemptRow.total, and exam_results.out_of).
 */
export interface ExamPaperModel {
  id: string;
  name: string;
  orderIndex: number;
  /** Counted server-side on read, never stored — a saved count would go stale. */
  questionCount: number;
  /** How many students have been handed it. Non-zero freezes every model. */
  attemptCount: number;
  questions: ExamPaperModelQuestion[];
  /** Classes pinned to this model, when distribution is BY_CLASS. */
  classIds: string[];
}

export interface ExamPaperModelQuestion {
  questionId: string;
  orderIndex: number;
  questionText: string;
  lessonId: string | null;
  lessonName: string | null;
}

/** How an exam hands its models out. */
export type ExamModelDistribution = 'RANDOM' | 'BY_CLASS';

export interface ExamModelsResponse {
  /** null = no models yet, so the exam still draws a pooled random paper. */
  distribution: ExamModelDistribution | null;
  /** Somebody has started: the models are frozen. */
  locked: boolean;
  models: ExamPaperModel[];
  /** The classes on this exam's course, for per-class assignment. */
  classes: { id: string; name: string }[];
}

/** A bank question as the model builder browses it. Never carries the key. */
export interface ExamPoolQuestion {
  id: string;
  questionText: string;
  lessonId: string | null;
  lessonName: string | null;
}

/**
 * A student's exam-portal credential as the TEACHER sees it: existence and the
 * audit stamps only. An unexpected `resetAt` is the visible symptom of a lost
 * or borrowed card. No password is readable by anyone, anywhere.
 */
export interface StudentCredentialInfo {
  hasCredentials: boolean;
  username: string | null;
  claimedAt: string | null;
  resetAt: string | null;
  lastLoginAt: string | null;
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
  // ── Online exam ───────────────────────────────────────────────────────────
  isOnline?: boolean;
  /** Required when `isOnline`. Must all belong to the exam's course. */
  lessonIds?: string[];
  /** Required when `isOnline`, and never more than the selected lessons hold. */
  questionCount?: number;
  durationMinutes?: number;
  opensAt?: string | null;
  closesAt?: string | null;
  /** Empty string clears it; omit to keep (generated for a new online exam). */
  accessCode?: string | null;
  shuffleOptions?: boolean;
  showAnswers?: boolean;
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
  /** Who set it (class instructor, else the course's). */
  teacherName?: string | null;
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
  /**
   * Recorded as not there. Distinct from `notMarked`, where nobody recorded
   * anything at all — both read as a miss, but only this one was a decision.
   */
  isAbsent?: boolean;
  notMarked?: boolean;
  className?: string | null;
}
