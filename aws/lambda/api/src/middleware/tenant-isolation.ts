/**
 * Tenant Isolation Middleware
 *
 * Multi-tenant security with full RBAC support:
 *   GLOBAL_ADMIN, BRANCH_ADMIN (multi-branch), ACADEMIC_MANAGER,
 *   SALES_MANAGER, VIEWER, ACCOUNTANT (legacy: ADMIN, BRANCH_MANAGER)
 */

import { verifyToken, extractTokenFromHeader } from '../utils/jwt';

// ─── Permission types (inlined to avoid cross-rootDir imports) ──────────────

type PermissionResource =
  | 'dashboard' | 'branches' | 'courses' | 'classes' | 'students'
  | 'enrollments' | 'employees' | 'revenues' | 'expenses' | 'withdrawals'
  | 'refunds' | 'debts' | 'products' | 'product_sales' | 'reports' | 'users'
  | 'master_courses' | 'events';

type PermissionAction = 'read' | 'write' | 'delete';

interface ResourcePermission { read: boolean; write: boolean; delete: boolean; }
type UserPermissions = Partial<Record<PermissionResource, Partial<ResourcePermission>>>;

const FULL: ResourcePermission = { read: true, write: true, delete: true };
const READ_WRITE: ResourcePermission = { read: true, write: true, delete: false };
const READ_ONLY: ResourcePermission = { read: true, write: false, delete: false };
const NO_ACCESS: ResourcePermission = { read: false, write: false, delete: false };

const ROLE_DEFAULTS: Record<string, UserPermissions> = {
  GLOBAL_ADMIN: {
    dashboard: FULL, branches: FULL, courses: FULL, classes: FULL,
    students: FULL, enrollments: FULL, employees: FULL, revenues: FULL,
    expenses: FULL, withdrawals: FULL, refunds: FULL, debts: FULL,
    products: FULL, product_sales: FULL, reports: FULL, users: FULL,
    master_courses: FULL,
    events: FULL,
  },
  ADMIN: {
    dashboard: FULL, branches: FULL, courses: FULL, classes: FULL,
    students: FULL, enrollments: FULL, employees: FULL, revenues: FULL,
    expenses: FULL, withdrawals: FULL, refunds: FULL, debts: FULL,
    products: FULL, product_sales: FULL, reports: FULL, users: FULL,
    master_courses: FULL,
    events: FULL,
  },
  BRANCH_ADMIN: {
    dashboard: READ_ONLY, branches: READ_ONLY, courses: FULL, classes: FULL,
    students: FULL, enrollments: FULL, employees: FULL, revenues: FULL,
    expenses: FULL, withdrawals: FULL, refunds: FULL, debts: FULL,
    products: FULL, product_sales: FULL, reports: READ_ONLY, users: NO_ACCESS,
    master_courses: READ_WRITE,
    events: FULL,
  },
  BRANCH_MANAGER: {
    dashboard: READ_ONLY, branches: READ_ONLY, courses: FULL, classes: FULL,
    students: FULL, enrollments: FULL, employees: FULL, revenues: FULL,
    expenses: FULL, withdrawals: FULL, refunds: FULL, debts: FULL,
    products: FULL, product_sales: FULL, reports: READ_ONLY, users: NO_ACCESS,
    master_courses: READ_WRITE,
    events: FULL,
  },
  ACADEMIC_MANAGER: {
    dashboard: READ_ONLY, branches: READ_ONLY, courses: FULL, classes: FULL,
    students: FULL, enrollments: READ_WRITE, employees: READ_ONLY,
    revenues: NO_ACCESS, expenses: NO_ACCESS, withdrawals: NO_ACCESS,
    refunds: NO_ACCESS, debts: NO_ACCESS, products: READ_ONLY,
    product_sales: NO_ACCESS, reports: NO_ACCESS, users: NO_ACCESS,
    master_courses: FULL,
    events: FULL,
  },
  SALES_MANAGER: {
    dashboard: READ_ONLY, branches: READ_ONLY, courses: READ_ONLY, classes: READ_ONLY,
    students: READ_WRITE, enrollments: READ_WRITE, employees: READ_ONLY,
    revenues: NO_ACCESS, expenses: NO_ACCESS, withdrawals: NO_ACCESS,
    refunds: NO_ACCESS, debts: NO_ACCESS, products: FULL,
    product_sales: FULL, reports: NO_ACCESS, users: NO_ACCESS,
    master_courses: READ_ONLY,
    events: READ_ONLY,
  },
  ACCOUNTANT: {
    dashboard: READ_ONLY, branches: READ_ONLY, courses: READ_ONLY, classes: READ_ONLY,
    students: READ_ONLY, enrollments: READ_ONLY, employees: READ_ONLY,
    revenues: FULL, expenses: FULL, withdrawals: FULL, refunds: FULL,
    debts: FULL, products: READ_ONLY, product_sales: READ_ONLY,
    reports: FULL, users: NO_ACCESS,
    master_courses: READ_ONLY,
    events: READ_ONLY,
  },
  VIEWER: {
    dashboard: READ_ONLY, branches: READ_ONLY, courses: READ_ONLY, classes: READ_ONLY,
    students: READ_ONLY, enrollments: READ_ONLY, employees: NO_ACCESS,
    revenues: NO_ACCESS, expenses: NO_ACCESS, withdrawals: NO_ACCESS,
    refunds: NO_ACCESS, debts: NO_ACCESS, products: READ_ONLY,
    product_sales: NO_ACCESS, reports: NO_ACCESS, users: NO_ACCESS,
    master_courses: READ_ONLY,
    events: READ_ONLY,
  },
};

