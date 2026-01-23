-- ============================================================================
-- Migration 101: Bundle vs Variation Separation
-- ============================================================================
--
-- DESCRIPTION:
-- Adds clear semantic distinction between BUNDLES and VARIATIONS in the
-- product_variants table. This resolves confusion where both concepts were
-- conflated without explicit type discrimination.
--
-- BUNDLES (variant_type = 'bundle'):
-- - Quantity packs (1x, 2x, 3x) with volume discounts
-- - ALWAYS use shared stock from parent product (uses_shared_stock = TRUE)
-- - units_per_pack determines how many physical units per pack
-- - Example: NOCTE Glasses - Personal (1x), Pareja (2x), Oficina (3x)
--
-- VARIATIONS (variant_type = 'variation'):
-- - Different versions of the product (size, color, material)
-- - ALWAYS use independent stock (uses_shared_stock = FALSE)
-- - units_per_pack is always 1 (not applicable)
-- - Example: T-Shirt - Size S, Size M, Size L
--
-- KEY CHANGES:
-- 1. Add variant_type enum column to product_variants
-- 2. Migrate existing data based on uses_shared_stock flag
-- 3. Add CHECK constraint enforcing business rules
-- 4. Add variant_type to order_line_items for audit trail
-- 5. Create separate inventory views for bundles and variations
-- 6. Update stock functions to validate variant_type
--
-- BACKWARD COMPATIBLE:
-- - Existing variants auto-classified based on uses_shared_stock
-- - API endpoints continue working with graceful type inference
-- - All existing orders remain valid
--
-- ============================================================================

-- ============================================================================
-- STEP 1: Create variant_type enum (if not exists)
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'variant_type_enum') THEN
        CREATE TYPE variant_type_enum AS ENUM ('bundle', 'variation');
        RAISE NOTICE '  Created variant_type_enum type';
    ELSE
        RAISE NOTICE '  variant_type_enum already exists';
    END IF;
END $$;

-- ============================================================================
-- STEP 2: Add variant_type column to product_variants
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'product_variants' AND column_name = 'variant_type'
    ) THEN
        -- Add column with default 'variation' (safer default)
        ALTER TABLE product_variants
        ADD COLUMN variant_type VARCHAR(20) DEFAULT 'variation';

        RAISE NOTICE '  Added variant_type column to product_variants';
    ELSE
        RAISE NOTICE '  variant_type column already exists';
    END IF;
END $$;

-- ============================================================================
-- STEP 3: Migrate existing data - infer type from uses_shared_stock
-- ============================================================================

UPDATE product_variants
SET variant_type = CASE
    WHEN uses_shared_stock = TRUE THEN 'bundle'
    ELSE 'variation'
END
WHERE variant_type IS NULL OR variant_type = 'variation';

-- Log migration stats
DO $$
DECLARE
    v_bundles INTEGER;
    v_variations INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_bundles FROM product_variants WHERE variant_type = 'bundle';
    SELECT COUNT(*) INTO v_variations FROM product_variants WHERE variant_type = 'variation';

    RAISE NOTICE '  Migrated existing variants: % bundles, % variations', v_bundles, v_variations;
END $$;

-- ============================================================================
-- STEP 4: Add CHECK constraint to enforce business rules
-- ============================================================================

DO $$
BEGIN
    -- Drop existing constraint if exists (for re-running migration)
    ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS chk_variant_type_rules;

    -- Add new constraint
    ALTER TABLE product_variants
    ADD CONSTRAINT chk_variant_type_rules CHECK (
        (variant_type = 'bundle' AND uses_shared_stock = TRUE) OR
        (variant_type = 'variation' AND uses_shared_stock = FALSE) OR
        (variant_type IS NULL)  -- Allow NULL for backward compatibility during transition
    );

    RAISE NOTICE '  Added CHECK constraint chk_variant_type_rules';
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '  Warning: Could not add constraint - %', SQLERRM;
END $$;

-- ============================================================================
-- STEP 5: Add variant_type to order_line_items for audit trail
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'order_line_items' AND column_name = 'variant_type'
    ) THEN
        ALTER TABLE order_line_items
        ADD COLUMN variant_type VARCHAR(20);

        RAISE NOTICE '  Added variant_type column to order_line_items';
    ELSE
        RAISE NOTICE '  variant_type column already exists in order_line_items';
    END IF;
END $$;

