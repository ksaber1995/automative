-- Migration 024: Make branch_id nullable in product_sales
-- Branch is already recorded on the product itself, so it is not required on the sale.

ALTER TABLE product_sales ALTER COLUMN branch_id DROP NOT NULL;

-- Re-create FK as SET NULL so deleting a branch does not cascade-delete sales history
ALTER TABLE product_sales DROP CONSTRAINT IF EXISTS product_sales_branch_id_fkey;
ALTER TABLE product_sales
  ADD CONSTRAINT product_sales_branch_id_fkey
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;
