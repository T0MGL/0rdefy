-- ============================================================================
-- Migration 087: Shared Stock for Bundle Variants
-- ============================================================================
--
-- DESCRIPTION:
-- Adds support for variants that share stock with the parent product.
-- Each variant can specify how many physical units it consumes from the
-- parent product's stock pool.
--
-- USE CASE:
-- - NOCTE Glasses with 150 physical units
-- - Variant "Personal" (1 unit) - consumes 1 from pool
-- - Variant "Pareja" (2 units) - consumes 2 from pool
-- - Variant "Oficina" (3 units) - consumes 3 from pool
--
-- HOW IT WORKS:
-- 1. Product has stock = 150 (physical units)
-- 2. Each variant has units_per_pack (e.g., 1, 2, 3)
-- 3. When order ships, stock deducted = quantity * units_per_pack
-- 4. Variant's "available stock" is calculated as floor(parent_stock / units_per_pack)
--
-- BACKWARD COMPATIBLE:
-- - uses_shared_stock defaults to FALSE
-- - units_per_pack defaults to 1
-- - Existing variants continue working independently
--
-- CRITICAL: This migration works with the EXISTING trigger system from
-- migration 057 (update_product_stock_on_order_status) which uses line_items JSONB.
-- The variant stock handling is done via order_line_items table which is populated
-- by the warehouse system.
--
-- ============================================================================

-- ============================================================================
-- STEP 1: Add shared stock columns to product_variants
-- ============================================================================

DO $$
BEGIN
    -- Add uses_shared_stock column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'product_variants' AND column_name = 'uses_shared_stock'
    ) THEN
        ALTER TABLE product_variants ADD COLUMN uses_shared_stock BOOLEAN DEFAULT FALSE;
        RAISE NOTICE '  Added uses_shared_stock column to product_variants';
    ELSE
        RAISE NOTICE '  uses_shared_stock column already exists';
    END IF;

    -- Add units_per_pack column (how many physical units this variant consumes)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'product_variants' AND column_name = 'units_per_pack'
    ) THEN
        ALTER TABLE product_variants ADD COLUMN units_per_pack INTEGER DEFAULT 1 CHECK (units_per_pack >= 1);
        RAISE NOTICE '  Added units_per_pack column to product_variants';
    ELSE
        RAISE NOTICE '  units_per_pack column already exists';
    END IF;
END $$;

-- ============================================================================
-- STEP 2: Create function to handle shared stock deduction for variants
-- This is called by the API/warehouse when processing orders with variants
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

    -- Check if this variant uses shared stock
    IF v_variant.uses_shared_stock IS NOT TRUE THEN
        -- Independent stock mode - use existing logic
        v_physical_units := p_quantity;

        UPDATE product_variants
        SET stock = GREATEST(0, stock - p_quantity),
            updated_at = NOW()
        WHERE id = p_variant_id
        RETURNING stock INTO v_new_stock;

        -- Log movement
        INSERT INTO inventory_movements (
            store_id, product_id, variant_id, order_id,
            quantity_change, stock_before, stock_after,
            movement_type, notes
        ) VALUES (
            v_store_id, v_variant.product_id, p_variant_id, p_order_id,
            -p_quantity, v_variant.stock, v_new_stock,
            p_movement_type, 'Independent variant stock'
        );

        RETURN QUERY SELECT TRUE, p_quantity, v_variant.stock - p_quantity, NULL::TEXT;
        RETURN;
    END IF;

    -- SHARED STOCK: Deduct from parent product
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

    -- Log movement with detailed notes
    INSERT INTO inventory_movements (
        store_id, product_id, variant_id, order_id,
        quantity_change, stock_before, stock_after,
        movement_type, notes
    ) VALUES (
        v_store_id, v_variant.product_id, p_variant_id, p_order_id,
        -v_physical_units, v_parent_stock, v_new_stock,
        p_movement_type,
        format('Shared stock: %s packs x %s units/pack = %s units deducted from parent',
               p_quantity, v_variant.units_per_pack, v_physical_units)
    );

    RETURN QUERY SELECT TRUE, v_physical_units, v_new_stock, NULL::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION deduct_shared_stock_for_variant(UUID, INTEGER, UUID, VARCHAR) IS
