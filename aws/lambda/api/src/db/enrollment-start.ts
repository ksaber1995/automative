/**
 * "Had this student joined the class by the time that lesson ran?"
 *
 * Absence here is derived, never stored: a lesson with no attendance row for a
 * student reads as a miss. That inference only holds from the day the student
 * joined. A class that started on the 1st and a student who enrolled on the
 * 16th produced a fortnight of invented absences — a streak long enough to top
 * the follow-up report, a month figure that could never reach 100%, and, with
 * Telegram on, a message home about lessons the student was not yet entitled to
 * attend.
 *
 * The join day is the earliest live enrolment onto that class: `enrollment_date`
 * on a direct one, `enrolled_at` on a bundle one. The same rows the rosters
 * read, so the two never disagree — a DROPPED or CANCELLED enrolment is not a
 * way into the class, and a student who left and came back is judged from the
 * enrolment that is still standing.
 *
 * Days, not timestamps: someone who joins on the 16th counts for the 16th's
 * lesson, which is usually the very lesson they joined to sit.
 *
 * What this must NOT do is rewrite history. It decides only what a MISSING
 * attendance row means — "absent" or "not a student here yet" — so every caller
 * keeps the rows it actually has. A trial or a visitor has no enrolment and so
 * no join day; the fallback below answers "yes, they had joined" rather than
 * hide a lesson someone demonstrably attended.
 */

/** The day this student joined the class — `-infinity` when nothing says. */
export function classJoinDate(student: string, classId: string): string {
  return `COALESCE((
    SELECT MIN(joined_on) FROM (
      SELECT en_join.enrollment_date AS joined_on
        FROM enrollments en_join
       WHERE en_join.student_id = ${student} AND en_join.class_id = ${classId}
         AND en_join.status NOT IN ('DROPPED', 'CANCELLED')
      UNION ALL
      SELECT mce_join.enrolled_at AS joined_on
        FROM master_class_enrollments mce_join
       WHERE mce_join.student_id = ${student} AND mce_join.class_id = ${classId}
         AND mce_join.status <> 'DROPPED'
    ) joins
  ), '-infinity'::date)`;
}

/**
 * True when the lesson starting at `sessionStart` ran on or after the day the
 * student joined `classId` — i.e. a lesson they were there to sit, so a missing
 * attendance row is a real absence.
 */
export function joinedBySession(student: string, classId: string, sessionStart: string): string {
  return `${classJoinDate(student, classId)} <= (${sessionStart})::date`;
}
