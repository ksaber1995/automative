-- Migration 007: Fix expenses category check constraint to include INVENTORY
-- The live DB constraint was missing INVENTORY (added to schema.sql but never migrated)

ALTER TABLE expenses
  DROP CONSTRAINT IF EXISTS expenses_category_check;

ALTER TABLE expenses
  ADD CONSTRAINT expenses_category_check
  CHECK (category IN (
    'SALARIES', 'RENT', 'UTILITIES', 'ELECTRICITY', 'INTERNET', 'WATER',
    'MARKETING', 'SUPPLIES', 'EQUIPMENT', 'MAINTENANCE', 'INSURANCE',
    'SOFTWARE', 'ADMINISTRATION', 'COGS', 'INVENTORY', 'OTHER'
  ));