'Deducts stock for a variant order. If variant uses shared stock, deducts from parent product.
Returns: success, physical_units_deducted, new_parent_stock, error_message';

-- ============================================================================
-- STEP 3: Create function to restore shared stock for cancelled orders
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
        -- Independent stock mode
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
            p_movement_type, 'Independent variant stock restored'
        );

        RETURN QUERY SELECT TRUE, p_quantity, v_new_stock, NULL::TEXT;
        RETURN;
    END IF;

    -- SHARED STOCK: Restore to parent product
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

    -- Log movement
    INSERT INTO inventory_movements (
        store_id, product_id, variant_id, order_id,
        quantity_change, stock_before, stock_after,
        movement_type, notes
    ) VALUES (
        v_store_id, v_variant.product_id, p_variant_id, p_order_id,
        v_physical_units, v_parent_stock, v_new_stock,
        p_movement_type,
        format('Shared stock restored: %s packs x %s units/pack = %s units returned to parent',
               p_quantity, v_variant.units_per_pack, v_physical_units)
    );

    RETURN QUERY SELECT TRUE, v_physical_units, v_new_stock, NULL::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION restore_shared_stock_for_variant(UUID, INTEGER, UUID, VARCHAR) IS
'Restores stock for a cancelled/returned variant order. If variant uses shared stock, restores to parent product.';

-- ============================================================================
-- STEP 4: Function to calculate available packs for shared stock variants
-- ============================================================================

CREATE OR REPLACE FUNCTION get_variant_available_stock(
    p_variant_id UUID
)
RETURNS INTEGER AS $$
DECLARE
    v_variant RECORD;
    v_parent_stock INTEGER;
BEGIN
    SELECT * INTO v_variant FROM product_variants WHERE id = p_variant_id AND is_active = TRUE;

    IF NOT FOUND THEN
        RETURN 0;
    END IF;

    IF v_variant.uses_shared_stock = TRUE THEN
        -- Shared stock: calculate available packs from parent
        SELECT stock INTO v_parent_stock FROM products WHERE id = v_variant.product_id;
        RETURN FLOOR(COALESCE(v_parent_stock, 0)::DECIMAL / COALESCE(v_variant.units_per_pack, 1));
    ELSE
        -- Independent stock: return variant's own stock
        RETURN COALESCE(v_variant.stock, 0);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_variant_available_stock(UUID) IS
'Returns available stock for a variant. For shared stock variants, calculates packs from parent stock.';

-- ============================================================================
-- STEP 5: View for variants with calculated available stock
-- ============================================================================

CREATE OR REPLACE VIEW v_variants_with_availability AS
SELECT
    pv.id,
    pv.product_id,
    pv.store_id,
    pv.sku,
    pv.variant_title,
    pv.option1_name,
    pv.option1_value,
    pv.price,
    pv.cost,
    pv.uses_shared_stock,
    pv.units_per_pack,
    pv.is_active,
    pv.position,
    p.name AS product_name,
    p.stock AS parent_stock,
    pv.stock AS variant_stock,

    -- Calculate available stock (packs that can be sold)
    CASE
        WHEN pv.uses_shared_stock = TRUE THEN
            FLOOR(COALESCE(p.stock, 0)::DECIMAL / COALESCE(pv.units_per_pack, 1))::INTEGER
        ELSE
            COALESCE(pv.stock, 0)
    END AS available_stock,

    -- Stock source indicator
    CASE
        WHEN pv.uses_shared_stock = TRUE THEN 'shared'
        ELSE 'independent'
    END AS stock_mode

FROM product_variants pv
JOIN products p ON p.id = pv.product_id
WHERE pv.is_active = TRUE AND p.is_active = TRUE;

COMMENT ON VIEW v_variants_with_availability IS
'Variants with calculated available stock. Shared stock variants show packs available from parent.';

-- ============================================================================
-- STEP 6: Function to enable shared stock on all variants of a product
-- ============================================================================

