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

interface CardDesign {
  template: CardTemplateId;
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

  return {
    template,
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
      await ensureAutoManageSessionsColumn();
      const context = await extractTenantContext(headers.authorization);
      const company = await queryOne(
        'SELECT id, name, global_expense_allocation, auto_manage_sessions FROM companies WHERE id = $1',
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
        },
      };
    } catch (error) {
      console.error('Get company settings error:', error);
      return mapThrownError(error, 'ERRORS.COMPANIES.SETTINGS_FAILED', 'Unauthorized', 401);
    }
  },

  updateSettings: async ({ body, headers }: { body: { globalExpenseAllocation?: string; autoManageSessions?: boolean }; headers: { authorization: string } }) => {
    try {
      await ensureAutoManageSessionsColumn();
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
