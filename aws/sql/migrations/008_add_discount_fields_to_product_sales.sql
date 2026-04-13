-- Migration 008: Add missing columns to product_sales table
-- discount_type, discount_value, discount_amount, subtotal, receipt_number, customer_phone
-- were in schema.sql but never applied to the live DB

ALTER TABLE product_sales
  ADD COLUMN IF NOT EXISTS discount_type VARCHAR(50) DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS discount_value DECIMAL(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subtotal DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS receipt_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(50);
