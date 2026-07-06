import { randomBytes } from 'crypto';
import { insert, update, query, queryOne, deleteById } from '../db/connection';
import { extractTenantContext, canAccessBranch, checkGranularPermission, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

// CRM is a Phase-1 lead pipeline, gated to ACADEMY companies on the ADVANCED
// plan. Schema mirrors migration 053 and self-applies idempotently at runtime.
let crmSchemaEnsured = false;
async function ensureCrmSchema(): Promise<void> {
  if (crmSchemaEnsured) return;
  await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS plan VARCHAR(20) NOT NULL DEFAULT 'SIMPLE'`);
  await query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_plan_check') THEN
      ALTER TABLE companies ADD CONSTRAINT companies_plan_check CHECK (plan IN ('SIMPLE', 'ADVANCED'));
    END IF;
  END $$`);
  await query(`CREATE TABLE IF NOT EXISTS crm_leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    full_name VARCHAR(200) NOT NULL,
    phone VARCHAR(50),
    email VARCHAR(255),
    source VARCHAR(50),
    interested_course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    stage VARCHAR(20) NOT NULL DEFAULT 'NEW'
      CHECK (stage IN ('NEW', 'CONTACTED', 'TRIAL', 'NEGOTIATION', 'WON', 'LOST')),
    owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT,
    lost_reason TEXT,
    next_action_at DATE,
    converted_student_id UUID REFERENCES students(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_crm_leads_company ON crm_leads(company_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_crm_leads_branch ON crm_leads(branch_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_crm_leads_stage ON crm_leads(stage)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_crm_leads_owner ON crm_leads(owner_user_id)`);
  await query(`DROP TRIGGER IF EXISTS update_crm_leads_updated_at ON crm_leads`);
  await query(`CREATE TRIGGER update_crm_leads_updated_at BEFORE UPDATE ON crm_leads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`);

  // Phase 2 (migration 054): activities/tasks on the timeline of a lead.
  await query(`CREATE TABLE IF NOT EXISTS crm_activities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL DEFAULT 'NOTE'
      CHECK (type IN ('NOTE', 'CALL', 'WHATSAPP', 'MEETING', 'TASK', 'TRIAL')),
    subject VARCHAR(300),
    body TEXT,
    due_at TIMESTAMP WITH TIME ZONE,
    done_at TIMESTAMP WITH TIME ZONE,
    owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_crm_act_lead ON crm_activities(lead_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_crm_act_company ON crm_activities(company_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_crm_act_owner ON crm_activities(owner_user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_crm_act_due ON crm_activities(due_at)`);
  // Tasks become first-class & assignable (migration 055): an employee assignee,
  // a priority, and standalone tasks (lead optional).
  await query(`ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS assigned_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL`);
  await query(`ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS priority VARCHAR(10) NOT NULL DEFAULT 'MEDIUM'`);
  await query(`ALTER TABLE crm_activities ALTER COLUMN lead_id DROP NOT NULL`);
  await query(`CREATE INDEX IF NOT EXISTS idx_crm_act_assignee ON crm_activities(assigned_employee_id)`);
  await query(`DROP TRIGGER IF EXISTS update_crm_activities_updated_at ON crm_activities`);
  await query(`CREATE TRIGGER update_crm_activities_updated_at BEFORE UPDATE ON crm_activities
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`);

  // Call log (migration 056): one row per outreach/call attempt to a lead, with
  // the response and the obstacle to joining. Drives the reach count & call history.
  await query(`CREATE TABLE IF NOT EXISTS crm_lead_calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
    response VARCHAR(24) NOT NULL DEFAULT 'NO_ANSWER',
    obstacle VARCHAR(24),
    notes TEXT,
    called_by UUID REFERENCES users(id) ON DELETE SET NULL,
    called_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_crm_calls_lead ON crm_lead_calls(lead_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_crm_calls_company ON crm_lead_calls(company_id)`);

  crmSchemaEnsured = true;
}

// CRM is Advanced-plan + Academy only. Returns an apiError response when denied.
async function crmDenied(companyId: string): Promise<any | null> {
  const c = await queryOne<any>(`SELECT type, plan FROM companies WHERE id = $1`, [companyId]);
  if (!c || c.type !== 'ACADEMY' || c.plan !== 'ADVANCED') {
    return apiError(403, 'ERRORS.CRM.NOT_AVAILABLE', 'CRM is available for academies on the Advanced plan');
  }
  return null;
}

const VALID_STAGES = ['NEW', 'CONTACTED', 'TRIAL', 'NEGOTIATION', 'WON', 'LOST'];

function generateQrToken(): string {
  return randomBytes(16).toString('hex');
}

function mapLeadFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id ?? null,
    fullName: row.full_name,
    phone: row.phone ?? null,
    email: row.email ?? null,
    source: row.source ?? null,
    interestedCourseId: row.interested_course_id ?? null,
    interestedCourseName: row.interested_course_name ?? null,
    stage: row.stage,
    ownerUserId: row.owner_user_id ?? null,
    ownerName: row.owner_name ?? null,
    notes: row.notes ?? null,
    lostReason: row.lost_reason ?? null,
    nextActionAt: row.next_action_at ?? null,
    convertedStudentId: row.converted_student_id ?? null,
    lastActivityAt: row.last_activity_at ?? null,
    openTaskCount: row.open_task_count !== undefined && row.open_task_count !== null ? parseInt(row.open_task_count, 10) : 0,
    nextTaskDueAt: row.next_task_due_at ?? null,
    reachCount: row.reach_count !== undefined && row.reach_count !== null ? parseInt(row.reach_count, 10) : 0,
    lastCallAt: row.last_call_at ?? null,
    lastResponse: row.last_response ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const ACTIVITY_TYPES = ['NOTE', 'CALL', 'WHATSAPP', 'MEETING', 'TASK', 'TRIAL'];

function mapActivityFromDB(row: any) {
  return {
    id: row.id,
    leadId: row.lead_id,
    leadName: row.lead_name ?? null,
    type: row.type,
    subject: row.subject ?? null,
    body: row.body ?? null,
    dueAt: row.due_at ?? null,
    doneAt: row.done_at ?? null,
    ownerUserId: row.owner_user_id ?? null,
    ownerName: row.owner_name ?? null,
    assignedEmployeeId: row.assigned_employee_id ?? null,
    assigneeName: row.assignee_name ?? null,
    priority: row.priority ?? 'MEDIUM',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const CALL_RESPONSES = ['NO_ANSWER', 'ANSWERED', 'INTERESTED', 'NOT_INTERESTED', 'CALL_BACK', 'WRONG_NUMBER'];
const CALL_OBSTACLES = ['NONE', 'PRICE', 'SCHEDULE', 'DISTANCE', 'STILL_THINKING', 'COMPETITOR', 'NOT_INTERESTED', 'OTHER'];

function mapCallFromDB(row: any) {
  return {
    id: row.id,
    leadId: row.lead_id,
    response: row.response,
    obstacle: row.obstacle ?? null,
    notes: row.notes ?? null,
    calledBy: row.called_by ?? null,
    calledByName: row.called_by_name ?? null,
    calledAt: row.called_at,
    createdAt: row.created_at,
  };
}

const LEAD_SELECT = `
  SELECT l.*,
         co.name AS interested_course_name,
         TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS owner_name,
         (SELECT MAX(a.created_at) FROM crm_activities a WHERE a.lead_id = l.id) AS last_activity_at,
         (SELECT COUNT(*) FROM crm_activities a WHERE a.lead_id = l.id AND a.done_at IS NULL AND a.due_at IS NOT NULL) AS open_task_count,
         (SELECT MIN(a.due_at) FROM crm_activities a WHERE a.lead_id = l.id AND a.done_at IS NULL AND a.due_at IS NOT NULL) AS next_task_due_at,
         (SELECT COUNT(*) FROM crm_lead_calls c WHERE c.lead_id = l.id) AS reach_count,
         (SELECT MAX(c.called_at) FROM crm_lead_calls c WHERE c.lead_id = l.id) AS last_call_at,
         (SELECT c.response FROM crm_lead_calls c WHERE c.lead_id = l.id ORDER BY c.called_at DESC LIMIT 1) AS last_response
  FROM crm_leads l
  LEFT JOIN courses co ON co.id = l.interested_course_id
  LEFT JOIN users u ON u.id = l.owner_user_id
`;

export const crmRoutes = {
  listLeads: async ({ query: q, headers }: { query: { stage?: string; ownerId?: string; branchId?: string; search?: string; toCall?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureCrmSchema();
      const denied = await crmDenied(context.companyId);
      if (denied) return denied;

      const params: any[] = [context.companyId];
      let sql = `${LEAD_SELECT} WHERE l.company_id = $1`;

      const branchClause = appendBranchSqlFilter(context, params, 'l.branch_id');
      if (branchClause) sql += ` AND (${branchClause} OR l.branch_id IS NULL)`;

      if (q.stage && VALID_STAGES.includes(q.stage)) {
        params.push(q.stage);
        sql += ` AND l.stage = $${params.length}`;
      }
      if (q.ownerId) {
        params.push(q.ownerId);
        sql += ` AND l.owner_user_id = $${params.length}`;
      }
      if (q.branchId) {
        if (!canAccessBranch(context, q.branchId)) return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        params.push(q.branchId);
        sql += ` AND l.branch_id = $${params.length}`;
      }
      if (q.search) {
        params.push(`%${q.search}%`);
        sql += ` AND (l.full_name ILIKE $${params.length} OR l.phone ILIKE $${params.length} OR l.email ILIKE $${params.length})`;
      }
      // "Who I have to call" — open leads never called, due for follow-up, or whose
      // last call went unanswered / needs a call-back.
      if (q.toCall === 'true') {
        sql += ` AND l.stage NOT IN ('WON','LOST') AND l.converted_student_id IS NULL AND (
          (SELECT COUNT(*) FROM crm_lead_calls c WHERE c.lead_id = l.id) = 0
          OR (l.next_action_at IS NOT NULL AND l.next_action_at <= CURRENT_DATE)
          OR (SELECT c.response FROM crm_lead_calls c WHERE c.lead_id = l.id ORDER BY c.called_at DESC LIMIT 1) IN ('NO_ANSWER','CALL_BACK')
        )`;
      }
      sql += ` ORDER BY l.created_at DESC`;

      const rows = await query<any>(sql, params);
      return { status: 200 as const, body: rows.map(mapLeadFromDB) };
    } catch (error) {
      console.error('List leads error:', error);
      return mapThrownError(error, 'ERRORS.CRM.LIST_FAILED', 'Failed to list leads');
    }
  },

  createLead: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureCrmSchema();
      const denied = await crmDenied(context.companyId);
      if (denied) return denied;

      if (!body?.fullName || !String(body.fullName).trim()) {
        return apiError(400, 'ERRORS.CRM.NAME_REQUIRED', 'Lead name is required');
      }
      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }
      const stage = VALID_STAGES.includes(body.stage) ? body.stage : 'NEW';

      const lead = await insert('crm_leads', {
        company_id: context.companyId,
        branch_id: body.branchId || null,
        full_name: String(body.fullName).trim(),
        phone: body.phone || null,
        email: body.email || null,
        source: body.source || null,
        interested_course_id: body.interestedCourseId || null,
        stage,
        owner_user_id: body.ownerUserId || context.userId, // creator owns by default
        notes: body.notes || null,
        next_action_at: body.nextActionAt || null,
      });

      const full = await queryOne<any>(`${LEAD_SELECT} WHERE l.id = $1`, [lead.id]);
      return { status: 201 as const, body: mapLeadFromDB(full || lead) };
    } catch (error) {
      console.error('Create lead error:', error);
      return mapThrownError(error, 'ERRORS.CRM.CREATE_FAILED', 'Failed to create lead', 400);
    }
  },

  updateLead: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureCrmSchema();
      const denied = await crmDenied(context.companyId);
      if (denied) return denied;

      const existing = await queryOne<any>('SELECT * FROM crm_leads WHERE id = $1 AND company_id = $2', [params.id, context.companyId]);
      if (!existing) return apiError(404, 'ERRORS.CRM.NOT_FOUND', 'Lead not found');

      const data: Record<string, any> = {};
      if (body.fullName !== undefined) data.full_name = String(body.fullName).trim();
      if (body.phone !== undefined) data.phone = body.phone || null;
      if (body.email !== undefined) data.email = body.email || null;
      if (body.source !== undefined) data.source = body.source || null;
      if (body.interestedCourseId !== undefined) data.interested_course_id = body.interestedCourseId || null;
      if (body.stage !== undefined) {
        if (!VALID_STAGES.includes(body.stage)) return apiError(400, 'ERRORS.CRM.INVALID_STAGE', 'Invalid stage');
        data.stage = body.stage;
      }
      if (body.ownerUserId !== undefined) data.owner_user_id = body.ownerUserId || null;
      if (body.notes !== undefined) data.notes = body.notes || null;
      if (body.lostReason !== undefined) data.lost_reason = body.lostReason || null;
      if (body.nextActionAt !== undefined) data.next_action_at = body.nextActionAt || null;
      if (body.branchId !== undefined) {
        if (body.branchId && !canAccessBranch(context, body.branchId)) return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        data.branch_id = body.branchId || null;
      }

      await update('crm_leads', params.id, data);

      // Automation: advancing into an active stage schedules a follow-up task
      // (2 days out, for the lead's owner) when none is open — keeps the
      // pipeline from going quiet. Best-effort; never fails the update.
      const ACTIVE_STAGES = ['CONTACTED', 'TRIAL', 'NEGOTIATION'];
      if (data.stage && data.stage !== existing.stage && ACTIVE_STAGES.includes(data.stage)) {
        try {
          const openTask = await queryOne<any>(
            `SELECT 1 FROM crm_activities WHERE lead_id = $1 AND done_at IS NULL AND due_at IS NOT NULL LIMIT 1`,
            [params.id]
          );
          if (!openTask) {
            const due = new Date();
            due.setDate(due.getDate() + 2);
            await insert('crm_activities', {
              company_id: context.companyId,
              lead_id: params.id,
              type: 'TASK',
              subject: `Follow up — ${data.stage}`,
              due_at: due.toISOString(),
              owner_user_id: existing.owner_user_id || context.userId,
              created_by: context.userId,
            });
          }
        } catch (autoErr) {
          console.error('Auto follow-up task error:', autoErr);
        }
      }

      const full = await queryOne<any>(`${LEAD_SELECT} WHERE l.id = $1`, [params.id]);
      return { status: 200 as const, body: mapLeadFromDB(full) };
    } catch (error) {
      console.error('Update lead error:', error);
      return mapThrownError(error, 'ERRORS.CRM.UPDATE_FAILED', 'Failed to update lead', 400);
    }
  },

  deleteLead: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureCrmSchema();
      const denied = await crmDenied(context.companyId);
      if (denied) return denied;

      const existing = await queryOne<any>('SELECT id FROM crm_leads WHERE id = $1 AND company_id = $2', [params.id, context.companyId]);
      if (!existing) return apiError(404, 'ERRORS.CRM.NOT_FOUND', 'Lead not found');
      await deleteById('crm_leads', params.id);
      return { status: 200 as const, body: { message: 'Lead deleted', code: 'CRM.LEAD_DELETED' } };
    } catch (error) {
      console.error('Delete lead error:', error);
      return mapThrownError(error, 'ERRORS.CRM.DELETE_FAILED', 'Failed to delete lead', 400);
    }
  },

  // Convert a won lead into a real student. Splits the name, carries phone/email
  // and source across, then marks the lead WON with converted_student_id set so
  // it drops out of the active pipeline but keeps its history.
  convertLead: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureCrmSchema();
      const denied = await crmDenied(context.companyId);
      if (denied) return denied;

      const lead = await queryOne<any>('SELECT * FROM crm_leads WHERE id = $1 AND company_id = $2', [params.id, context.companyId]);
      if (!lead) return apiError(404, 'ERRORS.CRM.NOT_FOUND', 'Lead not found');
      if (lead.converted_student_id) return apiError(409, 'ERRORS.CRM.ALREADY_CONVERTED', 'Lead already converted');

      // Resolve a branch: the lead's, an explicit one, or the company's first branch.
      let branchId: string | null = body?.branchId || lead.branch_id || null;
      if (branchId && !canAccessBranch(context, branchId)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }
      if (!branchId) {
        const b = await queryOne<any>(`SELECT id FROM branches WHERE company_id = $1 AND is_active = true ORDER BY created_at ASC LIMIT 1`, [context.companyId]);
        branchId = b?.id || null;
      }
      if (!branchId) return apiError(400, 'ERRORS.CRM.NO_BRANCH', 'No branch available to place the student');

      const parts = String(lead.full_name).trim().split(/\s+/);
      const firstName = parts.shift() || lead.full_name;
      const lastName = parts.join(' ') || '-';

      const codeRow = await queryOne<{ next: number }>(
        `SELECT COALESCE(MAX(student_code), 0) + 1 AS next FROM students WHERE company_id = $1`,
        [context.companyId]
      );

      const student = await insert('students', {
        company_id: context.companyId,
        first_name: firstName,
        last_name: lastName,
        email: lead.email || null,
        phone: lead.phone || null,
        branch_id: branchId,
        enrollment_date: new Date().toISOString().split('T')[0],
        acquisition_channel: lead.source || null,
        notes: lead.notes || null,
        qr_token: generateQrToken(),
        student_code: codeRow?.next ?? 1,
        is_active: true,
      });

      await update('crm_leads', lead.id, {
        stage: 'WON',
        converted_student_id: student.id,
        branch_id: branchId,
      });

      return { status: 200 as const, body: { studentId: student.id, leadId: lead.id } };
    } catch (error) {
      console.error('Convert lead error:', error);
      return mapThrownError(error, 'ERRORS.CRM.CONVERT_FAILED', 'Failed to convert lead', 400);
    }
  },

  // ── Activities & tasks (Phase 2) ──────────────────────────────────────────
  listActivities: async ({ params, headers }: { params: { leadId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureCrmSchema();
      const denied = await crmDenied(context.companyId);
      if (denied) return denied;

      const lead = await queryOne<any>('SELECT id FROM crm_leads WHERE id = $1 AND company_id = $2', [params.leadId, context.companyId]);
      if (!lead) return apiError(404, 'ERRORS.CRM.NOT_FOUND', 'Lead not found');

      const rows = await query<any>(
        `SELECT a.*, TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS owner_name
         FROM crm_activities a
         LEFT JOIN users u ON u.id = a.owner_user_id
         WHERE a.lead_id = $1 AND a.company_id = $2
         ORDER BY COALESCE(a.done_at, a.due_at, a.created_at) DESC, a.created_at DESC`,
        [params.leadId, context.companyId]
      );
      return { status: 200 as const, body: rows.map(mapActivityFromDB) };
    } catch (error) {
      console.error('List activities error:', error);
      return mapThrownError(error, 'ERRORS.CRM.ACT_LIST_FAILED', 'Failed to list activities');
    }
  },

  createActivity: async ({ params, body, headers }: { params: { leadId: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureCrmSchema();
      const denied = await crmDenied(context.companyId);
      if (denied) return denied;

      const lead = await queryOne<any>('SELECT id FROM crm_leads WHERE id = $1 AND company_id = $2', [params.leadId, context.companyId]);
      if (!lead) return apiError(404, 'ERRORS.CRM.NOT_FOUND', 'Lead not found');

      const type = ACTIVITY_TYPES.includes(body?.type) ? body.type : 'NOTE';
      // A TASK marked done at creation, or any activity logged after the fact.
      const doneAt = body?.done ? new Date().toISOString() : null;

      const act = await insert('crm_activities', {
        company_id: context.companyId,
        lead_id: params.leadId,
        type,
        subject: body?.subject || null,
        body: body?.body || null,
        due_at: body?.dueAt || null,
        done_at: doneAt,
        owner_user_id: body?.ownerUserId || context.userId,
        created_by: context.userId,
      });
      const full = await queryOne<any>(
        `SELECT a.*, TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS owner_name
         FROM crm_activities a LEFT JOIN users u ON u.id = a.owner_user_id WHERE a.id = $1`,
        [act.id]
      );
      return { status: 201 as const, body: mapActivityFromDB(full || act) };
    } catch (error) {
      console.error('Create activity error:', error);
      return mapThrownError(error, 'ERRORS.CRM.ACT_CREATE_FAILED', 'Failed to create activity', 400);
    }
  },

  updateActivity: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureCrmSchema();
      const denied = await crmDenied(context.companyId);
      if (denied) return denied;

      const existing = await queryOne<any>('SELECT * FROM crm_activities WHERE id = $1 AND company_id = $2', [params.id, context.companyId]);
      if (!existing) return apiError(404, 'ERRORS.CRM.NOT_FOUND', 'Activity not found');

      const data: Record<string, any> = {};
      if (body.type !== undefined && ACTIVITY_TYPES.includes(body.type)) data.type = body.type;
      if (body.subject !== undefined) data.subject = body.subject || null;
      if (body.body !== undefined) data.body = body.body || null;
      if (body.dueAt !== undefined) data.due_at = body.dueAt || null;
      // `done` toggles the completion timestamp.
      if (body.done !== undefined) data.done_at = body.done ? (existing.done_at || new Date().toISOString()) : null;

      await update('crm_activities', params.id, data);
      const full = await queryOne<any>(
        `SELECT a.*, TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS owner_name
         FROM crm_activities a LEFT JOIN users u ON u.id = a.owner_user_id WHERE a.id = $1`,
        [params.id]
      );
      return { status: 200 as const, body: mapActivityFromDB(full) };
    } catch (error) {
      console.error('Update activity error:', error);
      return mapThrownError(error, 'ERRORS.CRM.ACT_UPDATE_FAILED', 'Failed to update activity', 400);
    }
  },

  deleteActivity: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureCrmSchema();
      const denied = await crmDenied(context.companyId);
      if (denied) return denied;

      const existing = await queryOne<any>('SELECT id FROM crm_activities WHERE id = $1 AND company_id = $2', [params.id, context.companyId]);
      if (!existing) return apiError(404, 'ERRORS.CRM.NOT_FOUND', 'Activity not found');
      await deleteById('crm_activities', params.id);
      return { status: 200 as const, body: { message: 'Activity deleted', code: 'CRM.ACTIVITY_DELETED' } };
    } catch (error) {
      console.error('Delete activity error:', error);
      return mapThrownError(error, 'ERRORS.CRM.ACT_DELETE_FAILED', 'Failed to delete activity', 400);
    }
  },

  // Tasks list (dedicated page). Filter by assignee (employee), status, lead, text.
  // Standalone tasks (no lead) are included via LEFT JOIN.
  listTasks: async ({ query: q, headers }: { query: { assigneeId?: string; status?: string; leadId?: string; search?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureCrmSchema();
      const denied = await crmDenied(context.companyId);
      if (denied) return denied;

      const params: any[] = [context.companyId];
      let sql = `SELECT a.*, l.full_name AS lead_name,
                        TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS owner_name,
                        TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS assignee_name
                 FROM crm_activities a
                 LEFT JOIN crm_leads l ON l.id = a.lead_id
                 LEFT JOIN users u ON u.id = a.owner_user_id
                 LEFT JOIN employees e ON e.id = a.assigned_employee_id
                 WHERE a.company_id = $1 AND a.type = 'TASK'`;
      const status = q.status || 'open';
      if (status === 'open') sql += ` AND a.done_at IS NULL`;
      else if (status === 'overdue') sql += ` AND a.done_at IS NULL AND a.due_at IS NOT NULL AND a.due_at < NOW()`;
      else if (status === 'done') sql += ` AND a.done_at IS NOT NULL`;
      // 'all' → no status filter
      if (q.assigneeId) { params.push(q.assigneeId); sql += ` AND a.assigned_employee_id = $${params.length}`; }
      if (q.leadId) { params.push(q.leadId); sql += ` AND a.lead_id = $${params.length}`; }
      if (q.search) { params.push(`%${q.search}%`); sql += ` AND (a.subject ILIKE $${params.length} OR a.body ILIKE $${params.length})`; }
      sql += ` ORDER BY (a.done_at IS NOT NULL), a.due_at ASC NULLS LAST, a.created_at DESC`;

      const rows = await query<any>(sql, params);
      return { status: 200 as const, body: rows.map(mapActivityFromDB) };
    } catch (error) {
      console.error('List tasks error:', error);
      return mapThrownError(error, 'ERRORS.CRM.TASKS_FAILED', 'Failed to load tasks');
    }
  },

  // Create a standalone or lead-linked task, assignable to an employee.
  createTask: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureCrmSchema();
      const denied = await crmDenied(context.companyId);
      if (denied) return denied;

      if (!body?.subject || !String(body.subject).trim()) {
        return apiError(400, 'ERRORS.CRM.TASK_SUBJECT_REQUIRED', 'Task title is required');
      }
      const priority = ['LOW', 'MEDIUM', 'HIGH'].includes(body.priority) ? body.priority : 'MEDIUM';

      const task = await insert('crm_activities', {
        company_id: context.companyId,
        lead_id: body.leadId || null,
        type: 'TASK',
        subject: String(body.subject).trim(),
        body: body.body || null,
        due_at: body.dueAt || null,
        assigned_employee_id: body.assignedEmployeeId || null,
        priority,
        owner_user_id: context.userId,
        created_by: context.userId,
      });
      const full = await queryOne<any>(
        `SELECT a.*, l.full_name AS lead_name,
                TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS assignee_name
         FROM crm_activities a
         LEFT JOIN crm_leads l ON l.id = a.lead_id
         LEFT JOIN employees e ON e.id = a.assigned_employee_id WHERE a.id = $1`,
        [task.id]
      );
      return { status: 201 as const, body: mapActivityFromDB(full || task) };
    } catch (error) {
      console.error('Create task error:', error);
      return mapThrownError(error, 'ERRORS.CRM.TASK_CREATE_FAILED', 'Failed to create task', 400);
    }
  },

  // Update a task: fields, assignee, priority, or completion.
  updateTask: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureCrmSchema();
      const denied = await crmDenied(context.companyId);
      if (denied) return denied;

      const existing = await queryOne<any>(`SELECT * FROM crm_activities WHERE id = $1 AND company_id = $2 AND type = 'TASK'`, [params.id, context.companyId]);
      if (!existing) return apiError(404, 'ERRORS.CRM.NOT_FOUND', 'Task not found');

      const data: Record<string, any> = {};
      if (body.subject !== undefined) data.subject = String(body.subject).trim();
      if (body.body !== undefined) data.body = body.body || null;
      if (body.dueAt !== undefined) data.due_at = body.dueAt || null;
      if (body.leadId !== undefined) data.lead_id = body.leadId || null;
      if (body.assignedEmployeeId !== undefined) data.assigned_employee_id = body.assignedEmployeeId || null;
      if (body.priority !== undefined && ['LOW', 'MEDIUM', 'HIGH'].includes(body.priority)) data.priority = body.priority;
      if (body.done !== undefined) data.done_at = body.done ? (existing.done_at || new Date().toISOString()) : null;

      await update('crm_activities', params.id, data);
      const full = await queryOne<any>(
        `SELECT a.*, l.full_name AS lead_name,
                TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS assignee_name
         FROM crm_activities a
         LEFT JOIN crm_leads l ON l.id = a.lead_id
         LEFT JOIN employees e ON e.id = a.assigned_employee_id WHERE a.id = $1`,
        [params.id]
      );
      return { status: 200 as const, body: mapActivityFromDB(full) };
    } catch (error) {
      console.error('Update task error:', error);
      return mapThrownError(error, 'ERRORS.CRM.TASK_UPDATE_FAILED', 'Failed to update task', 400);
    }
  },

  // ── Call log (per lead): history of reach attempts + response + obstacle ─────
  listCalls: async ({ params, headers }: { params: { leadId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureCrmSchema();
      const denied = await crmDenied(context.companyId);
      if (denied) return denied;

      const lead = await queryOne<any>('SELECT id FROM crm_leads WHERE id = $1 AND company_id = $2', [params.leadId, context.companyId]);
      if (!lead) return apiError(404, 'ERRORS.CRM.NOT_FOUND', 'Lead not found');

      const rows = await query<any>(
        `SELECT c.*, TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS called_by_name
         FROM crm_lead_calls c LEFT JOIN users u ON u.id = c.called_by
         WHERE c.lead_id = $1 AND c.company_id = $2
         ORDER BY c.called_at DESC`,
        [params.leadId, context.companyId]
      );
      return { status: 200 as const, body: rows.map(mapCallFromDB) };
    } catch (error) {
      console.error('List calls error:', error);
      return mapThrownError(error, 'ERRORS.CRM.CALLS_FAILED', 'Failed to load call history');
    }
  },

  logCall: async ({ params, body, headers }: { params: { leadId: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureCrmSchema();
      const denied = await crmDenied(context.companyId);
      if (denied) return denied;

      const lead = await queryOne<any>('SELECT id FROM crm_leads WHERE id = $1 AND company_id = $2', [params.leadId, context.companyId]);
      if (!lead) return apiError(404, 'ERRORS.CRM.NOT_FOUND', 'Lead not found');

      const response = CALL_RESPONSES.includes(body?.response) ? body.response : 'NO_ANSWER';
      const obstacle = body?.obstacle && body.obstacle !== 'NONE' && CALL_OBSTACLES.includes(body.obstacle) ? body.obstacle : null;

      const call = await insert('crm_lead_calls', {
        company_id: context.companyId,
        lead_id: params.leadId,
        response,
        obstacle,
        notes: body?.notes || null,
        called_by: context.userId,
        called_at: body?.calledAt || new Date().toISOString(),
      });
      const full = await queryOne<any>(
        `SELECT c.*, TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS called_by_name
         FROM crm_lead_calls c LEFT JOIN users u ON u.id = c.called_by WHERE c.id = $1`,
        [call.id]
      );
      return { status: 201 as const, body: mapCallFromDB(full || call) };
    } catch (error) {
      console.error('Log call error:', error);
      return mapThrownError(error, 'ERRORS.CRM.CALL_LOG_FAILED', 'Failed to log the call', 400);
    }
  },

  deleteCall: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureCrmSchema();
      const denied = await crmDenied(context.companyId);
      if (denied) return denied;

      const existing = await queryOne<any>('SELECT id FROM crm_lead_calls WHERE id = $1 AND company_id = $2', [params.id, context.companyId]);
      if (!existing) return apiError(404, 'ERRORS.CRM.NOT_FOUND', 'Call not found');
      await deleteById('crm_lead_calls', params.id);
      return { status: 200 as const, body: { message: 'Call deleted', code: 'CRM.CALL_DELETED' } };
    } catch (error) {
      console.error('Delete call error:', error);
      return mapThrownError(error, 'ERRORS.CRM.CALL_DELETE_FAILED', 'Failed to delete call', 400);
    }
  },

  // ── Analytics (Phase 4): funnel, source attribution, owner leaderboard ──────
  getAnalytics: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureCrmSchema();
      const denied = await crmDenied(context.companyId);
      if (denied) return denied;

      const cid = context.companyId;
      const stageRows = await query<any>(
        `SELECT stage, COUNT(*)::int AS count FROM crm_leads WHERE company_id = $1 GROUP BY stage`, [cid]
      );
      const byStage: Record<string, number> = {};
      for (const s of VALID_STAGES) byStage[s] = 0;
      for (const r of stageRows) byStage[r.stage] = r.count;
      const funnel = VALID_STAGES.map(s => ({ stage: s, count: byStage[s] }));
      const totalLeads = VALID_STAGES.reduce((n, s) => n + byStage[s], 0);
      const won = byStage['WON'];
      const lost = byStage['LOST'];
      const open = totalLeads - won - lost;
      const conversionRate = totalLeads > 0 ? Math.round((won / totalLeads) * 1000) / 10 : 0;

      const sources = await query<any>(
        `SELECT COALESCE(NULLIF(source, ''), 'UNKNOWN') AS source, COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE stage = 'WON')::int AS won
         FROM crm_leads WHERE company_id = $1 GROUP BY 1 ORDER BY total DESC`, [cid]
      );

      const ownerLeads = await query<any>(
        `SELECT l.owner_user_id, TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS owner_name,
                COUNT(*)::int AS total, COUNT(*) FILTER (WHERE l.stage = 'WON')::int AS won
         FROM crm_leads l LEFT JOIN users u ON u.id = l.owner_user_id
         WHERE l.company_id = $1 AND l.owner_user_id IS NOT NULL
         GROUP BY l.owner_user_id, u.first_name, u.last_name ORDER BY total DESC`, [cid]
      );
      const ownerTasks = await query<any>(
        `SELECT owner_user_id,
                COUNT(*) FILTER (WHERE done_at IS NULL AND due_at IS NOT NULL)::int AS open_tasks,
                COUNT(*) FILTER (WHERE done_at IS NULL AND due_at < NOW())::int AS overdue_tasks
         FROM crm_activities WHERE company_id = $1 AND owner_user_id IS NOT NULL GROUP BY owner_user_id`, [cid]
      );
      const taskByOwner = new Map<string, any>();
      for (const t of ownerTasks) taskByOwner.set(t.owner_user_id, t);
      const leaderboard = ownerLeads.map((o: any) => ({
        ownerUserId: o.owner_user_id,
        ownerName: o.owner_name || null,
        total: o.total,
        won: o.won,
        openTasks: taskByOwner.get(o.owner_user_id)?.open_tasks ?? 0,
        overdueTasks: taskByOwner.get(o.owner_user_id)?.overdue_tasks ?? 0,
      }));

      const taskTotals = await queryOne<any>(
        `SELECT COUNT(*) FILTER (WHERE done_at IS NULL AND due_at IS NOT NULL)::int AS open,
                COUNT(*) FILTER (WHERE done_at IS NULL AND due_at < NOW())::int AS overdue
         FROM crm_activities WHERE company_id = $1`, [cid]
      );

      // Why leads don't join — obstacles cited on calls (distinct leads per obstacle).
      const obstacleRows = await query<any>(
        `SELECT obstacle, COUNT(DISTINCT lead_id)::int AS count
         FROM crm_lead_calls
         WHERE company_id = $1 AND obstacle IS NOT NULL AND obstacle <> 'NONE'
         GROUP BY obstacle ORDER BY count DESC`, [cid]
      );

      return {
        status: 200 as const,
        body: {
          totalLeads, won, lost, open, conversionRate,
          funnel,
          sources: sources.map((s: any) => ({ source: s.source, total: s.total, won: s.won })),
          leaderboard,
          tasks: { open: taskTotals?.open ?? 0, overdue: taskTotals?.overdue ?? 0 },
          obstacles: obstacleRows.map((o: any) => ({ obstacle: o.obstacle, count: o.count })),
        },
      };
    } catch (error) {
      console.error('CRM analytics error:', error);
      return mapThrownError(error, 'ERRORS.CRM.ANALYTICS_FAILED', 'Failed to load analytics');
    }
  },

  // ── Retention (Phase 4): active students at risk (dues / overdue subscriptions) ──
  getAtRisk: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureCrmSchema();
      const denied = await crmDenied(context.companyId);
      if (denied) return denied;

      const cid = context.companyId;
      const map = new Map<string, any>();
      const add = (row: any, reason: string, amount: number) => {
        const key = row.student_id;
        let e = map.get(key);
        if (!e) {
          e = {
            studentId: row.student_id,
            fullName: `${row.first_name} ${row.last_name}`.trim(),
            phone: row.phone ?? null,
            parentName: row.parent_name ?? null,
            parentPhone: row.parent_phone ?? null,
            branchId: row.branch_id ?? null,
            outstanding: 0,
            reasons: [] as string[],
          };
          map.set(key, e);
        }
        if (!e.reasons.includes(reason)) e.reasons.push(reason);
        e.outstanding += amount;
      };

      // Outstanding balance on active enrollments (unpaid dues).
      const dues = await query<any>(
        `SELECT e.student_id, s.first_name, s.last_name, s.phone, s.parent_name, s.parent_phone, e.branch_id,
                SUM(GREATEST(COALESCE(e.final_price,0) - COALESCE(e.amount_paid,0), 0))::numeric AS balance
         FROM enrollments e JOIN students s ON s.id = e.student_id
         WHERE e.company_id = $1 AND s.is_active = true
           AND e.status IN ('ACTIVE', 'PENDING', 'ON_HOLD')
           AND COALESCE(e.final_price,0) > COALESCE(e.amount_paid,0)
         GROUP BY e.student_id, s.first_name, s.last_name, s.phone, s.parent_name, s.parent_phone, e.branch_id`,
        [cid]
      );
      for (const r of dues) add(r, 'DUES', parseFloat(r.balance) || 0);

      // Overdue monthly subscription installments (if the table exists).
      const hasMsp = await queryOne<any>(`SELECT to_regclass('public.monthly_subscription_payments') IS NOT NULL AS ok`);
      if (hasMsp?.ok) {
        const subs = await query<any>(
          `SELECT msp.student_id, s.first_name, s.last_name, s.phone, s.parent_name, s.parent_phone, s.branch_id,
                  SUM(GREATEST(COALESCE(msp.amount_due,0) - COALESCE(msp.amount_paid,0), 0))::numeric AS balance
           FROM monthly_subscription_payments msp JOIN students s ON s.id = msp.student_id
           WHERE s.company_id = $1 AND s.is_active = true
             AND msp.payment_status IN ('PENDING', 'PARTIAL', 'OVERDUE')
             AND msp.due_date < CURRENT_DATE
           GROUP BY msp.student_id, s.first_name, s.last_name, s.phone, s.parent_name, s.parent_phone, s.branch_id`,
          [cid]
        );
        for (const r of subs) add(r, 'SUBSCRIPTION', parseFloat(r.balance) || 0);
      }

      const items = Array.from(map.values())
        .map(e => ({ ...e, outstanding: Math.round(e.outstanding * 100) / 100 }))
        .sort((a, b) => b.outstanding - a.outstanding)
        .slice(0, 300);

      return { status: 200 as const, body: items };
    } catch (error) {
      console.error('CRM at-risk error:', error);
      return mapThrownError(error, 'ERRORS.CRM.ATRISK_FAILED', 'Failed to load at-risk students');
    }
  },
};
