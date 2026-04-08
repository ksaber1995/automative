-- ============================================================
-- Migration 006: RBAC System
-- Adds: linked_employee_id, permissions JSONB to users
--       user_branches junction table for multi-branch support
--       Updates role CHECK constraint with new role values
--       Migrates ADMIN → GLOBAL_ADMIN
-- ============================================================

-- 1. Add linked_employee_id
ALTER TABLE users ADD COLUMN IF NOT EXISTS
  linked_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_linked_employee_id ON users(linked_employee_id);

-- 2. Add permissions JSONB
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT NULL;

-- 3. Drop old role CHECK constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- 4. Add new role CHECK constraint
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  role IN (
    'GLOBAL_ADMIN', 'BRANCH_ADMIN', 'ACADEMIC_MANAGER', 'SALES_MANAGER', 'VIEWER',
    'ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT'
  )
);

-- 5. Create user_branches junction table
CREATE TABLE IF NOT EXISTS user_branches (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id   UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_user_branches_user_id ON user_branches(user_id);
CREATE INDEX IF NOT EXISTS idx_user_branches_branch_id ON user_branches(branch_id);
CREATE INDEX IF NOT EXISTS idx_user_branches_company_id ON user_branches(company_id);

-- 6. Migrate existing ADMIN users to GLOBAL_ADMIN
UPDATE users SET role = 'GLOBAL_ADMIN' WHERE role = 'ADMIN';

-- 7. Backfill user_branches from existing branch_id on users
INSERT INTO user_branches (user_id, branch_id, company_id)
SELECT u.id, u.branch_id, u.company_id
FROM users u
WHERE u.branch_id IS NOT NULL
  AND u.role NOT IN ('GLOBAL_ADMIN')
ON CONFLICT (user_id, branch_id) DO NOTHING;
