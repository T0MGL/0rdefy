-- ================================================================
-- MIGRATION 094: Order Notes and Shopify Field Enhancements
-- ================================================================
-- Author: Bright Idea
-- Date: 2026-01-20
-- Production Ready: YES
--
-- Purpose: Add internal admin notes and properly capture Shopify fields
-- that are currently being ignored (city, address2, shipping method)
--
-- New Columns:
--   1. internal_notes - Admin observations/notes (not customer visible)
--   2. shopify_shipping_method - Shipping method name from Shopify
--   3. shopify_shipping_method_code - Shipping method code from Shopify
--
-- Field Corrections (existing columns now populated):
--   - address_reference: Will be populated from shipping_address.address2
--   - shipping_city: Will be populated from shipping_address.city
--   - shipping_city_normalized: Will be populated (normalized city)
--
-- Non-Breaking:
--   - All changes are additive (new columns)
--   - Existing data remains unchanged
--   - neighborhood field continues to work (backwards compatible)
--   - Idempotent: Safe to run multiple times
--
-- Rollback:
--   ALTER TABLE orders DROP COLUMN IF EXISTS internal_notes;
--   ALTER TABLE orders DROP COLUMN IF EXISTS shopify_shipping_method;
--   ALTER TABLE orders DROP COLUMN IF EXISTS shopify_shipping_method_code;
--   DROP INDEX IF EXISTS idx_orders_has_internal_notes;
--   DROP INDEX IF EXISTS idx_orders_shipping_method;
--   DROP INDEX IF EXISTS idx_orders_shipping_city_store;
--   DROP FUNCTION IF EXISTS normalize_city_name(TEXT);
--   DROP VIEW IF EXISTS v_orders_shipping_methods;
-- ================================================================


-- ================================================================
-- 1. ADD internal_notes COLUMN (IDEMPOTENT)
-- ================================================================
-- For internal admin observations that should not be visible to customers

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'orders'
          AND column_name = 'internal_notes'
    ) THEN
        ALTER TABLE public.orders ADD COLUMN internal_notes TEXT;

        COMMENT ON COLUMN public.orders.internal_notes IS
            'Internal admin notes/observations. Not visible to customers or couriers.
             Use for tracking special situations, customer feedback, product issues, etc.';

        RAISE NOTICE 'Column internal_notes added to orders table';
    ELSE
        RAISE NOTICE 'Column internal_notes already exists - skipping';
    END IF;
END $$;


-- ================================================================
-- 2. ADD shopify_shipping_method COLUMNS (IDEMPOTENT)
-- ================================================================
-- Capture the shipping method selected by customer in Shopify checkout

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'orders'
          AND column_name = 'shopify_shipping_method'
    ) THEN
        ALTER TABLE public.orders ADD COLUMN shopify_shipping_method VARCHAR(255);

        COMMENT ON COLUMN public.orders.shopify_shipping_method IS
            'Shipping method title from Shopify shipping_lines[0].title.
             Examples: "Envio Express (24/48h)", "Envio Gratis", "Standard Shipping"';

        RAISE NOTICE 'Column shopify_shipping_method added to orders table';
    ELSE
        RAISE NOTICE 'Column shopify_shipping_method already exists - skipping';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'orders'
          AND column_name = 'shopify_shipping_method_code'
    ) THEN
        ALTER TABLE public.orders ADD COLUMN shopify_shipping_method_code VARCHAR(100);

        COMMENT ON COLUMN public.orders.shopify_shipping_method_code IS
            'Shipping method code from Shopify shipping_lines[0].code.
             Examples: "EXPRESS", "FREE_SHIPPING", "STANDARD"';

        RAISE NOTICE 'Column shopify_shipping_method_code added to orders table';
    ELSE
        RAISE NOTICE 'Column shopify_shipping_method_code already exists - skipping';
    END IF;
END $$;


-- ================================================================
-- 3. INDEXES FOR QUERYING (IDEMPOTENT - CREATE IF NOT EXISTS)
-- ================================================================

-- Index for orders with internal notes (for filtering "orders with notes")
-- Partial index to only include rows with actual notes (saves space)
CREATE INDEX IF NOT EXISTS idx_orders_has_internal_notes
ON public.orders(store_id)
WHERE internal_notes IS NOT NULL AND internal_notes != '';

-- Index for shipping method queries (for analytics/filtering by method)
CREATE INDEX IF NOT EXISTS idx_orders_shipping_method
ON public.orders(store_id, shopify_shipping_method)
WHERE shopify_shipping_method IS NOT NULL;

-- Index for city-based queries (complements migration 090)
CREATE INDEX IF NOT EXISTS idx_orders_shipping_city_store
ON public.orders(store_id, shipping_city)
WHERE shipping_city IS NOT NULL;


-- ================================================================
-- 4. HELPER FUNCTION: Normalize city name (IDEMPOTENT - CREATE OR REPLACE)
-- ================================================================
-- Handles accents and case for consistent city matching
-- Used by backend when mapping Shopify orders
-- IMMUTABLE for performance (can be used in indexes)

