/**
 * The vendor's debugging login.
 *
 * It gets parked inside a customer's tenant to reproduce what they are seeing,
 * which makes it the one account that is deliberately not where it belongs. Two
 * rules follow from that, and both name this constant rather than the literal:
 *
 *  - the tenant-facing user list hides it, so a customer never finds a stranger
 *    sitting in their own company (routes/users.ts);
 *  - it is the only account the admin console may move between tenants
 *    (routes/admin-secret.ts) — moving a real user strips their branch, linked
 *    employee and permissions, which is never what anyone means to do.
 *
 * The admin console keeps its own copy (admin/src/app/app.component.ts); it is a
 * separate app and does not share this build.
 */
export const DEBUG_ACCOUNT_EMAIL = 'master@master.com';

/** Case- and whitespace-insensitive, since the value arrives from the DB. */
export function isDebugAccount(email: string | null | undefined): boolean {
  return (email || '').trim().toLowerCase() === DEBUG_ACCOUNT_EMAIL;
}
