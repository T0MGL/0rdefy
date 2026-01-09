-- ================================================================
-- Migration: 046_delivery_amount_discrepancy
-- Description: Add fields to track when courier collects a different amount than expected
-- Date: 2026-01-09
-- ================================================================

-- Add columns to orders table for tracking amount discrepancies
ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount_collected NUMERIC(12, 2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS has_amount_discrepancy BOOLEAN DEFAULT FALSE;

-- Add comment explaining the fields
COMMENT ON COLUMN orders.amount_collected IS 'Actual amount collected by courier (if different from cod_amount)';
COMMENT ON COLUMN orders.has_amount_discrepancy IS 'Flag indicating courier collected a different amount than expected';

-- Create index for filtering orders with discrepancies
CREATE INDEX IF NOT EXISTS idx_orders_amount_discrepancy
ON orders (store_id, has_amount_discrepancy)
WHERE has_amount_discrepancy = TRUE;

-- Create a view for easy querying of orders with discrepancies
CREATE OR REPLACE VIEW orders_with_amount_discrepancy AS
SELECT
    o.id,
    o.store_id,
    o.shopify_order_id,
    o.shopify_order_number,
    o.customer_first_name,
    o.customer_last_name,
    o.customer_phone,
    o.cod_amount AS expected_amount,
    o.amount_collected,
    (o.amount_collected - COALESCE(o.cod_amount, 0)) AS discrepancy_amount,
    o.payment_method,
    o.courier_id,
    c.name AS carrier_name,
    o.delivered_at,
    o.created_at
FROM orders o
LEFT JOIN carriers c ON o.courier_id = c.id
WHERE o.has_amount_discrepancy = TRUE
  AND o.sleeves_status = 'delivered'
ORDER BY o.delivered_at DESC;

COMMENT ON VIEW orders_with_amount_discrepancy IS 'View showing all delivered orders where courier collected a different amount than expected';

-- ================================================================
-- Success message
-- ================================================================
DO $$
BEGIN
    RAISE NOTICE '✅ Migration 046: Delivery amount discrepancy fields added successfully';
END $$;