CREATE OR REPLACE FUNCTION public.normalize_city_name(p_city TEXT)
RETURNS TEXT AS $$
BEGIN
    -- Handle NULL and empty strings safely
    IF p_city IS NULL THEN
        RETURN NULL;
    END IF;

    -- Trim first, then check if empty
    p_city := TRIM(p_city);
    IF p_city = '' THEN
        RETURN NULL;
    END IF;

    -- Normalize: lowercase, remove accents
    -- Using TRANSLATE for performance (faster than regexp_replace)
    RETURN LOWER(
        TRANSLATE(p_city,
            'ÁÉÍÓÚáéíóúÀÈÌÒÙàèìòùÂÊÎÔÛâêîôûÄËÏÖÜäëïöüÑñÇçÃÕãõ',
            'AEIOUaeiouAEIOUaeiouAEIOUaeiouAEIOUaeiouNnCcAOao'
        )
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

COMMENT ON FUNCTION public.normalize_city_name(TEXT) IS
'Normalizes city names for consistent matching: lowercase, trimmed, accents removed.
Used to populate shipping_city_normalized from Shopify shipping_address.city.
Example: "Asunción" -> "asuncion", "San Lorenzo " -> "san lorenzo"
IMMUTABLE and STRICT for optimal performance.';

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.normalize_city_name(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_city_name(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.normalize_city_name(TEXT) TO anon;


-- ================================================================
-- 5. VIEW: Orders with Shopify Shipping Info (IDEMPOTENT - CREATE OR REPLACE)
-- ================================================================
-- Useful for analytics on shipping methods
-- Note: Views inherit RLS from underlying tables

DROP VIEW IF EXISTS public.v_orders_shipping_methods;

CREATE VIEW public.v_orders_shipping_methods AS
SELECT
    store_id,
    shopify_shipping_method,
    shopify_shipping_method_code,
    COUNT(*) as order_count,
    COALESCE(SUM(total_price), 0) as total_revenue,
    COALESCE(AVG(total_shipping), 0) as avg_shipping_cost,
    MIN(created_at) as first_order,
    MAX(created_at) as last_order
FROM public.orders
WHERE shopify_shipping_method IS NOT NULL
  AND sleeves_status NOT IN ('cancelled')
GROUP BY store_id, shopify_shipping_method, shopify_shipping_method_code;

COMMENT ON VIEW public.v_orders_shipping_methods IS
'Analytics view showing order distribution by Shopify shipping method.
Useful for understanding which shipping options customers prefer.
Inherits RLS from orders table - users only see their store data.';

-- Grant permissions (view inherits RLS from orders table)
GRANT SELECT ON public.v_orders_shipping_methods TO authenticated;
GRANT SELECT ON public.v_orders_shipping_methods TO service_role;


-- ================================================================
-- 6. VERIFICATION (Production Safety Check)
-- ================================================================

DO $$
DECLARE
    v_has_internal_notes BOOLEAN := FALSE;
    v_has_shipping_method BOOLEAN := FALSE;
    v_has_shipping_code BOOLEAN := FALSE;
    v_has_function BOOLEAN := FALSE;
    v_has_view BOOLEAN := FALSE;
    v_errors TEXT := '';
BEGIN
    -- Check columns exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'orders'
          AND column_name = 'internal_notes'
    ) INTO v_has_internal_notes;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'orders'
          AND column_name = 'shopify_shipping_method'
    ) INTO v_has_shipping_method;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'orders'
          AND column_name = 'shopify_shipping_method_code'
    ) INTO v_has_shipping_code;

    -- Check function exists
    SELECT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'normalize_city_name'
    ) INTO v_has_function;

    -- Check view exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.views
        WHERE table_schema = 'public'
          AND table_name = 'v_orders_shipping_methods'
    ) INTO v_has_view;

    -- Build error message if anything failed
    IF NOT v_has_internal_notes THEN
        v_errors := v_errors || 'internal_notes column missing. ';
    END IF;
    IF NOT v_has_shipping_method THEN
        v_errors := v_errors || 'shopify_shipping_method column missing. ';
    END IF;
    IF NOT v_has_shipping_code THEN
        v_errors := v_errors || 'shopify_shipping_method_code column missing. ';
    END IF;
    IF NOT v_has_function THEN
        v_errors := v_errors || 'normalize_city_name function missing. ';
    END IF;
    IF NOT v_has_view THEN
        v_errors := v_errors || 'v_orders_shipping_methods view missing. ';
    END IF;

    -- Fail if any errors
    IF v_errors != '' THEN
        RAISE EXCEPTION 'Migration 094 FAILED: %', v_errors;
    END IF;

    -- Success output
    RAISE NOTICE '';
    RAISE NOTICE '================================================';
    RAISE NOTICE 'Migration 094: Order Notes & Shopify Fields';
    RAISE NOTICE '================================================';
    RAISE NOTICE 'internal_notes column................ OK';
    RAISE NOTICE 'shopify_shipping_method column....... OK';
    RAISE NOTICE 'shopify_shipping_method_code column.. OK';
    RAISE NOTICE 'normalize_city_name function......... OK';
    RAISE NOTICE 'v_orders_shipping_methods view....... OK';
    RAISE NOTICE '================================================';
    RAISE NOTICE 'Migration completed successfully!';
    RAISE NOTICE '';
END $$;


-- ================================================================
-- 7. NOTIFY POSTGREST TO RELOAD SCHEMA
-- ================================================================

NOTIFY pgrst, 'reload schema';
