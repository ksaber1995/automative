/**
 * "Has this student left the academy?" — asked by every forward-looking list.
 *
 * Leaving is `students.is_active = false` (a trigger stamps `inactive_date`).
 * Enrolment status is a different fact and does not follow: a student who walks
 * out mid-term still has an ACTIVE enrolment on a MONTHLY_SUBSCRIPTION course
 * unless someone also cancels it, and nobody does — marking them left IS the act
 * staff perform. So every roster and dues query that reads `enrollments` alone
 * keeps producing them: they appear on the attendance sheet and are counted
 * absent for lessons they were never going to sit, and a new month's bill is
 * materialised against a person who has gone.
 *
 * What this must NOT do is rewrite history. Attendance already recorded, money
 * already collected and bills already raised stay exactly as they are — the
 * filter belongs on "who is expected from here on", never on "what happened".
 * That is why it is applied to roster/candidate queries and not to the tables
 * that store the record.
 *
 * COALESCE, because `is_active` is nullable on old rows and a NULL there has
 * always meant "still with us".
 */

/** The student row, aliased `alias`, belongs to someone still with the academy. */
export function studentIsPresent(alias: string): string {
  return `COALESCE(${alias}.is_active, true)`;
}

/**
 * The same test where only a student id is in scope — inside an `enrolled` CTE
 * built from `enrollments`, which never joins `students`.
 */
export function studentIsPresentById(studentIdExpr: string): string {
  return `EXISTS (
    SELECT 1 FROM students st_active
    WHERE st_active.id = ${studentIdExpr} AND COALESCE(st_active.is_active, true)
  )`;
}
