-- Migration 025: Add stock_purchases table to track inventory restock history
CREATE TABLE stock_purchases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL,
  cost_per_unit DECIMAL(10, 2) NOT NULL,
  total_cost DECIMAL(10, 2) NOT NULL,
  date DATE NOT NULL,
  notes TEXT,
  expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_stock_purchases_product ON stock_purchases(product_id);
CREATE INDEX idx_stock_purchases_company ON stock_purchases(company_id);
CREATE INDEX idx_stock_purchases_date ON stock_purchases(date);
