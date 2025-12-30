-- ================================================================
-- Migration 033: Add missing Shopify order fields
-- ================================================================
-- Problem: Shopify webhooks try to insert multiple missing fields
-- This migration adds all missing columns that Shopify webhooks need
--
-- Changes:
-- 1. Add total_discounts column (order discount total)
-- 2. Add order_status_url column (customer order tracking URL)
-- 3. Add tags column (order tags from Shopify)
-- 4. Add processed_at column (when order was processed in Shopify)
-- 5. Add cancelled_at column (when order was cancelled - already exists)
-- ================================================================

-- Step 1: Add total_discounts column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'total_discounts'
    ) THEN
        ALTER TABLE orders ADD COLUMN total_discounts DECIMAL(10,2) DEFAULT 0.00;
        RAISE NOTICE '✅ Added total_discounts column to orders table';
    ELSE
        RAISE NOTICE 'ℹ️  total_discounts column already exists in orders table';
    END IF;
END $$;

-- Step 2: Add order_status_url column if it doesn't exist
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

-- Step 3: Add tags column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'tags'
    ) THEN
        ALTER TABLE orders ADD COLUMN tags TEXT;
        RAISE NOTICE '✅ Added tags column to orders table';
    ELSE
        RAISE NOTICE 'ℹ️  tags column already exists in orders table';
    END IF;
END $$;

-- Step 4: Add processed_at column if it doesn't exist (from migration 031)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'processed_at'
    ) THEN
        ALTER TABLE orders ADD COLUMN processed_at TIMESTAMP;
        RAISE NOTICE '✅ Added processed_at column to orders table';
    ELSE
        RAISE NOTICE 'ℹ️  processed_at column already exists in orders table';
    END IF;
END $$;

-- Step 5: Add comments for documentation
COMMENT ON COLUMN orders.total_discounts IS 'Total discount amount applied to the order (from Shopify)';
COMMENT ON COLUMN orders.order_status_url IS 'Customer-facing order status/tracking URL (from Shopify)';
COMMENT ON COLUMN orders.tags IS 'Order tags from Shopify (comma-separated string)';
COMMENT ON COLUMN orders.processed_at IS 'Timestamp when Shopify processed the order';

-- Step 6: Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_orders_total_discounts ON orders(total_discounts) WHERE total_discounts > 0;
CREATE INDEX IF NOT EXISTS idx_orders_tags ON orders USING gin(to_tsvector('simple', COALESCE(tags, '')));
CREATE INDEX IF NOT EXISTS idx_orders_processed_at ON orders(processed_at) WHERE processed_at IS NOT NULL;

-- Step 7: Verify the changes
DO $$
DECLARE
    v_total_discounts_exists BOOLEAN;
    v_order_status_url_exists BOOLEAN;
    v_tags_exists BOOLEAN;
    v_processed_at_exists BOOLEAN;
    v_cancelled_at_exists BOOLEAN;
BEGIN
    -- Check if all columns exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'total_discounts'
    ) INTO v_total_discounts_exists;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'order_status_url'
    ) INTO v_order_status_url_exists;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'tags'
    ) INTO v_tags_exists;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'processed_at'
    ) INTO v_processed_at_exists;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'cancelled_at'
    ) INTO v_cancelled_at_exists;

    RAISE NOTICE '✅ Migration 033 completed successfully:';
    RAISE NOTICE '   - total_discounts column exists: %', v_total_discounts_exists;
    RAISE NOTICE '   - order_status_url column exists: %', v_order_status_url_exists;
    RAISE NOTICE '   - tags column exists: %', v_tags_exists;
    RAISE NOTICE '   - processed_at column exists: %', v_processed_at_exists;
    RAISE NOTICE '   - cancelled_at column exists: %', v_cancelled_at_exists;
END $$;
