import { query } from '../db/connection';

/**
 * The vendor's debugging logins.
 *
 * A debug login gets parked inside a customer's tenant to reproduce what they
 * are seeing, which makes it the one kind of account that is deliberately not
 * where it belongs. Two rules follow from that:
 *
 *  - the tenant-facing user list hides them, so a customer never finds a
 *    stranger sitting in their own company (routes/users.ts);
 *  - they are the only accounts the admin console may move between tenants
 *    (routes/admin-secret.ts) — moving a real user strips their branch, linked
 *    employee and permissions, which is never what anyone means to do.
 *
 * There used to be exactly one, master@master.com, recognised by its email.
 * Debug logins are now marked by `users.is_debug` instead, so each portal user
 * can hold their own (`users.debug_owner_id` names the admin_secret_users row
 * that owns it; NULL means shared — master@master.com stays shared). The email
 * constant remains for the backfill and as belt-and-braces in the tenant list.
 *
 * The admin console keeps its own copy of the shared address
 * (admin/src/app/tenant-users/tenant-users-page.component.ts); it is a separate
 * app and does not share this build.
 */
export const DEBUG_ACCOUNT_EMAIL = 'master@master.com';

/** Case- and whitespace-insensitive, since the value arrives from the DB. */
export function isDebugAccount(email: string | null | undefined): boolean {
  return (email || '').trim().toLowerCase() === DEBUG_ACCOUNT_EMAIL;
}

/**
 * The roles a tenant user account can hold (mirrors the users.role CHECK
 * constraint). Lives here rather than in routes/admin-secret.ts because both
 * that file and routes/admin-portal.ts need it, and admin-secret already
 * imports from admin-portal — the other direction would be a cycle.
 */
export const TENANT_USER_ROLES = [
  'GLOBAL_ADMIN', 'ADMIN', 'ACADEMIC_MANAGER', 'SALES_MANAGER',
  'BRANCH_ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT', 'VIEWER',
];

/** A debug login should see the whole tenant, like master@master.com does. */
export const DEBUG_USER_DEFAULT_ROLE = 'GLOBAL_ADMIN';

/**
 * The columns behind per-portal-user debug logins (migration 108), applied the
 * same idempotent-runtime way as the rest of this API's schema:
 *
 *  - `is_debug`  — marks a vendor debug login. Hidden from the tenant's own
 *    user list, movable between tenants from the console.
 *  - `debug_owner_id` — which admin_secret_users row this debug login belongs
 *    to. NULL means shared (every portal user with tenant_users.read sees it).
 *    No FK: admin_secret_users is itself created lazily at runtime, and
 *    users.branch_id sets the precedent. A deleted portal user's debug logins
 *    are un-owned explicitly (routes/admin-portal.ts deleteUser).
 *
 * The backfill marks master@master.com, the original shared debug login.
 */
let debugColumnsEnsured = false;
export async function ensureDebugUserColumns(): Promise<void> {
  if (debugColumnsEnsured) return;
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_debug BOOLEAN NOT NULL DEFAULT false`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS debug_owner_id UUID`);
  await query(
    `UPDATE users SET is_debug = true WHERE LOWER(TRIM(email)) = $1 AND is_debug = false`,
    [DEBUG_ACCOUNT_EMAIL],
  );
  debugColumnsEnsured = true;
}