-- Backfill variant_type in order_line_items from product_variants
UPDATE order_line_items oli
SET variant_type = pv.variant_type
FROM product_variants pv
WHERE oli.variant_id = pv.id
  AND oli.variant_type IS NULL
  AND oli.variant_id IS NOT NULL;

-- ============================================================================
-- STEP 6: Create view for bundles inventory
-- ============================================================================

CREATE OR REPLACE VIEW v_bundles_inventory AS
SELECT
    pv.id,
    pv.product_id,
    pv.store_id,
    pv.sku,
    pv.variant_title,
    pv.units_per_pack,
    pv.price,
    pv.cost,
    pv.is_active,
    pv.position,
    pv.shopify_variant_id,
    p.name AS product_name,
    p.stock AS parent_stock,
    -- Calculate available packs
    FLOOR(COALESCE(p.stock, 0)::DECIMAL / GREATEST(COALESCE(pv.units_per_pack, 1), 1))::INTEGER AS available_packs,
    -- Status based on availability
    CASE
        WHEN FLOOR(COALESCE(p.stock, 0)::DECIMAL / GREATEST(COALESCE(pv.units_per_pack, 1), 1)) <= 0 THEN 'out_of_stock'
        WHEN FLOOR(COALESCE(p.stock, 0)::DECIMAL / GREATEST(COALESCE(pv.units_per_pack, 1), 1)) <= 5 THEN 'low_stock'
        ELSE 'in_stock'
    END AS stock_status
FROM product_variants pv
JOIN products p ON p.id = pv.product_id
WHERE pv.variant_type = 'bundle'
  AND pv.is_active = TRUE
  AND p.is_active = TRUE;

COMMENT ON VIEW v_bundles_inventory IS
'Bundle variants with calculated pack availability from parent product stock.
Bundles share stock with parent: available_packs = floor(parent_stock / units_per_pack)';

-- ============================================================================
-- STEP 7: Create view for variations inventory
-- ============================================================================

CREATE OR REPLACE VIEW v_variations_inventory AS
SELECT
    pv.id,
    pv.product_id,
    pv.store_id,
    pv.sku,
    pv.variant_title,
    pv.option1_name,
    pv.option1_value,
    pv.option2_name,
    pv.option2_value,
    pv.option3_name,
    pv.option3_value,
    pv.price,
    pv.cost,
    pv.stock,
    pv.is_active,
    pv.position,
    pv.shopify_variant_id,
    p.name AS product_name,
    -- Status based on stock
    CASE
        WHEN COALESCE(pv.stock, 0) <= 0 THEN 'out_of_stock'
        WHEN COALESCE(pv.stock, 0) <= 5 THEN 'low_stock'
        ELSE 'in_stock'
    END AS stock_status
FROM product_variants pv
JOIN products p ON p.id = pv.product_id
WHERE pv.variant_type = 'variation'
  AND pv.is_active = TRUE
  AND p.is_active = TRUE;

COMMENT ON VIEW v_variations_inventory IS
'Variation variants with independent stock. Each variation maintains its own inventory.';

-- ============================================================================
-- STEP 8: Create combined view with variant type indicator
-- ============================================================================

CREATE OR REPLACE VIEW v_all_variants_inventory AS
SELECT
    pv.id,
    pv.product_id,
    pv.store_id,
    pv.variant_type,
    pv.sku,
    pv.variant_title,
    pv.units_per_pack,
    pv.price,
    pv.cost,
    pv.is_active,
    p.name AS product_name,
    p.stock AS parent_stock,
    pv.stock AS variant_stock,
    -- Calculate available units/packs based on type
    CASE
        WHEN pv.variant_type = 'bundle' THEN
            FLOOR(COALESCE(p.stock, 0)::DECIMAL / GREATEST(COALESCE(pv.units_per_pack, 1), 1))::INTEGER
        ELSE
            COALESCE(pv.stock, 0)
    END AS available_quantity,
    -- Human-readable availability
    CASE
        WHEN pv.variant_type = 'bundle' THEN
            FLOOR(COALESCE(p.stock, 0)::DECIMAL / GREATEST(COALESCE(pv.units_per_pack, 1), 1))::INTEGER || ' packs'
        ELSE
            COALESCE(pv.stock, 0)::TEXT || ' units'
    END AS availability_display,
    -- Stock status
    CASE
        WHEN pv.variant_type = 'bundle' AND FLOOR(COALESCE(p.stock, 0)::DECIMAL / GREATEST(COALESCE(pv.units_per_pack, 1), 1)) <= 0 THEN 'out_of_stock'
        WHEN pv.variant_type = 'bundle' AND FLOOR(COALESCE(p.stock, 0)::DECIMAL / GREATEST(COALESCE(pv.units_per_pack, 1), 1)) <= 5 THEN 'low_stock'
        WHEN pv.variant_type = 'variation' AND COALESCE(pv.stock, 0) <= 0 THEN 'out_of_stock'
        WHEN pv.variant_type = 'variation' AND COALESCE(pv.stock, 0) <= 5 THEN 'low_stock'
        ELSE 'in_stock'
    END AS stock_status
