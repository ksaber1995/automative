import { query, queryOne, update } from '../db/connection';
import { extractTenantContext } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

// Auto start/end sessions on schedule. ON by default for new tenants: a class
// with a weekly schedule is expected to run at that time, and making every
// academy find a setting before their timetable does anything is a worse
// default than starting the lesson they already told us about.
//
// Added idempotently at runtime so the setting works before any SQL migration.
// The second statement matters as much as the first: on every database that
// already HAS the column, ADD COLUMN IF NOT EXISTS is a no-op and would leave
// the old FALSE default in place, so new tenants would keep opting out.
// How homework marks are entered: a number (the original behaviour) or a rating
// picked from a fixed list. A rating IS a number underneath — Excellent is 5,
// Weak is 1 — so nothing about how results are stored or reported changes; only
// the marking control does. NUMERIC stays the default so existing tenants are
// untouched.
//
// Added idempotently at runtime, same as the column above.
let homeworkGradingColumnInitPromise: Promise<void> | null = null;
export async function ensureHomeworkGradingColumn(): Promise<void> {
  if (!homeworkGradingColumnInitPromise) {
    homeworkGradingColumnInitPromise = (async () => {
      try {
        await query(
          `ALTER TABLE companies ADD COLUMN IF NOT EXISTS homework_grading_mode VARCHAR(10) NOT NULL DEFAULT 'NUMERIC'`
        );
      } catch (e) {
        homeworkGradingColumnInitPromise = null;
        throw e;
      }
    })();
  }
  return homeworkGradingColumnInitPromise;
}

/** The only two values the column may hold; anything else is rejected. */
const HOMEWORK_GRADING_MODES = ['NUMERIC', 'RATING'] as const;

/**
 * What kind of academy this is, which decides only what things are CALLED.
 *
 * A sports academy is an advanced academy in every respect that matters — same
 * tables, same permissions, same CRM and cash gating — but its people are
 * coaches and trainees, not teachers and students, and they train in groups on a
 * pitch rather than in classes in a room. That is a vocabulary, not a feature,
 * so it lives here rather than in `type` or `plan`: putting it in `type` would
 * have switched CRM and Cash OFF, since both gate on `type = 'ACADEMY'`.
 *
 * GENERAL is the default, so every existing tenant keeps the wording it has.
 * Added idempotently at runtime, same as the columns above.
 */
let verticalColumnInitPromise: Promise<void> | null = null;
export async function ensureVerticalColumn(): Promise<void> {
  if (!verticalColumnInitPromise) {
    verticalColumnInitPromise = (async () => {
      try {
        await query(
          `ALTER TABLE companies ADD COLUMN IF NOT EXISTS vertical VARCHAR(16) NOT NULL DEFAULT 'GENERAL'`
        );
      } catch (e) {
        verticalColumnInitPromise = null;
        throw e;
      }
    })();
  }
  return verticalColumnInitPromise;
}

/** The only two verticals; anything else reads as GENERAL. */
export const COMPANY_VERTICALS = ['GENERAL', 'SPORTS'] as const;
export type CompanyVertical = (typeof COMPANY_VERTICALS)[number];

/** Narrow whatever is on the row (or missing) to a vertical. */
export function toVertical(value: unknown): CompanyVertical {
  return value === 'SPORTS' ? 'SPORTS' : 'GENERAL';
}

let autoHomeworkColumnInitPromise: Promise<void> | null = null;
export async function ensureAutoHomeworkColumn(): Promise<void> {
  if (!autoHomeworkColumnInitPromise) {
    autoHomeworkColumnInitPromise = (async () => {
      try {
        // Opt-in: homework is a habit, not a given — default OFF.
        await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS auto_create_homework BOOLEAN NOT NULL DEFAULT FALSE`);
      } catch (e) {
        autoHomeworkColumnInitPromise = null;
        throw e;
      }
    })();
  }
  return autoHomeworkColumnInitPromise;
}

/** Does this company want a homework created with every new session? */
export async function isAutoHomeworkEnabled(companyId: string): Promise<boolean> {
  await ensureAutoHomeworkColumn();
  const row = await queryOne<any>(
    'SELECT auto_create_homework FROM companies WHERE id = $1',
    [companyId]
  );
  return row?.auto_create_homework === true;
}

let autoManageColumnInitPromise: Promise<void> | null = null;
export async function ensureAutoManageSessionsColumn(): Promise<void> {
  if (!autoManageColumnInitPromise) {
    autoManageColumnInitPromise = (async () => {
      try {
        await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS auto_manage_sessions BOOLEAN NOT NULL DEFAULT TRUE`);
        await query(`ALTER TABLE companies ALTER COLUMN auto_manage_sessions SET DEFAULT TRUE`);
      } catch (e) {
        autoManageColumnInitPromise = null;
        throw e;
      }
    })();
  }
  return autoManageColumnInitPromise;
}

