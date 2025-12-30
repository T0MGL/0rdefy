-- Quick migration script to add missing Shopify columns
-- Run this in Supabase SQL Editor

-- Add processed_at
ALTER TABLE orders ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP;

-- Add cancelled_at
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_orders_processed_at ON orders(processed_at) WHERE processed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_cancelled_at ON orders(cancelled_at) WHERE cancelled_at IS NOT NULL;

-- Verify
SELECT
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'orders'
AND column_name IN ('processed_at', 'cancelled_at', 'order_status_url')
ORDER BY column_name;
