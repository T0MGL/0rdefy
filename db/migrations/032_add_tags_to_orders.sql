-- ================================================================
-- Migration 032: Add tags column to orders table
-- ================================================================
-- Problem: Shopify webhooks try to insert tags but column doesn't exist
-- This field stores Shopify order tags (comma-separated string)
--
-- Changes:
-- 1. Add tags column to orders table
-- ================================================================

-- Step 1: Add tags column if it doesn't exist
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

-- Step 2: Add comment for documentation
COMMENT ON COLUMN orders.tags IS 'Order tags from Shopify (comma-separated string)';

-- Step 3: Add index for tag searches (optional but helpful)
CREATE INDEX IF NOT EXISTS idx_orders_tags ON orders USING gin(to_tsvector('simple', COALESCE(tags, '')));

-- Step 4: Verify the changes
DO $$
DECLARE
    v_tags_exists BOOLEAN;
BEGIN
    -- Check if column exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'tags'
    ) INTO v_tags_exists;

    RAISE NOTICE '✅ Migration 032 completed successfully:';
    RAISE NOTICE '   - tags column exists: %', v_tags_exists;
END $$;
