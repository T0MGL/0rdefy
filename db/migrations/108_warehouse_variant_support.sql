-- ============================================================================
-- MIGRATION 108: Complete Warehouse Variant Support (PRODUCTION-READY)
-- ============================================================================
--
-- CRITICAL BUGS FIXED:
--
-- BUG 1: packing_progress table missing variant_id column
--        - Cannot track which variant is being packed
--        - FIX: Add variant_id column with FK to product_variants
--
-- BUG 2: UNIQUE constraints don't include variant_id
--        - Same product with different variants creates duplicates or conflicts
--        - FIX: Update UNIQUE constraints to include variant_id
--
-- BUG 3: increment_packing_quantity RPC doesn't filter by variant_id
--        - Two variants of same product in session cause wrong calculations
--        - FIX: Add variant_id parameter and filtering
--
-- BUG 4: Service layer queries don't filter by variant_id
--        - updatePickingProgress and updatePackingProgress match wrong records
--        - FIX: Add helper RPCs that accept variant_id
--
-- SAFETY:
-- - Idempotent (safe to run multiple times)
-- - Transaction wrapped for atomicity
-- - Backward compatible with NULL variant_id
-- - No destructive operations
--
-- Author: Claude
-- Date: 2026-01-23
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Add variant_id column to packing_progress
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'packing_progress' AND column_name = 'variant_id'
    ) THEN
        ALTER TABLE packing_progress
        ADD COLUMN variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL;

        RAISE NOTICE '[108] Added variant_id column to packing_progress';
    ELSE
        RAISE NOTICE '[108] variant_id already exists in packing_progress';
    END IF;
END $$;

-- Create index for variant_id queries
CREATE INDEX IF NOT EXISTS idx_packing_progress_variant_id
ON packing_progress(variant_id)
WHERE variant_id IS NOT NULL;

-- ============================================================================
-- STEP 2: Update UNIQUE constraints to include variant_id
-- Uses COALESCE to handle NULL variant_id (products without variants)
-- ============================================================================

-- 2a. Update picking_session_items UNIQUE constraint
DO $$
BEGIN
    -- Drop old constraint if exists
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'picking_session_items_picking_session_id_product_id_key'
    ) THEN
        ALTER TABLE picking_session_items
        DROP CONSTRAINT picking_session_items_picking_session_id_product_id_key;
        RAISE NOTICE '[108] Dropped old UNIQUE constraint on picking_session_items';
    END IF;

    -- Drop the new constraint if it exists (idempotent)
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'picking_session_items_session_product_variant_key'
    ) THEN
        ALTER TABLE picking_session_items
        DROP CONSTRAINT picking_session_items_session_product_variant_key;
    END IF;
END $$;

-- Create unique index that handles NULL variant_id correctly
-- Using COALESCE with UUID zero ensures NULL variants are treated as a single unique value
DROP INDEX IF EXISTS idx_picking_session_items_unique_product_variant;
CREATE UNIQUE INDEX idx_picking_session_items_unique_product_variant
ON picking_session_items(picking_session_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::UUID));

COMMENT ON INDEX idx_picking_session_items_unique_product_variant IS
'Ensures unique (session, product, variant) combinations. Uses COALESCE for NULL-safe comparison.';

-- 2b. Update packing_progress UNIQUE constraint
DO $$
BEGIN
    -- Drop old constraint if exists
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'packing_progress_picking_session_id_order_id_product_id_key'
    ) THEN
        ALTER TABLE packing_progress
        DROP CONSTRAINT packing_progress_picking_session_id_order_id_product_id_key;
        RAISE NOTICE '[108] Dropped old UNIQUE constraint on packing_progress';
    END IF;

    -- Drop new constraint if exists (idempotent)
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'packing_progress_session_order_product_variant_key'
    ) THEN
        ALTER TABLE packing_progress
        DROP CONSTRAINT packing_progress_session_order_product_variant_key;
    END IF;
END $$;

-- Create unique index that handles NULL variant_id correctly
DROP INDEX IF EXISTS idx_packing_progress_unique_order_product_variant;
CREATE UNIQUE INDEX idx_packing_progress_unique_order_product_variant
ON packing_progress(picking_session_id, order_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::UUID));

