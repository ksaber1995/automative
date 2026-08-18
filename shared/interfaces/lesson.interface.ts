/**
 * A lesson: one entry in a course's curriculum, in order.
 *
 * Part of the online-exams feature (online_exams.md) — a lesson is what a
 * question bank hangs off, and what an online exam draws its questions from. Per
 * COURSE, not per class: every class of a course teaches the same lessons.
 */
export interface LessonModel {
  id: string;
  companyId: string;
  /** Denormalised from the course, so a lesson can never drift to another branch. */
  branchId: string | null;
  courseId: string;
  courseName?: string;
  name: string;
  description: string | null;
  /** Position in the course (1, 2, 3 …). */
  orderIndex: number;
  /** Active questions in this lesson's bank. 0 until the bank ships (phase 2). */
  questionCount?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LessonCreateDto {
  courseId: string;
  name: string;
  description?: string | null;
  /** Omit to append to the end of the course's list. */
  orderIndex?: number;
}

export interface LessonUpdateDto {
  courseId?: string;
  name?: string;
  description?: string | null;
  orderIndex?: number;
  isActive?: boolean;
}

/** Rewrites `orderIndex` for a course's lessons from the order of the ids. */
export interface LessonReorderDto {
  courseId: string;
  lessonIds: string[];
}

/**
 * One option of an MCQ. `isCorrect` is present because these types describe the
 * TEACHER's view of the bank; the student's paper uses its own types (phase 5) and
 * never carries the answer before a submit.
 */
export interface LessonQuestionOption {
  id: string;
  optionText: string;
  isCorrect: boolean;
  orderIndex: number;
}

export interface LessonQuestionModel {
  id: string;
  companyId: string;
  lessonId: string;
  courseId: string;
  questionText: string;
  /** 'MCQ' is the only type for now. */
  questionType: string;
  /** Optional note shown in the answer review after a student submits. */
  explanation: string | null;
  isActive: boolean;
  options: LessonQuestionOption[];
  createdAt: string;
  updatedAt: string;
}

/** A question is always written whole: the stem plus its full option list. */
export interface LessonQuestionCreateDto {
  questionText: string;
  explanation?: string | null;
  /** 2–6 options, of which exactly one has `isCorrect`. */
  options: { optionText: string; isCorrect: boolean }[];
}

export interface LessonQuestionUpdateDto {
  questionText?: string;
  explanation?: string | null;
  /** Omit to leave the existing answers untouched. */
  options?: { optionText: string; isCorrect: boolean }[];
  isActive?: boolean;
}
