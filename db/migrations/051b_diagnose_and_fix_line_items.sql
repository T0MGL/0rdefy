-- Diagnostic script for order_line_items image_url issue
-- Run this in Supabase SQL Editor to diagnose and fix

-- ================================================================
-- STEP 1: Diagnose - Check how many line items have NULL image_url
-- ================================================================

SELECT
    'Total line items' as metric,
    COUNT(*) as count
FROM order_line_items
UNION ALL
SELECT
    'Line items with image_url' as metric,
    COUNT(*) as count
FROM order_line_items WHERE image_url IS NOT NULL
UNION ALL
SELECT
    'Line items without image_url' as metric,
    COUNT(*) as count
FROM order_line_items WHERE image_url IS NULL
UNION ALL
SELECT
    'Line items with product_id mapped' as metric,
    COUNT(*) as count
FROM order_line_items WHERE product_id IS NOT NULL
UNION ALL
SELECT
    'Line items with shopify_variant_id' as metric,
    COUNT(*) as count
FROM order_line_items WHERE shopify_variant_id IS NOT NULL;

-- ================================================================
-- STEP 2: Check if products have matching Shopify IDs
-- ================================================================

-- Sample of line items without image and their Shopify IDs
SELECT
    oli.id,
    oli.product_name,
    oli.shopify_product_id as oli_shopify_product_id,
    oli.shopify_variant_id as oli_shopify_variant_id,
    oli.sku as oli_sku,
    oli.product_id,
    oli.image_url
FROM order_line_items oli
WHERE oli.image_url IS NULL
LIMIT 10;

-- Check if there are products with those Shopify IDs
SELECT
    p.id,
    p.name,
    p.shopify_product_id,
    p.shopify_variant_id,
    p.sku,
    p.image_url,
    p.store_id
FROM products p
WHERE p.image_url IS NOT NULL
LIMIT 10;

-- ================================================================
-- STEP 3: Alternative fix - Match by product name (fuzzy)
-- ================================================================
-- This is a more aggressive approach - matches by product name

UPDATE order_line_items oli
SET image_url = p.image_url,
    product_id = p.id
FROM products p
JOIN orders o ON o.id = oli.order_id
WHERE oli.image_url IS NULL
  AND p.store_id = o.store_id
  AND p.image_url IS NOT NULL
  AND (
    -- Exact name match
    LOWER(TRIM(oli.product_name)) = LOWER(TRIM(p.name))
    -- Or name contains product name
    OR LOWER(TRIM(p.name)) LIKE '%' || LOWER(TRIM(oli.product_name)) || '%'
    OR LOWER(TRIM(oli.product_name)) LIKE '%' || LOWER(TRIM(p.name)) || '%'
  );

-- ================================================================
-- STEP 4: Verify results after fix
-- ================================================================

SELECT
    'After fix - Line items with image_url' as metric,
    COUNT(*) as count
FROM order_line_items WHERE image_url IS NOT NULL
UNION ALL
SELECT
    'After fix - Line items without image_url' as metric,
    COUNT(*) as count
FROM order_line_items WHERE image_url IS NULL;
