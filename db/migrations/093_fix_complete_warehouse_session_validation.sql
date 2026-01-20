-- ================================================================
-- MIGRATION 093: Fix complete_warehouse_session validation
-- ================================================================
-- PROBLEM: The complete_warehouse_session RPC uses INNER JOIN with
-- products and orders tables, which can exclude orphaned records
-- from packing_progress if the product was deleted or doesn't exist.
--
-- This causes a mismatch where:
-- - Frontend shows all orders as "complete" (is_complete: true)
-- - DB validation fails because it counts orphaned packing_progress records
--
-- SOLUTION: Use direct packing_progress count instead of JOINs.
-- This ensures ALL records are validated, even orphaned ones.
--
-- Author: Bright Idea
-- Date: 2026-01-20
-- ================================================================

-- Drop existing function to replace it
DROP FUNCTION IF EXISTS complete_warehouse_session(UUID, UUID);

CREATE OR REPLACE FUNCTION complete_warehouse_session(
    p_session_id UUID,
    p_store_id UUID
)
RETURNS JSONB AS $$
DECLARE
    v_session RECORD;
    v_unpacked_count INTEGER;
    v_unpacked_details TEXT;
    v_order_ids UUID[];
    v_orders_updated INTEGER := 0;
BEGIN
    -- Lock session
    SELECT * INTO v_session
    FROM picking_sessions
    WHERE id = p_session_id AND store_id = p_store_id
    FOR UPDATE;

    IF v_session IS NULL THEN
        RAISE EXCEPTION 'Session not found';
    END IF;

    IF v_session.status = 'completed' THEN
        RAISE EXCEPTION 'Session is already completed';
    END IF;

    -- FIXED: Count unpacked items directly from packing_progress
    -- without requiring JOIN to succeed (handles orphaned products)
    SELECT
        COUNT(*),
        STRING_AGG(
            format('product_id=%s, order_id=%s, packed=%s/%s',
                pp.product_id, pp.order_id, pp.quantity_packed, pp.quantity_needed),
            '; '
        )
    INTO v_unpacked_count, v_unpacked_details
    FROM packing_progress pp
    WHERE pp.picking_session_id = p_session_id
    AND pp.quantity_packed < pp.quantity_needed;

    IF v_unpacked_count > 0 THEN
        RAISE EXCEPTION 'Cannot complete session - % items not fully packed. Details: %',
            v_unpacked_count,
            LEFT(COALESCE(v_unpacked_details, 'N/A'), 500);
    END IF;

    -- Get all orders in session
    SELECT ARRAY_AGG(order_id) INTO v_order_ids
    FROM picking_session_orders
    WHERE picking_session_id = p_session_id;

    -- Lock and update all orders atomically
    UPDATE orders
    SET sleeves_status = 'ready_to_ship',
        updated_at = NOW()
    WHERE id = ANY(v_order_ids)
    AND store_id = p_store_id
    AND sleeves_status = 'in_preparation';

    GET DIAGNOSTICS v_orders_updated = ROW_COUNT;

    -- Complete session
    UPDATE picking_sessions
    SET status = 'completed',
        packing_completed_at = NOW(),
        completed_at = NOW(),
        last_activity_at = NOW(),
        updated_at = NOW()
    WHERE id = p_session_id;

    RETURN jsonb_build_object(
        'success', true,
        'session_id', p_session_id,
        'session_code', v_session.code,
        'orders_completed', v_orders_updated,
        'completed_at', NOW()
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION complete_warehouse_session(UUID, UUID) IS
'Atomically completes a warehouse session with full validation.
Updates all orders to ready_to_ship (triggers stock deduction).
Validates all items are fully packed before completing.
FIXED (Migration 093): Uses direct packing_progress count instead of JOINs to handle orphaned products.';

-- Grant permissions
GRANT EXECUTE ON FUNCTION complete_warehouse_session(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION complete_warehouse_session(UUID, UUID) TO service_role;

-- ================================================================
-- DIAGNOSTIC: Query to check for problematic packing_progress records
-- ================================================================
-- Run this to see what records are causing issues:
--
-- SELECT
--     pp.id,
--     pp.picking_session_id,
--     pp.order_id,
--     pp.product_id,
--     pp.quantity_needed,
--     pp.quantity_packed,
--     pp.quantity_needed - pp.quantity_packed as remaining,
--     p.name as product_name,
--     o.shopify_order_number
-- FROM packing_progress pp
-- LEFT JOIN products p ON p.id = pp.product_id
-- LEFT JOIN orders o ON o.id = pp.order_id
-- WHERE pp.quantity_packed < pp.quantity_needed
-- ORDER BY pp.picking_session_id, pp.order_id;
-- ================================================================

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
    RAISE NOTICE '================================================================';
    RAISE NOTICE 'Migration 093 complete: Fixed complete_warehouse_session validation';
    RAISE NOTICE '================================================================';
    RAISE NOTICE 'FIXED: Uses direct packing_progress count instead of JOINs';
    RAISE NOTICE 'This handles cases where products were deleted or orphaned';
    RAISE NOTICE '================================================================';
END $$;