CREATE OR REPLACE FUNCTION enable_shared_stock_for_product(
    p_product_id UUID,
    p_variant_units JSONB DEFAULT NULL  -- Optional: {"variant_id": units_per_pack, ...}
)
RETURNS TABLE (
    success BOOLEAN,
    updated_count INTEGER,
    message TEXT
) AS $$
DECLARE
    v_updated INTEGER := 0;
    v_variant RECORD;
    v_units INTEGER;
BEGIN
    -- Update all variants to use shared stock
    FOR v_variant IN
        SELECT id, variant_title FROM product_variants
        WHERE product_id = p_product_id AND is_active = TRUE
    LOOP
        -- Get units_per_pack from parameter or default to 1
        v_units := COALESCE((p_variant_units->>v_variant.id::TEXT)::INTEGER, 1);

        UPDATE product_variants
        SET uses_shared_stock = TRUE,
            units_per_pack = v_units,
            stock = 0,  -- Clear variant stock since using parent
            updated_at = NOW()
        WHERE id = v_variant.id;

        v_updated := v_updated + 1;
    END LOOP;

    RETURN QUERY SELECT TRUE, v_updated,
        'Enabled shared stock for ' || v_updated || ' variants. Stock now managed from parent product.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION enable_shared_stock_for_product(UUID, JSONB) IS
'Enables shared stock mode for all variants of a product. Optionally set units_per_pack per variant.';

-- ============================================================================
-- STEP 7: Update adjust_variant_stock to handle shared stock
-- ============================================================================

CREATE OR REPLACE FUNCTION adjust_variant_stock(
    p_variant_id UUID,
    p_quantity_change INTEGER,
    p_movement_type VARCHAR(50),
    p_order_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
    success BOOLEAN,
    new_stock INTEGER,
    error_message TEXT
) AS $$
DECLARE
    v_variant RECORD;
    v_stock_before INTEGER;
    v_stock_after INTEGER;
    v_physical_units INTEGER;
    v_store_id UUID;
BEGIN
    -- Get variant info
    SELECT pv.*, p.store_id, p.stock as parent_stock
    INTO v_variant
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.id = p_variant_id
    FOR UPDATE OF pv;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 0, 'Variant not found'::TEXT;
        RETURN;
    END IF;

    v_store_id := v_variant.store_id;

    -- Handle shared stock vs independent stock
    IF v_variant.uses_shared_stock = TRUE THEN
        -- SHARED STOCK: Adjust parent product stock
        -- For shared stock, quantity_change represents PACKS, so multiply by units_per_pack
        v_physical_units := p_quantity_change * COALESCE(v_variant.units_per_pack, 1);
        v_stock_before := v_variant.parent_stock;
        v_stock_after := GREATEST(0, v_stock_before + v_physical_units);

        UPDATE products
        SET stock = v_stock_after,
            updated_at = NOW()
        WHERE id = v_variant.product_id;

        -- Log the movement
        INSERT INTO inventory_movements (
            store_id, product_id, variant_id, order_id,
            quantity_change, stock_before, stock_after,
            movement_type, notes
        ) VALUES (
            v_store_id, v_variant.product_id, p_variant_id, p_order_id,
            v_physical_units, v_stock_before, v_stock_after,
            p_movement_type,
            COALESCE(p_notes, format('Shared stock adjustment: %s packs x %s units/pack = %s units',
                                     p_quantity_change, v_variant.units_per_pack, v_physical_units))
        );

        -- Return available packs (not raw units)
        RETURN QUERY SELECT TRUE,
            FLOOR(v_stock_after::DECIMAL / COALESCE(v_variant.units_per_pack, 1))::INTEGER,
            NULL::TEXT;
    ELSE
        -- INDEPENDENT STOCK: Adjust variant's own stock
        v_stock_before := v_variant.stock;
        v_stock_after := GREATEST(0, v_stock_before + p_quantity_change);

        UPDATE product_variants
        SET stock = v_stock_after,
            updated_at = NOW()
        WHERE id = p_variant_id;

        -- Log the movement
        INSERT INTO inventory_movements (
            store_id, product_id, variant_id, order_id,
            quantity_change, stock_before, stock_after,
            movement_type, notes
        ) VALUES (
            v_store_id, v_variant.product_id, p_variant_id, p_order_id,
            p_quantity_change, v_stock_before, v_stock_after,
            p_movement_type,
            COALESCE(p_notes, 'Independent variant stock adjustment')
        );

        RETURN QUERY SELECT TRUE, v_stock_after, NULL::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION adjust_variant_stock(UUID, INTEGER, VARCHAR, UUID, TEXT) IS
