-- ================================================================
-- Migration 079: Atomic Packing Increment (Fallback Race Fix)
-- ================================================================
-- Created: 2026-01-18
-- Description: Adds atomic increment function for packing progress
--              to prevent race conditions in the fallback path when
--              update_packing_progress_atomic RPC is not available.
--
-- Problem: When two workers pack the same product simultaneously,
--          the fallback updatePackingProgress() function has a
--          read-modify-write race condition:
--          Thread A reads qty=5 → Thread B reads qty=5 →
--          Thread A writes qty=6 → Thread B writes qty=6 (LOST UPDATE!)
--
-- Solution: Use SQL atomic increment with all validations in a
--           single transaction. Provides same guarantees as the
--           main update_packing_progress_atomic() function.
-- ================================================================

BEGIN;

-- Drop if exists to allow clean reinstallation
DROP FUNCTION IF EXISTS increment_packing_quantity(UUID, INTEGER, INTEGER, UUID, UUID);

-- Create atomic increment function (simplified version for fallback)
-- This is a lightweight version that assumes session/order validation already happened
-- in the application layer (to avoid duplicate validation overhead)
CREATE OR REPLACE FUNCTION increment_packing_quantity(
    p_progress_id UUID,
    p_quantity_needed INTEGER,
    p_picked_quantity INTEGER,
    p_session_id UUID,
    p_product_id UUID
)
RETURNS TABLE (
    id UUID,
    picking_session_id UUID,
    order_id UUID,
    product_id UUID,
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

    -- Check if already fully packed for this specific order/product
    IF v_progress.quantity_packed >= v_progress.quantity_needed THEN
        RAISE EXCEPTION 'This item is already fully packed for this order (packed: %, needed: %)',
            v_progress.quantity_packed, v_progress.quantity_needed;
    END IF;

    -- Calculate total packed across all orders for this product
    SELECT COALESCE(SUM(p.quantity_packed), 0) INTO v_total_packed
    FROM packing_progress p
    WHERE p.picking_session_id = p_session_id
    AND p.product_id = p_product_id;

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

    -- Return updated record
    RETURN QUERY
    SELECT
        pp.id,
        pp.picking_session_id,
        pp.order_id,
        pp.product_id,
        pp.quantity_needed,
        pp.quantity_packed,
        pp.created_at,
        pp.updated_at
    FROM packing_progress pp
    WHERE pp.id = p_progress_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION increment_packing_quantity(UUID, INTEGER, INTEGER, UUID, UUID) IS
'Atomically increments packing quantity with full validation.
Prevents race conditions when update_packing_progress_atomic is unavailable.
Uses row-level locking and single UPDATE to ensure consistency.';

-- Grant permissions
GRANT EXECUTE ON FUNCTION increment_packing_quantity(UUID, INTEGER, INTEGER, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_packing_quantity(UUID, INTEGER, INTEGER, UUID, UUID) TO service_role;

-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================

DO $$
BEGIN
    RAISE NOTICE '================================================================';
    RAISE NOTICE 'Migration 079 complete: Atomic Packing Increment';
    RAISE NOTICE '================================================================';
    RAISE NOTICE '  Created: increment_packing_quantity() function';
    RAISE NOTICE '  Purpose: Prevent race conditions in fallback packing path';
    RAISE NOTICE '  Benefits:';
    RAISE NOTICE '    - Row-level locking prevents concurrent updates';
    RAISE NOTICE '    - Single UPDATE operation (no read-modify-write)';
    RAISE NOTICE '    - Full validation (quantity limits, availability)';
    RAISE NOTICE '    - Consistent with main update_packing_progress_atomic()';
    RAISE NOTICE '================================================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Race Condition Fix:';
    RAISE NOTICE '  BEFORE: Thread A reads qty=5, Thread B reads qty=5';
    RAISE NOTICE '          Thread A writes qty=6, Thread B writes qty=6 ❌';
    RAISE NOTICE '  AFTER:  Thread A locks + increments → qty=6';
    RAISE NOTICE '          Thread B locks + increments → qty=7 ✅';
    RAISE NOTICE '================================================================';
END $$;

COMMIT;