COMMENT ON INDEX idx_packing_progress_unique_order_product_variant IS
'Ensures unique (session, order, product, variant) combinations. Uses COALESCE for NULL-safe comparison.';

-- ============================================================================
-- STEP 3: Update increment_packing_quantity RPC to handle variant_id
-- ============================================================================

-- Drop old function signature (without variant_id)
DROP FUNCTION IF EXISTS increment_packing_quantity(UUID, INTEGER, INTEGER, UUID, UUID);

-- Create new function with variant_id parameter
CREATE OR REPLACE FUNCTION increment_packing_quantity(
    p_progress_id UUID,
    p_quantity_needed INTEGER,
    p_picked_quantity INTEGER,
    p_session_id UUID,
    p_product_id UUID,
    p_variant_id UUID DEFAULT NULL  -- NEW: variant_id parameter
)
RETURNS TABLE (
    id UUID,
    picking_session_id UUID,
    order_id UUID,
    product_id UUID,
    variant_id UUID,  -- NEW: return variant_id
    quantity_needed INTEGER,
    quantity_packed INTEGER,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
DECLARE
    v_progress RECORD;
    v_session RECORD;
    v_order RECORD;
    v_total_packed INTEGER;
    v_new_quantity INTEGER;
BEGIN
    -- Lock session first (validates session exists and is in correct state)
    SELECT * INTO v_session
    FROM picking_sessions ps
    WHERE ps.id = p_session_id
    FOR UPDATE;

    IF v_session IS NULL THEN
        RAISE EXCEPTION 'Session not found';
    END IF;

    IF v_session.status != 'packing' THEN
        RAISE EXCEPTION 'Session is not in packing status (current: %)', v_session.status;
    END IF;

    -- Lock the specific packing progress record
    SELECT * INTO v_progress
    FROM packing_progress pp
    WHERE pp.id = p_progress_id
    FOR UPDATE;

    IF v_progress IS NULL THEN
        RAISE EXCEPTION 'Packing progress record not found';
    END IF;

    -- Validate packing_progress belongs to the session (security check)
    IF v_progress.picking_session_id != p_session_id THEN
        RAISE EXCEPTION 'Packing progress does not belong to this session';
    END IF;

    -- Lock and validate order status (prevent packing completed/cancelled orders)
    SELECT * INTO v_order
    FROM orders o
    WHERE o.id = v_progress.order_id
    FOR UPDATE;

    IF v_order IS NULL THEN
        RAISE EXCEPTION 'Order not found';
    END IF;

    -- Block if order reached stock-affecting status
    IF v_order.sleeves_status IN ('ready_to_ship', 'shipped', 'in_transit', 'delivered') THEN
        RAISE EXCEPTION 'Order % has already been completed (status: %). Cannot modify packing.',
            COALESCE(v_order.order_number, v_order.id::TEXT), v_order.sleeves_status;
    END IF;

    IF v_order.sleeves_status IN ('cancelled', 'rejected', 'returned') THEN
        RAISE EXCEPTION 'Order % has been % and cannot be packed.',
            COALESCE(v_order.order_number, v_order.id::TEXT), v_order.sleeves_status;
    END IF;

    -- Check if already fully packed for this specific order/product/variant
    IF v_progress.quantity_packed >= v_progress.quantity_needed THEN
        RAISE EXCEPTION 'This item is already fully packed for this order (packed: %, needed: %)',
            v_progress.quantity_packed, v_progress.quantity_needed;
    END IF;

    -- Calculate total packed across all orders for this product+variant
    -- CRITICAL FIX: Now filters by variant_id using COALESCE for NULL safety
    SELECT COALESCE(SUM(p.quantity_packed), 0) INTO v_total_packed
    FROM packing_progress p
    WHERE p.picking_session_id = p_session_id
    AND p.product_id = p_product_id
    AND COALESCE(p.variant_id, '00000000-0000-0000-0000-000000000000'::UUID) =
        COALESCE(p_variant_id, '00000000-0000-0000-0000-000000000000'::UUID);

    -- Validate against total picked quantity
    IF v_total_packed >= p_picked_quantity THEN
        RAISE EXCEPTION 'No more units available to pack. Picked: %, Already packed: %',
            p_picked_quantity, v_total_packed;
    END IF;

    -- Atomically increment (no read-modify-write race)
    v_new_quantity := v_progress.quantity_packed + 1;

    UPDATE packing_progress pp
    SET quantity_packed = v_new_quantity,
        updated_at = NOW()
    WHERE pp.id = p_progress_id;

    -- Update session last activity (important for staleness tracking)
    UPDATE picking_sessions ps
    SET last_activity_at = NOW()
    WHERE ps.id = p_session_id;

    -- Return updated record (now includes variant_id)
    RETURN QUERY
    SELECT
        pp.id,
        pp.picking_session_id,
        pp.order_id,
        pp.product_id,
        pp.variant_id,
        pp.quantity_needed,
        pp.quantity_packed,
        pp.created_at,
        pp.updated_at
    FROM packing_progress pp
    WHERE pp.id = p_progress_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION increment_packing_quantity(UUID, INTEGER, INTEGER, UUID, UUID, UUID) IS
'UPDATED in migration 108: Now handles variant_id for proper variant-aware packing.
Atomically increments packing quantity with full validation.
Prevents race conditions when update_packing_progress_atomic is unavailable.
Uses row-level locking and single UPDATE to ensure consistency.';

GRANT EXECUTE ON FUNCTION increment_packing_quantity(UUID, INTEGER, INTEGER, UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_packing_quantity(UUID, INTEGER, INTEGER, UUID, UUID, UUID) TO service_role;

-- ============================================================================
-- STEP 4: Create helper RPC for variant-aware packing progress lookup
-- This is used by the service layer to find the correct packing progress record
-- ============================================================================

CREATE OR REPLACE FUNCTION get_packing_progress_for_item(
    p_session_id UUID,
    p_order_id UUID,
    p_product_id UUID,
    p_variant_id UUID DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    picking_session_id UUID,
    order_id UUID,
    product_id UUID,
    variant_id UUID,
    quantity_needed INTEGER,
    quantity_packed INTEGER,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        pp.id,
        pp.picking_session_id,
        pp.order_id,
        pp.product_id,
        pp.variant_id,
        pp.quantity_needed,
        pp.quantity_packed,
        pp.created_at,
        pp.updated_at
    FROM packing_progress pp
    WHERE pp.picking_session_id = p_session_id
    AND pp.order_id = p_order_id
    AND pp.product_id = p_product_id
    AND COALESCE(pp.variant_id, '00000000-0000-0000-0000-000000000000'::UUID) =
        COALESCE(p_variant_id, '00000000-0000-0000-0000-000000000000'::UUID);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_packing_progress_for_item(UUID, UUID, UUID, UUID) IS
'Finds packing progress record for a specific (session, order, product, variant) combination.
Uses COALESCE for NULL-safe variant comparison.';

GRANT EXECUTE ON FUNCTION get_packing_progress_for_item(UUID, UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_packing_progress_for_item(UUID, UUID, UUID, UUID) TO service_role;

-- ============================================================================
-- STEP 5: Create helper RPC for variant-aware picking item lookup
-- ============================================================================

CREATE OR REPLACE FUNCTION get_picking_item_for_product(
    p_session_id UUID,
    p_product_id UUID,
    p_variant_id UUID DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    picking_session_id UUID,
    product_id UUID,
    variant_id UUID,
    total_quantity_needed INTEGER,
    quantity_picked INTEGER,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        psi.id,
        psi.picking_session_id,
        psi.product_id,
        psi.variant_id,
        psi.total_quantity_needed,
        psi.quantity_picked,
        psi.created_at,
        psi.updated_at
    FROM picking_session_items psi
    WHERE psi.picking_session_id = p_session_id
    AND psi.product_id = p_product_id
    AND COALESCE(psi.variant_id, '00000000-0000-0000-0000-000000000000'::UUID) =
        COALESCE(p_variant_id, '00000000-0000-0000-0000-000000000000'::UUID);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_picking_item_for_product(UUID, UUID, UUID) IS
'Finds picking session item for a specific (session, product, variant) combination.
Uses COALESCE for NULL-safe variant comparison.';

GRANT EXECUTE ON FUNCTION get_picking_item_for_product(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_picking_item_for_product(UUID, UUID, UUID) TO service_role;

-- ============================================================================
-- STEP 6: Create variant-aware update picking progress RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION update_picking_progress_with_variant(
    p_session_id UUID,
    p_product_id UUID,
    p_variant_id UUID,
    p_quantity_picked INTEGER,
    p_store_id UUID
)
RETURNS TABLE (
    id UUID,
    picking_session_id UUID,
    product_id UUID,
    variant_id UUID,
    total_quantity_needed INTEGER,
    quantity_picked INTEGER
) AS $$
DECLARE
    v_session RECORD;
    v_item RECORD;
BEGIN
    -- Validate session
    SELECT * INTO v_session
    FROM picking_sessions ps
    WHERE ps.id = p_session_id AND ps.store_id = p_store_id
    FOR UPDATE;

    IF v_session IS NULL THEN
        RAISE EXCEPTION 'Session not found or access denied';
    END IF;

    IF v_session.status != 'picking' THEN
        RAISE EXCEPTION 'Session is not in picking status';
    END IF;

    -- Find the correct item using COALESCE for NULL safety
    SELECT * INTO v_item
    FROM picking_session_items psi
    WHERE psi.picking_session_id = p_session_id
    AND psi.product_id = p_product_id
    AND COALESCE(psi.variant_id, '00000000-0000-0000-0000-000000000000'::UUID) =
        COALESCE(p_variant_id, '00000000-0000-0000-0000-000000000000'::UUID)
    FOR UPDATE;

    IF v_item IS NULL THEN
        RAISE EXCEPTION 'Item not found in picking session';
    END IF;

    -- Validate quantity
    IF p_quantity_picked < 0 OR p_quantity_picked > v_item.total_quantity_needed THEN
        RAISE EXCEPTION 'Invalid quantity. Must be between 0 and %', v_item.total_quantity_needed;
    END IF;

    -- Update the item
    UPDATE picking_session_items psi
    SET quantity_picked = p_quantity_picked,
        updated_at = NOW()
    WHERE psi.id = v_item.id;

    -- Update session activity
    UPDATE picking_sessions ps
    SET last_activity_at = NOW(),
        updated_at = NOW()
    WHERE ps.id = p_session_id;

    -- Return updated record
    RETURN QUERY
    SELECT
        psi.id,
        psi.picking_session_id,
        psi.product_id,
        psi.variant_id,
        psi.total_quantity_needed,
        psi.quantity_picked
    FROM picking_session_items psi
    WHERE psi.id = v_item.id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_picking_progress_with_variant(UUID, UUID, UUID, INTEGER, UUID) IS
'Updates picking progress for a specific product+variant combination.
Created in migration 108 to fix variant handling in warehouse.';

GRANT EXECUTE ON FUNCTION update_picking_progress_with_variant(UUID, UUID, UUID, INTEGER, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION update_picking_progress_with_variant(UUID, UUID, UUID, INTEGER, UUID) TO service_role;

-- ============================================================================
-- STEP 7: Create variant-aware update packing progress RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION update_packing_progress_with_variant(
    p_session_id UUID,
    p_order_id UUID,
    p_product_id UUID,
    p_variant_id UUID,
    p_store_id UUID
)
RETURNS TABLE (
    id UUID,
    picking_session_id UUID,
    order_id UUID,
    product_id UUID,
    variant_id UUID,
    quantity_needed INTEGER,
    quantity_packed INTEGER
) AS $$
DECLARE
    v_session RECORD;
    v_order RECORD;
    v_progress RECORD;
    v_picking_item RECORD;
    v_total_packed INTEGER;
BEGIN
    -- Validate session
    SELECT * INTO v_session
    FROM picking_sessions ps
    WHERE ps.id = p_session_id AND ps.store_id = p_store_id
    FOR UPDATE;

    IF v_session IS NULL THEN
        RAISE EXCEPTION 'Session not found or access denied';
    END IF;

    IF v_session.status != 'packing' THEN
        RAISE EXCEPTION 'Session is not in packing status';
    END IF;

    -- Validate order status
    SELECT * INTO v_order
    FROM orders o
    WHERE o.id = p_order_id
    FOR UPDATE;

    IF v_order IS NULL THEN
        RAISE EXCEPTION 'Order not found';
    END IF;

    IF v_order.sleeves_status IN ('ready_to_ship', 'shipped', 'in_transit', 'delivered') THEN
        RAISE EXCEPTION 'Order already completed (status: %)', v_order.sleeves_status;
    END IF;

    IF v_order.sleeves_status IN ('cancelled', 'rejected', 'returned') THEN
        RAISE EXCEPTION 'Order has been % and cannot be packed', v_order.sleeves_status;
    END IF;

    -- Find the correct packing progress record
    SELECT * INTO v_progress
    FROM packing_progress pp
    WHERE pp.picking_session_id = p_session_id
    AND pp.order_id = p_order_id
    AND pp.product_id = p_product_id
    AND COALESCE(pp.variant_id, '00000000-0000-0000-0000-000000000000'::UUID) =
        COALESCE(p_variant_id, '00000000-0000-0000-0000-000000000000'::UUID)
    FOR UPDATE;

    IF v_progress IS NULL THEN
        RAISE EXCEPTION 'Packing progress not found for this item';
    END IF;

    -- Check if already fully packed
    IF v_progress.quantity_packed >= v_progress.quantity_needed THEN
        RAISE EXCEPTION 'This item is already fully packed (packed: %, needed: %)',
            v_progress.quantity_packed, v_progress.quantity_needed;
    END IF;

    -- Get picking item to check basket availability
    SELECT * INTO v_picking_item
    FROM picking_session_items psi
    WHERE psi.picking_session_id = p_session_id
    AND psi.product_id = p_product_id
    AND COALESCE(psi.variant_id, '00000000-0000-0000-0000-000000000000'::UUID) =
        COALESCE(p_variant_id, '00000000-0000-0000-0000-000000000000'::UUID);

    -- Calculate total packed for this product+variant across all orders
    SELECT COALESCE(SUM(pp.quantity_packed), 0) INTO v_total_packed
    FROM packing_progress pp
    WHERE pp.picking_session_id = p_session_id
    AND pp.product_id = p_product_id
    AND COALESCE(pp.variant_id, '00000000-0000-0000-0000-000000000000'::UUID) =
        COALESCE(p_variant_id, '00000000-0000-0000-0000-000000000000'::UUID);

    -- Check basket availability
    IF v_picking_item IS NOT NULL AND v_total_packed >= v_picking_item.quantity_picked THEN
        RAISE EXCEPTION 'No more units available in basket (picked: %, packed: %)',
            v_picking_item.quantity_picked, v_total_packed;
    END IF;

    -- Increment quantity packed
    UPDATE packing_progress pp
    SET quantity_packed = v_progress.quantity_packed + 1,
        updated_at = NOW()
    WHERE pp.id = v_progress.id;

    -- Update session activity
    UPDATE picking_sessions ps
    SET last_activity_at = NOW(),
        updated_at = NOW()
    WHERE ps.id = p_session_id;

    -- Return updated record
    RETURN QUERY
    SELECT
        pp.id,
        pp.picking_session_id,
        pp.order_id,
        pp.product_id,
        pp.variant_id,
        pp.quantity_needed,
        pp.quantity_packed
    FROM packing_progress pp
    WHERE pp.id = v_progress.id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_packing_progress_with_variant(UUID, UUID, UUID, UUID, UUID) IS
'Atomically increments packing progress for a specific product+variant combination.
Created in migration 108 to fix variant handling in warehouse.
Includes all validation: session status, order status, quantity limits.';

GRANT EXECUTE ON FUNCTION update_packing_progress_with_variant(UUID, UUID, UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION update_packing_progress_with_variant(UUID, UUID, UUID, UUID, UUID) TO service_role;

-- ============================================================================
-- STEP 8: View to monitor warehouse variant status
-- ============================================================================

CREATE OR REPLACE VIEW v_warehouse_variant_status AS
SELECT
    ps.id as session_id,
    ps.code as session_code,
    ps.status as session_status,
    ps.store_id,
    psi.product_id,
    psi.variant_id,
    p.name as product_name,
    pv.variant_title,
    pv.uses_shared_stock,
    pv.units_per_pack,
    psi.total_quantity_needed,
    psi.quantity_picked,
    COALESCE(pp_agg.total_packed, 0) as total_packed,
    psi.quantity_picked - COALESCE(pp_agg.total_packed, 0) as remaining_in_basket
FROM picking_sessions ps
JOIN picking_session_items psi ON psi.picking_session_id = ps.id
LEFT JOIN products p ON p.id = psi.product_id
LEFT JOIN product_variants pv ON pv.id = psi.variant_id
LEFT JOIN (
    SELECT
        picking_session_id,
        product_id,
        variant_id,
        SUM(quantity_packed) as total_packed
    FROM packing_progress
    GROUP BY picking_session_id, product_id, variant_id
) pp_agg ON pp_agg.picking_session_id = psi.picking_session_id
    AND pp_agg.product_id = psi.product_id
    AND COALESCE(pp_agg.variant_id, '00000000-0000-0000-0000-000000000000'::UUID) =
        COALESCE(psi.variant_id, '00000000-0000-0000-0000-000000000000'::UUID)
WHERE ps.status IN ('picking', 'packing')
ORDER BY ps.store_id, ps.created_at DESC, p.name;

COMMENT ON VIEW v_warehouse_variant_status IS
'Shows current warehouse session status with variant details.
Use to debug variant-related picking/packing issues.';

GRANT SELECT ON v_warehouse_variant_status TO authenticated;
GRANT SELECT ON v_warehouse_variant_status TO service_role;

-- ============================================================================
-- STEP 9: Backfill existing packing_progress with variant_id from order_line_items
-- ============================================================================

DO $$
DECLARE
    v_updated_count INTEGER := 0;
BEGIN
    -- Backfill variant_id from order_line_items for existing packing_progress records
    -- This updates records where packing_progress.variant_id IS NULL
    -- but there's a matching order_line_item with a variant_id
    WITH line_items_with_variants AS (
        SELECT DISTINCT
            oli.order_id,
            oli.product_id,
            oli.variant_id
        FROM order_line_items oli
        WHERE oli.variant_id IS NOT NULL
    )
    UPDATE packing_progress pp
    SET variant_id = liv.variant_id
    FROM line_items_with_variants liv
    WHERE pp.order_id = liv.order_id
    AND pp.product_id = liv.product_id
    AND pp.variant_id IS NULL;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    IF v_updated_count > 0 THEN
        RAISE NOTICE '[108] Backfilled % packing_progress records with variant_id', v_updated_count;
    ELSE
        RAISE NOTICE '[108] No packing_progress records needed variant_id backfill';
    END IF;
END $$;

-- Also backfill picking_session_items that might be missing variant_id
DO $$
DECLARE
    v_updated_count INTEGER := 0;
BEGIN
    -- For active sessions, try to backfill variant_id from order_line_items
    -- by matching the order's line items to the picking session items
    WITH session_order_variants AS (
        SELECT DISTINCT
            pso.picking_session_id,
            oli.product_id,
            oli.variant_id
        FROM picking_session_orders pso
        JOIN order_line_items oli ON oli.order_id = pso.order_id
        WHERE oli.variant_id IS NOT NULL
    )
    UPDATE picking_session_items psi
    SET variant_id = sov.variant_id
    FROM session_order_variants sov
    WHERE psi.picking_session_id = sov.picking_session_id
    AND psi.product_id = sov.product_id
    AND psi.variant_id IS NULL;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    IF v_updated_count > 0 THEN
        RAISE NOTICE '[108] Backfilled % picking_session_items records with variant_id', v_updated_count;
    ELSE
        RAISE NOTICE '[108] No picking_session_items records needed variant_id backfill';
    END IF;
END $$;

-- ============================================================================
-- STEP 10: Verification
-- ============================================================================

DO $$
DECLARE
    v_packing_has_variant BOOLEAN;
    v_picking_idx_exists BOOLEAN;
    v_packing_idx_exists BOOLEAN;
    v_rpc_exists BOOLEAN;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '  MIGRATION 108 - VERIFICATION';
    RAISE NOTICE '============================================';

    -- Check packing_progress has variant_id
    SELECT EXISTS(
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'packing_progress' AND column_name = 'variant_id'
    ) INTO v_packing_has_variant;

    IF v_packing_has_variant THEN
        RAISE NOTICE 'OK: packing_progress.variant_id column exists';
    ELSE
        RAISE WARNING 'FAIL: packing_progress.variant_id NOT created';
    END IF;

    -- Check unique indexes
    SELECT EXISTS(
        SELECT 1 FROM pg_indexes WHERE indexname = 'idx_picking_session_items_unique_product_variant'
    ) INTO v_picking_idx_exists;

    IF v_picking_idx_exists THEN
        RAISE NOTICE 'OK: picking_session_items unique index with variant exists';
    ELSE
        RAISE WARNING 'FAIL: picking_session_items unique index NOT created';
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM pg_indexes WHERE indexname = 'idx_packing_progress_unique_order_product_variant'
    ) INTO v_packing_idx_exists;

    IF v_packing_idx_exists THEN
        RAISE NOTICE 'OK: packing_progress unique index with variant exists';
    ELSE
        RAISE WARNING 'FAIL: packing_progress unique index NOT created';
    END IF;

    -- Check RPCs exist
    SELECT EXISTS(
        SELECT 1 FROM pg_proc WHERE proname = 'update_packing_progress_with_variant'
    ) INTO v_rpc_exists;

    IF v_rpc_exists THEN
        RAISE NOTICE 'OK: update_packing_progress_with_variant RPC exists';
    ELSE
        RAISE WARNING 'FAIL: update_packing_progress_with_variant NOT created';
    END IF;

    RAISE NOTICE '';
    RAISE NOTICE 'CHANGES APPLIED:';
    RAISE NOTICE '  1. Added variant_id to packing_progress table';
    RAISE NOTICE '  2. Updated UNIQUE constraints to include variant_id';
    RAISE NOTICE '  3. Updated increment_packing_quantity RPC';
    RAISE NOTICE '  4. Created get_packing_progress_for_item helper RPC';
    RAISE NOTICE '  5. Created get_picking_item_for_product helper RPC';
    RAISE NOTICE '  6. Created update_picking_progress_with_variant RPC';
    RAISE NOTICE '  7. Created update_packing_progress_with_variant RPC';
    RAISE NOTICE '  8. Created v_warehouse_variant_status monitoring view';
    RAISE NOTICE '  9. Backfilled existing packing_progress/picking_session_items with variant_id';
    RAISE NOTICE '';
    RAISE NOTICE 'SERVICE LAYER CHANGES (already applied):';
    RAISE NOTICE '  - warehouse.service.ts updated with variant-aware functions';
    RAISE NOTICE '  - warehouse.ts routes updated to accept variantId';
    RAISE NOTICE '============================================';
END $$;

COMMIT;

-- ============================================================================
-- ROLLBACK INSTRUCTIONS
-- ============================================================================
--
-- If you need to rollback this migration:
--
-- BEGIN;
--
-- -- Revert unique indexes to old constraints
-- DROP INDEX IF EXISTS idx_picking_session_items_unique_product_variant;
-- DROP INDEX IF EXISTS idx_packing_progress_unique_order_product_variant;
--
-- ALTER TABLE picking_session_items
-- ADD CONSTRAINT picking_session_items_picking_session_id_product_id_key
-- UNIQUE (picking_session_id, product_id);
--
-- ALTER TABLE packing_progress
-- ADD CONSTRAINT packing_progress_picking_session_id_order_id_product_id_key
-- UNIQUE (picking_session_id, order_id, product_id);
--
-- -- Drop new functions
-- DROP FUNCTION IF EXISTS update_packing_progress_with_variant(UUID, UUID, UUID, UUID, UUID);
-- DROP FUNCTION IF EXISTS update_picking_progress_with_variant(UUID, UUID, UUID, INTEGER, UUID);
-- DROP FUNCTION IF EXISTS get_packing_progress_for_item(UUID, UUID, UUID, UUID);
-- DROP FUNCTION IF EXISTS get_picking_item_for_product(UUID, UUID, UUID);
--
-- -- Note: variant_id column is safe to leave (NULLable, FK)
--
-- COMMIT;
--
-- ============================================================================
