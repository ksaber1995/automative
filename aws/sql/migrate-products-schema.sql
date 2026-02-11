-- Migration to update products table schema
-- Run this migration to update existing products table

-- Step 1: Add new columns
ALTER TABLE products ADD COLUMN IF NOT EXISTS category VARCHAR(50);
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit VARCHAR(50);
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_global BOOLEAN DEFAULT false;

-- Step 2: Rename columns
ALTER TABLE products RENAME COLUMN price TO selling_price;
ALTER TABLE products RENAME COLUMN cost TO cost_price;
ALTER TABLE products RENAME COLUMN stock_quantity TO stock;
ALTER TABLE products RENAME COLUMN min_stock_level TO min_stock;

-- Step 3: Update NOT NULL constraints and defaults
ALTER TABLE products ALTER COLUMN code SET NOT NULL;
ALTER TABLE products ALTER COLUMN description SET NOT NULL;
ALTER TABLE products ALTER COLUMN cost_price SET NOT NULL;
ALTER TABLE products ALTER COLUMN stock SET NOT NULL;
ALTER TABLE products ALTER COLUMN stock SET DEFAULT 0;
ALTER TABLE products ALTER COLUMN min_stock SET NOT NULL;
ALTER TABLE products ALTER COLUMN min_stock SET DEFAULT 0;
ALTER TABLE products ALTER COLUMN is_global SET NOT NULL;
ALTER TABLE products ALTER COLUMN is_global SET DEFAULT false;

-- Step 4: Make branch_id nullable (for global products)
ALTER TABLE products ALTER COLUMN branch_id DROP NOT NULL;

-- Step 5: Update existing data with default values
UPDATE products SET category = 'OTHER' WHERE category IS NULL;
UPDATE products SET unit = 'piece' WHERE unit IS NULL;
UPDATE products SET is_global = false WHERE is_global IS NULL;
UPDATE products SET cost_price = selling_price * 0.7 WHERE cost_price IS NULL;

-- Step 6: Set NOT NULL constraints for new columns
ALTER TABLE products ALTER COLUMN category SET NOT NULL;
ALTER TABLE products ALTER COLUMN unit SET NOT NULL;

-- Step 7: Add CHECK constraint for global products
ALTER TABLE products ADD CONSTRAINT check_global_products
  CHECK ((is_global = true AND branch_id IS NULL) OR (is_global = false AND branch_id IS NOT NULL));

-- Step 8: Drop and recreate unique constraint
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_branch_id_code_key;
ALTER TABLE products ADD CONSTRAINT products_branch_id_code_key UNIQUE(branch_id, code);
