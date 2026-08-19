import { insert, update, findById, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, isGlobalAdmin, checkGranularPermission, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';
import { ensurePerSessionSchema } from './session-payments';
import { ensureLevelSchema } from './levels';
import { ensureSubjectSchema } from './subjects';

// Aggregates every level linked to a course (via the course_levels join) into a
// JSON array. Aliased `c` must be the courses row in the surrounding query.
const LEVELS_SUBQUERY = `COALESCE((
  SELECT json_agg(json_build_object('id', l2.id, 'name', l2.name) ORDER BY l2.name ASC)
  FROM course_levels cl2
  JOIN levels l2 ON cl2.level_id = l2.id
  WHERE cl2.course_id = c.id
), '[]'::json) AS levels_json`;

// Aggregates every subject linked to a course (via the course_subjects join) into
// a JSON array. Aliased `c` must be the courses row in the surrounding query.
const SUBJECTS_SUBQUERY = `COALESCE((
  SELECT json_agg(json_build_object('id', s2.id, 'name', s2.name) ORDER BY s2.name ASC)
  FROM course_subjects cs2
  JOIN subjects s2 ON cs2.subject_id = s2.id
  WHERE cs2.course_id = c.id
), '[]'::json) AS subjects_json`;

/** The billing models where a course price keeps being charged after enrolment. */
const RECURRING_PAYMENT_TYPES = ['MONTHLY_SUBSCRIPTION', 'PER_SESSION'];

/**
 * Which enrolments a course price change moves.
 *
 * Not "whoever currently sits on the list price": an enrolment's fee is frozen at
 * enrolment, so any course whose price changed before this cascade existed has
 * students stranded on the old figure. Matching against today's list price would
 * classify all of them as individually negotiated and move nobody — a no-op for
 * exactly the courses that need it.
 *
 * A deliberate discount is what the enrolment actually records, so that is what is
 * read. No discount means the student is on whatever the course charges and follows
 * it; a recorded discount is a figure agreed with them and is left alone.
 */
const UNDISCOUNTED = `COALESCE(e.discount_amount, 0) = 0 AND COALESCE(e.discount_percent, 0) = 0`;

/**
 * What a price change is about to do, so staff can be told before they commit.
 *
 * Keyed off the COURSE's payment type, never `enrollments.payment_type`. That
 * column is a denormalised copy added with a DEFAULT and never back-filled, so it
 * drifts — there are monthly courses whose enrolments all still read ONE_TIME.
 * `ensureBillsForMonth` bills on the course's type, so anything reasoning about
 * those bills has to agree with it or it silently matches nothing.
 */
async function priceChangeImpact(
  companyId: string,
  courseId: string,
  paymentType: string,
  oldPrice: number,
  newPrice: number,
) {
  const enrolled = await queryOne<any>(
    `SELECT COUNT(*) FILTER (WHERE ${UNDISCOUNTED})     AS moves,
            COUNT(*) FILTER (WHERE NOT (${UNDISCOUNTED})) AS keeps_own
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
      WHERE e.company_id = $1 AND e.course_id = $2 AND c.payment_type = $3
        AND e.status NOT IN ('DROPPED', 'CANCELLED')`,
    [companyId, courseId, paymentType],
  );

  // Already-raised rows that the optional half of the change would rewrite, and the
  // ones it would refuse to touch because they are settled.
  const raised = paymentType === 'MONTHLY_SUBSCRIPTION'
    ? await queryOne<any>(
        `SELECT COUNT(*) FILTER (WHERE b.payment_status NOT IN ('PAID', 'REFUNDED')) AS open_count,
                COALESCE(SUM($3::numeric - b.amount_due)
                         FILTER (WHERE b.payment_status NOT IN ('PAID', 'REFUNDED')), 0) AS open_delta,
                COUNT(*) FILTER (WHERE b.payment_status IN ('PAID', 'REFUNDED')) AS settled_count
           FROM monthly_subscription_payments b
           JOIN enrollments e ON e.id = b.enrollment_id
          WHERE b.company_id = $1 AND b.course_id = $2 AND ${UNDISCOUNTED}
            AND b.billing_year  = EXTRACT(YEAR  FROM CURRENT_DATE)::int
            AND b.billing_month = EXTRACT(MONTH FROM CURRENT_DATE)::int`,
        [companyId, courseId, newPrice],
      )
    : await queryOne<any>(
        `SELECT COUNT(*) FILTER (WHERE sp.payment_status = 'PENDING') AS open_count,
                COALESCE(SUM($3::numeric - sp.amount_due)
                         FILTER (WHERE sp.payment_status = 'PENDING'), 0) AS open_delta,
                COUNT(*) FILTER (WHERE sp.payment_status <> 'PENDING') AS settled_count
           FROM session_payments sp
           JOIN enrollments e ON e.id = sp.enrollment_id
          WHERE sp.company_id = $1 AND sp.course_id = $2 AND ${UNDISCOUNTED}`,
        [companyId, courseId, newPrice],
      );

  return {
    paymentType,
    currentPrice: oldPrice,
    newPrice,
    studentsOnListPrice: Number(enrolled?.moves ?? 0),
    studentsOnOwnPrice: Number(enrolled?.keeps_own ?? 0),
    openCount: Number(raised?.open_count ?? 0),
    openDelta: Math.round(parseFloat(raised?.open_delta ?? 0) * 100) / 100,
    settledCount: Number(raised?.settled_count ?? 0),
  };
}

/**
 * Carry a course's new price to the students already on it.
 *
 * Both recurring models bill at `COALESCE(enrollments.final_price, courses.price)`
 * with `final_price` stamped when the student enrols — so on its own a change to the
 * course price reaches nobody. Moving the enrolment fee is what makes it take effect
 * from here on: for a subscription the months not yet materialised (`ensureBillsForMonth`
 * refuses to raise a bill for a month that has not started, so every future month is
 * still unwritten), and for per-session the charges not yet raised against a session.
 *
 * Students without a recorded discount move; a discounted enrolment keeps its
 * agreed fee, and staff can still reprice that one from the enrolment. See
 * `UNDISCOUNTED` for why the discount is read rather than the current fee.
 *
 * What has already been raised is a separate decision, which is why
 * `applyToCurrentUnpaid` is passed in rather than assumed: the current month's bill
 * and the charges for sessions already held are figures the student has been told
 * they owe. Settled and refunded rows are never rewritten either way — that money
 * has moved — and neither are earlier months, which keep the price they were owed
 * at. A month carrying a course-wide override stays scaled to it, using the same
 * maths as `ensureBillsForMonth`.
 */
async function cascadeCoursePrice(
  companyId: string,
  courseId: string,
  paymentType: string,
  newPrice: number,
  applyToCurrentUnpaid: boolean,
): Promise<{ studentsRepriced: number; openRepriced: number }> {
  const moved = await query(
    `UPDATE enrollments e
        SET final_price = $3, original_price = $3, updated_at = NOW()
       FROM courses c
      WHERE c.id = e.course_id
        AND e.company_id = $1 AND e.course_id = $2 AND c.payment_type = $4
        AND e.status NOT IN ('DROPPED', 'CANCELLED')
        AND ${UNDISCOUNTED}
      RETURNING e.id`,
    [companyId, courseId, newPrice, paymentType],
  );
  const studentsRepriced = (moved as any[]).length;

  if (!applyToCurrentUnpaid) return { studentsRepriced, openRepriced: 0 };

  // Matched on the same undiscounted set the enrolments were moved by, not on the
  // fee — a student who was already sitting on the new figure still gets their
  // open row restated, and a discounted one is still passed over.
  const openRepriced = paymentType === 'MONTHLY_SUBSCRIPTION'
    ? (await query(
        `UPDATE monthly_subscription_payments msp
            SET amount_due = sub.new_due,
                payment_status = CASE
                  WHEN sub.new_due > 0 AND msp.amount_paid >= sub.new_due THEN 'PAID'
                  WHEN msp.amount_paid > 0 THEN 'PARTIAL'
                  ELSE 'PENDING'
                END,
                paid_date = CASE
                  WHEN sub.new_due > 0 AND msp.amount_paid >= sub.new_due THEN COALESCE(msp.paid_date, CURRENT_DATE)
                  ELSE msp.paid_date
                END,
                updated_at = NOW()
           FROM (
             SELECT b.id,
                    CASE
                      WHEN ov.override_price IS NOT NULL AND c.price > 0
                        THEN ROUND(ov.override_price * (e.final_price / c.price), 2)
                      ELSE e.final_price
                    END AS new_due
               FROM monthly_subscription_payments b
               JOIN enrollments e ON e.id = b.enrollment_id
               JOIN courses c ON c.id = e.course_id
               LEFT JOIN course_monthly_price_overrides ov
                 ON ov.course_id = e.course_id
                AND ov.billing_year = b.billing_year
                AND ov.billing_month = b.billing_month
              WHERE b.company_id = $1 AND b.course_id = $2 AND ${UNDISCOUNTED}
                AND b.payment_status NOT IN ('PAID', 'REFUNDED')
                AND b.billing_year  = EXTRACT(YEAR  FROM CURRENT_DATE)::int
                AND b.billing_month = EXTRACT(MONTH FROM CURRENT_DATE)::int
           ) sub
          WHERE msp.id = sub.id
          RETURNING msp.id`,
        [companyId, courseId],
      ) as any[]).length
    // A charge covered by a prepaid package, waived, or already settled keeps its
    // figure: only what the student still owes in cash is restated.
    : (await query(
        `UPDATE session_payments sp
            SET amount_due = $3::numeric,
                payment_status = CASE
                  WHEN $3::numeric > 0 AND sp.amount_paid >= $3::numeric THEN 'PAID'
                  ELSE sp.payment_status
                END,
                updated_at = NOW()
           FROM enrollments e
          WHERE e.id = sp.enrollment_id
            AND sp.company_id = $1 AND sp.course_id = $2
            AND ${UNDISCOUNTED} AND sp.payment_status = 'PENDING'
          RETURNING sp.id`,
        [companyId, courseId, newPrice],
      ) as any[]).length;

  return { studentsRepriced, openRepriced };
}

/** Sentinel: a default room id was given, but it isn't one of this company's rooms. */
const INVALID_ROOM = Symbol('invalid-room');

/**
 * Validate the course's default room against the caller's company. Null when no
 * room was chosen (or it was cleared), the id when it checks out, and the
 * sentinel when it belongs to someone else or doesn't exist.
 */
async function resolveDefaultRoomId(raw: any, companyId: string): Promise<string | null | typeof INVALID_ROOM> {
  if (raw === undefined || raw === null || raw === '') return null;
  const room = await queryOne<any>('SELECT id FROM rooms WHERE id = $1 AND company_id = $2', [raw, companyId]);
  return room ? String(raw) : INVALID_ROOM;
}

function mapCourseFromDB(row: any) {
  let levels: { id: string; name: string | null }[] = [];
  const raw = row.levels_json;
  if (raw != null) {
    levels = typeof raw === 'string' ? JSON.parse(raw) : raw;
  }
  // Fall back to the legacy single link when the join has no rows yet (e.g. a
  // course created from a master template before it was ever edited).
  if (levels.length === 0 && row.level_id) {
    levels = [{ id: row.level_id, name: row.level_name ?? null }];
  }

  let subjects: { id: string; name: string | null }[] = [];
  const rawSubjects = row.subjects_json;
  if (rawSubjects != null) {
    subjects = typeof rawSubjects === 'string' ? JSON.parse(rawSubjects) : rawSubjects;
  }

  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    name: row.name,
    description: row.description,
    price: parseFloat(row.price),
    branchName: row.branch_name ?? null,
    instructorId: row.instructor_id,
    // Only populated where the query joins employees (the list); undefined
    // elsewhere rather than a wrong null, so a caller can tell "no teacher" from
    // "didn't ask".
    instructorName: row.instructor_name ?? null,
    defaultRoomId: row.default_room_id ?? null,
    levelId: row.level_id ?? (levels[0]?.id ?? null),
    levelName: row.level_name ?? (levels[0]?.name ?? null),
    levelIds: levels.map((l) => l.id),
    levels,
    subjectIds: subjects.map((s) => s.id),
    subjects,
    isActive: row.is_active,
    paymentType: row.payment_type || 'ONE_TIME',
    sessionPackageSize: row.session_package_size ?? null,
    sessionPackagePrice: row.session_package_price != null ? parseFloat(row.session_package_price) : null,
    chargeAbsentSessions: row.charge_absent_sessions ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// The level ids a create/update body wants on a course. Accepts the new
// `levelIds` array and falls back to the legacy single `levelId`.
function resolveLevelIds(body: any): string[] {
  if (Array.isArray(body.levelIds)) {
    return [...new Set(body.levelIds.filter(Boolean) as string[])];
  }
  if (body.levelId) return [body.levelId];
  return [];
}

// Replace a course's level links with exactly `levelIds`.
async function setCourseLevels(courseId: string, levelIds: string[]) {
  await query('DELETE FROM course_levels WHERE course_id = $1', [courseId]);
  const unique = [...new Set(levelIds.filter(Boolean))];
  if (unique.length > 0) {
    await query(
      `INSERT INTO course_levels (course_id, level_id)
       SELECT $1, unnest($2::uuid[])
       ON CONFLICT (course_id, level_id) DO NOTHING`,
      [courseId, unique]
    );
  }
}

// The subject ids a create/update body wants on a course.
function resolveSubjectIds(body: any): string[] {
  if (Array.isArray(body.subjectIds)) {
    return [...new Set(body.subjectIds.filter(Boolean) as string[])];
  }
  return [];
}

// Replace a course's subject links with exactly `subjectIds`.
async function setCourseSubjects(courseId: string, subjectIds: string[]) {
  await query('DELETE FROM course_subjects WHERE course_id = $1', [courseId]);
  const unique = [...new Set(subjectIds.filter(Boolean))];
  if (unique.length > 0) {
    await query(
      `INSERT INTO course_subjects (course_id, subject_id)
       SELECT $1, unnest($2::uuid[])
       ON CONFLICT (course_id, subject_id) DO NOTHING`,
      [courseId, unique]
    );
  }
}

// Re-read a course with its aggregated levels + subjects for a complete response body.
async function fetchCourseWithLevels(id: string, companyId: string) {
  return queryOne(
    `SELECT c.*, l.name as level_name, ${LEVELS_SUBQUERY}, ${SUBJECTS_SUBQUERY}
     FROM courses c
     LEFT JOIN levels l ON c.level_id = l.id
     WHERE c.id = $1 AND c.company_id = $2`,
    [id, companyId]
  );
}

function mapCourseWithEnrollmentCountFromDB(row: any) {
  const direct = parseInt(row.direct_enrollment_count || '0', 10);
  const master = parseInt(row.master_enrollment_count || '0', 10);
  return {
    ...mapCourseFromDB(row),
    directEnrollmentCount: direct,
    masterEnrollmentCount: master,
    enrollmentCount: direct + master,
  };
}

export const coursesRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      // PER_SESSION courses need the widened payment_type CHECK + settings columns.
      if (body.paymentType === 'PER_SESSION') await ensurePerSessionSchema();
      await ensureLevelSchema();
      await ensureSubjectSchema();

      const levelIds = resolveLevelIds(body);
      const subjectIds = resolveSubjectIds(body);

      const defaultRoomId = await resolveDefaultRoomId(body.defaultRoomId, context.companyId);
      if (defaultRoomId === INVALID_ROOM) {
        return apiError(404, 'ERRORS.ROOMS.NOT_FOUND', 'Room not found');
      }

      const course = await insert('courses', {
        company_id: context.companyId,
        branch_id: body.branchId,
        name: body.name,
        description: body.description || null,
        price: body.price,
        instructor_id: body.instructorId || null,
        default_room_id: defaultRoomId,
        // Keep the legacy single column pointed at the first level for old readers.
        level_id: levelIds[0] ?? null,
        is_active: true,
        payment_type: body.paymentType || 'ONE_TIME',
        session_package_size: body.paymentType === 'PER_SESSION' ? (body.sessionPackageSize || null) : null,
        session_package_price: body.paymentType === 'PER_SESSION' ? (body.sessionPackagePrice ?? null) : null,
        charge_absent_sessions: body.paymentType === 'PER_SESSION' ? !!body.chargeAbsentSessions : false,
      });

      await setCourseLevels(course.id, levelIds);
      await setCourseSubjects(course.id, subjectIds);

      const full = await fetchCourseWithLevels(course.id, context.companyId);
      return {
        status: 201 as const,
        body: mapCourseFromDB(full ?? course),
      };
    } catch (error) {
      console.error('Create course error:', error);
      return mapThrownError(error, 'ERRORS.COURSES.CREATE_FAILED', 'Failed to create course', 400);
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      await ensureLevelSchema();
      await ensureSubjectSchema();

      let sql = `
        SELECT
          c.*,
          l.name as level_name,
          br.name AS branch_name,
          NULLIF(TRIM(CONCAT(emp.first_name, ' ', emp.last_name)), '') AS instructor_name,
          ${LEVELS_SUBQUERY},
          ${SUBJECTS_SUBQUERY},
          COUNT(DISTINCT e.id) FILTER (WHERE e.status != 'DROPPED') as direct_enrollment_count,
          COUNT(DISTINCT mce.id) FILTER (WHERE mce.status != 'DROPPED') as master_enrollment_count
        FROM courses c
        LEFT JOIN levels l ON c.level_id = l.id
        -- Branch name comes from the row itself rather than a client-side lookup.
        -- The lookup is filtered (is_active, and the caller's own branch scope),
        -- so any course on a branch outside it fell back to printing a raw UUID.
        LEFT JOIN branches br ON br.id = c.branch_id
        -- The assigned teacher's name, so the list can show who teaches a course
        -- without a lookup round-trip per row.
        LEFT JOIN employees emp ON emp.id = c.instructor_id
        LEFT JOIN enrollments e ON c.id = e.course_id AND e.status != 'DROPPED'
        LEFT JOIN master_class_enrollments mce ON c.id = mce.course_id AND mce.status != 'DROPPED'
        WHERE c.company_id = $1
      `;
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        sql += ` AND c.branch_id = $${params.length}`;
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 'c.branch_id');
        if (branchClause) sql += ` AND ${branchClause}`;
      }

      sql += ' GROUP BY c.id, l.name, br.name, emp.first_name, emp.last_name ORDER BY c.created_at DESC';

      const courses = await query(sql, params);
      return {
        status: 200 as const,
        body: courses.map(mapCourseWithEnrollmentCountFromDB),
      };
    } catch (error) {
      console.error('List courses error:', error);
      return mapThrownError(error, 'ERRORS.COURSES.LIST_FAILED', 'Failed to list courses');
    }
  },

  listActive: async ({ query: queryParams, headers }: { query: { branchId?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      await ensureLevelSchema();
      await ensureSubjectSchema();

      let sql = `SELECT c.*, l.name as level_name, ${LEVELS_SUBQUERY}, ${SUBJECTS_SUBQUERY}
        FROM courses c
        LEFT JOIN levels l ON c.level_id = l.id
        WHERE c.company_id = $1 AND c.is_active = true`;
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        sql += ` AND c.branch_id = $${params.length}`;
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 'c.branch_id');
        if (branchClause) sql += ` AND ${branchClause}`;
      }

      sql += ' ORDER BY c.created_at DESC';

      const courses = await query(sql, params);
      return {
        status: 200 as const,
        body: courses.map(mapCourseFromDB),
      };
    } catch (error) {
      console.error('List active courses error:', error);
      return mapThrownError(error, 'ERRORS.COURSES.LIST_FAILED', 'Failed to list active courses');
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      await ensureLevelSchema();
      await ensureSubjectSchema();

      const course = await queryOne(
        `SELECT c.*, l.name as level_name, ${LEVELS_SUBQUERY}, ${SUBJECTS_SUBQUERY}
         FROM courses c
         LEFT JOIN levels l ON c.level_id = l.id
         WHERE c.id = $1 AND c.company_id = $2`,
        [params.id, context.companyId]
      );

      if (!course) {
        return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
      }

      if (!canAccessBranch(context, course.branch_id)) {
        return apiError(403, 'ERRORS.COURSES.ACCESS_DENIED', 'Access denied to this course');
      }

      return {
        status: 200 as const,
        body: mapCourseFromDB(course),
      };
    } catch (error) {
      console.error('Get course error:', error);
      return mapThrownError(error, 'ERRORS.COURSES.NOT_FOUND', 'Course not found', 404);
    }
  },

  // Dry run of a price change, so the confirmation staff are shown carries real
  // numbers rather than a generic caution. Reads only.
  priceImpact: async ({ params, query: queryParams, headers }: { params: { id: string }; query: { price: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const course = await queryOne<any>(
        'SELECT id, branch_id, price, payment_type FROM courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!course) {
        return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
      }
      if (!canAccessBranch(context, course.branch_id)) {
        return apiError(403, 'ERRORS.COURSES.ACCESS_DENIED', 'Access denied to this course');
      }

      const newPrice = Number(queryParams.price);
      if (!Number.isFinite(newPrice) || newPrice < 0) {
        return apiError(400, 'ERRORS.COURSES.INVALID_PRICE', 'Invalid price');
      }

      // A one-time course bills once at enrolment, so a new list price only ever
      // applies to the next student to sign up — nothing to warn about.
      if (!RECURRING_PAYMENT_TYPES.includes(course.payment_type)) {
        return {
          status: 200 as const,
          body: {
            paymentType: course.payment_type,
            currentPrice: parseFloat(course.price),
            newPrice,
            studentsOnListPrice: 0,
            studentsOnOwnPrice: 0,
            openCount: 0,
            openDelta: 0,
            settledCount: 0,
          },
        };
      }

      return {
        status: 200 as const,
        body: await priceChangeImpact(
          context.companyId, params.id, course.payment_type, parseFloat(course.price), newPrice,
        ),
      };
    } catch (error) {
      console.error('Course price impact error:', error);
      return mapThrownError(error, 'ERRORS.COURSES.NOT_FOUND', 'Course not found', 404);
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      // The response re-reads the course with its aggregated levels + subjects, so
      // the join tables must exist regardless of whether this request changes them.
      await ensureLevelSchema();
      await ensureSubjectSchema();

      const existing = await queryOne(
        'SELECT * FROM courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
      }

      if (!canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.COURSES.ACCESS_DENIED_UPDATE', 'Access denied to update this course');
      }

      // Ensure the per-session columns exist before writing them.
      if (body.paymentType === 'PER_SESSION' || body.sessionPackageSize !== undefined
          || body.sessionPackagePrice !== undefined || body.chargeAbsentSessions !== undefined) {
        await ensurePerSessionSchema();
      }

      const updateData: any = {};

      if (body.branchId !== undefined) {
        if (!canAccessBranch(context, body.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS_TARGET', 'Access denied to target branch');
        }
        updateData.branch_id = body.branchId;
      }
      if (body.name !== undefined) updateData.name = body.name;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.price !== undefined) updateData.price = body.price;
      if (body.instructorId !== undefined) updateData.instructor_id = body.instructorId || null;
      if (body.defaultRoomId !== undefined) {
        const defaultRoomId = await resolveDefaultRoomId(body.defaultRoomId, context.companyId);
        if (defaultRoomId === INVALID_ROOM) {
          return apiError(404, 'ERRORS.ROOMS.NOT_FOUND', 'Room not found');
        }
        updateData.default_room_id = defaultRoomId;
      }
      if (body.paymentType !== undefined) updateData.payment_type = body.paymentType;
      if (body.sessionPackageSize !== undefined) updateData.session_package_size = body.sessionPackageSize || null;
      if (body.sessionPackagePrice !== undefined) updateData.session_package_price = body.sessionPackagePrice ?? null;
      if (body.chargeAbsentSessions !== undefined) updateData.charge_absent_sessions = !!body.chargeAbsentSessions;

      // Level links: accept the new `levelIds` array or the legacy single `levelId`.
      // Keep courses.level_id pointed at the first level for backward compatibility.
      const levelsProvided = body.levelIds !== undefined || body.levelId !== undefined;
      let newLevelIds: string[] = [];
      if (levelsProvided) {
        newLevelIds = resolveLevelIds(body);
        updateData.level_id = newLevelIds[0] ?? null;
      }

      // Subject links: only rewritten when `subjectIds` is present in the body.
      const subjectsProvided = body.subjectIds !== undefined;

      const course = Object.keys(updateData).length > 0
        ? await update('courses', params.id, updateData)
        : existing;

      if (!course) {
        return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
      }

      // Run after the course row is written, so the override maths below reads the
      // new list price — the same price `ensureBillsForMonth` will read next month.
      const paymentType = body.paymentType ?? existing.payment_type;
      if (updateData.price !== undefined && RECURRING_PAYMENT_TYPES.includes(paymentType)) {
        const oldPrice = parseFloat(existing.price);
        const newPrice = Number(updateData.price);
        if (Number.isFinite(newPrice) && Number.isFinite(oldPrice) && newPrice !== oldPrice) {
          await cascadeCoursePrice(
            context.companyId, params.id, paymentType, newPrice,
            body.applyToCurrentUnpaid === true,
          );
        }
      }

      if (levelsProvided) {
        await setCourseLevels(params.id, newLevelIds);
      }

      if (subjectsProvided) {
        await setCourseSubjects(params.id, resolveSubjectIds(body));
      }

      const full = await fetchCourseWithLevels(params.id, context.companyId);
      return {
        status: 200 as const,
        body: mapCourseFromDB(full ?? course),
      };
    } catch (error) {
      console.error('Update course error:', error);
      return mapThrownError(error, 'ERRORS.COURSES.UPDATE_FAILED', 'Failed to update course', 404);
    }
  },

  getEnrollments: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const course = await queryOne(
        'SELECT * FROM courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!course) {
        return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
      }

      if (!canAccessBranch(context, course.branch_id)) {
        return apiError(403, 'ERRORS.COURSES.ACCESS_DENIED', 'Access denied to this course');
      }

      const enrollments = await query(
        `SELECT
          e.id as enrollment_id,
          e.student_id,
          s.name AS student_name,
          e.class_id,
          cl.name as class_name,
          e.enrollment_date,
          e.status,
          e.original_price,
          e.discount_percent,
          e.discount_amount,
          e.final_price,
          e.payment_mode,
          e.down_payment,
          e.amount_paid,
          e.total_refunded,
          e.payment_status,
          e.notes,
          e.created_at
        FROM enrollments e
        JOIN students s ON e.student_id = s.id
        LEFT JOIN classes cl ON e.class_id = cl.id
        WHERE e.course_id = $1 AND e.company_id = $2 AND e.status != 'DROPPED'
        ORDER BY e.enrollment_date DESC`,
        [params.id, context.companyId]
      );

      return {
        status: 200 as const,
        body: enrollments.map((row: any) => ({
          enrollmentId: row.enrollment_id,
          studentId: row.student_id,
          studentName: row.student_name,
          classId: row.class_id,
          className: row.class_name,
          enrollmentDate: row.enrollment_date,
          status: row.status,
          originalPrice: parseFloat(row.original_price),
          discountPercent: parseFloat(row.discount_percent || 0),
          discountAmount: parseFloat(row.discount_amount || 0),
          finalPrice: parseFloat(row.final_price),
          paymentMode: row.payment_mode || 'FULL',
          downPayment: parseFloat(row.down_payment || 0),
          amountPaid: parseFloat(row.amount_paid || 0),
          totalRefunded: parseFloat(row.total_refunded || 0),
          paymentStatus: row.payment_status,
          notes: row.notes,
          createdAt: row.created_at,
        })),
      };
    } catch (error) {
      console.error('Get course enrollments error:', error);
      return mapThrownError(error, 'ERRORS.COURSES.ENROLLMENTS_FAILED', 'Failed to get course enrollments');
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
      }

      if (!canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.COURSES.ACCESS_DENIED_DELETE', 'Access denied to delete this course');
      }

      // Reject hard-delete if anyone has ever enrolled (direct or via a master bundle).
      // Even DROPPED enrollments are kept for audit, so we count all rows.
      const enrollCounts = await queryOne(
        `SELECT
            (SELECT COUNT(*) FROM enrollments WHERE course_id = $1) AS direct,
            (SELECT COUNT(*) FROM master_class_enrollments WHERE course_id = $1) AS bundle`,
        [params.id]
      );
      const direct = parseInt(enrollCounts?.direct || '0', 10);
      const bundle = parseInt(enrollCounts?.bundle || '0', 10);
      if (direct + bundle > 0) {
        return apiError(
          409,
          'ERRORS.COURSES.HAS_ENROLLMENTS',
          'Course has enrollments and cannot be deleted; deactivate it instead'
        );
      }

      await query('DELETE FROM classes WHERE course_id = $1', [params.id]);
      await query(
        'DELETE FROM courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      return {
        status: 200 as const,
        body: { message: 'Course deleted successfully', code: 'COURSES.DELETED' },
      };
    } catch (error) {
      console.error('Delete course error:', error);
      return mapThrownError(error, 'ERRORS.COURSES.DELETE_FAILED', 'Failed to delete course', 404);
    }
  },

  deactivate: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
      if (!canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.COURSES.ACCESS_DENIED_UPDATE', 'Access denied to update this course');
      }
      if (!existing.is_active) {
        return { status: 200 as const, body: mapCourseFromDB(existing) };
      }

      // A class blocks deactivation if it is still active AND not finished.
      // The caller must either finish the class (status DONE) or deactivate it first.
      const blockingClasses = await query(
        `SELECT id, name, start_date
         FROM classes
         WHERE course_id = $1 AND is_active = true AND is_finished = false`,
        [params.id]
      );

      if (blockingClasses.length > 0) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const inProgress = blockingClasses.filter((c: any) => {
          const start = c.start_date ? new Date(c.start_date) : null;
          return !start || start.getTime() <= today.getTime();
        });
        const codeKey = inProgress.length > 0
          ? 'ERRORS.COURSES.HAS_IN_PROGRESS_CLASSES'
          : 'ERRORS.COURSES.HAS_ACTIVE_CLASSES';
        return {
          status: 409 as const,
          body: {
            message: 'Course has classes that must be finished or deactivated first',
            code: codeKey,
            classes: blockingClasses.map((c: any) => ({ id: c.id, name: c.name })),
          } as any,
        };
      }

      const course = await update('courses', params.id, { is_active: false });
      if (!course) return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
      return { status: 200 as const, body: mapCourseFromDB(course) };
    } catch (error) {
      console.error('Deactivate course error:', error);
      return mapThrownError(error, 'ERRORS.COURSES.UPDATE_FAILED', 'Failed to deactivate course', 400);
    }
  },

  activate: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
      if (!canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.COURSES.ACCESS_DENIED_UPDATE', 'Access denied to update this course');
      }

      const course = await update('courses', params.id, { is_active: true });
      if (!course) return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
      return { status: 200 as const, body: mapCourseFromDB(course) };
    } catch (error) {
      console.error('Activate course error:', error);
      return mapThrownError(error, 'ERRORS.COURSES.UPDATE_FAILED', 'Failed to activate course', 400);
    }
  },
};