/**
 * Migration 093: companies.type gains a real CHECK constraint (it was a free
 * VARCHAR(20) since migration 028) and SCHOOL becomes a legal value — ahead of
 * its signup flow shipping. Mirrors the guarded pattern in session-payments.ts'
 * ensurePerSessionSchema: skip when already in the desired state, swallow
 * duplicate_object so concurrent cold-starting containers can't race.
 */
let companyTypeConstraintInitPromise: Promise<void> | null = null;
export async function ensureCompanyTypeConstraint(): Promise<void> {
  if (!companyTypeConstraintInitPromise) {
    companyTypeConstraintInitPromise = (async () => {
      try {
        await query(`DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = 'companies_type_check' AND conrelid = 'companies'::regclass
                AND pg_get_constraintdef(oid) LIKE '%SCHOOL%'
            ) THEN
              ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_type_check;
              BEGIN
                ALTER TABLE companies ADD CONSTRAINT companies_type_check
                  CHECK (type IN ('ACADEMY', 'TEACHER', 'SCHOOL'));
              EXCEPTION WHEN duplicate_object THEN NULL;
              END;
            END IF;
          END $$`);
      } catch (e) {
        companyTypeConstraintInitPromise = null;
        throw e;
      }
    })();
  }
  return companyTypeConstraintInitPromise;
}

/**
 * Opt-in (migration 092): auto-confirm a PER_SESSION charge raised while taking
 * attendance, instead of leaving it PENDING for a manual click. Off by default —
 * unlike auto-managed sessions, a company only wants this once it has actually
 * decided cash changes hands at the door. Sticky in either direction once set.
 */
