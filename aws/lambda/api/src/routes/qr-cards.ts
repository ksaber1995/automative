import { query, queryOne } from '../db/connection';
import { extractTenantContext, checkGranularPermission } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

type AuthHeaders = { authorization: string };

/**
 * A POOL of pre-printed QR cards.
 *
 * The academy prints a batch of blank cards up front — each with its own QR and a
 * printed serial, owned by nobody. When a card is handed to a student it is
 * scanned once on their page, and only then does it point at them.
 *
 * Linking does NOT take away the student's own qr_token: both resolve to the same
 * student, so a card printed the old way keeps working. That is why every QR
 * lookup in the API has to consult this table too — see QR_STUDENT_MATCH below.
 *
 * Schema mirrors migration 062 and self-applies idempotently at runtime.
 */
let qrCardSchemaEnsured = false;
export async function ensureQrCardSchema(): Promise<void> {
  if (qrCardSchemaEnsured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS qr_cards (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      token       VARCHAR(32) NOT NULL,
      serial      INTEGER NOT NULL,
      student_id  UUID REFERENCES students(id) ON DELETE SET NULL,
      assigned_at TIMESTAMP WITH TIME ZONE,
      created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_qr_cards_token  ON qr_cards(token)`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_qr_cards_serial ON qr_cards(company_id, serial)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_qr_cards_company ON qr_cards(company_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_qr_cards_student ON qr_cards(student_id)`);
  // Off by default: an academy only gets the pool once we switch it on for them.
  await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS qr_cards_enabled BOOLEAN NOT NULL DEFAULT false`);

  // Cards generated before the reserved range existed carry serials 1..N, which
  // collide head-on with the students' own codes. Lift them out of the way. The
  // predicate is self-limiting, so this is a no-op on every later boot.
  const moved = await query<any>(
    `UPDATE qr_cards SET serial = serial + ${CARD_SERIAL_BASE}
     WHERE serial <= ${CARD_SERIAL_BASE} RETURNING id`,
  );
  if (moved.length) {
    // A card already in a student's hand now has a new number, and the number on
    // the card is the number staff type — so the student's code follows it.
    await query(
      `UPDATE students s SET student_code = c.serial, updated_at = NOW()
       FROM qr_cards c
       WHERE c.student_id = s.id
         AND s.student_code IS DISTINCT FROM c.serial
         AND NOT EXISTS (SELECT 1 FROM students o
                         WHERE o.company_id = s.company_id AND o.student_code = c.serial AND o.id <> s.id)`,
    );
  }
  qrCardSchemaEnsured = true;
}

/**
 * The pool is sold per academy, so it is off until we enable it for that company.
 * Enforced here, not just hidden in the UI — a disabled tenant that posts straight
 * at the API still gets nothing.
 */
async function qrCardsDenied(companyId: string): Promise<any | null> {
  const c = await queryOne<any>('SELECT qr_cards_enabled FROM companies WHERE id = $1', [companyId]);
  if (!c || c.qr_cards_enabled !== true) {
    return apiError(403, 'ERRORS.QR_CARDS.DISABLED', 'QR cards are not enabled for this academy');
  }
  return null;
}

/**
 * The predicate every QR lookup must use, in place of a bare `s.qr_token = $1`.
 *
 * A student is matched by a scanned token if it is EITHER their own qr_token OR a
 * pool card linked to them. Forget this in one place and that flow alone reports
 * "student not found" for a pool card — which is exactly the kind of bug that only
 * shows up on the one screen nobody tested.
 *
 * `tok` / `co` are the $n placeholders of the token and company_id in the calling
 * query, so it drops into an existing WHERE clause without renumbering.
 */
export function qrStudentMatch(tok: string, co: string, alias = 's'): string {
  return `(${alias}.qr_token = ${tok}
           OR ${alias}.id = (SELECT c.student_id FROM qr_cards c
                             WHERE c.token = ${tok} AND c.company_id = ${co}))`;
}

/** Same, with no tenant scope — the public profile page has no session. */
export function qrStudentMatchPublic(tok: string, alias = 's'): string {
  return `(${alias}.qr_token = ${tok}
           OR ${alias}.id = (SELECT c.student_id FROM qr_cards c WHERE c.token = ${tok}))`;
}

/** A batch this size is already ~10 minutes of printing; anything more is a typo. */
const MAX_BATCH = 2000;

/**
 * Card serials live in a RESERVED range, above every organic student code.
 *
 * Linking a card gives the student the card's number as their student_code, and a
 * new student's code is MAX(student_code) + 1 — so without a reserved range the
 * sequence would walk straight into the pool: link card 5, the next student gets
 * code 6, and card 6 is now unusable. Keeping serials above 100000 (and computing
 * the next student code only from codes BELOW it — see students.ts) keeps the two
 * numbering spaces from ever meeting.
 */
export const CARD_SERIAL_BASE = 100000;

/**
 * A code as typed, turned back into the integer stored in student_code.
 *
 * A card prints its number as "A5" — short, and unmistakably a card. The leading
 * "A" IS the reserved range: A5 means card 5, i.e. student_code 100005, and must
 * never resolve to the student whose own code happens to be 5. Cards printed
 * before the short form ("A-100001") already carry the full number, so anything
 * already inside the reserved range is taken as absolute, not shifted twice.
 */
export function codeDigits(code: string | number): number {
  const raw = String(code).trim();
  const n = parseInt(raw.replace(/\D/g, ''), 10);
  if (!Number.isFinite(n)) return NaN;
  return /^[Aa]/.test(raw) && n < CARD_SERIAL_BASE ? CARD_SERIAL_BASE + n : n;
}

function mapCard(row: any) {
  return {
    id: row.id,
    serial: row.serial,
    token: row.token,
    studentId: row.student_id ?? null,
    studentName: row.student_name ?? null,
    studentCode: row.student_code ?? null,
    assignedAt: row.assigned_at ?? null,
    createdAt: row.created_at,
  };
}

export const qrCardsRoutes = {
  /** Print run: mint `count` blank cards, numbered on from the last serial. */
  generate: async ({ body, headers }: { body: { count: number }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureQrCardSchema();
      const denied = await qrCardsDenied(context.companyId);
      if (denied) return denied;

      const count = Math.floor(Number(body?.count ?? 0));
      if (!Number.isFinite(count) || count < 1 || count > MAX_BATCH) {
        return apiError(400, 'ERRORS.QR_CARDS.BAD_COUNT', `Ask for between 1 and ${MAX_BATCH} cards`);
      }

      // Serials continue from the last batch (so a reprint never collides with a
      // card already in someone's pocket) but never below the reserved base, which
      // is what keeps them clear of the students' own codes.
      const last = await queryOne<any>(
        'SELECT COALESCE(MAX(serial), 0) AS last FROM qr_cards WHERE company_id = $1',
        [context.companyId],
      );
      const from = Math.max(parseInt(last?.last ?? '0', 10), CARD_SERIAL_BASE) + 1;

      // One statement: generate_series makes the serials, uuid makes the tokens.
      const rows = await query<any>(
        `INSERT INTO qr_cards (company_id, token, serial)
         SELECT $1, REPLACE(uuid_generate_v4()::text, '-', ''), g
         FROM generate_series($2::int, $3::int) AS g
         RETURNING *`,
        [context.companyId, from, from + count - 1],
      );

      return { status: 201 as const, body: rows.map(mapCard) };
    } catch (error) {
      console.error('QR cards generate error:', error);
      return mapThrownError(error, 'ERRORS.QR_CARDS.GENERATE_FAILED', 'Failed to generate the cards', 400);
    }
  },

  /** The pool. `status=free|linked` narrows it; the rest is for printing. */
  list: async ({ query: q, headers }: { query: { status?: string }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureQrCardSchema();
      const denied = await qrCardsDenied(context.companyId);
      if (denied) return denied;

      let sql = `
        SELECT c.*,
               TRIM(CONCAT(s.first_name, ' ', s.last_name)) AS student_name,
               s.student_code
        FROM qr_cards c
        LEFT JOIN students s ON s.id = c.student_id
        WHERE c.company_id = $1`;
      if (q?.status === 'free') sql += ' AND c.student_id IS NULL';
      if (q?.status === 'linked') sql += ' AND c.student_id IS NOT NULL';
      sql += ' ORDER BY c.serial';

      const rows = await query<any>(sql, [context.companyId]);
      return { status: 200 as const, body: rows.map(mapCard) };
    } catch (error) {
      console.error('QR cards list error:', error);
      return mapThrownError(error, 'ERRORS.QR_CARDS.LIST_FAILED', 'Failed to load the QR cards');
    }
  },

  /**
   * Hand a card to a student: scan it (token) or type its serial.
   *
   * The student keeps their own qr_token, so both cards work. Re-linking a card
   * that is already on someone else is refused rather than silently moved — two
   * students would otherwise share one printed card without anyone noticing.
   */
  link: async ({ body, headers }: { body: { studentId: string; token?: string; serial?: number }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureQrCardSchema();
      const denied = await qrCardsDenied(context.companyId);
      if (denied) return denied;

      const student = await queryOne<any>(
        'SELECT id, first_name, last_name FROM students WHERE id = $1 AND company_id = $2 AND is_active = true',
        [body?.studentId, context.companyId],
      );
      if (!student) return apiError(404, 'ERRORS.STUDENTS.NOT_FOUND', 'Student not found');

      // Scanned value wins; a typed serial is the fallback for a damaged QR.
      const token = (body?.token || '').trim();
      const serial = Number(body?.serial);
      const card = token
        ? await queryOne<any>(
            'SELECT * FROM qr_cards WHERE token = $1 AND company_id = $2',
            [token, context.companyId],
          )
        : Number.isInteger(serial)
          ? await queryOne<any>(
              'SELECT * FROM qr_cards WHERE serial = $1 AND company_id = $2',
              [serial, context.companyId],
            )
          : null;

      if (!card) return apiError(404, 'ERRORS.QR_CARDS.NOT_FOUND', 'That card is not in this pool');

      if (card.student_id && card.student_id !== student.id) {
        return apiError(409, 'ERRORS.QR_CARDS.ALREADY_LINKED', 'That card is already linked to another student');
      }
      if (card.student_id === student.id) {
        return {
          status: 200 as const,
          body: { ...mapCard(card), studentName: `${student.first_name} ${student.last_name}`, alreadyLinked: true },
        };
      }

      // The student TAKES the card's number as their student code — the number on
      // the card in their hand is the number staff type. Refuse if somebody else
      // already holds it rather than corrupting two students onto one code.
      const clash = await queryOne<any>(
        'SELECT id FROM students WHERE student_code = $1 AND company_id = $2 AND id <> $3',
        [card.serial, context.companyId, student.id],
      );
      if (clash) return apiError(409, 'ERRORS.QR_CARDS.CODE_TAKEN', 'Another student already has that code');

      const updated = await queryOne<any>(
        `UPDATE qr_cards SET student_id = $1, assigned_at = NOW()
         WHERE id = $2 AND company_id = $3 AND student_id IS NULL
         RETURNING *`,
        [student.id, card.id, context.companyId],
      );
      // Someone linked it a moment ago, between the read and the write.
      if (!updated) return apiError(409, 'ERRORS.QR_CARDS.ALREADY_LINKED', 'That card is already linked to another student');

      await query('UPDATE students SET student_code = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3',
        [card.serial, student.id, context.companyId]);

      return {
        status: 200 as const,
        body: { ...mapCard(updated), studentName: `${student.first_name} ${student.last_name}`, alreadyLinked: false },
      };
    } catch (error) {
      console.error('QR card link error:', error);
      return mapThrownError(error, 'ERRORS.QR_CARDS.LINK_FAILED', 'Failed to link the card');
    }
  },

  /** Card lost or handed to the wrong person: put it back in the pool. */
  unlink: async ({ params, headers }: { params: { id: string }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureQrCardSchema();
      const denied = await qrCardsDenied(context.companyId);
      if (denied) return denied;

      const row = await queryOne<any>(
        `UPDATE qr_cards SET student_id = NULL, assigned_at = NULL
         WHERE id = $1 AND company_id = $2
         RETURNING *`,
        [params.id, context.companyId],
      );
      if (!row) return apiError(404, 'ERRORS.QR_CARDS.NOT_FOUND', 'That card is not in this pool');
      return { status: 200 as const, body: mapCard(row) };
    } catch (error) {
      console.error('QR card unlink error:', error);
      return mapThrownError(error, 'ERRORS.QR_CARDS.UNLINK_FAILED', 'Failed to unlink the card');
    }
  },

  /** The cards already linked to one student (their page lists them). */
  byStudent: async ({ params, headers }: { params: { studentId: string }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureQrCardSchema();

      const rows = await query<any>(
        'SELECT * FROM qr_cards WHERE student_id = $1 AND company_id = $2 ORDER BY serial',
        [params.studentId, context.companyId],
      );
      return { status: 200 as const, body: rows.map(mapCard) };
    } catch (error) {
      console.error('QR cards by student error:', error);
      return mapThrownError(error, 'ERRORS.QR_CARDS.LIST_FAILED', 'Failed to load the cards');
    }
  },
};
