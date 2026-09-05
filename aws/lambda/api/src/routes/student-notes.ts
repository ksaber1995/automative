import { query, queryOne } from '../db/connection';
import { extractTenantContext, checkGranularPermission } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';
import { sendPushToStudent } from '../utils/push';

/**
 * Follow-up notes — what a teacher writes about a student: a comment after a
 * lesson, praise, a concern to raise with the family. They live on the
 * student's "Follow-up" tab on the web and, when marked visible, on the
 * parent's card page and in the mobile app.
 *
 * Schema is ensured at runtime like student_auth: the table appears on first
 * use with no migration step to forget on deploy.
 */

export type StudentNoteKind = 'NOTE' | 'PRAISE' | 'CONCERN';
export const STUDENT_NOTE_KINDS: StudentNoteKind[] = ['NOTE', 'PRAISE', 'CONCERN'];

let schemaEnsured = false;
export async function ensureStudentNotesSchema(): Promise<void> {
  if (schemaEnsured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS student_notes (
      id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      student_id        UUID NOT NULL REFERENCES students(id)  ON DELETE CASCADE,
      author_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
      author_name       VARCHAR(160) NOT NULL DEFAULT '',
      kind              VARCHAR(20)  NOT NULL DEFAULT 'NOTE',
      body              TEXT NOT NULL,
      visible_to_parent BOOLEAN NOT NULL DEFAULT TRUE,
      created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_student_notes_student ON student_notes(student_id, created_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_student_notes_company ON student_notes(company_id)`);
  schemaEnsured = true;
}

export interface StudentNoteRow {
  id: string;
  studentId: string;
  authorUserId: string | null;
  authorName: string;
  kind: StudentNoteKind;
  body: string;
  visibleToParent: boolean;
  createdAt: string;
  updatedAt: string;
}

function mapNote(row: any): StudentNoteRow {
  return {
    id: row.id,
    studentId: row.student_id,
    authorUserId: row.author_user_id ?? null,
    authorName: row.author_name ?? '',
    kind: (STUDENT_NOTE_KINDS.includes(row.kind) ? row.kind : 'NOTE') as StudentNoteKind,
    body: row.body ?? '',
    visibleToParent: row.visible_to_parent !== false,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at ?? row.created_at).toISOString(),
  };
}

/**
 * The notes a parent may read — the public card page and the mobile app call
 * this from the profile handler. Newest first, capped: this is a feed, not an
 * archive.
 */
export async function listParentVisibleNotes(studentId: string, companyId: string) {
  await ensureStudentNotesSchema();
  const rows = await query<any>(
    `SELECT id, student_id, author_user_id, author_name, kind, body, visible_to_parent, created_at, updated_at
       FROM student_notes
      WHERE student_id = $1 AND company_id = $2 AND visible_to_parent = TRUE
      ORDER BY created_at DESC
      LIMIT 100`,
    [studentId, companyId],
  );
  return rows.map(mapNote).map(({ id, kind, body, authorName, createdAt }) => ({
    id, kind, body, authorName, createdAt,
  }));
}

const KIND_TITLES: Record<StudentNoteKind, string> = {
  NOTE: 'ملاحظة من المدرّس 📝',
  PRAISE: 'إشادة من المدرّس 🌟',
  CONCERN: 'تنبيه من المدرّس ⚠️',
};

async function authorNameFor(userId: string, companyId: string): Promise<string> {
  const u = await queryOne<any>(
    `SELECT first_name, last_name, email FROM users WHERE id = $1 AND company_id = $2`,
    [userId, companyId],
  );
  if (!u) return '';
  const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
  return name || (u.email ?? '');
}

async function studentInCompany(studentId: string, companyId: string): Promise<boolean> {
  const s = await queryOne<any>(`SELECT id FROM students WHERE id = $1 AND company_id = $2`, [studentId, companyId]);
  return !!s;
}

type AuthHeaders = { authorization: string };

export const studentNotesRoutes = {
  /** GET /api/students/:id/notes — every note, private ones included. */
  list: async ({ params, headers }: { params: { id: string }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureStudentNotesSchema();
      if (!(await studentInCompany(params.id, context.companyId))) {
        return apiError(404, 'ERRORS.STUDENTS.NOT_FOUND', 'Student not found');
      }
      const rows = await query<any>(
        `SELECT id, student_id, author_user_id, author_name, kind, body, visible_to_parent, created_at, updated_at
           FROM student_notes
          WHERE student_id = $1 AND company_id = $2
          ORDER BY created_at DESC`,
        [params.id, context.companyId],
      );
      return { status: 200 as const, body: rows.map(mapNote) };
    } catch (error) {
      return mapThrownError(error, 'ERRORS.STUDENT_NOTES.LIST_FAILED', 'Failed to load notes');
    }
  },

  /**
   * POST /api/students/:id/notes — write one. A parent-visible note also lands
   * in the family's notification feed, the same way a mark or an absence does.
   */
  create: async ({ params, headers, body }: {
    params: { id: string };
    headers: AuthHeaders;
    body: { body: string; kind?: StudentNoteKind; visibleToParent?: boolean };
  }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureStudentNotesSchema();
      if (!(await studentInCompany(params.id, context.companyId))) {
        return apiError(404, 'ERRORS.STUDENTS.NOT_FOUND', 'Student not found');
      }
      const text = (body?.body ?? '').trim();
      if (!text) return apiError(400, 'ERRORS.STUDENT_NOTES.EMPTY', 'Write something first');
      const kind: StudentNoteKind = STUDENT_NOTE_KINDS.includes(body.kind as StudentNoteKind) ? (body.kind as StudentNoteKind) : 'NOTE';
      const visible = body.visibleToParent !== false;
      const authorName = await authorNameFor(context.userId, context.companyId);

      const row = await queryOne<any>(
        `INSERT INTO student_notes (company_id, student_id, author_user_id, author_name, kind, body, visible_to_parent)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, student_id, author_user_id, author_name, kind, body, visible_to_parent, created_at, updated_at`,
        [context.companyId, params.id, context.userId, authorName, kind, text, visible],
      );
      const note = mapNote(row);

      if (visible) {
        // Fire-and-forget: a push failure must never fail the save.
        sendPushToStudent(context.companyId, params.id, {
          title: KIND_TITLES[kind],
          body: `${authorName ? `${authorName}: ` : ''}${text.length > 160 ? `${text.slice(0, 157)}…` : text}`,
        }).catch((e) => console.error('push: student note failed (ignored):', e));
      }
      return { status: 201 as const, body: note };
    } catch (error) {
      return mapThrownError(error, 'ERRORS.STUDENT_NOTES.CREATE_FAILED', 'Failed to save the note');
    }
  },

  /** PATCH /api/students/:id/notes/:noteId — edit the text, kind or visibility. */
  update: async ({ params, headers, body }: {
    params: { id: string; noteId: string };
    headers: AuthHeaders;
    body: { body?: string; kind?: StudentNoteKind; visibleToParent?: boolean };
  }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureStudentNotesSchema();
      const sets: string[] = [];
      const values: any[] = [];
      if (body.body !== undefined) {
        const text = body.body.trim();
        if (!text) return apiError(400, 'ERRORS.STUDENT_NOTES.EMPTY', 'Write something first');
        values.push(text); sets.push(`body = $${values.length}`);
      }
      if (body.kind !== undefined && STUDENT_NOTE_KINDS.includes(body.kind)) {
        values.push(body.kind); sets.push(`kind = $${values.length}`);
      }
      if (body.visibleToParent !== undefined) {
        values.push(body.visibleToParent === true); sets.push(`visible_to_parent = $${values.length}`);
      }
      if (sets.length === 0) return apiError(400, 'ERRORS.STUDENT_NOTES.NOTHING_TO_UPDATE', 'Nothing to update');
      sets.push('updated_at = CURRENT_TIMESTAMP');
      values.push(params.noteId, params.id, context.companyId);
      const row = await queryOne<any>(
        `UPDATE student_notes SET ${sets.join(', ')}
          WHERE id = $${values.length - 2} AND student_id = $${values.length - 1} AND company_id = $${values.length}
          RETURNING id, student_id, author_user_id, author_name, kind, body, visible_to_parent, created_at, updated_at`,
        values,
      );
      if (!row) return apiError(404, 'ERRORS.STUDENT_NOTES.NOT_FOUND', 'Note not found');
      return { status: 200 as const, body: mapNote(row) };
    } catch (error) {
      return mapThrownError(error, 'ERRORS.STUDENT_NOTES.UPDATE_FAILED', 'Failed to update the note');
    }
  },

  /** DELETE /api/students/:id/notes/:noteId */
  remove: async ({ params, headers }: { params: { id: string; noteId: string }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureStudentNotesSchema();
      const row = await queryOne<any>(
        `DELETE FROM student_notes WHERE id = $1 AND student_id = $2 AND company_id = $3 RETURNING id`,
        [params.noteId, params.id, context.companyId],
      );
      if (!row) return apiError(404, 'ERRORS.STUDENT_NOTES.NOT_FOUND', 'Note not found');
      return { status: 200 as const, body: { success: true } };
    } catch (error) {
      return mapThrownError(error, 'ERRORS.STUDENT_NOTES.DELETE_FAILED', 'Failed to delete the note');
    }
  },
};
