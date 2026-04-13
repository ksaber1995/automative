-- Migration 009: Add product_sale_id to expenses table
-- Was in schema.sql but never applied to the live DB

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS product_sale_id UUID REFERENCES product_sales(id) ON DELETE SET NULL;
