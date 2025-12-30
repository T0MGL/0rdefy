-- ================================================================
-- Migration 031: Add missing Shopify timestamp columns to orders
-- ================================================================
-- Problem: Shopify webhooks try to insert processed_at and cancelled_at but columns don't exist
-- These fields track when Shopify processed/cancelled the order
--
-- Changes:
-- 1. Add processed_at column (when Shopify processed the order)
-- 2. Add cancelled_at column (when Shopify cancelled the order)
-- ================================================================

-- Step 1: Add processed_at column if it doesn't exist
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

-- Step 2: Add cancelled_at column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'cancelled_at'
    ) THEN
        ALTER TABLE orders ADD COLUMN cancelled_at TIMESTAMP;
        RAISE NOTICE '✅ Added cancelled_at column to orders table';
    ELSE
        RAISE NOTICE 'ℹ️  cancelled_at column already exists in orders table';
    END IF;
END $$;

-- Step 3: Add comments for documentation
COMMENT ON COLUMN orders.processed_at IS 'Timestamp when Shopify processed the order (from Shopify webhook)';
COMMENT ON COLUMN orders.cancelled_at IS 'Timestamp when the order was cancelled in Shopify';

-- Step 4: Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_orders_processed_at ON orders(processed_at) WHERE processed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_cancelled_at ON orders(cancelled_at) WHERE cancelled_at IS NOT NULL;

-- Step 5: Verify the changes
DO $$
DECLARE
    v_processed_at_exists BOOLEAN;
    v_cancelled_at_exists BOOLEAN;
BEGIN
    -- Check if columns exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'processed_at'
    ) INTO v_processed_at_exists;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'cancelled_at'
    ) INTO v_cancelled_at_exists;

    RAISE NOTICE '✅ Migration 031 completed successfully:';
    RAISE NOTICE '   - processed_at column exists: %', v_processed_at_exists;
    RAISE NOTICE '   - cancelled_at column exists: %', v_cancelled_at_exists;
END $$;
