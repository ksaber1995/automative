/**
 * Tenant Isolation Middleware
 *
 * Provides multi-tenant security by extracting company context from JWT tokens
 * and enforcing data isolation between companies.
 *
 * All protected routes MUST use extractTenantContext() to ensure proper tenant isolation.
 */

import { verifyToken, extractTokenFromHeader, JWTPayload } from '../utils/jwt';

/**
 * Tenant context extracted from JWT token
 * Contains all information needed for tenant-scoped queries
 */
export interface TenantContext {
  userId: string;
  email: string;
  role: string;
  companyId: string;  // Mandatory - used for all queries
  branchId?: string | null;
}

/**
 * Extracts and verifies tenant context from JWT token
 *
 * CRITICAL: All protected routes must use this function
 * to ensure proper multi-tenant data isolation.
 *
 * @param authHeader - Authorization header from request (format: "Bearer <token>")
 * @returns TenantContext containing company ID and user information
 * @throws Error if no token provided or token is invalid/missing companyId
 *
 * @example
 * const context = await extractTenantContext(headers.authorization);
 * const students = await query(
 *   'SELECT * FROM students WHERE company_id = $1',
 *   [context.companyId]
 * );
 */
export async function extractTenantContext(
  authHeader?: string
): Promise<TenantContext> {
  const token = extractTokenFromHeader(authHeader);

  if (!token) {
    throw new Error('No authentication token provided');
  }

  const decoded = await verifyToken(token);

  // Enforce companyId presence - tokens without companyId are invalid
  if (!decoded.companyId) {
    throw new Error('Invalid token: missing company context');
  }

  return {
    userId: decoded.id,
    email: decoded.email,
    role: decoded.role,
    companyId: decoded.companyId,
    branchId: decoded.branchId,
  };
}

/**
 * Validates that a resource belongs to the tenant's company
 *
 * Use this when accessing resources by ID to ensure they belong
 * to the same company as the requesting user.
 *
 * @param companyId - The company ID from tenant context
 * @param tableName - Name of the table to check
 * @param resourceId - ID of the resource to validate
 * @returns true if resource belongs to company, false otherwise
 *
 * @example
 * const isValid = await validateCompanyOwnership(
 *   context.companyId,
 *   'students',
 *   studentId
 * );
 * if (!isValid) {
 *   return { status: 404, body: { message: 'Student not found' } };
 * }
 */
export async function validateCompanyOwnership(
  companyId: string,
  tableName: string,
  resourceId: string
): Promise<boolean> {
  const { queryOne } = await import('../db/connection');

  const result = await queryOne(
    `SELECT id FROM ${tableName} WHERE id = $1 AND company_id = $2`,
    [resourceId, companyId]
  );

  return !!result;
}

/**
 * Role-based access control check
 *
 * Verifies if the current user has one of the required roles
 *
 * @param context - Tenant context from extractTenantContext()
 * @param requiredRoles - Array of roles that are allowed
 * @returns true if user has required role, false otherwise
 *
 * @example
 * if (!checkPermission(context, ['ADMIN', 'BRANCH_MANAGER'])) {
 *   return { status: 403, body: { message: 'Access denied' } };
 * }
 */
export function checkPermission(
  context: TenantContext,
  requiredRoles: string[]
): boolean {
  return requiredRoles.includes(context.role);
}

/**
 * Branch-level access control
 *
 * Ensures users can only access data from their assigned branch,
 * unless they're ADMIN (company-wide access)
 *
 * @param context - Tenant context from extractTenantContext()
 * @param targetBranchId - Branch ID user is trying to access
 * @returns true if user can access the branch, false otherwise
 *
 * @example
 * if (queryParams.branchId && !canAccessBranch(context, queryParams.branchId)) {
 *   return { status: 403, body: { message: 'Access denied to this branch' } };
 * }
 */
export function canAccessBranch(
  context: TenantContext,
  targetBranchId: string
): boolean {
  // ADMINs have company-wide access to all branches
  if (context.role === 'ADMIN') {
    return true;
  }

  // Other roles can only access their own branch
  return context.branchId === targetBranchId;
}

/**
 * Helper to build company-scoped WHERE clause
 *
 * @param companyId - Company ID from tenant context
 * @param additionalConditions - Optional additional WHERE conditions
 * @returns SQL WHERE clause with company_id filter
 *
 * @example
 * const whereClause = buildCompanyFilter(context.companyId, 'is_active = true');
 * // Returns: "WHERE company_id = '<uuid>' AND is_active = true"
 */
export function buildCompanyFilter(
  companyId: string,
  additionalConditions?: string
): string {
  let clause = `WHERE company_id = '${companyId}'`;

  if (additionalConditions) {
    clause += ` AND ${additionalConditions}`;
  }

  return clause;
}

/**
 * Apply branch-level filtering based on user role
 *
 * ADMINs see all branches in their company
 * Other roles only see their assigned branch
 *
 * @param context - Tenant context
 * @param requestedBranchId - Optional branch ID from query params
 * @returns Branch ID to filter by, or null for company-wide access
 *
 * @example
 * const branchFilter = getBranchFilter(context, queryParams.branchId);
 * if (branchFilter) {
 *   sql += ' AND branch_id = $2';
 *   params.push(branchFilter);
 * }
 */
export function getBranchFilter(
  context: TenantContext,
  requestedBranchId?: string
): string | null {
  // ADMIN can request specific branch or see all
  if (context.role === 'ADMIN') {
    return requestedBranchId || null;
  }

  // Non-admins are restricted to their own branch
  return context.branchId || null;
}
