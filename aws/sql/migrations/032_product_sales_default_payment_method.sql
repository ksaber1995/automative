-- Migration 032: default product_sales.payment_method to CASH
-- Existing rows with a NULL payment_method render as the broken i18n key
-- "PRODUCTS.SALES.METHOD_null" in the sales history UI. Backfill them to CASH
-- and set a column default so future inserts can never be NULL again.

ALTER TABLE product_sales ALTER COLUMN payment_method SET DEFAULT 'CASH';

UPDATE product_sales SET payment_method = 'CASH' WHERE payment_method IS NULL;
