-- 108: Per-portal-user debug logins.
--
-- The vendor's debug login used to be exactly one account, recognised by its
-- email (master@master.com). Debug logins are now marked by a column, so each
-- admin-console (portal) user can hold their own:
--
--   is_debug        marks a vendor debug login. Hidden from the tenant's own
--                   user list (routes/users.ts), and the only kind of account
--                   the admin console lists and moves between tenants.
--   debug_owner_id  which admin_secret_users row owns it. NULL = shared with
--                   every portal user (master@master.com stays shared).
--                   Deliberately no FK: admin_secret_users is created lazily
--                   at runtime, and users.branch_id sets the precedent. A
--                   deleted portal user's debug logins are un-owned explicitly
--                   by the API.
--
-- Applied idempotently at runtime by ensureDebugUserColumns() in
-- aws/lambda/api/src/utils/debug-account.ts — this file is the reference copy
-- for fresh installs.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_debug BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS debug_owner_id UUID;

-- The original shared debug login.
UPDATE users SET is_debug = true
 WHERE LOWER(TRIM(email)) = 'master@master.com' AND is_debug = false;
