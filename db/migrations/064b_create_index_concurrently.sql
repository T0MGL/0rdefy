-- ================================================================
-- Migration 064b: Create Unique Index CONCURRENTLY (Production Safe)
-- ================================================================
-- This must be run OUTSIDE a transaction block
-- Execute this separately after 064_fix_product_duplicates_constraint.sql
-- ================================================================

-- Drop the regular index if it exists (created by 064)
DROP INDEX IF EXISTS idx_products_unique_shopify_product_store;

-- Create the index CONCURRENTLY (no table lock, safe for production)
-- This will build the index in the background without blocking writes
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_products_unique_shopify_product_store
ON products (store_id, shopify_product_id)
WHERE shopify_product_id IS NOT NULL;

-- Add comment
COMMENT ON INDEX idx_products_unique_shopify_product_store IS
'Prevents duplicate products with same shopify_product_id per store.
Fixes webhook error: "JSON object requested, multiple (or no) rows returned".
Created CONCURRENTLY for zero-downtime deployment.';

-- Verification
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'idx_products_unique_shopify_product_store'
    ) THEN
        RAISE NOTICE '✅ Index created successfully: idx_products_unique_shopify_product_store';
    ELSE
        RAISE WARNING '❌ Index was not created - check for errors above';
    END IF;
END $$;
