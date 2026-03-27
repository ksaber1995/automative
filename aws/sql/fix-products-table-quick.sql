-- Quick fix for products table - Run this if you have direct DB access
-- This will update the products table to match the expected schema

-- Check current columns first
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'products'
ORDER BY ordinal_position;

-- Add new columns if they don't exist
ALTER TABLE products ADD COLUMN IF NOT EXISTS category VARCHAR(50);
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit VARCHAR(50);
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_global BOOLEAN DEFAULT false;

-- Rename old columns to new names (only if they exist with old names)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'price') THEN
        ALTER TABLE products RENAME COLUMN price TO selling_price;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'cost') THEN
        ALTER TABLE products RENAME COLUMN cost TO cost_price;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'stock_quantity') THEN
        ALTER TABLE products RENAME COLUMN stock_quantity TO stock;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'min_stock_level') THEN
        ALTER TABLE products RENAME COLUMN min_stock_level TO min_stock;
    END IF;
END $$;

-- Update NULL values with defaults
UPDATE products SET category = 'OTHER' WHERE category IS NULL;
UPDATE products SET unit = 'piece' WHERE unit IS NULL;
UPDATE products SET is_global = false WHERE is_global IS NULL;

-- Set NOT NULL constraints and defaults
ALTER TABLE products ALTER COLUMN category SET NOT NULL;
ALTER TABLE products ALTER COLUMN unit SET NOT NULL;
ALTER TABLE products ALTER COLUMN stock SET NOT NULL;
ALTER TABLE products ALTER COLUMN stock SET DEFAULT 0;
ALTER TABLE products ALTER COLUMN min_stock SET NOT NULL;
ALTER TABLE products ALTER COLUMN min_stock SET DEFAULT 0;
ALTER TABLE products ALTER COLUMN is_global SET NOT NULL;
ALTER TABLE products ALTER COLUMN is_global SET DEFAULT false;

-- Make branch_id nullable for global products
ALTER TABLE products ALTER COLUMN branch_id DROP NOT NULL;

-- Add CHECK constraint (ignore if already exists)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_global_products') THEN
        ALTER TABLE products ADD CONSTRAINT check_global_products
        CHECK ((is_global = true AND branch_id IS NULL) OR (is_global = false AND branch_id IS NOT NULL));
    END IF;
END $$;

-- Verify the result
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'products'
ORDER BY ordinal_position;

SELECT 'Migration completed successfully!' as status;
