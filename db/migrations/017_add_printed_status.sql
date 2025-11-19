-- ================================================================
-- ORDEFY - ADD PRINTED STATUS TO ORDERS
-- ================================================================
-- Adds tracking for when shipping labels are printed
-- ================================================================

-- Add printed status fields to orders table
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS printed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS printed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS printed_by VARCHAR(100);

-- Add comments for documentation
COMMENT ON COLUMN orders.printed IS 'Whether the shipping label has been printed';
COMMENT ON COLUMN orders.printed_at IS 'Timestamp when label was first printed';
COMMENT ON COLUMN orders.printed_by IS 'User who printed the label (email or name)';

-- Create index for quick lookups of unprinted orders
CREATE INDEX IF NOT EXISTS idx_orders_printed ON orders(store_id, printed);

-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================
