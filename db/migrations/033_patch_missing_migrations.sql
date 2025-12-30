-- ================================================================
-- MIGRATION 033: PATCH - Consolidate Missing Migrations 026-032
-- ================================================================
-- Purpose: Apply all missing migrations that weren't in MASTER migration
-- Context: User only applied 000_MASTER_MIGRATION.sql
-- Missing: Migrations 026, 030, 031, 032 elements
-- Date: 2025-12-30
-- Safe to run multiple times (idempotent)
-- ================================================================

-- ================================================================
-- PART 1: Add Missing Columns to orders table
-- ================================================================

-- Migration 026: Auto-generated fields
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255);

-- Migration 030: Shopify order tracking URL
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_status_url TEXT;

-- Migration 031: Shopify processing timestamp
ALTER TABLE orders ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP;

-- Migration 032: Shopify order tags
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tags TEXT;

-- Add comments for documentation
COMMENT ON COLUMN orders.order_number IS 'Auto-generated order number (from Shopify or internal format ORD-YYYYMMDD-XXXXXX)';
COMMENT ON COLUMN orders.customer_name IS 'Auto-generated customer full name (first_name + last_name or email)';
COMMENT ON COLUMN orders.order_status_url IS 'Shopify order status URL for customer tracking';
COMMENT ON COLUMN orders.processed_at IS 'Timestamp when Shopify processed the order';
COMMENT ON COLUMN orders.tags IS 'Shopify order tags (comma-separated string)';

-- ================================================================
-- PART 2: Create Indexes for New Columns
-- ================================================================

-- Index for order_status_url (Migration 030)
CREATE INDEX IF NOT EXISTS idx_orders_order_status_url
ON orders(order_status_url)
WHERE order_status_url IS NOT NULL;

-- Index for processed_at (Migration 031)
CREATE INDEX IF NOT EXISTS idx_orders_processed_at
ON orders(processed_at)
WHERE processed_at IS NOT NULL;

-- GIN index for full-text search on tags (Migration 032)
CREATE INDEX IF NOT EXISTS idx_orders_tags
ON orders USING gin(to_tsvector('simple', COALESCE(tags, '')));

-- Index for payment_gateway analytics (already exists in MASTER but adding for completeness)
CREATE INDEX IF NOT EXISTS idx_orders_payment_gateway
ON orders(payment_gateway)
WHERE payment_gateway IS NOT NULL;

-- Index for shopify_order_name lookups (Migration 025)
CREATE INDEX IF NOT EXISTS idx_orders_shopify_order_name
ON orders(shopify_order_name)
WHERE shopify_order_name IS NOT NULL;

-- ================================================================
-- PART 3: Create generate_order_number Function (Migration 026)
-- ================================================================

CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $$
BEGIN
  -- If order_number is not set, generate one
  IF NEW.order_number IS NULL THEN
    NEW.order_number := COALESCE(
      NEW.shopify_order_number::TEXT, -- Cast INT to TEXT
      'ORD-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || SUBSTRING(NEW.id::text, 1, 6)
    );
  END IF;

  -- If customer_name is not set, generate from customer info
  IF NEW.customer_name IS NULL THEN
    NEW.customer_name := COALESCE(
      NULLIF(TRIM(NEW.customer_first_name || ' ' || NEW.customer_last_name), ''),
      NEW.customer_email,
      'Unknown Customer'
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_order_number() IS 'Auto-generates order_number and customer_name for new orders';

-- ================================================================
-- PART 4: Create Trigger for generate_order_number
-- ================================================================

DROP TRIGGER IF EXISTS trigger_generate_order_number ON orders;

CREATE TRIGGER trigger_generate_order_number
    BEFORE INSERT ON orders
    FOR EACH ROW
    EXECUTE FUNCTION generate_order_number();

COMMENT ON TRIGGER trigger_generate_order_number ON orders IS 'Auto-populates order_number and customer_name on order creation';

-- ================================================================
-- PART 5: Backfill Existing Orders (One-time Data Migration)
-- ================================================================

-- Update existing orders that don't have order_number
UPDATE orders
SET order_number = COALESCE(
    shopify_order_number::TEXT,
    'ORD-' || TO_CHAR(created_at, 'YYYYMMDD') || '-' || SUBSTRING(id::text, 1, 6)
)
WHERE order_number IS NULL;

-- Update existing orders that don't have customer_name
UPDATE orders
SET customer_name = COALESCE(
    NULLIF(TRIM(customer_first_name || ' ' || customer_last_name), ''),
    customer_email,
    'Unknown Customer'
)
WHERE customer_name IS NULL;

-- Update shopify_order_name from shopify_order_number where missing (Migration 025)
UPDATE orders
SET shopify_order_name = '#' || shopify_order_number
WHERE shopify_order_number IS NOT NULL
  AND shopify_order_name IS NULL;

-- ================================================================
-- VERIFICATION
-- ================================================================

DO $$
DECLARE
    v_order_number_exists BOOLEAN;
    v_customer_name_exists BOOLEAN;
    v_order_status_url_exists BOOLEAN;
    v_processed_at_exists BOOLEAN;
    v_tags_exists BOOLEAN;
    v_function_exists BOOLEAN;
    v_trigger_exists BOOLEAN;
    v_orders_without_number INTEGER;
    v_orders_without_name INTEGER;
BEGIN
    -- Check columns exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'order_number'
    ) INTO v_order_number_exists;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'customer_name'
    ) INTO v_customer_name_exists;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'order_status_url'
    ) INTO v_order_status_url_exists;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'processed_at'
    ) INTO v_processed_at_exists;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'tags'
    ) INTO v_tags_exists;

    -- Check function exists
    SELECT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'generate_order_number'
    ) INTO v_function_exists;

    -- Check trigger exists
    SELECT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_generate_order_number'
    ) INTO v_trigger_exists;

    -- Count orders without order_number or customer_name
    SELECT COUNT(*) INTO v_orders_without_number
    FROM orders WHERE order_number IS NULL;

    SELECT COUNT(*) INTO v_orders_without_name
    FROM orders WHERE customer_name IS NULL;

    -- Output verification results
    RAISE NOTICE '============================================';
    RAISE NOTICE 'MIGRATION 033 - VERIFICATION RESULTS';
    RAISE NOTICE '============================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Columns:';
    RAISE NOTICE '  ✓ order_number: %', v_order_number_exists;
    RAISE NOTICE '  ✓ customer_name: %', v_customer_name_exists;
    RAISE NOTICE '  ✓ order_status_url: %', v_order_status_url_exists;
    RAISE NOTICE '  ✓ processed_at: %', v_processed_at_exists;
    RAISE NOTICE '  ✓ tags: %', v_tags_exists;
    RAISE NOTICE '';
    RAISE NOTICE 'Functions & Triggers:';
    RAISE NOTICE '  ✓ generate_order_number(): %', v_function_exists;
    RAISE NOTICE '  ✓ trigger_generate_order_number: %', v_trigger_exists;
    RAISE NOTICE '';
    RAISE NOTICE 'Data Quality:';
    RAISE NOTICE '  ✓ Orders without order_number: %', v_orders_without_number;
    RAISE NOTICE '  ✓ Orders without customer_name: %', v_orders_without_name;
    RAISE NOTICE '';
    RAISE NOTICE '============================================';

    IF v_orders_without_number > 0 OR v_orders_without_name > 0 THEN
        RAISE WARNING 'Some orders are still missing order_number or customer_name. Run backfill again.';
    ELSE
        RAISE NOTICE '✅ MIGRATION 033 COMPLETED SUCCESSFULLY';
    END IF;

    RAISE NOTICE '============================================';
END $$;

-- ================================================================
-- MIGRATION 033 COMPLETE
-- ================================================================
-- Next steps:
-- 1. Verify all indexes created: \di idx_orders_*
-- 2. Test order creation: INSERT INTO orders should auto-populate order_number
-- 3. Update MASTER migration (000_MASTER_MIGRATION.sql) with these changes
-- ================================================================