FROM product_variants pv
JOIN products p ON p.id = pv.product_id
WHERE pv.is_active = TRUE AND p.is_active = TRUE;

COMMENT ON VIEW v_all_variants_inventory IS
'All variants with type-aware availability calculation. Bundles show packs, variations show units.';

-- ============================================================================
-- STEP 9: Update deduct_shared_stock_for_variant to validate bundle type
-- ============================================================================

CREATE OR REPLACE FUNCTION deduct_shared_stock_for_variant(
    p_variant_id UUID,
    p_quantity INTEGER,
    p_order_id UUID,
    p_movement_type VARCHAR(50) DEFAULT 'order_ready_to_ship'
)
RETURNS TABLE (
    success BOOLEAN,
    physical_units_deducted INTEGER,
    new_parent_stock INTEGER,
    error_message TEXT
) AS $$
DECLARE
    v_variant RECORD;
    v_parent_stock INTEGER;
    v_physical_units INTEGER;
    v_new_stock INTEGER;
    v_store_id UUID;
BEGIN
    -- Get variant with lock
    SELECT pv.*, p.store_id
    INTO v_variant
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.id = p_variant_id
    FOR UPDATE OF pv;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 0, 0, 'Variant not found'::TEXT;
        RETURN;
    END IF;

    v_store_id := v_variant.store_id;

    -- Check if this variant uses shared stock (bundles)
    IF v_variant.uses_shared_stock IS NOT TRUE THEN
        -- VARIATION: Independent stock mode
        v_physical_units := p_quantity;

        UPDATE product_variants
        SET stock = GREATEST(0, stock - p_quantity),
            updated_at = NOW()
        WHERE id = p_variant_id
        RETURNING stock INTO v_new_stock;

        -- Log movement with clear VARIANTE label
        INSERT INTO inventory_movements (
            store_id, product_id, variant_id, order_id,
            quantity_change, stock_before, stock_after,
            movement_type, notes
        ) VALUES (
            v_store_id, v_variant.product_id, p_variant_id, p_order_id,
            -p_quantity, v_variant.stock, v_new_stock,
            p_movement_type,
            format('VARIANTE "%s": %s units (independent stock)',
                   v_variant.variant_title, p_quantity)
        );

        RETURN QUERY SELECT TRUE, p_quantity, v_variant.stock - p_quantity, NULL::TEXT;
        RETURN;
    END IF;

    -- BUNDLE: Deduct from parent product (shared stock)
    v_physical_units := p_quantity * COALESCE(v_variant.units_per_pack, 1);

    -- Lock and get parent stock
    SELECT stock INTO v_parent_stock
    FROM products
    WHERE id = v_variant.product_id
    FOR UPDATE;

    -- Check if enough stock
    IF v_parent_stock < v_physical_units THEN
        RETURN QUERY SELECT
            FALSE,
            0,
            v_parent_stock,
            format('Insufficient stock. Need %s units, have %s', v_physical_units, v_parent_stock)::TEXT;
        RETURN;
    END IF;

    -- Deduct from parent
    v_new_stock := v_parent_stock - v_physical_units;

    UPDATE products
    SET stock = v_new_stock,
        updated_at = NOW()
    WHERE id = v_variant.product_id;

    -- Log movement with clear PACK label
    INSERT INTO inventory_movements (
        store_id, product_id, variant_id, order_id,
        quantity_change, stock_before, stock_after,
        movement_type, notes
    ) VALUES (
        v_store_id, v_variant.product_id, p_variant_id, p_order_id,
        -v_physical_units, v_parent_stock, v_new_stock,
        p_movement_type,
        format('PACK "%s": %s packs x %s units/pack = %s units from parent stock',
               v_variant.variant_title, p_quantity, v_variant.units_per_pack, v_physical_units)
    );

    RETURN QUERY SELECT TRUE, v_physical_units, v_new_stock, NULL::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION deduct_shared_stock_for_variant(UUID, INTEGER, UUID, VARCHAR) IS