let autoConfirmSessionPaymentsColumnInitPromise: Promise<void> | null = null;
export async function ensureAutoConfirmSessionPaymentsColumn(): Promise<void> {
  if (!autoConfirmSessionPaymentsColumnInitPromise) {
    autoConfirmSessionPaymentsColumnInitPromise = (async () => {
      try {
        await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS auto_confirm_session_payments BOOLEAN NOT NULL DEFAULT FALSE`);
      } catch (e) {
        autoConfirmSessionPaymentsColumnInitPromise = null;
        throw e;
      }
    })();
  }
  return autoConfirmSessionPaymentsColumnInitPromise;
}

/**
 * How many free (TRIAL) sessions one student may ever attend, company-wide.
 *
 * 0 means unlimited, which is what every existing tenant gets — a free session
 * has always been open to anyone, and silently capping it on deploy would start
 * turning people away at the door. An academy opts in by setting a number.
 */
let freeTrialLimitColumnInitPromise: Promise<void> | null = null;
export async function ensureFreeTrialLimitColumn(): Promise<void> {
  if (!freeTrialLimitColumnInitPromise) {
    freeTrialLimitColumnInitPromise = (async () => {
      try {
        await query(
          `ALTER TABLE companies ADD COLUMN IF NOT EXISTS free_session_trial_limit INTEGER NOT NULL DEFAULT 0`
        );
      } catch (e) {
        freeTrialLimitColumnInitPromise = null;
        throw e;
      }
    })();
  }
  return freeTrialLimitColumnInitPromise;
}

/**
 * Whether this tenant may send SMS, and until when (migration 097).
 *
 * Sold per tenant and switched on from the admin console, the same shape as the
 * QR card pool: off until someone turns it on. Two columns rather than one
 * because "activated" and "paid up to" are different facts — a lapsed tenant
 * keeps the flag but stops being entitled, and re-selling is then a date change
 * rather than a re-activation.
 *
 * `sms_expiration` NULL means no end date, not "expired": a tenant switched on
 * without one stays on until someone switches them off. Callers must therefore
 * test the pair, never the date alone — see smsIsActive below.
 */
let smsColumnsInitPromise: Promise<void> | null = null;
export async function ensureCompanySmsColumns(): Promise<void> {
  if (!smsColumnsInitPromise) {
    smsColumnsInitPromise = (async () => {
      try {
        await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS sms_activated BOOLEAN NOT NULL DEFAULT FALSE`);
        await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS sms_expiration DATE`);
      } catch (e) {
        smsColumnsInitPromise = null;
        throw e;
      }
    })();
  }
  return smsColumnsInitPromise;
}

/**
 * SQL for "this tenant may send SMS right now" — the flag AND an expiry that has
 * not passed. `alias` is the companies alias in the query.
 *
 * Exported so the eventual sender and any UI both ask the question the same way;
 * spelling it out twice is how the console ends up claiming SMS is on for a
 * tenant whose date ran out last week.
 */
export function smsIsActive(alias = 'c'): string {
  return `(${alias}.sms_activated = true
           AND (${alias}.sms_expiration IS NULL OR ${alias}.sms_expiration >= CURRENT_DATE))`;
}

// Online exams — lessons, question banks and (later) the student exam portal.
// Gated per tenant and OFF by default: the feature ships dark and is switched on
// from the admin console one tenant at a time, like the QR card pool.
//
// Same idempotent runtime-migration approach as the columns above, so the flag
// works before migration 100 has been applied anywhere.
let onlineExamsColumnInitPromise: Promise<void> | null = null;
export async function ensureOnlineExamsColumn(): Promise<void> {
  if (!onlineExamsColumnInitPromise) {
    onlineExamsColumnInitPromise = (async () => {
      try {
        await query(
          `ALTER TABLE companies ADD COLUMN IF NOT EXISTS online_exams_enabled BOOLEAN NOT NULL DEFAULT false`
        );
      } catch (e) {
        onlineExamsColumnInitPromise = null;
        throw e;
      }
    })();
  }
  return onlineExamsColumnInitPromise;
}

/**
 * "May this tenant use online exams at all?" — the single source of the answer for
 * the whole feature (lessons, question banks, online exams, the student portal).
 *
 * Use this form where the right response to a gated tenant is to leave a field
 * alone rather than fail the request: `sessions.update` accepts a `lessonId` it
 * silently ignores, so the sessions API keeps the same shape for every tenant.
 * Where the endpoint IS the feature, use assertOnlineExams below.
 */
export async function isOnlineExamsEnabled(companyId: string): Promise<boolean> {
  await ensureOnlineExamsColumn();
  const row = await queryOne<any>(
    'SELECT online_exams_enabled FROM companies WHERE id = $1',
    [companyId]
  );
  return row?.online_exams_enabled === true;
}

/**
 * The gate as a guard clause. Returns an apiError response when denied and null
 * when allowed, so callers read:
 *
 *     const denied = await assertOnlineExams(context.companyId);
 *     if (denied) return denied;
 *
 * Mirrors assertCrmAvailable in routes/crm.ts. Every entry point goes through
 * this one function so the rule cannot drift between them — and so shipping the
 * feature to customers later is one edit here, not a hunt through call sites.
 */
export async function assertOnlineExams(companyId: string) {
  if (!(await isOnlineExamsEnabled(companyId))) {
    return apiError(
      403,
      'ERRORS.ONLINE_EXAMS.NOT_AVAILABLE',
      'Online exams are not enabled for this account'
    );
  }
  return null;
}

// Student ID card back face — one shared design per company. Same idempotent
// runtime-migration approach as above.
let cardDesignColumnInitPromise: Promise<void> | null = null;
export async function ensureCardDesignColumn(): Promise<void> {
  if (!cardDesignColumnInitPromise) {
    cardDesignColumnInitPromise = (async () => {
      try {
        await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS card_design JSONB`);
      } catch (e) {
        cardDesignColumnInitPromise = null;
        throw e;
      }
    })();
  }
  return cardDesignColumnInitPromise;
}

type CardTemplateId = 'navy' | 'maroon' | 'minimal' | 'portrait';
const CARD_TEMPLATES: CardTemplateId[] = ['navy', 'maroon', 'minimal', 'portrait'];