// ─── Tenant Context ──────────────────────────────────────────────────────────

export interface TenantContext {
  userId: string;
  email: string;
  role: string;
  companyId: string;
  branchId?: string | null;
  branchIds?: string[];
  permissions?: UserPermissions | null;
}

const AUTH_ERROR_MESSAGES = [
  'No authentication token provided',
  'Invalid token',
  'Invalid token: missing company context',
  'Invalid refresh token',
];

export function isAuthError(error: unknown): boolean {
  return AUTH_ERROR_MESSAGES.includes(error instanceof Error ? error.message : '');
}

const SUBSCRIPTION_ERROR_MESSAGES = ['Trial period expired', 'Subscription expired'];

export function isSubscriptionError(error: unknown): boolean {
  return SUBSCRIPTION_ERROR_MESSAGES.includes(error instanceof Error ? error.message : '');
}

export async function extractTenantContext(authHeader?: string): Promise<TenantContext> {
  const token = extractTokenFromHeader(authHeader);
  if (!token) throw new Error('No authentication token provided');

  const decoded = await verifyToken(token);
  if (!decoded.companyId) throw new Error('Invalid token: missing company context');

  const { queryOne, query } = await import('../db/connection');

  // Check subscription
  const subscription = await queryOne<any>(
    'SELECT status, trial_end_date, subscription_end_date FROM subscriptions WHERE company_id = $1',
    [decoded.companyId]
  );
  if (subscription) {
    const today = new Date().toISOString().split('T')[0];
    if (subscription.status === 'TRIAL') {
      const end = subscription.trial_end_date?.toISOString?.()?.split('T')[0] ?? subscription.trial_end_date;
      if (end && end < today) throw new Error('Trial period expired');
    } else if (subscription.status === 'MONTHLY' || subscription.status === 'ANNUAL') {
      const end = subscription.subscription_end_date?.toISOString?.()?.split('T')[0] ?? subscription.subscription_end_date;
      if (end && end < today) throw new Error('Subscription expired');
    }
  }

  // Fetch branch IDs from junction table
  let branchIds: string[] = [];
  try {
    const rows = await query<any>(
      'SELECT branch_id FROM user_branches WHERE user_id = $1 AND company_id = $2',
      [decoded.id, decoded.companyId]
    );
    branchIds = rows.map((r: any) => r.branch_id);
  } catch {
    if (decoded.branchId) branchIds = [decoded.branchId];
  }
  if (branchIds.length === 0 && decoded.branchId) branchIds = [decoded.branchId];

  return {
    userId: decoded.id,
    email: decoded.email,
    role: decoded.role,
    companyId: decoded.companyId,
    branchId: decoded.branchId,
    branchIds,
    permissions: (decoded.permissions as UserPermissions) ?? null,
  };
}

export async function validateCompanyOwnership(
  companyId: string,
  tableName: string,
  resourceId: string
): Promise<boolean> {
  const { queryOne } = await import('../db/connection');
  return !!(await queryOne(
    `SELECT id FROM ${tableName} WHERE id = $1 AND company_id = $2`,
    [resourceId, companyId]
  ));
}

export function checkPermission(context: TenantContext, requiredRoles: string[]): boolean {
  return requiredRoles.includes(context.role);
}

export function isGlobalAdmin(context: TenantContext): boolean {
  return context.role === 'GLOBAL_ADMIN' || context.role === 'ADMIN';
}

export function checkGranularPermission(
  context: TenantContext,
  resource: PermissionResource,
  action: PermissionAction
): boolean {
  const custom = context.permissions?.[resource]?.[action];
  if (custom !== undefined) return custom as boolean;
  return ROLE_DEFAULTS[context.role]?.[resource]?.[action] ?? false;
}

export function canAccessBranch(context: TenantContext, targetBranchId: string): boolean {
  if (isGlobalAdmin(context)) return true;
  if (context.role === 'BRANCH_ADMIN' || context.role === 'BRANCH_MANAGER') {
    return (context.branchIds ?? []).includes(targetBranchId);
  }
  return context.branchId === targetBranchId;
}

export function getBranchFilter(context: TenantContext, requestedBranchId?: string): string | null {
  if (isGlobalAdmin(context)) return requestedBranchId || null;
  if (context.role === 'BRANCH_ADMIN' || context.role === 'BRANCH_MANAGER') {
    if (requestedBranchId) {
      return (context.branchIds ?? []).includes(requestedBranchId) ? requestedBranchId : null;
    }
    return context.branchIds?.[0] || context.branchId || null;
  }
  return context.branchId || null;
}

export function getBranchSqlFilter(context: TenantContext, columnAlias = 'branch_id'): string | null {
  if (isGlobalAdmin(context)) return null;
  if (
    (context.role === 'BRANCH_ADMIN' || context.role === 'BRANCH_MANAGER') &&
    context.branchIds && context.branchIds.length > 0
  ) {
    if (context.branchIds.length === 1) return `${columnAlias} = '${context.branchIds[0]}'`;
    return `${columnAlias} IN (${context.branchIds.map(id => `'${id}'`).join(', ')})`;
  }
  if (context.branchId) return `${columnAlias} = '${context.branchId}'`;
  return null;
}

export function buildCompanyFilter(companyId: string, additionalConditions?: string): string {
  let clause = `WHERE company_id = '${companyId}'`;
  if (additionalConditions) clause += ` AND ${additionalConditions}`;
  return clause;
}