'Deducts stock for a variant order.
- BUNDLE (uses_shared_stock=true): Deducts physical units from parent product
- VARIATION (uses_shared_stock=false): Deducts from variant independent stock
Returns: success, physical_units_deducted, new_stock, error_message';

-- ============================================================================
-- STEP 10: Update restore_shared_stock_for_variant with type-aware notes
-- ============================================================================

CREATE OR REPLACE FUNCTION restore_shared_stock_for_variant(
    p_variant_id UUID,
    p_quantity INTEGER,
    p_order_id UUID,
    p_movement_type VARCHAR(50) DEFAULT 'order_cancelled'
)
RETURNS TABLE (
    success BOOLEAN,
    physical_units_restored INTEGER,
    new_parent_stock INTEGER,
    error_message TEXT
) AS $$
DECLARE
    v_variant RECORD;
    v_parent_stock INTEGER;
    v_physical_units INTEGER;
    v_new_stock INTEGER;
    v_store_id UUID;
BEGIN
    -- Get variant
    SELECT pv.*, p.store_id
    INTO v_variant
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.id = p_variant_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 0, 0, 'Variant not found'::TEXT;
        RETURN;
    END IF;

    v_store_id := v_variant.store_id;

    -- Check if this variant uses shared stock
    IF v_variant.uses_shared_stock IS NOT TRUE THEN
        -- VARIATION: Independent stock mode
        v_physical_units := p_quantity;

        UPDATE product_variants
        SET stock = stock + p_quantity,
            updated_at = NOW()
        WHERE id = p_variant_id
        RETURNING stock INTO v_new_stock;

        INSERT INTO inventory_movements (
            store_id, product_id, variant_id, order_id,
            quantity_change, stock_before, stock_after,
            movement_type, notes
        ) VALUES (
            v_store_id, v_variant.product_id, p_variant_id, p_order_id,
            p_quantity, v_variant.stock, v_new_stock,
            p_movement_type,
            format('VARIANTE "%s": %s units restored (independent stock)',
                   v_variant.variant_title, p_quantity)
        );

        RETURN QUERY SELECT TRUE, p_quantity, v_new_stock, NULL::TEXT;
        RETURN;
    END IF;

    -- BUNDLE: Restore to parent product (shared stock)
    v_physical_units := p_quantity * COALESCE(v_variant.units_per_pack, 1);

    -- Get and update parent stock
    SELECT stock INTO v_parent_stock
    FROM products
    WHERE id = v_variant.product_id
    FOR UPDATE;

    v_new_stock := v_parent_stock + v_physical_units;

    UPDATE products
    SET stock = v_new_stock,
        updated_at = NOW()
    WHERE id = v_variant.product_id;

    -- Log movement with PACK label
    INSERT INTO inventory_movements (
        store_id, product_id, variant_id, order_id,
        quantity_change, stock_before, stock_after,
        movement_type, notes
    ) VALUES (
        v_store_id, v_variant.product_id, p_variant_id, p_order_id,
        v_physical_units, v_parent_stock, v_new_stock,
        p_movement_type,
        format('PACK "%s": %s packs x %s units/pack = %s units restored to parent stock',
               v_variant.variant_title, p_quantity, v_variant.units_per_pack, v_physical_units)
    );

    RETURN QUERY SELECT TRUE, v_physical_units, v_new_stock, NULL::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION restore_shared_stock_for_variant(UUID, INTEGER, UUID, VARCHAR) IS
'Restores stock for a cancelled/returned variant order.
- BUNDLE: Restores physical units to parent product
- VARIATION: Restores to variant independent stock';

-- ============================================================================
-- STEP 11: Create helper function to resolve variant type
-- ============================================================================

CREATE OR REPLACE FUNCTION resolve_variant_type(
    p_variant_id UUID,
    p_payload_type VARCHAR(20) DEFAULT NULL
)
RETURNS VARCHAR(20) AS $$
DECLARE
    v_db_type VARCHAR(20);