// The pool (agnostic) card designs, chosen separately from the personal student
// cards above. Mirrors AGNOSTIC_TEMPLATES in the frontend's card-agnostic.util
// and the enum in CardDesignSchema — this file keeps its own copy of the card
// types because the Lambda has no path alias to shared/.
type AgnosticTemplateId = 'aurora' | 'ribbon' | 'mono' | 'wave' | 'crest' | 'custom';
const AGNOSTIC_TEMPLATES: AgnosticTemplateId[] = ['aurora', 'ribbon', 'mono', 'wave', 'crest', 'custom'];

/**
 * Per-card-set tuning: logo width/offset, photo offset, and the three colours the
 * card's palette is derived from. Mirrors CardAdjust in shared/interfaces — this
 * file keeps its own copy because the Lambda has no path alias to shared/.
 */
interface CardAdjust {
  logoScale: number;
  logoDx: number;
  logoDy: number;
  photoDx: number;
  photoDy: number;
  bg: string;
  text: string;
  accent: string;
}

/** Where the QR and serial sit on a tenant's own pool artwork. Mirrors PoolArtLayout. */
interface PoolArtLayout {
  qrX: number;
  qrY: number;
  qrSize: number;
  qrTile: boolean;
  codeX: number;
  codeY: number;
  codeSize: number;
  codeColor: string;
  codeChip: boolean;
}

const DEFAULT_CARD_ADJUST: CardAdjust = {
  logoScale: 100, logoDx: 0, logoDy: 0, photoDx: 0, photoDy: 0, bg: '', text: '', accent: '',
};

const DEFAULT_POOL_ART: PoolArtLayout = {
  qrX: 235, qrY: 290, qrSize: 268, qrTile: true,
  codeX: 235, codeY: 470, codeSize: 34, codeColor: '#111827', codeChip: false,
};

/**
 * Which rows the student card's FRONT shows. Mirrors CardFields in
 * shared/interfaces — the Lambda has no path alias to shared/, so the shape is
 * repeated here and the two must be kept in step.
 *
 * `code` deliberately has no toggle: the card exists to be scanned, and the
 * number is the fallback when a camera will not read the QR.
 */
interface CardFields {
  studentName: boolean;
  className: boolean;
  courseName: boolean;
  school: boolean;
  year: boolean;
}

interface CardDesign {
  template: CardTemplateId;
  fields: CardFields;
  agnosticTemplate: AgnosticTemplateId;
  teacherName: string;
  teacherTitle: string;
  phone: string;
  whatsapp: string;
  email: string;
  location: string;
  qrLink: string;
  slogan: string;
  instructions: string[];
  highlights: string[];
  /** Teacher photo + academy logo, as data URLs ('' = use the built-in default). */
  photo: string;
  logo: string;
  /** Logo/photo placement + colours, tuned separately per card set. */
  student: CardAdjust;
  pool: CardAdjust;
  /** The pool's academy side places its logo independently of its student side. */
  poolBack: CardAdjust;
  /** The academy's own pool artwork ('custom' design), as data URLs. */
  artFront: string;
  artBack: string;
  poolArt: PoolArtLayout;
}

/**
 * The card design every tenant starts with. It is also written to the row at
 * signup (see auth.ts) and backfilled for existing tenants by migration 060, so
 * the design is a real, editable record rather than an implicit default — but
 * resolveCardDesign still merges it underneath whatever is stored, so a row that
 * predates a new field (or was never saved) keeps rendering.
 *
 * teacherName is deliberately left empty: resolveCardDesign falls back to the
 * company name, so a tenant that renames itself doesn't keep a stale name on its
 * cards.
 */
export const DEFAULT_CARD_DESIGN: CardDesign = {
  template: 'navy',
  fields: { studentName: true, className: true, courseName: true, school: true, year: true },
  agnosticTemplate: 'aurora',
  teacherName: '',
  teacherTitle: '',
  phone: '',
  whatsapp: '',
  email: '',
  location: '',
  qrLink: '',
  slogan: 'التفوق لا يأتي صدفة\nبل هو نتيجة الإجتهاد والثقة بالله',
  instructions: [
    'يحافظ الطالب على البطاقة وعدم إعارتها.',
    'في حالة فقدان البطاقة يتم إبلاغ المعلم فوراً.',
    'تُستخدم البطاقة في الحضور والانصراف.',
    'المحافظة على البطاقة وعدم العبث بها.',
    'الالتزام بالقوانين دليل على احترامك لنفسك وللآخرين.',
  ],
  highlights: ['شرح مبسط وفهم عميق', 'مراجعات نهائية', 'اختبارات دورية', 'متابعة مستمرة وتقييم شامل'],
  photo: '',
  logo: '',
  student: { ...DEFAULT_CARD_ADJUST },
  pool: { ...DEFAULT_CARD_ADJUST },
  poolBack: { ...DEFAULT_CARD_ADJUST },
  artFront: '',
  artBack: '',
  poolArt: { ...DEFAULT_POOL_ART },
};

