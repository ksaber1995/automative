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

  // Pool type (migration 066) — stamped on a print run when the vendor mints it.
  // Nothing branches on it: it exists so runs can be told apart later, and the
  // meaning of 1/2/3 is deliberately not encoded here.
  //
  // NOT NULL DEFAULT 1, so cards minted before types existed read as type 1
  // rather than NULL. That is a choice: it means whatever consumes this can
  // always group by a value instead of carrying a "no type" branch forever, and
  // "1" is the honest name for the only run there has ever been.
  // Print tracking (migration 076). NULL = not sent to the printer yet, so the
  // next download can carry only the new run. A timestamp rather than a boolean
  // so a run stays identifiable after the fact.
  await query(`ALTER TABLE qr_cards ADD COLUMN IF NOT EXISTS printed_at TIMESTAMP WITH TIME ZONE`);
  await query(`CREATE INDEX IF NOT EXISTS idx_qr_cards_unprinted
                 ON qr_cards (company_id, serial) WHERE printed_at IS NULL`);

  await query(`ALTER TABLE qr_cards ADD COLUMN IF NOT EXISTS pool_type SMALLINT NOT NULL DEFAULT 1`);
  await query(`DO $$ BEGIN
    ALTER TABLE qr_cards ADD CONSTRAINT qr_cards_pool_type_check CHECK (pool_type IN (1, 2, 3));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$`);
  // Off by default: an academy only gets the pool once we switch it on for them.
  await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS qr_cards_enabled BOOLEAN NOT NULL DEFAULT false`);

  // The student code this card overwrote when it was linked, so unlinking can put
  // it back. Cards linked before this column existed have NULL — unlink() then
  // issues a fresh organic code instead, which is the best it can do: the old
  // number was never recorded anywhere.
  await query(`ALTER TABLE qr_cards ADD COLUMN IF NOT EXISTS prev_student_code INTEGER`);

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
 * NEW-style pool cards live in a SECOND reserved range and print their number with
 * a leading zero ("05") instead of the "A" prefix. Cards minted from now on land
 * here; the "A" cards already printed (100000+) are left exactly as they were, so
 * nothing in anyone's pocket changes meaning. Kept clear of both the organic codes
 * (< 100000) and the old card range. Mirrors CARD_SERIAL_BASE_V2 in the frontend.
 */
export const CARD_SERIAL_BASE_V2 = 900000;

/**
 * A code as typed, turned back into the integer stored in student_code.
 *
 * A card prints its number short and unmistakable: "A5" for an old card, "05" for
 * a new one. The prefix IS the reserved range — "A5" means card 5 = 100005, "05"
 * means card 5 = 900005 — and must never resolve to the student whose own code is
 * 5. A value already at/above a base is taken as absolute, not shifted twice.
 */
export function codeDigits(code: string | number): number {
  const raw = String(code).trim();
  const n = parseInt(raw.replace(/\D/g, ''), 10);
  if (!Number.isFinite(n)) return NaN;
  if (/^[Aa]/.test(raw) && n < CARD_SERIAL_BASE) return CARD_SERIAL_BASE + n;
  if (/^0\d/.test(raw) && n < CARD_SERIAL_BASE) return CARD_SERIAL_BASE_V2 + n;
  return n;
}

/**
 * The serial the next minted card should get. New cards are minted in the V2 range
 * (they print "0N"); the card NUMBER continues on from the highest existing card,
 * old or new, so a company that had "A50" gets "051" next — the count never resets.
 */
export async function nextCardSerial(companyId: string): Promise<number> {
  const row = await queryOne<any>(
    `SELECT COALESCE(MAX(CASE WHEN serial >= ${CARD_SERIAL_BASE_V2} THEN serial - ${CARD_SERIAL_BASE_V2}
                              WHEN serial >  ${CARD_SERIAL_BASE}    THEN serial - ${CARD_SERIAL_BASE}
                              ELSE 0 END), 0) AS lastn
     FROM qr_cards WHERE company_id = $1`,
    [companyId],
  );
  return CARD_SERIAL_BASE_V2 + parseInt(row?.lastn ?? '0', 10) + 1;
}

function mapCard(row: any) {
  return {
    id: row.id,
    serial: row.serial,
    token: row.token,
    poolType: row.pool_type ?? 1,
    studentId: row.student_id ?? null,
    studentName: row.student_name ?? null,
    studentCode: row.student_code ?? null,
    assignedAt: row.assigned_at ?? null,
    printedAt: row.printed_at ?? null,
    printed: row.printed_at != null,
    createdAt: row.created_at,
  };
}

/**
 * Give a student a real number back after their card was unlinked.
 *
 * Only acts when the student is still wearing THIS card's serial — if they have
 * since been given another card, or an admin typed them a code by hand, that is
 * the current truth and must not be overwritten.
 *
 * Prefers the code the card overwrote at link time. Falls back to the next free
 * organic code (the same MAX(student_code) < CARD_SERIAL_BASE + 1 rule a new
 * student gets) when nothing was stored — every card linked before
 * prev_student_code existed — or when the old number has since been taken.
 */
async function restoreStudentCode(
  studentId: string,
  companyId: string,
  cardSerial: number,
  prevCode: number | null,
): Promise<void> {
  const student = await queryOne<any>(
    'SELECT student_code FROM students WHERE id = $1 AND company_id = $2',
    [studentId, companyId],
  );
  if (!student || Number(student.student_code) !== cardSerial) return;

  let code: number | null = null;
  const wanted = Number(prevCode);
  if (Number.isInteger(wanted) && wanted > 0 && wanted < CARD_SERIAL_BASE) {
    const taken = await queryOne<any>(
      'SELECT id FROM students WHERE student_code = $1 AND company_id = $2 AND id <> $3',
      [wanted, companyId, studentId],
    );
    if (!taken) code = wanted;
  }

  if (code === null) {
    const next = await queryOne<any>(
      `SELECT COALESCE(MAX(student_code), 0) + 1 AS next FROM students
       WHERE company_id = $1 AND student_code < ${CARD_SERIAL_BASE}`,
      [companyId],
    );
    code = Number(next?.next ?? 1);
  }

  await query(
    'UPDATE students SET student_code = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3',
    [code, studentId, companyId],
  );
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

      // New cards are minted in the V2 range (they print "0N"); the number continues
      // from the last card so a reprint never collides with one already in a pocket.
      const from = await nextCardSerial(context.companyId);

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
               s.name AS student_name,
               s.student_code
        FROM qr_cards c
        LEFT JOIN students s ON s.id = c.student_id
        WHERE c.company_id = $1`;
      if (q?.status === 'free') sql += ' AND c.student_id IS NULL';
      if (q?.status === 'linked') sql += ' AND c.student_id IS NOT NULL';
      // The next print run: never yet sent to the printer, and not already in
      // somebody's hand.
      if (q?.status === 'unprinted') sql += ' AND c.printed_at IS NULL AND c.student_id IS NULL';
      if (q?.status === 'printed') sql += ' AND c.printed_at IS NOT NULL';
      sql += ' ORDER BY c.serial';

      const rows = await query<any>(sql, [context.companyId]);
      return { status: 200 as const, body: rows.map(mapCard) };
    } catch (error) {
      console.error('QR cards list error:', error);
      return mapThrownError(error, 'ERRORS.QR_CARDS.LIST_FAILED', 'Failed to load the QR cards');
    }
  },

  /**
   * Stamp a print run as sent to the printer, so the next download carries only
   * new cards.
   *
   * `ids` should be exactly what was downloaded. Omitting it falls back to "every
   * card currently unprinted", which is only safe when nothing was generated
   * between the download and this call — the UI always sends ids for that reason.
   *
   * Already-printed cards are left untouched rather than re-stamped, so a second
   * click can't rewrite the date of an earlier run.
   */
  markPrinted: async ({ body, headers }: { body: { ids?: string[] }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureQrCardSchema();
      const denied = await qrCardsDenied(context.companyId);
      if (denied) return denied;

      const ids = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : null;

      const rows = ids
        ? await query<any>(
            `UPDATE qr_cards SET printed_at = NOW()
              WHERE company_id = $1 AND printed_at IS NULL AND id = ANY($2::uuid[])
              RETURNING *`,
            [context.companyId, ids],
          )
        : await query<any>(
            `UPDATE qr_cards SET printed_at = NOW()
              WHERE company_id = $1 AND printed_at IS NULL AND student_id IS NULL
              RETURNING *`,
            [context.companyId],
          );

      return { status: 200 as const, body: { marked: rows.length } };
    } catch (error) {
      console.error('QR cards mark-printed error:', error);
      return mapThrownError(error, 'ERRORS.QR_CARDS.MARK_PRINTED_FAILED', 'Failed to mark the cards as printed', 400);
    }
  },

  /**
   * Undo a mark — a run that never actually reached the printer goes back into
   * the next download rather than being stranded as "printed" forever.
   */
  unmarkPrinted: async ({ body, headers }: { body: { ids?: string[] }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureQrCardSchema();
      const denied = await qrCardsDenied(context.companyId);
      if (denied) return denied;

      const ids = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : [];
      if (!ids.length) return apiError(400, 'ERRORS.QR_CARDS.NO_IDS', 'No cards given');

      // Linked cards stay printed: the card is physically out there.
      const rows = await query<any>(
        `UPDATE qr_cards SET printed_at = NULL
          WHERE company_id = $1 AND student_id IS NULL AND id = ANY($2::uuid[])
          RETURNING *`,
        [context.companyId, ids],
      );
      return { status: 200 as const, body: { marked: rows.length } };
    } catch (error) {
      console.error('QR cards unmark-printed error:', error);
      return mapThrownError(error, 'ERRORS.QR_CARDS.MARK_PRINTED_FAILED', 'Failed to update the cards', 400);
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
      // Deliberately NOT gated on qr_cards_enabled. That flag is about CREATING a
      // pool, and a tenant who cannot create one may still have been given cards
      // by an admin — those cards are useless if they cannot be linked. The lookup
      // below is already scoped to the caller's company, so a tenant can only ever
      // link a card that belongs to them.

      const student = await queryOne<any>(
        'SELECT id, name, student_code FROM students WHERE id = $1 AND company_id = $2 AND is_active = true',
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
          body: { ...mapCard(card), studentName: student.name, alreadyLinked: true },
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

      // Remember the number we're about to take away, so unlink() can give it
      // back. Only an ORGANIC code is worth keeping: if their current code is
      // itself a card's serial (they already hold another card), restoring it
      // later would hand them a number that belongs to a card in the pool.
      const previousCode = Number(student.student_code);
      const restorable = Number.isInteger(previousCode) && previousCode > 0 && previousCode < CARD_SERIAL_BASE
        ? previousCode
        : null;

      const updated = await queryOne<any>(
        `UPDATE qr_cards SET student_id = $1, assigned_at = NOW(), prev_student_code = $4
         WHERE id = $2 AND company_id = $3 AND student_id IS NULL
         RETURNING *`,
        [student.id, card.id, context.companyId, restorable],
      );
      // Someone linked it a moment ago, between the read and the write.
      if (!updated) return apiError(409, 'ERRORS.QR_CARDS.ALREADY_LINKED', 'That card is already linked to another student');

      await query('UPDATE students SET student_code = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3',
        [card.serial, student.id, context.companyId]);

      return {
        status: 200 as const,
        body: { ...mapCard(updated), studentName: student.name, alreadyLinked: false },
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
      // Ungated for the same reason as link(): whoever can link a card must be
      // able to undo it, or a card handed to the wrong student is stuck there.

      // Read first: the UPDATE below returns the row AFTER the write, by which
      // point the student it was on is gone from it.
      const before = await queryOne<any>(
        'SELECT id, serial, student_id, prev_student_code FROM qr_cards WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId],
      );
      if (!before) return apiError(404, 'ERRORS.QR_CARDS.NOT_FOUND', 'That card is not in this pool');

      const row = await queryOne<any>(
        `UPDATE qr_cards SET student_id = NULL, assigned_at = NULL, prev_student_code = NULL
         WHERE id = $1 AND company_id = $2
         RETURNING *`,
        [params.id, context.companyId],
      );
      if (!row) return apiError(404, 'ERRORS.QR_CARDS.NOT_FOUND', 'That card is not in this pool');

      // Linking took the student's number away; unlinking has to give one back, or
      // they are left wearing a code from the card pool forever.
      if (before.student_id) {
        await restoreStudentCode(before.student_id, context.companyId, Number(before.serial), before.prev_student_code);
      }

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