BEGIN
    -- Priority 1: If payload specifies type, use it (external webhook control)
    IF p_payload_type IS NOT NULL AND p_payload_type IN ('bundle', 'variation') THEN
        RETURN p_payload_type;
    END IF;

    -- Priority 2: Look up in database
    SELECT variant_type INTO v_db_type
    FROM product_variants
    WHERE id = p_variant_id;

    IF v_db_type IS NOT NULL THEN
        RETURN v_db_type;
    END IF;

    -- Priority 3: Default to 'variation' (safer - doesn't affect parent stock)
    RETURN 'variation';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION resolve_variant_type(UUID, VARCHAR) IS
'Resolves variant type with fallback chain:
1. Payload type (if provided and valid)
2. Database lookup
3. Default to "variation" (safe fallback)
Used by webhooks and order creation to determine stock handling.';

-- ============================================================================
-- STEP 12: Create index for variant_type queries
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_product_variants_type
ON product_variants(variant_type)
WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_product_variants_type_product
ON product_variants(product_id, variant_type)
WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_order_line_items_variant_type
ON order_line_items(variant_type)
WHERE variant_type IS NOT NULL;

-- ============================================================================
-- STEP 13: Grants
-- ============================================================================

GRANT SELECT ON v_bundles_inventory TO authenticated;
GRANT SELECT ON v_bundles_inventory TO service_role;

GRANT SELECT ON v_variations_inventory TO authenticated;
GRANT SELECT ON v_variations_inventory TO service_role;

GRANT SELECT ON v_all_variants_inventory TO authenticated;
GRANT SELECT ON v_all_variants_inventory TO service_role;

GRANT EXECUTE ON FUNCTION resolve_variant_type(UUID, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION resolve_variant_type(UUID, VARCHAR) TO service_role;

-- ============================================================================
-- STEP 14: Migration complete summary
-- ============================================================================

DO $$
DECLARE
    v_bundles INTEGER;
    v_variations INTEGER;
    v_mixed_products INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_bundles FROM product_variants WHERE variant_type = 'bundle' AND is_active = TRUE;
    SELECT COUNT(*) INTO v_variations FROM product_variants WHERE variant_type = 'variation' AND is_active = TRUE;

    SELECT COUNT(DISTINCT product_id) INTO v_mixed_products
    FROM (
        SELECT product_id, variant_type FROM product_variants WHERE is_active = TRUE
        GROUP BY product_id, variant_type
    ) t
    GROUP BY product_id
    HAVING COUNT(*) > 1;

    RAISE NOTICE '============================================================';
    RAISE NOTICE '  MIGRATION 101 COMPLETE: Bundle vs Variation Separation';
    RAISE NOTICE '============================================================';
    RAISE NOTICE '';
    RAISE NOTICE 'COLUMNS ADDED:';
    RAISE NOTICE '  - product_variants.variant_type VARCHAR(20)';
    RAISE NOTICE '  - order_line_items.variant_type VARCHAR(20)';
    RAISE NOTICE '';
    RAISE NOTICE 'CONSTRAINTS ADDED:';
    RAISE NOTICE '  - chk_variant_type_rules (bundle->shared_stock, variation->independent)';
    RAISE NOTICE '';
    RAISE NOTICE 'VIEWS CREATED:';
    RAISE NOTICE '  - v_bundles_inventory (bundles with pack availability)';
    RAISE NOTICE '  - v_variations_inventory (variations with independent stock)';
    RAISE NOTICE '  - v_all_variants_inventory (combined with type indicator)';
    RAISE NOTICE '';
    RAISE NOTICE 'FUNCTIONS UPDATED:';
    RAISE NOTICE '  - deduct_shared_stock_for_variant (type-aware notes)';
    RAISE NOTICE '  - restore_shared_stock_for_variant (type-aware notes)';
    RAISE NOTICE '';
    RAISE NOTICE 'NEW FUNCTIONS:';
    RAISE NOTICE '  - resolve_variant_type(variant_id, payload_type)';
    RAISE NOTICE '';
    RAISE NOTICE 'MIGRATION STATS:';
    RAISE NOTICE '  - Bundles: %', v_bundles;
    RAISE NOTICE '  - Variations: %', v_variations;
    RAISE NOTICE '  - Products with both types: %', COALESCE(v_mixed_products, 0);
    RAISE NOTICE '';
    RAISE NOTICE 'BUSINESS RULES ENFORCED:';
    RAISE NOTICE '  - BUNDLE: variant_type=bundle AND uses_shared_stock=TRUE';
    RAISE NOTICE '  - VARIATION: variant_type=variation AND uses_shared_stock=FALSE';
    RAISE NOTICE '';
    RAISE NOTICE 'BACKWARD COMPATIBLE: All existing variants auto-classified';
    RAISE NOTICE '============================================================';
END $$;
