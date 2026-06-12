-- Migration 033: track how many units a product-sale refund returned to stock.
-- When a customer returns the physical product as part of a refund, we add the
-- units back to products.stock. restock_quantity records how many units this
-- refund put back so cumulative restocks can never exceed the sale quantity.

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS restock_quantity INTEGER NOT NULL DEFAULT 0;
