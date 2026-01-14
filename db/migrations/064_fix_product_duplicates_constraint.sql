-- ================================================================
-- Migration 064: Fix Product Duplicates & Webhook Errors
-- ================================================================
-- Adds unique constraint to prevent duplicate shopify_product_id
-- Fixes webhook errors: "multiple rows returned"
-- ================================================================

-- 1. First, identify and log any existing duplicates
DO $$
DECLARE
    duplicate_record RECORD;
    duplicate_count INTEGER;
BEGIN
    -- Check for duplicates
    SELECT COUNT(*) INTO duplicate_count
    FROM (
        SELECT shopify_product_id, store_id, COUNT(*) as cnt
        FROM products
        WHERE shopify_product_id IS NOT NULL
        GROUP BY shopify_product_id, store_id
        HAVING COUNT(*) > 1
    ) duplicates;

    IF duplicate_count > 0 THEN
        RAISE NOTICE 'Found % duplicate product groups', duplicate_count;

        -- Log each duplicate group
        FOR duplicate_record IN
            SELECT
                shopify_product_id,
                store_id,
                COUNT(*) as duplicate_count,
                STRING_AGG(id::text, ', ' ORDER BY created_at DESC) as product_ids
            FROM products
            WHERE shopify_product_id IS NOT NULL
            GROUP BY shopify_product_id, store_id
            HAVING COUNT(*) > 1
        LOOP
            RAISE NOTICE 'Duplicate: shopify_product_id=%, store_id=%, count=%, ids=%',
                duplicate_record.shopify_product_id,
                duplicate_record.store_id,
                duplicate_record.duplicate_count,
                duplicate_record.product_ids;
        END LOOP;
    ELSE
        RAISE NOTICE 'No duplicate products found - database is clean';
    END IF;
END $$;

-- 2. Clean up duplicates (keep most recent, delete older ones)
-- This will only run if duplicates exist
WITH duplicates AS (
    SELECT
        id,
        shopify_product_id,
        store_id,
        ROW_NUMBER() OVER (
            PARTITION BY shopify_product_id, store_id
            ORDER BY created_at DESC, updated_at DESC
        ) as rn
    FROM products
    WHERE shopify_product_id IS NOT NULL
),
to_delete AS (
    SELECT id
    FROM duplicates
    WHERE rn > 1
)
DELETE FROM products
WHERE id IN (SELECT id FROM to_delete);

-- Log cleanup result
DO $$
DECLARE
    deleted_count INTEGER;
BEGIN
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    IF deleted_count > 0 THEN
        RAISE NOTICE 'Deleted % duplicate products (kept most recent versions)', deleted_count;
    ELSE
        RAISE NOTICE 'No duplicate products to delete';
    END IF;
END $$;

-- 3. Add unique constraint to prevent future duplicates
-- Note: CREATE INDEX CONCURRENTLY must be run outside a transaction
-- If running this via migration tool, you may need to run this separately
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_unique_shopify_product_store
ON products (store_id, shopify_product_id)
WHERE shopify_product_id IS NOT NULL;

-- 4. Add comment explaining the constraint
COMMENT ON INDEX idx_products_unique_shopify_product_store IS
'Prevents duplicate products with same shopify_product_id per store.
Fixes webhook error: "JSON object requested, multiple (or no) rows returned"';

-- ================================================================
-- Verification Query
-- ================================================================
-- Run this after migration to verify no duplicates remain:
--
-- SELECT
--   shopify_product_id,
--   store_id,
--   COUNT(*) as count
-- FROM products
-- WHERE shopify_product_id IS NOT NULL
-- GROUP BY shopify_product_id, store_id
-- HAVING COUNT(*) > 1;
--
-- Expected: 0 rows (no duplicates)
-- ================================================================
