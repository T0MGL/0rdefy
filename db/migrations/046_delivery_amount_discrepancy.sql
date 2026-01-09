-- ================================================================
-- Migration: 046_delivery_amount_discrepancy
-- Description: Add fields to track when courier collects a different amount than expected
-- Date: 2026-01-09
-- ================================================================
--
-- PAYMENT TYPE LOGIC:
--
-- COD (Cash on Delivery): efectivo, cash, contra entrega
--   - Courier collects cash from customer
--   - amount_collected = actual cash received
--   - has_amount_discrepancy = true if amount_collected != cod_amount
--   - Used in settlement: courier owes store (amount_collected - carrier_fee)
--
-- PREPAID (tarjeta, qr, transferencia, online):
--   - Payment already received by store
--   - amount_collected = 0 (courier doesn't collect anything)
--   - has_amount_discrepancy = false (no discrepancy possible)
--   - Used in settlement: store owes courier the carrier_fee
--
-- ================================================================

-- Add columns to orders table for tracking amount discrepancies
ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount_collected NUMERIC(12, 2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS has_amount_discrepancy BOOLEAN DEFAULT FALSE;

-- Add comment explaining the fields
COMMENT ON COLUMN orders.amount_collected IS 'Actual amount collected by courier. For COD: cash received. For PREPAID: always 0 (payment already in store account).';
COMMENT ON COLUMN orders.has_amount_discrepancy IS 'Flag indicating COD order where courier collected different amount than expected. Always FALSE for prepaid orders.';

-- Create index for filtering orders with discrepancies
CREATE INDEX IF NOT EXISTS idx_orders_amount_discrepancy
ON orders (store_id, has_amount_discrepancy)
WHERE has_amount_discrepancy = TRUE;

-- Create a view for easy querying of orders with discrepancies (COD only)
-- Drop first to allow column changes
DROP VIEW IF EXISTS orders_with_amount_discrepancy;
CREATE VIEW orders_with_amount_discrepancy AS
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
    (o.amount_collected - COALESCE(o.cod_amount, o.total_price, 0)) AS discrepancy_amount,
    o.payment_method,
    -- Determine if COD based on payment_method
    CASE
        WHEN LOWER(COALESCE(o.payment_method, '')) IN ('efectivo', 'cash', 'contra entrega', 'cod', '')
        THEN TRUE
        ELSE FALSE
    END AS is_cod,
    o.courier_id,
    c.name AS carrier_name,
    o.delivered_at,
    o.created_at
FROM orders o
LEFT JOIN carriers c ON o.courier_id = c.id
WHERE o.has_amount_discrepancy = TRUE
  AND o.sleeves_status = 'delivered'
  -- Only show COD orders with discrepancies (prepaid orders should never have discrepancies)
  AND LOWER(COALESCE(o.payment_method, '')) IN ('efectivo', 'cash', 'contra entrega', 'cod', '')
ORDER BY o.delivered_at DESC;

COMMENT ON VIEW orders_with_amount_discrepancy IS 'View showing delivered COD orders where courier collected a different amount than expected. Prepaid orders are excluded as they should never have amount discrepancies.';

-- ================================================================
-- Add missing total_cod_expected column to daily_settlements
-- This column is needed for manual reconciliation to track expected vs collected
-- ================================================================
ALTER TABLE daily_settlements ADD COLUMN IF NOT EXISTS total_cod_expected DECIMAL(12,2) DEFAULT 0;
COMMENT ON COLUMN daily_settlements.total_cod_expected IS 'Total COD amount expected from delivered orders (before any discrepancies)';

-- ================================================================
-- Add missing shipped_at column to orders
-- This column is needed for dispatch/settlement to track when order was shipped
-- ================================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMP;
COMMENT ON COLUMN orders.shipped_at IS 'Timestamp when order was marked as shipped/dispatched to courier';
CREATE INDEX IF NOT EXISTS idx_orders_shipped_at ON orders(shipped_at) WHERE shipped_at IS NOT NULL;

-- ================================================================
-- Success message
-- ================================================================
DO $$
BEGIN
    RAISE NOTICE '✅ Migration 046: Delivery amount discrepancy fields added successfully';
END $$;
