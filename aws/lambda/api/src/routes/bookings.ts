import { randomBytes } from 'crypto';
import { insert, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, checkGranularPermission, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';
import { enforceByIp, RATE_LIMITS } from '../middleware/rate-limit';
import { studentsRoutes } from './students';
import { enrollmentsRoutes } from './enrollments';

// ============================================================
// Online booking — a public per-tenant link where a student records their
// data, picks a course/class, attaches a photo of their payment, and submits.
// Staff see the requests in the app; accepting one creates the student AND
// the enrollment (with the confirmed money) in one step.
//
// The payment "photo" is a data-URL kept in the row itself: bookings are
// low-volume and short-lived, and the app has no file store — a column beats
// inventing one. It is excluded from the list query and fetched per row.
// ============================================================

/** Keep uploads sane: ~4MB of base64 ≈ a 3MB photo. */
const MAX_PHOTO_CHARS = 4 * 1024 * 1024;

let bookingSchemaEnsured = false;
export async function ensureBookingSchema(): Promise<void> {
  if (bookingSchemaEnsured) return;
  // The tenant's public link identity. Unguessable, like students.qr_token.
  await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS booking_token VARCHAR(32)`);
  await query(`CREATE TABLE IF NOT EXISTS booking_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
    student_name TEXT NOT NULL,
    phone VARCHAR(50) NOT NULL,
    parent_phone VARCHAR(50),
    notes TEXT,
    claimed_amount NUMERIC(10,2),
    payment_photo TEXT,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','REJECTED')),
    student_id UUID REFERENCES students(id) ON DELETE SET NULL,
    enrollment_id UUID,
    decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_booking_requests_company ON booking_requests(company_id, status, created_at DESC)`);
  bookingSchemaEnsured = true;
}

function mapBooking(row: any) {
  return {
    id: row.id,
    courseId: row.course_id,
    courseName: row.course_name ?? null,
    classId: row.class_id ?? null,
    className: row.class_name ?? null,
    studentName: row.student_name,
    phone: row.phone,
    parentPhone: row.parent_phone ?? null,
    notes: row.notes ?? null,
    claimedAmount: row.claimed_amount != null ? parseFloat(row.claimed_amount) : null,
    hasPaymentPhoto: row.has_photo === true || !!row.payment_photo,
    status: row.status,
    studentId: row.student_id ?? null,
    enrollmentId: row.enrollment_id ?? null,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? null,
  };
}

export const bookingsRoutes = {
  // ── Public: what the booking page needs to render ──
  publicInfo: async ({ params }: { params: { token: string } }) => {
    enforceByIp(RATE_LIMITS.PUBLIC_PROFILE_IP);
    try {
      await ensureBookingSchema();
      const company = await queryOne<any>(
        `SELECT id, name FROM companies WHERE booking_token = $1 AND COALESCE(is_active, true)`,
        [params.token]
      );
      if (!company) return apiError(404, 'ERRORS.BOOKINGS.LINK_NOT_FOUND', 'Booking link not found');

      const courses = await query<any>(
        `SELECT c.id, c.name, c.price, c.payment_type,
                COALESCE((
                  SELECT json_agg(json_build_object('id', cl.id, 'name', cl.name,
                                                    'daysOfWeek', cl.days_of_week,
                                                    'startTime', cl.start_time::text,
                                                    'endTime', cl.end_time::text)
                                  ORDER BY cl.name)
                  FROM classes cl
                  WHERE cl.course_id = c.id AND cl.deleted_at IS NULL
                    AND COALESCE(cl.is_active, true) AND NOT COALESCE(cl.is_finished, false)
                ), '[]'::json) AS classes
         FROM courses c
         WHERE c.company_id = $1 AND c.is_active = true
         ORDER BY c.name`,
        [company.id]
      );
      return {
        status: 200 as const,
        body: {
          companyName: company.name,
          courses: courses.map((c: any) => ({
            id: c.id,
            name: c.name,
            price: parseFloat(c.price),
            paymentType: c.payment_type || 'ONE_TIME',
            classes: typeof c.classes === 'string' ? JSON.parse(c.classes) : c.classes,
          })),
        },
      };
    } catch (error: any) {
      if (error?.statusCode === 429 || error?.status === 429) throw error;
      console.error('Booking publicInfo error:', error);
      return apiError(404, 'ERRORS.BOOKINGS.LINK_NOT_FOUND', 'Booking link not found');
    }
  },

  // ── Public: submit a booking request ──
  publicCreate: async ({ params, body }: { params: { token: string }; body: any }) => {
    enforceByIp(RATE_LIMITS.PUBLIC_PROFILE_IP);
    try {
      await ensureBookingSchema();
      const company = await queryOne<any>(
        `SELECT id FROM companies WHERE booking_token = $1 AND COALESCE(is_active, true)`,
        [params.token]
      );
      if (!company) return apiError(404, 'ERRORS.BOOKINGS.LINK_NOT_FOUND', 'Booking link not found');

      const name = String(body?.studentName || '').trim();
      const phone = String(body?.phone || '').trim();
      if (name.length < 2) return apiError(400, 'ERRORS.BOOKINGS.NAME_REQUIRED', 'Name is required');
      if (phone.length < 8) return apiError(400, 'ERRORS.BOOKINGS.PHONE_REQUIRED', 'Phone is required');

      const course = await queryOne<any>(
        'SELECT id, price FROM courses WHERE id = $1 AND company_id = $2 AND is_active = true',
        [body?.courseId, company.id]
      );
      if (!course) return apiError(400, 'ERRORS.BOOKINGS.COURSE_REQUIRED', 'Please choose the course you want to join');

      // The class is a MUST: an enrollment without one has no schedule, no
      // attendance sheet, and no room — the office would only have to chase it.
      // Worded for the person filling the form, not for a developer.
      if (!body?.classId) {
        return apiError(400, 'ERRORS.BOOKINGS.CLASS_REQUIRED', 'Please choose the class / group you want to join');
      }
      const cls = await queryOne<any>(
        'SELECT id FROM classes WHERE id = $1 AND course_id = $2 AND deleted_at IS NULL',
        [body.classId, course.id]
      );
      if (!cls) return apiError(400, 'ERRORS.BOOKINGS.CLASS_INVALID', 'That class does not belong to the course');
      const classId: string = cls.id;

      const photo = typeof body?.paymentPhoto === 'string' ? body.paymentPhoto : null;
      if (photo && (photo.length > MAX_PHOTO_CHARS || !photo.startsWith('data:image/'))) {
        return apiError(400, 'ERRORS.BOOKINGS.PHOTO_INVALID', 'The payment photo must be an image under 3MB');
      }

      // The claimed payment cannot exceed what one enrollment costs up-front:
      // one month for a subscription, the price for everything else.
      const claimed = body?.claimedAmount != null ? parseFloat(body.claimedAmount) : null;
      const priceCap = parseFloat(course.price || 0);
      if (claimed != null && priceCap > 0 && claimed > priceCap + 0.001) {
        return apiError(400, 'ERRORS.BOOKINGS.PAY_TOO_MUCH', `The paid amount cannot exceed ${priceCap}`);
      }
      const row = await insert('booking_requests', {
        company_id: company.id,
        course_id: course.id,
        class_id: classId,
        student_name: name,
        phone,
        parent_phone: String(body?.parentPhone || '').trim() || null,
        notes: String(body?.notes || '').trim() || null,
        claimed_amount: Number.isFinite(claimed as number) && (claimed as number) > 0 ? claimed : null,
        payment_photo: photo,
        status: 'PENDING',
      });
      return { status: 201 as const, body: { id: row.id, message: 'Booking received', code: 'BOOKINGS.RECEIVED' } };
    } catch (error: any) {
      if (error?.statusCode === 429 || error?.status === 429) throw error;
      console.error('Booking publicCreate error:', error);
      return mapThrownError(error, 'ERRORS.BOOKINGS.CREATE_FAILED', 'Failed to submit the booking', 400);
    }
  },

  // ── Tenant: the shareable link (created on first ask) ──
  getLink: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureBookingSchema();
      let row = await queryOne<any>('SELECT booking_token FROM companies WHERE id = $1', [context.companyId]);
      if (!row?.booking_token) {
        const token = randomBytes(16).toString('hex');
        await query('UPDATE companies SET booking_token = $2, updated_at = NOW() WHERE id = $1', [context.companyId, token]);
        row = { booking_token: token };
      }
      return { status: 200 as const, body: { token: row.booking_token, url: `https://app.netrofit.com/book/${row.booking_token}` } };
    } catch (error) {
      console.error('Booking getLink error:', error);
      return mapThrownError(error, 'ERRORS.BOOKINGS.LINK_FAILED', 'Failed to load the booking link');
    }
  },

  // ── Tenant: list requests (photo excluded — fetched per row) ──
  list: async ({ query: q, headers }: { query: { status?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureBookingSchema();
      const params: any[] = [context.companyId];
      let sql = `SELECT b.id, b.course_id, b.class_id, b.student_name, b.phone, b.parent_phone, b.notes,
                        b.claimed_amount, (b.payment_photo IS NOT NULL) AS has_photo, b.status,
                        b.student_id, b.enrollment_id, b.created_at, b.decided_at,
                        c.name AS course_name, cl.name AS class_name
                 FROM booking_requests b
                 JOIN courses c ON c.id = b.course_id
                 LEFT JOIN classes cl ON cl.id = b.class_id
                 WHERE b.company_id = $1`;
      if (q.status && ['PENDING', 'ACCEPTED', 'REJECTED'].includes(q.status)) {
        params.push(q.status);
        sql += ` AND b.status = $${params.length}`;
      }
      const branchClause = appendBranchSqlFilter(context, params, 'c.branch_id');
      if (branchClause) sql += ` AND ${branchClause}`;
      sql += ' ORDER BY (b.status = \'PENDING\') DESC, b.created_at DESC LIMIT 300';
      const rows = await query<any>(sql, params);
      return { status: 200 as const, body: rows.map(mapBooking) };
    } catch (error) {
      console.error('Booking list error:', error);
      return mapThrownError(error, 'ERRORS.BOOKINGS.LIST_FAILED', 'Failed to load bookings');
    }
  },

  getPhoto: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureBookingSchema();
      const row = await queryOne<any>(
        'SELECT payment_photo FROM booking_requests WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!row) return apiError(404, 'ERRORS.BOOKINGS.NOT_FOUND', 'Booking not found');
      return { status: 200 as const, body: { photo: row.payment_photo ?? null } };
    } catch (error) {
      console.error('Booking getPhoto error:', error);
      return mapThrownError(error, 'ERRORS.BOOKINGS.PHOTO_FAILED', 'Failed to load the photo');
    }
  },

  /**
   * Accept: create the student, enroll them, stamp the booking. Delegates to
   * the REAL student and enrollment creates (same permission checks, same
   * billing paths — monthly gets its bills, per-session its schema), so a
   * booked student is indistinguishable from one the office typed in.
   */
  accept: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureBookingSchema();
      const booking = await queryOne<any>(
        'SELECT * FROM booking_requests WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!booking) return apiError(404, 'ERRORS.BOOKINGS.NOT_FOUND', 'Booking not found');
      if (booking.status !== 'PENDING') {
        return apiError(400, 'ERRORS.BOOKINGS.ALREADY_DECIDED', 'This booking was already decided');
      }

      const course = await queryOne<any>(
        'SELECT id, branch_id, price, payment_type FROM courses WHERE id = $1 AND company_id = $2',
        [booking.course_id, context.companyId]
      );
      if (!course) return apiError(400, 'ERRORS.BOOKINGS.COURSE_GONE', 'The booked course no longer exists');
      if (!canAccessBranch(context, course.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      // The money the office actually confirms — defaults to what was claimed.
      const amountPaid = body?.amountPaid != null ? Math.max(0, parseFloat(body.amountPaid) || 0)
        : (booking.claimed_amount != null ? parseFloat(booking.claimed_amount) : 0);
      const today = new Date().toISOString().slice(0, 10);
      const price = parseFloat(course.price || 0);
      const paymentType = course.payment_type || 'ONE_TIME';

      const studentRes: any = await studentsRoutes.create({
        headers,
        body: {
          name: booking.student_name,
          phone: booking.phone,
          parentPhone: booking.parent_phone || undefined,
          branchId: course.branch_id,
          notes: booking.notes ? `Online booking: ${booking.notes}` : 'Online booking',
          acquisitionChannel: 'ONLINE_BOOKING',
        },
      });
      if (studentRes.status !== 201) return studentRes;
      const student = studentRes.body;

      const enrollBody: any = {
        studentId: student.id,
        courseId: course.id,
        classId: booking.class_id || undefined,
        branchId: course.branch_id,
        enrollmentDate: today,
        status: 'ACTIVE',
        originalPrice: price,
        finalPrice: price,
      };
      if (paymentType === 'MONTHLY_SUBSCRIPTION') {
        if (amountPaid >= price && price > 0) enrollBody.payFirstMonth = true;
        else if (amountPaid > 0) enrollBody.firstMonthDownPayment = amountPaid;
      } else {
        enrollBody.paymentMode = amountPaid >= price ? 'FULL' : 'INSTALLMENTS';
        enrollBody.downPayment = amountPaid >= price ? 0 : amountPaid;
      }
      const enrollRes: any = await enrollmentsRoutes.create({ headers, body: enrollBody });
      if (enrollRes.status !== 201) return enrollRes;

      await query(
        `UPDATE booking_requests SET status = 'ACCEPTED', student_id = $2, enrollment_id = $3,
                decided_by = $4, decided_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [booking.id, student.id, enrollRes.body.id, context.userId]
      );
      return { status: 200 as const, body: { message: 'Booking accepted', code: 'BOOKINGS.ACCEPTED', studentId: student.id, enrollmentId: enrollRes.body.id } };
    } catch (error) {
      console.error('Booking accept error:', error);
      return mapThrownError(error, 'ERRORS.BOOKINGS.ACCEPT_FAILED', 'Failed to accept the booking', 400);
    }
  },

  reject: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureBookingSchema();
      const booking = await queryOne<any>(
        'SELECT id, status FROM booking_requests WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!booking) return apiError(404, 'ERRORS.BOOKINGS.NOT_FOUND', 'Booking not found');
      if (booking.status !== 'PENDING') {
        return apiError(400, 'ERRORS.BOOKINGS.ALREADY_DECIDED', 'This booking was already decided');
      }
      await query(
        `UPDATE booking_requests SET status = 'REJECTED', decided_by = $2, decided_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [booking.id, context.userId]
      );
      return { status: 200 as const, body: { message: 'Booking rejected', code: 'BOOKINGS.REJECTED' } };
    } catch (error) {
      console.error('Booking reject error:', error);
      return mapThrownError(error, 'ERRORS.BOOKINGS.REJECT_FAILED', 'Failed to reject the booking', 400);
    }
  },
};
