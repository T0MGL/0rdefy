-- ================================================================
-- Migration 030: Add order_status_url to orders table
-- ================================================================
-- Problem: Shopify webhooks try to insert order_status_url but column doesn't exist
-- This field is needed for customer order tracking via Shopify
--
-- Changes:
-- 1. Add order_status_url column to orders table
-- 2. Add index for faster lookups
-- ================================================================

-- Step 1: Add order_status_url column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'order_status_url'
    ) THEN
        ALTER TABLE orders ADD COLUMN order_status_url TEXT;
        RAISE NOTICE '✅ Added order_status_url column to orders table';
    ELSE
        RAISE NOTICE 'ℹ️  order_status_url column already exists in orders table';
    END IF;
END $$;

-- Step 2: Add index for faster lookups (optional but recommended)
CREATE INDEX IF NOT EXISTS idx_orders_order_status_url
ON orders(order_status_url)
WHERE order_status_url IS NOT NULL;

-- Step 3: Add comment for documentation
COMMENT ON COLUMN orders.order_status_url IS 'Shopify order status URL for customer order tracking. Example: https://store.myshopify.com/account/orders/1234567890';

-- Step 4: Verify the change
DO $$
DECLARE
    v_column_exists BOOLEAN;
    v_index_exists BOOLEAN;
BEGIN
    -- Check if column exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'order_status_url'
    ) INTO v_column_exists;

    -- Check if index exists
    SELECT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'orders' AND indexname = 'idx_orders_order_status_url'
    ) INTO v_index_exists;

    RAISE NOTICE '✅ Migration 030 completed successfully:';
    RAISE NOTICE '   - order_status_url column exists: %', v_column_exists;
    RAISE NOTICE '   - Index idx_orders_order_status_url exists: %', v_index_exists;
END $$;