/**
 * Merge whatever is stored over the defaults, so a company that has never saved
 * (or that saved before a field existed) still gets a complete, renderable card.
 * teacherName falls back to the company name.
 */
function resolveCardDesign(stored: any, companyName: string): CardDesign {
  const d = stored && typeof stored === 'object' ? stored : {};
  const str = (v: any, fallback: string) => (typeof v === 'string' ? v : fallback);
  const list = (v: any, fallback: string[], cap: number) =>
    Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, cap) : fallback;
  const num = (v: any, lo: number, hi: number, fallback: number) =>
    (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback);
  const bool = (v: any, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  // '' means "use the design's own colour", so a blank has to survive as a blank —
  // only a real hex is honoured, and anything else falls back rather than to black.
  const hex = (v: any, fallback: string) =>
    (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim() : fallback);

  const adjust = (v: any): CardAdjust => {
    const a = v && typeof v === 'object' ? v : {};
    return {
      logoScale: num(a.logoScale, 50, 200, 100),
      logoDx: num(a.logoDx, -120, 120, 0),
      logoDy: num(a.logoDy, -120, 120, 0),
      photoDx: num(a.photoDx, -120, 120, 0),
      photoDy: num(a.photoDy, -120, 120, 0),
      bg: hex(a.bg, ''),
      text: hex(a.text, ''),
      accent: hex(a.accent, ''),
    };
  };

  const poolArt = (v: any): PoolArtLayout => {
    const a = v && typeof v === 'object' ? v : {};
    const p = DEFAULT_POOL_ART;
    // Size first: what has to stay inside the card is the QR's BOX, not its centre.
    const qrSize = num(a.qrSize, 90, 460, p.qrSize);
    const half = qrSize / 2;
    return {
      qrSize,
      qrX: num(a.qrX, 56 + half, 1016 - 56 - half, p.qrX),
      qrY: num(a.qrY, 56 + half, 638 - 56 - half, p.qrY),
      qrTile: bool(a.qrTile, p.qrTile),
      codeX: num(a.codeX, 56, 1016 - 56, p.codeX),
      codeY: num(a.codeY, 56, 638 - 56, p.codeY),
      codeSize: num(a.codeSize, 12, 80, p.codeSize),
      codeColor: hex(a.codeColor, p.codeColor),
      codeChip: bool(a.codeChip, p.codeChip),
    };
  };

  const template: CardTemplateId = CARD_TEMPLATES.includes(d.template)
    ? d.template
    : DEFAULT_CARD_DESIGN.template;

  // Every field the tenant sends has to be named here to survive: updateCardDesign
  // persists this return value, so anything left out is silently dropped on save.
  // agnosticTemplate was missing, which is why the pool-design picker never stuck
  // — the choice validated, then vanished, and every read fell back to 'aurora'.
  const agnosticTemplate: AgnosticTemplateId = AGNOSTIC_TEMPLATES.includes(d.agnosticTemplate)
    ? d.agnosticTemplate
    : DEFAULT_CARD_DESIGN.agnosticTemplate;

  // Which rows the student card's front shows. Absent (a design saved before the
  // toggles existed) means all of them, which is exactly what those cards printed.
  const fields = (v: any): CardFields => {
    const f = v && typeof v === 'object' ? v : {};
    const dflt = DEFAULT_CARD_DESIGN.fields;
    return {
      studentName: bool(f.studentName, dflt.studentName),
      className: bool(f.className, dflt.className),
      courseName: bool(f.courseName, dflt.courseName),
      school: bool(f.school, dflt.school),
      year: bool(f.year, dflt.year),
    };
  };

  return {
    template,
    // NAMED HERE ON PURPOSE, like agnosticTemplate below — omit it and every
    // checkbox validates, vanishes on save, and silently returns to "show all".
    fields: fields(d.fields),
    agnosticTemplate,
    teacherName: str(d.teacherName, '').trim() || companyName,
    teacherTitle: str(d.teacherTitle, DEFAULT_CARD_DESIGN.teacherTitle),
    phone: str(d.phone, DEFAULT_CARD_DESIGN.phone),
    whatsapp: str(d.whatsapp, DEFAULT_CARD_DESIGN.whatsapp),
    email: str(d.email, DEFAULT_CARD_DESIGN.email),
    location: str(d.location, DEFAULT_CARD_DESIGN.location),
    qrLink: str(d.qrLink, DEFAULT_CARD_DESIGN.qrLink),
    slogan: str(d.slogan, DEFAULT_CARD_DESIGN.slogan),
    instructions: list(d.instructions, DEFAULT_CARD_DESIGN.instructions, 5),
    highlights: list(d.highlights, DEFAULT_CARD_DESIGN.highlights, 4),
    photo: str(d.photo, ''),
    logo: str(d.logo, ''),
    // NAMED HERE ON PURPOSE — see the note above. updateCardDesign persists exactly
    // what this returns, so a field missing from this list validates on the way in
    // and is then dropped on the way to the row, which is what silently reset the
    // pool picker for every tenant until agnosticTemplate was added.
    student: adjust(d.student),
    pool: adjust(d.pool),
    // Falls back to `pool`, not to the defaults: a design saved before the two pool
    // faces were split placed both logos with `pool`, and must keep rendering that way.
    poolBack: adjust(d.poolBack ?? d.pool),
    artFront: str(d.artFront, ''),
    artBack: str(d.artBack, ''),
    poolArt: poolArt(d.poolArt),
  };
}

