-- Migration 030: Add missing Shopify order fields
-- Adds shopify_order_name (e.g. "#1001") and payment_gateway to orders table
-- Created: 2025-01-12

-- Add shopify_order_name field (the human-readable order name like "#1001")
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS shopify_order_name VARCHAR(50);

-- Add payment_gateway field (payment method used: shopify_payments, manual, cash_on_delivery, paypal, etc.)
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS payment_gateway VARCHAR(100);

-- Add cancel_reason field (why the order was cancelled)
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

-- Create index on shopify_order_name for faster lookups
CREATE INDEX IF NOT EXISTS idx_orders_shopify_order_name
ON orders(shopify_order_name)
WHERE shopify_order_name IS NOT NULL;

-- Create index on payment_gateway for analytics
CREATE INDEX IF NOT EXISTS idx_orders_payment_gateway
ON orders(payment_gateway)
WHERE payment_gateway IS NOT NULL;

-- Update existing Shopify orders to populate shopify_order_name from shopify_order_number
-- This is a one-time migration to populate existing data
UPDATE orders
SET shopify_order_name = '#' || shopify_order_number
WHERE shopify_order_number IS NOT NULL
  AND shopify_order_name IS NULL;

-- Comment on new columns
COMMENT ON COLUMN orders.shopify_order_name IS 'Human-readable order name from Shopify (e.g. "#1001")';
COMMENT ON COLUMN orders.payment_gateway IS 'Payment method/gateway used (e.g. shopify_payments, manual, cash_on_delivery)';
COMMENT ON COLUMN orders.cancel_reason IS 'Reason why the order was cancelled (from Shopify or internal)';
