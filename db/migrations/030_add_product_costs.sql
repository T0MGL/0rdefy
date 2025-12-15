-- ================================================================
-- MIGRATION 030: Add granular cost tracking to products
-- ================================================================

-- Add packaging_cost and additional_cost columns to products table
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS packaging_cost DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS additional_cost DECIMAL(10,2) DEFAULT 0;

COMMENT ON COLUMN products.packaging_cost IS 'Cost of packaging materials per unit';
COMMENT ON COLUMN products.additional_cost IS 'Other per-unit costs (labels, handling, etc)';