function mapCompanyProfile(row: any) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    email: row.email,
    phone: row.phone,
    address: row.address,
    city: row.city,
    state: row.state,
    zipCode: row.zip_code,
    country: row.country,
    taxId: row.tax_id,
    registrationNumber: row.registration_number,
    industry: row.industry,
    plan: row.plan ?? 'SIMPLE',
    timezone: row.timezone,
    currency: row.currency,
    locale: row.locale,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const companiesRoutes = {
  getProfile: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      const company = await queryOne<any>(
        'SELECT * FROM companies WHERE id = $1',
        [context.companyId]
      );
      if (!company) {
        return apiError(404, 'ERRORS.COMPANIES.NOT_FOUND', 'Company not found');
      }
      const subscription = await queryOne<any>(
        'SELECT status, price, trial_start_date, trial_end_date, subscription_start_date, subscription_end_date FROM subscriptions WHERE company_id = $1',
        [context.companyId]
      );

      return {
        status: 200 as const,
        body: {
          company: mapCompanyProfile(company),
          subscription: subscription
            ? {
                status: subscription.status,
                price: parseFloat(subscription.price || 0),
                trialStartDate: subscription.trial_start_date,
                trialEndDate: subscription.trial_end_date,
                subscriptionStartDate: subscription.subscription_start_date,
                subscriptionEndDate: subscription.subscription_end_date,
              }
            : null,
        },
      };
    } catch (error) {
      console.error('Get company profile error:', error);
      return mapThrownError(error, 'ERRORS.COMPANIES.PROFILE_FAILED', 'Failed to load company profile', 401);
    }
  },

  getSettings: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      await Promise.all([ensureAutoManageSessionsColumn(), ensureAutoConfirmSessionPaymentsColumn(), ensureHomeworkGradingColumn(), ensureFreeTrialLimitColumn(), ensureAutoHomeworkColumn()]);
      const context = await extractTenantContext(headers.authorization);
      const company = await queryOne(
        'SELECT id, name, global_expense_allocation, auto_manage_sessions, auto_confirm_session_payments, homework_grading_mode, free_session_trial_limit, auto_create_homework FROM companies WHERE id = $1',
        [context.companyId]
      );
      if (!company) {
        return apiError(404, 'ERRORS.COMPANIES.NOT_FOUND', 'Company not found');
      }
      return {
        status: 200 as const,
        body: {
          id: company.id,
          name: company.name,
          globalExpenseAllocation: company.global_expense_allocation || 'OVERHEAD',
          autoManageSessions: company.auto_manage_sessions === true,
          autoConfirmSessionPayments: company.auto_confirm_session_payments === true,
          homeworkGradingMode: company.homework_grading_mode === 'RATING' ? 'RATING' : 'NUMERIC',
          freeSessionTrialLimit: parseInt(company.free_session_trial_limit ?? 0, 10) || 0,
          autoCreateHomework: company.auto_create_homework === true,
        },
      };
    } catch (error) {
      console.error('Get company settings error:', error);
      return mapThrownError(error, 'ERRORS.COMPANIES.SETTINGS_FAILED', 'Unauthorized', 401);
    }
  },

  updateSettings: async ({ body, headers }: { body: { globalExpenseAllocation?: string; autoManageSessions?: boolean; autoConfirmSessionPayments?: boolean; homeworkGradingMode?: string; freeSessionTrialLimit?: number; autoCreateHomework?: boolean }; headers: { authorization: string } }) => {
    try {
      await Promise.all([ensureAutoManageSessionsColumn(), ensureAutoConfirmSessionPaymentsColumn(), ensureHomeworkGradingColumn(), ensureFreeTrialLimitColumn(), ensureAutoHomeworkColumn()]);
      const context = await extractTenantContext(headers.authorization);

      if (context.role !== 'ADMIN' && context.role !== 'GLOBAL_ADMIN') {
        return apiError(403, 'ERRORS.COMPANIES.ADMIN_ONLY', 'Only admins can update company settings');
      }

      const updateData: any = {};
      if (body.globalExpenseAllocation !== undefined) {
        updateData.global_expense_allocation = body.globalExpenseAllocation;
      }
      if (body.autoManageSessions !== undefined) {
        updateData.auto_manage_sessions = body.autoManageSessions === true;
      }
      if (body.autoConfirmSessionPayments !== undefined) {
        updateData.auto_confirm_session_payments = body.autoConfirmSessionPayments === true;
      }
      if (body.autoCreateHomework !== undefined) {
        updateData.auto_create_homework = body.autoCreateHomework === true;
      }
      if (body.homeworkGradingMode !== undefined) {
        if (!HOMEWORK_GRADING_MODES.includes(body.homeworkGradingMode as any)) {
          return apiError(400, 'ERRORS.COMPANIES.BAD_GRADING_MODE', 'Unknown homework grading mode');
        }
        updateData.homework_grading_mode = body.homeworkGradingMode;
      }
      if (body.freeSessionTrialLimit !== undefined) {
        // A negative cap would reject every trial while reading as a limit of
        // "minus one"; 0 is the documented way to say unlimited.
        const limit = Number(body.freeSessionTrialLimit);
        if (!Number.isInteger(limit) || limit < 0) {
          return apiError(400, 'ERRORS.COMPANIES.BAD_TRIAL_LIMIT', 'Trial limit must be zero or a positive whole number');
        }
        updateData.free_session_trial_limit = limit;
      }

      const company = await update('companies', context.companyId, updateData);
      if (!company) {
        return apiError(400, 'ERRORS.COMPANIES.UPDATE_FAILED', 'Failed to update settings');
      }

      return {
        status: 200 as const,
        body: {
          id: company.id,
          name: company.name,
          globalExpenseAllocation: company.global_expense_allocation || 'OVERHEAD',
          autoManageSessions: company.auto_manage_sessions === true,
          autoConfirmSessionPayments: company.auto_confirm_session_payments === true,
          homeworkGradingMode: company.homework_grading_mode === 'RATING' ? 'RATING' : 'NUMERIC',
          freeSessionTrialLimit: parseInt(company.free_session_trial_limit ?? 0, 10) || 0,
          autoCreateHomework: company.auto_create_homework === true,
        },
      };
    } catch (error) {
      console.error('Update company settings error:', error);
      return mapThrownError(error, 'ERRORS.COMPANIES.UPDATE_FAILED', 'Failed to update settings', 400);
    }
  },

  /** PATCH /api/companies/contact — the tenant's own phone number.
   *
   *  Kept apart from updateSettings: that one holds accounting switches nobody
   *  touches twice a year, this is a contact detail that changes when a SIM does.
   */
  updateContact: async ({ body, headers }: { body: { phone: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (context.role !== 'ADMIN' && context.role !== 'GLOBAL_ADMIN') {
        return apiError(403, 'ERRORS.COMPANIES.ADMIN_ONLY', 'Only admins can update company details');
      }

      // Accept what people actually type — spaces, dashes, brackets, a leading
      // 00 for the international prefix — and store one canonical shape. 00 maps
      // to '+' because "002…" was reaching the database and rendering as a
      // country code that does not exist.
      const raw = String(body.phone ?? '').trim();
      let phone: string | null = raw
        .replace(/[\s()\-.]/g, '')
        .replace(/^00/, '+');

      if (phone === '') {
        phone = null;                                   // clearing the field is allowed
      } else if (!/^\+?\d{7,17}$/.test(phone)) {
        return apiError(400, 'ERRORS.COMPANIES.INVALID_PHONE', 'Enter a valid phone number');
      }

      const company = await update('companies', context.companyId, { phone });
      if (!company) {
        return apiError(400, 'ERRORS.COMPANIES.UPDATE_FAILED', 'Failed to update company');
      }

      return {
        status: 200 as const,
        body: { id: company.id, phone: company.phone ?? null },
      };
    } catch (error) {
      console.error('Update company contact error:', error);
      return mapThrownError(error, 'ERRORS.COMPANIES.UPDATE_FAILED', 'Failed to update company', 400);
    }
  },

  getCardDesign: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      await ensureCardDesignColumn();
      const context = await extractTenantContext(headers.authorization);
      const company = await queryOne<any>(
        'SELECT name, card_design FROM companies WHERE id = $1',
        [context.companyId]
      );
      if (!company) return apiError(404, 'ERRORS.COMPANIES.NOT_FOUND', 'Company not found');
      return {
        status: 200 as const,
        body: resolveCardDesign(company.card_design, company.name),
      };
    } catch (error) {
      console.error('Get card design error:', error);
      return mapThrownError(error, 'ERRORS.COMPANIES.SETTINGS_FAILED', 'Unauthorized', 401);
    }
  },

  updateCardDesign: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      await ensureCardDesignColumn();
      const context = await extractTenantContext(headers.authorization);

      if (context.role !== 'ADMIN' && context.role !== 'GLOBAL_ADMIN') {
        return apiError(403, 'ERRORS.COMPANIES.ADMIN_ONLY', 'Only admins can update the card design');
      }

      const company = await queryOne<any>('SELECT name FROM companies WHERE id = $1', [context.companyId]);
      if (!company) return apiError(404, 'ERRORS.COMPANIES.NOT_FOUND', 'Company not found');

      const design = resolveCardDesign(body, company.name);
      // Explicit ::jsonb cast — the generic update() helper would bind the object as text.
      await query('UPDATE companies SET card_design = $1::jsonb, updated_at = NOW() WHERE id = $2', [
        JSON.stringify(design),
        context.companyId,
      ]);

      return { status: 200 as const, body: design };
    } catch (error) {
      console.error('Update card design error:', error);
      return mapThrownError(error, 'ERRORS.COMPANIES.UPDATE_FAILED', 'Failed to update card design');
    }
  },

  // Self-service plan change (academies only): SIMPLE ⇄ ADVANCED. ADVANCED
  // unlocks CRM & add-ons. Admin-gated. No billing enforced yet.
  upgradePlan: async ({ body, headers }: { body: { plan?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (context.role !== 'ADMIN' && context.role !== 'GLOBAL_ADMIN') {
        return apiError(403, 'ERRORS.COMPANIES.ADMIN_ONLY', 'Only admins can change the plan');
      }
      const company = await queryOne<any>('SELECT type FROM companies WHERE id = $1', [context.companyId]);
      if (!company) return apiError(404, 'ERRORS.COMPANIES.NOT_FOUND', 'Company not found');
      if (company.type !== 'ACADEMY') {
        return apiError(400, 'ERRORS.COMPANIES.PLAN_ACADEMY_ONLY', 'Plans apply to academies only');
      }
      const plan = body?.plan === 'ADVANCED' ? 'ADVANCED' : 'SIMPLE';
      const updated = await update('companies', context.companyId, { plan });
      if (!updated) return apiError(400, 'ERRORS.COMPANIES.PLAN_UPDATE_FAILED', 'Failed to update plan');
      return { status: 200 as const, body: { plan: updated.plan ?? plan } };
    } catch (error) {
      console.error('Upgrade plan error:', error);
      return mapThrownError(error, 'ERRORS.COMPANIES.PLAN_UPDATE_FAILED', 'Failed to update plan', 400);
    }
  },
};
