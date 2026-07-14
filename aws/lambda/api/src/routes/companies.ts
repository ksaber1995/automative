import { query, queryOne, update } from '../db/connection';
import { extractTenantContext } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

// Auto start/end sessions on schedule (opt-in per company). Added idempotently
// at runtime so the setting works even before a SQL migration is applied.
let autoManageColumnInitPromise: Promise<void> | null = null;
export async function ensureAutoManageSessionsColumn(): Promise<void> {
  if (!autoManageColumnInitPromise) {
    autoManageColumnInitPromise = (async () => {
      try {
        await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS auto_manage_sessions BOOLEAN NOT NULL DEFAULT FALSE`);
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

interface CardDesign {
  template: CardTemplateId;
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

  const template: CardTemplateId = CARD_TEMPLATES.includes(d.template)
    ? d.template
    : DEFAULT_CARD_DESIGN.template;

  return {
    template,
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
