-- Migration 016: Remove global products concept
--
-- Products are always branch-scoped. The `is_global` flag is dropped, and any
-- existing global rows are removed (cascading through product_sales and
-- inventory-expense backlinks). Linked product_sales rely on FK CASCADE, and
-- expenses.product_id uses SET NULL.

-- 1. Drop the check constraint that enforced is_global/branch_id symmetry.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_check;

-- 2. Delete rows that can't satisfy the new NOT NULL on branch_id. These are
--    exactly the old global products.
DELETE FROM products WHERE is_global = true OR branch_id IS NULL;

-- 3. Enforce branch scope + drop the column.
ALTER TABLE products ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE products DROP COLUMN IF EXISTS is_global;

DROP INDEX IF EXISTS idx_products_is_global;
