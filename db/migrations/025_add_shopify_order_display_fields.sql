-- ================================================================
-- MIGRATION 025: Add Shopify Order Display Fields
-- ================================================================
-- Purpose: Add shopify_order_name and payment_gateway fields to orders table
--          for better UI display and identification
-- Date: 2025-01-06
-- ================================================================

-- Add shopify_order_name column (e.g., "#1001")
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shopify_order_name VARCHAR(100);

-- Add payment_gateway column (e.g., "shopify_payments", "manual", "paypal", etc.)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_gateway VARCHAR(100);

-- Create index for faster lookups by shopify_order_name
CREATE INDEX IF NOT EXISTS idx_orders_shopify_order_name ON orders(shopify_order_name) WHERE shopify_order_name IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN orders.shopify_order_name IS 'Shopify order name/number for display in UI (e.g., "#1001")';
COMMENT ON COLUMN orders.payment_gateway IS 'Payment gateway used for the order (e.g., shopify_payments, manual, paypal, mercadopago, etc.)';

-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================
