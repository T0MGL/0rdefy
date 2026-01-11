-- Migration: Add transactional warehouse session completion
-- Description: Creates an RPC function to complete warehouse sessions atomically
-- Author: Bright Idea
-- Date: 2026-01-11
--
-- FIXES:
-- 1. Ensures all operations in completeSession are atomic
-- 2. Uses row-level locking to prevent race conditions
-- 3. Automatic rollback on any failure

-- Drop existing function if exists
DROP FUNCTION IF EXISTS complete_warehouse_session(UUID, UUID);

-- Create transactional complete session function
CREATE OR REPLACE FUNCTION complete_warehouse_session(
    p_session_id UUID,
    p_store_id UUID
)
RETURNS JSON AS $$
DECLARE
    v_session RECORD;
    v_order_id UUID;
    v_updated_orders INT := 0;
    v_result JSON;
BEGIN
    -- Lock the session row to prevent concurrent completion
    SELECT * INTO v_session
    FROM picking_sessions
    WHERE id = p_session_id
      AND store_id = p_store_id
      AND status = 'packing'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found, not in packing status, or already completed';
    END IF;

    -- Update all orders in the session to ready_to_ship atomically
    -- This triggers the inventory management trigger for each order
    FOR v_order_id IN
        SELECT pso.order_id
        FROM picking_session_orders pso
        JOIN orders o ON o.id = pso.order_id
        WHERE pso.picking_session_id = p_session_id
          AND o.sleeves_status = 'in_preparation'
          AND o.store_id = p_store_id
        FOR UPDATE OF o  -- Lock each order row
    LOOP
        UPDATE orders
        SET sleeves_status = 'ready_to_ship',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = v_order_id
          AND store_id = p_store_id;

        v_updated_orders := v_updated_orders + 1;
    END LOOP;

    -- Update session status to completed
    UPDATE picking_sessions
    SET status = 'completed',
        packing_completed_at = CURRENT_TIMESTAMP
    WHERE id = p_session_id;

    -- Return summary
    SELECT json_build_object(
        'session_id', p_session_id,
        'session_code', v_session.session_code,
        'orders_updated', v_updated_orders,
        'completed_at', CURRENT_TIMESTAMP
    ) INTO v_result;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- Add comment
COMMENT ON FUNCTION complete_warehouse_session IS 'Atomically completes a warehouse packing session, updating all orders to ready_to_ship with row-level locking to prevent race conditions.';

-- Grant execute permission
GRANT EXECUTE ON FUNCTION complete_warehouse_session TO authenticated;
GRANT EXECUTE ON FUNCTION complete_warehouse_session TO service_role;
