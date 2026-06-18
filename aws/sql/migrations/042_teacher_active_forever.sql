-- 042_teacher_active_forever.sql
-- Teacher tenants are "active forever" once activated. ACTIVE subscriptions are
-- never expiry-gated, so for every already-ACTIVE teacher company we clear the
-- end date to make "forever" explicit (and so the profile shows it as such).
-- Idempotent.

UPDATE subscriptions
   SET subscription_end_date = NULL,
       updated_at = NOW()
 WHERE status = 'ACTIVE'
   AND company_id IN (SELECT id FROM companies WHERE type = 'TEACHER');
