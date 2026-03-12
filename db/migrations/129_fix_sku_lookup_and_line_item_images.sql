-- ============================================================================
-- Migration 129: Fix SKU lookup for products with variants + image_url on line items
-- ============================================================================
--
-- FIXES:
-- 1. find_product_or_variant_by_sku() excluded parent products with has_variants=TRUE
--    This caused SKU lookups to fail for products that have bundles/variations
-- 2. External webhook did not populate image_url on order_line_items
--    (Fixed in application code, this migration updates the RPC to also return image_url)
--
-- NOTE: Must DROP function first because CREATE OR REPLACE cannot change return type
-- ============================================================================

-- ============================================================================
-- STEP 1: Drop existing function (return type is changing - adding image_url)
-- No dependencies: function is only called from application code (webhook service)
-- ============================================================================

DROP FUNCTION IF EXISTS find_product_or_variant_by_sku(UUID, VARCHAR);

-- ============================================================================
-- STEP 2: Recreate with fixes: removed has_variants filter, added image_url
-- ============================================================================

CREATE OR REPLACE FUNCTION find_product_or_variant_by_sku(
    p_store_id UUID,
    p_sku VARCHAR(255)
)
RETURNS TABLE (
    entity_type VARCHAR(20),
    product_id UUID,
    variant_id UUID,
    product_name VARCHAR(255),
    variant_title VARCHAR(255),
    sku VARCHAR(255),
    price DECIMAL(10,2),
    stock INTEGER,
    image_url TEXT
) AS $$
DECLARE
    v_normalized_sku VARCHAR(255);
BEGIN
    -- Normalize SKU for comparison
    v_normalized_sku := UPPER(TRIM(p_sku));

    IF v_normalized_sku IS NULL OR v_normalized_sku = '' THEN
        RETURN;
    END IF;

    -- First try to find variant by SKU (more specific match)
    RETURN QUERY
    SELECT
        'variant'::VARCHAR(20) AS entity_type,
        pv.product_id,
        pv.id AS variant_id,
        p.name AS product_name,
        pv.variant_title,
        pv.sku,
        pv.price,
        pv.stock,
        COALESCE(pv.image_url, p.image_url) AS image_url
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.store_id = p_store_id
      AND UPPER(TRIM(pv.sku)) = v_normalized_sku
      AND pv.is_active = TRUE
      AND p.is_active = TRUE
    LIMIT 1;

    -- If found as variant, return early
    IF FOUND THEN
        RETURN;
    END IF;

    -- Fallback: Try to find product by SKU (any product, including parents with variants)
    -- FIX: Removed (has_variants = FALSE OR has_variants IS NULL) filter
    -- Parent products with bundles/variations should still be findable by their own SKU
    RETURN QUERY
    SELECT
        'product'::VARCHAR(20) AS entity_type,
        p.id AS product_id,
        NULL::UUID AS variant_id,
        p.name AS product_name,
        NULL::VARCHAR(255) AS variant_title,
        p.sku,
        p.price,
        p.stock,
        p.image_url
    FROM products p
    WHERE p.store_id = p_store_id
      AND UPPER(TRIM(p.sku)) = v_normalized_sku
      AND p.is_active = TRUE
    LIMIT 1;

    RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ BEGIN RAISE NOTICE '✅ Migration 129: Fixed find_product_or_variant_by_sku - removed has_variants filter, added image_url to return'; END $$;
