-- Migration 100: Warehouse Batch Packing System
-- Purpose: Enable one-click packing for entire sessions and individual orders
-- This dramatically reduces the time to complete warehouse sessions from minutes to seconds

-- ============================================================================
-- FUNCTION: auto_pack_session
-- Purpose: Pack all items for all orders in a session with a single call
-- This is the core innovation that makes warehouse operations instant
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_pack_session(
    p_session_id UUID,
    p_store_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_session RECORD;
    v_orders_packed INT := 0;
    v_items_packed INT := 0;
    v_total_units INT := 0;
BEGIN
    -- 1. Validate and lock the session
    SELECT ps.* INTO v_session
    FROM picking_sessions ps
    WHERE ps.id = p_session_id
      AND ps.store_id = p_store_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found or access denied'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_session.status != 'packing' THEN
        RAISE EXCEPTION 'Session must be in packing status. Current status: %', v_session.status
            USING ERRCODE = 'P0001';
    END IF;

    -- 2. Update all packing_progress records to fully packed in one UPDATE
    -- This is much more efficient than looping through each order
    WITH updated AS (
        UPDATE packing_progress pp
        SET quantity_packed = quantity_needed,
            updated_at = NOW()
        WHERE pp.picking_session_id = p_session_id
          AND pp.quantity_packed < pp.quantity_needed
        RETURNING pp.order_id, pp.quantity_needed
    )
    SELECT
        COUNT(DISTINCT order_id),
        COUNT(*),
        COALESCE(SUM(quantity_needed), 0)
    INTO v_orders_packed, v_items_packed, v_total_units
    FROM updated;

    -- 3. Update session activity timestamp
    UPDATE picking_sessions
    SET last_activity_at = NOW(),
        updated_at = NOW()
    WHERE id = p_session_id;

    -- 4. Return summary
    RETURN jsonb_build_object(
        'success', true,
        'session_id', p_session_id,
        'orders_packed', v_orders_packed,
        'items_packed', v_items_packed,
        'total_units', v_total_units,
        'packed_at', NOW()
    );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION auto_pack_session(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION auto_pack_session(UUID, UUID) TO service_role;

COMMENT ON FUNCTION auto_pack_session IS
'Packs all items for all orders in a session with a single call.
This dramatically reduces warehouse operation time from O(n*m) clicks to O(1).
Used by the "Empacar Todo" button in the warehouse UI.';


-- ============================================================================
-- FUNCTION: pack_all_items_for_order
-- Purpose: Pack all remaining items for a single order
-- Useful for the "Empacar" button on individual order cards
-- ============================================================================

CREATE OR REPLACE FUNCTION pack_all_items_for_order(
    p_session_id UUID,
    p_order_id UUID,
    p_store_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_session RECORD;
    v_order RECORD;
    v_items_packed INT := 0;
    v_total_units INT := 0;
BEGIN
    -- 1. Validate session
    SELECT ps.* INTO v_session
    FROM picking_sessions ps
    WHERE ps.id = p_session_id
      AND ps.store_id = p_store_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found or access denied'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_session.status != 'packing' THEN
        RAISE EXCEPTION 'Session must be in packing status. Current status: %', v_session.status
            USING ERRCODE = 'P0001';
    END IF;

    -- 2. Validate order is in session
    SELECT o.* INTO v_order
    FROM orders o
    INNER JOIN picking_session_orders pso ON pso.order_id = o.id
    WHERE pso.picking_session_id = p_session_id
      AND o.id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found in this session'
            USING ERRCODE = 'P0002';
    END IF;

    -- 3. Check order status - don't pack orders that are already processed
    IF v_order.sleeves_status IN ('ready_to_ship', 'shipped', 'in_transit', 'delivered', 'cancelled', 'rejected', 'returned') THEN
        RAISE EXCEPTION 'Cannot pack order with status: %', v_order.sleeves_status
            USING ERRCODE = 'P0001';
    END IF;

    -- 4. Update all packing_progress for this order
    WITH updated AS (
        UPDATE packing_progress pp
        SET quantity_packed = quantity_needed,
            updated_at = NOW()
        WHERE pp.picking_session_id = p_session_id
          AND pp.order_id = p_order_id
          AND pp.quantity_packed < pp.quantity_needed
        RETURNING pp.quantity_needed
    )
    SELECT COUNT(*), COALESCE(SUM(quantity_needed), 0)
    INTO v_items_packed, v_total_units
    FROM updated;

    -- 5. Update session activity
    UPDATE picking_sessions
    SET last_activity_at = NOW(),
        updated_at = NOW()
    WHERE id = p_session_id;

    -- 6. Return result
    RETURN jsonb_build_object(
        'success', true,
        'session_id', p_session_id,
        'order_id', p_order_id,
        'items_packed', v_items_packed,
        'total_units', v_total_units,
        'is_complete', true,
        'packed_at', NOW()
    );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION pack_all_items_for_order(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION pack_all_items_for_order(UUID, UUID, UUID) TO service_role;

COMMENT ON FUNCTION pack_all_items_for_order IS
'Packs all remaining items for a single order in one call.
Used by the "Empacar" button on individual order cards in the warehouse UI.';


-- ============================================================================
-- FUNCTION: get_packing_summary
-- Purpose: Get a quick summary of packing progress for a session
-- Useful for UI to show overall progress without fetching all details
-- ============================================================================

CREATE OR REPLACE FUNCTION get_packing_summary(
    p_session_id UUID,
    p_store_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_session RECORD;
    v_total_orders INT;
    v_complete_orders INT;
    v_total_items INT;
    v_packed_items INT;
    v_total_units INT;
    v_packed_units INT;
BEGIN
    -- Validate session
    SELECT * INTO v_session
    FROM picking_sessions
    WHERE id = p_session_id AND store_id = p_store_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found'
            USING ERRCODE = 'P0002';
    END IF;

    -- Get order counts
    SELECT
        COUNT(DISTINCT pp.order_id),
        COUNT(DISTINCT CASE WHEN pp.quantity_packed >= pp.quantity_needed THEN pp.order_id END)
    INTO v_total_orders, v_complete_orders
    FROM packing_progress pp
    WHERE pp.picking_session_id = p_session_id;

    -- Check if all items for each order are complete
    SELECT COUNT(DISTINCT order_id)
    INTO v_complete_orders
    FROM (
        SELECT pp.order_id,
               BOOL_AND(pp.quantity_packed >= pp.quantity_needed) as is_complete
        FROM packing_progress pp
        WHERE pp.picking_session_id = p_session_id
        GROUP BY pp.order_id
        HAVING BOOL_AND(pp.quantity_packed >= pp.quantity_needed)
    ) complete_orders;

    -- Get item and unit counts
    SELECT
        COUNT(*),
        COUNT(CASE WHEN quantity_packed >= quantity_needed THEN 1 END),
        COALESCE(SUM(quantity_needed), 0),
        COALESCE(SUM(quantity_packed), 0)
    INTO v_total_items, v_packed_items, v_total_units, v_packed_units
    FROM packing_progress
    WHERE picking_session_id = p_session_id;

    RETURN jsonb_build_object(
        'session_id', p_session_id,
        'session_code', v_session.code,
        'session_status', v_session.status,
        'total_orders', v_total_orders,
        'complete_orders', v_complete_orders,
        'total_items', v_total_items,
        'packed_items', v_packed_items,
        'total_units', v_total_units,
        'packed_units', v_packed_units,
        'progress_percent', CASE WHEN v_total_units > 0
            THEN ROUND((v_packed_units::NUMERIC / v_total_units) * 100, 1)
            ELSE 0 END,
        'is_ready_to_complete', (v_complete_orders = v_total_orders AND v_total_orders > 0)
    );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_packing_summary(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_packing_summary(UUID, UUID) TO service_role;

COMMENT ON FUNCTION get_packing_summary IS
'Returns a quick summary of packing progress for display in the UI header.
Includes order counts, item counts, and progress percentage.';


-- ============================================================================
-- INDEX: Improve packing_progress query performance
-- ============================================================================

-- Index for fast lookup by session (used in auto_pack_session)
CREATE INDEX IF NOT EXISTS idx_packing_progress_session_order
ON packing_progress(picking_session_id, order_id);

-- Index for finding incomplete items quickly
CREATE INDEX IF NOT EXISTS idx_packing_progress_incomplete
ON packing_progress(picking_session_id)
WHERE quantity_packed < quantity_needed;