'Adjusts variant stock atomically. Handles both shared and independent stock modes.
For shared stock: adjusts parent product and calculates physical units.
For independent stock: adjusts variant directly.';

-- ============================================================================
-- STEP 8: Grants
-- ============================================================================

GRANT EXECUTE ON FUNCTION deduct_shared_stock_for_variant(UUID, INTEGER, UUID, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION deduct_shared_stock_for_variant(UUID, INTEGER, UUID, VARCHAR) TO service_role;

GRANT EXECUTE ON FUNCTION restore_shared_stock_for_variant(UUID, INTEGER, UUID, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION restore_shared_stock_for_variant(UUID, INTEGER, UUID, VARCHAR) TO service_role;

GRANT EXECUTE ON FUNCTION get_variant_available_stock(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_variant_available_stock(UUID) TO service_role;

GRANT EXECUTE ON FUNCTION enable_shared_stock_for_product(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION enable_shared_stock_for_product(UUID, JSONB) TO service_role;

GRANT SELECT ON v_variants_with_availability TO authenticated;
GRANT SELECT ON v_variants_with_availability TO service_role;

-- ============================================================================
-- STEP 9: Migration complete summary
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================================';
    RAISE NOTICE '  MIGRATION 087 COMPLETE: Shared Stock for Bundle Variants';
    RAISE NOTICE '============================================================';
    RAISE NOTICE '';
    RAISE NOTICE 'COLUMNS ADDED TO product_variants:';
    RAISE NOTICE '  - uses_shared_stock BOOLEAN (default FALSE)';
    RAISE NOTICE '  - units_per_pack INTEGER (default 1)';
    RAISE NOTICE '';
    RAISE NOTICE 'FUNCTIONS CREATED:';
    RAISE NOTICE '  - deduct_shared_stock_for_variant(variant_id, qty, order_id, type)';
    RAISE NOTICE '  - restore_shared_stock_for_variant(variant_id, qty, order_id, type)';
    RAISE NOTICE '  - get_variant_available_stock(variant_id)';
    RAISE NOTICE '  - enable_shared_stock_for_product(product_id, variant_units)';
    RAISE NOTICE '  - adjust_variant_stock (UPDATED for shared stock)';
    RAISE NOTICE '';
    RAISE NOTICE 'VIEWS CREATED:';
    RAISE NOTICE '  - v_variants_with_availability';
    RAISE NOTICE '';
    RAISE NOTICE 'IMPORTANT: This migration does NOT modify the existing stock';
    RAISE NOTICE 'trigger. The shared stock functions should be called by the';
    RAISE NOTICE 'warehouse service when processing orders with variants.';
    RAISE NOTICE '';
    RAISE NOTICE 'HOW TO USE:';
    RAISE NOTICE '  1. Create product with stock = total physical units (e.g., 150)';
    RAISE NOTICE '  2. Create variants with uses_shared_stock = TRUE';
    RAISE NOTICE '  3. Set units_per_pack for each variant (1, 2, 3, etc.)';
    RAISE NOTICE '  4. Call deduct_shared_stock_for_variant when order ships';
    RAISE NOTICE '  5. Call restore_shared_stock_for_variant if order cancelled';
    RAISE NOTICE '';
    RAISE NOTICE 'EXAMPLE:';
    RAISE NOTICE '  Product: NOCTE Glasses, stock = 150';
    RAISE NOTICE '  Variant "Personal": units_per_pack = 1, available = 150';
    RAISE NOTICE '  Variant "Pareja": units_per_pack = 2, available = 75';
    RAISE NOTICE '  Variant "Oficina": units_per_pack = 3, available = 50';
    RAISE NOTICE '';
    RAISE NOTICE 'BACKWARD COMPATIBLE: Existing variants unaffected';
    RAISE NOTICE '============================================================';
END $$;
