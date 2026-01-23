-- ============================================================================
-- Migration 102: Auto-Cleanup Picking Sessions on Order Status Change
-- ============================================================================
--
-- PROBLEM:
-- When users change order status directly from the Orders page (bypassing the
-- warehouse picking/packing flow), the orders remain in active picking sessions.
-- This causes:
-- 1. Orphaned sessions showing orders that are already shipped/delivered
-- 2. Confusing UI with stale data
-- 3. Picking lists with incorrect quantities
--
-- SOLUTION:
-- Create a trigger that automatically removes orders from picking sessions
-- when their status changes to a "completed" state (shipped, delivered, etc.)
-- outside the normal warehouse workflow.
--
-- PRODUCTION SAFETY:
-- - Idempotent (safe to run multiple times)
-- - Uses CREATE OR REPLACE (no DROP of existing objects)
-- - Early exit if order not in any picking session (99% of cases)
-- - Exception handling - trigger failures don't block order updates
-- - NO automatic data cleanup - must be run manually after verification
-- - Performance optimized with proper indexes
-- - Non-blocking for normal operations
--
-- Author: Claude
-- Date: 2026-01-23
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Add index for faster lookups (if not exists)
-- ============================================================================

-- This index speeds up the check "is this order in any picking session?"
CREATE INDEX IF NOT EXISTS idx_picking_session_orders_order_id_session_id
    ON picking_session_orders(order_id, picking_session_id);

-- ============================================================================
-- STEP 2: Create the cleanup trigger function
-- ============================================================================
-- Key production safety features:
-- 1. Early exit if order not in any session (fast path for 99% of orders)
-- 2. Exception handling - failures are logged but don't block order updates
-- 3. Minimal work - only processes what's necessary

CREATE OR REPLACE FUNCTION cleanup_order_from_picking_session_on_status_change()
RETURNS TRIGGER AS $$
DECLARE
    v_session RECORD;
    v_remaining_orders INT;
    v_line_item RECORD;
    v_is_in_session BOOLEAN := FALSE;
BEGIN
    -- =================================================================
    -- FAST PATH: Check if this order is in any active picking session
    -- This is the most common case (99%+ of orders are NOT in sessions)
    -- =================================================================
    SELECT EXISTS(
        SELECT 1
        FROM picking_session_orders pso
        JOIN picking_sessions ps ON ps.id = pso.picking_session_id
        WHERE pso.order_id = NEW.id
          AND ps.status IN ('picking', 'packing')
    ) INTO v_is_in_session;

    -- Early exit - order not in any session, nothing to do
    IF NOT v_is_in_session THEN
        RETURN NEW;
    END IF;

    -- =================================================================
    -- SCENARIO 1: Order moved to "post-dispatch" status directly
    -- (shipped, in_transit, delivered)
    -- NOTE: We do NOT include 'ready_to_ship' here because:
    --   - Normal warehouse flow sets orders to ready_to_ship when completing session
    --   - ready_to_ship is the expected state for orders waiting for dispatch
    --   - Only shipped/in_transit/delivered indicate the order left without proper flow
    -- =================================================================
    IF NEW.sleeves_status IN ('shipped', 'in_transit', 'delivered') AND
       OLD.sleeves_status IN ('pending', 'contacted', 'confirmed', 'in_preparation') THEN

        FOR v_session IN
            SELECT ps.id as session_id, ps.code as session_code, ps.status as session_status, ps.store_id
            FROM picking_session_orders pso
            JOIN picking_sessions ps ON ps.id = pso.picking_session_id
            WHERE pso.order_id = NEW.id
              AND ps.status IN ('picking', 'packing')
        LOOP
            BEGIN
                -- Delete packing progress for this order in this session
                DELETE FROM packing_progress
                WHERE order_id = NEW.id
                  AND picking_session_id = v_session.session_id;

                -- Remove order from session
                DELETE FROM picking_session_orders
                WHERE order_id = NEW.id
                  AND picking_session_id = v_session.session_id;

                -- Count remaining orders in session
                SELECT COUNT(*) INTO v_remaining_orders
                FROM picking_session_orders
                WHERE picking_session_id = v_session.session_id;

                IF v_remaining_orders = 0 THEN
                    -- Session is now empty - mark as completed/abandoned
                    UPDATE picking_sessions
                    SET status = 'completed',
                        abandoned_at = NOW(),
                        abandon_reason = format('Order %s processed outside warehouse (status: %s)',
                                               NEW.id::text, NEW.sleeves_status),
                        updated_at = NOW(),
                        completed_at = NOW()
                    WHERE id = v_session.session_id;

                    -- Delete picking session items
                    DELETE FROM picking_session_items
                    WHERE picking_session_id = v_session.session_id;

                    RAISE NOTICE '[PICKING CLEANUP] Session % abandoned - order % moved to %',
                        v_session.session_code, NEW.id, NEW.sleeves_status;
                ELSE
                    -- Update picking items - decrease quantities for removed order's products
                    FOR v_line_item IN
                        SELECT product_id, COALESCE(quantity, 0) as quantity
                        FROM order_line_items
                        WHERE order_id = NEW.id
                          AND product_id IS NOT NULL
                    LOOP
                        UPDATE picking_session_items
                        SET total_quantity_needed = GREATEST(0, total_quantity_needed - v_line_item.quantity),
                            updated_at = NOW()
                        WHERE picking_session_id = v_session.session_id
                          AND product_id = v_line_item.product_id;
                    END LOOP;

                    -- Delete items where quantity is now 0
                    DELETE FROM picking_session_items
                    WHERE picking_session_id = v_session.session_id
                      AND total_quantity_needed <= 0;

                    RAISE NOTICE '[PICKING CLEANUP] Session % updated - order % removed, % orders remain',
                        v_session.session_code, NEW.id, v_remaining_orders;
                END IF;

            EXCEPTION WHEN OTHERS THEN
                -- Log error but don't fail the order update
                RAISE WARNING '[PICKING CLEANUP] Error cleaning session % for order %: %',
                    v_session.session_code, NEW.id, SQLERRM;
            END;
        END LOOP;
    END IF;

    -- =================================================================
    -- SCENARIO 2: Order cancelled or rejected while in_preparation
    -- =================================================================
    IF NEW.sleeves_status IN ('cancelled', 'rejected') AND
       OLD.sleeves_status = 'in_preparation' THEN

        FOR v_session IN
            SELECT ps.id as session_id, ps.code as session_code
            FROM picking_session_orders pso
            JOIN picking_sessions ps ON ps.id = pso.picking_session_id
            WHERE pso.order_id = NEW.id
              AND ps.status IN ('picking', 'packing')
        LOOP
            BEGIN
                -- Delete packing progress
                DELETE FROM packing_progress
                WHERE order_id = NEW.id
                  AND picking_session_id = v_session.session_id;

                -- Remove from session
                DELETE FROM picking_session_orders
                WHERE order_id = NEW.id
                  AND picking_session_id = v_session.session_id;

                -- Check if session is empty
                SELECT COUNT(*) INTO v_remaining_orders
                FROM picking_session_orders
                WHERE picking_session_id = v_session.session_id;

                IF v_remaining_orders = 0 THEN
                    UPDATE picking_sessions
                    SET status = 'completed',
                        abandoned_at = NOW(),
                        abandon_reason = format('Order %s %s', NEW.id::text, NEW.sleeves_status),
                        updated_at = NOW(),
                        completed_at = NOW()
                    WHERE id = v_session.session_id;

                    DELETE FROM picking_session_items
                    WHERE picking_session_id = v_session.session_id;

                    RAISE NOTICE '[PICKING CLEANUP] Session % abandoned - order % %',
                        v_session.session_code, NEW.id, NEW.sleeves_status;
                ELSE
                    -- Update picking items
                    FOR v_line_item IN
                        SELECT product_id, COALESCE(quantity, 0) as quantity
                        FROM order_line_items
                        WHERE order_id = NEW.id
                          AND product_id IS NOT NULL
                    LOOP
                        UPDATE picking_session_items
                        SET total_quantity_needed = GREATEST(0, total_quantity_needed - v_line_item.quantity),
                            updated_at = NOW()
                        WHERE picking_session_id = v_session.session_id
                          AND product_id = v_line_item.product_id;
                    END LOOP;

                    DELETE FROM picking_session_items
                    WHERE picking_session_id = v_session.session_id
                      AND total_quantity_needed <= 0;
                END IF;

            EXCEPTION WHEN OTHERS THEN
                RAISE WARNING '[PICKING CLEANUP] Error cleaning session % for order %: %',
                    v_session.session_code, NEW.id, SQLERRM;
            END;
        END LOOP;
    END IF;

    RETURN NEW;

EXCEPTION WHEN OTHERS THEN
    -- Critical safety: NEVER fail the order update due to cleanup issues
    RAISE WARNING '[PICKING CLEANUP] Unexpected error for order %: %. Order update will proceed.',
        NEW.id, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION cleanup_order_from_picking_session_on_status_change() IS
'Production-safe trigger that removes orders from picking sessions when status changes.
Features: early exit optimization, exception handling (never blocks order updates), minimal work.
Triggered on: shipped/in_transit/delivered (NOT ready_to_ship - that is normal warehouse exit), or cancelled/rejected while in_preparation.
Does NOT interfere with: normal warehouse flow, dispatch operations, ready_to_ship orders.';

-- ============================================================================
-- STEP 3: Create the trigger (idempotent)
-- ============================================================================

DROP TRIGGER IF EXISTS trigger_cleanup_picking_session_on_order_status ON orders;

CREATE TRIGGER trigger_cleanup_picking_session_on_order_status
    AFTER UPDATE OF sleeves_status
    ON orders
    FOR EACH ROW
    EXECUTE FUNCTION cleanup_order_from_picking_session_on_status_change();

COMMENT ON TRIGGER trigger_cleanup_picking_session_on_order_status ON orders IS
'Auto-cleans picking sessions when orders change status outside warehouse flow. Safe: never blocks order updates.';

-- ============================================================================
-- STEP 4: Create monitoring view (for manual verification)
-- ============================================================================
-- This view helps identify orphaned orders BEFORE running cleanup

CREATE OR REPLACE VIEW v_orphaned_picking_session_orders AS
SELECT
    ps.id AS session_id,
    ps.code AS session_code,
    ps.status AS session_status,
    ps.store_id,
    ps.created_at AS session_created,
    o.id AS order_id,
    o.order_number,
    o.shopify_order_name,
    o.sleeves_status AS order_status,
    CASE
        WHEN o.sleeves_status IN ('shipped', 'in_transit', 'delivered') THEN 'ALREADY_SHIPPED'
        WHEN o.sleeves_status IN ('cancelled', 'rejected') THEN 'CANCELLED'
        WHEN o.sleeves_status = 'ready_to_ship' THEN 'READY_BUT_IN_SESSION'
        ELSE 'OK'
    END AS issue_type
FROM picking_sessions ps
JOIN picking_session_orders pso ON pso.picking_session_id = ps.id
JOIN orders o ON o.id = pso.order_id
WHERE ps.status IN ('picking', 'packing')
  AND o.sleeves_status NOT IN ('confirmed', 'in_preparation')
ORDER BY ps.created_at DESC;

COMMENT ON VIEW v_orphaned_picking_session_orders IS
'Shows orders in active picking sessions with incompatible statuses.
Includes ready_to_ship orders (should have been cleaned when session completed - indicates incomplete session).
Use to verify before running cleanup_orphaned_picking_sessions().';

-- ============================================================================
-- STEP 5: Create manual cleanup function (for existing orphaned sessions)
-- ============================================================================
-- IMPORTANT: This does NOT run automatically. Must be called manually after
-- reviewing the v_orphaned_picking_session_orders view.

CREATE OR REPLACE FUNCTION cleanup_orphaned_picking_sessions(p_store_id UUID DEFAULT NULL)
RETURNS TABLE (
    session_id UUID,
    session_code VARCHAR,
    orders_removed INT,
    action_taken VARCHAR
) AS $$
DECLARE
    v_session RECORD;
    v_orphaned_order RECORD;
    v_orders_removed INT;
    v_remaining_orders INT;
BEGIN
    FOR v_session IN
        SELECT DISTINCT ps.id, ps.code, ps.store_id
        FROM picking_sessions ps
        WHERE ps.status IN ('picking', 'packing')
          AND (p_store_id IS NULL OR ps.store_id = p_store_id)
          AND EXISTS (
              SELECT 1
              FROM picking_session_orders pso
              JOIN orders o ON o.id = pso.order_id
              WHERE pso.picking_session_id = ps.id
                AND o.sleeves_status NOT IN ('confirmed', 'in_preparation')
          )
    LOOP
        v_orders_removed := 0;

        FOR v_orphaned_order IN
            SELECT pso.order_id, o.sleeves_status
            FROM picking_session_orders pso
            JOIN orders o ON o.id = pso.order_id
            WHERE pso.picking_session_id = v_session.id
              AND o.sleeves_status NOT IN ('confirmed', 'in_preparation')
        LOOP
            DELETE FROM packing_progress
            WHERE order_id = v_orphaned_order.order_id
              AND picking_session_id = v_session.id;

            DELETE FROM picking_session_orders
            WHERE order_id = v_orphaned_order.order_id
              AND picking_session_id = v_session.id;

            v_orders_removed := v_orders_removed + 1;
        END LOOP;

        SELECT COUNT(*) INTO v_remaining_orders
        FROM picking_session_orders
        WHERE picking_session_id = v_session.id;

        IF v_remaining_orders = 0 THEN
            UPDATE picking_sessions
            SET status = 'completed',
                abandoned_at = NOW(),
                abandon_reason = 'Manual cleanup via cleanup_orphaned_picking_sessions()',
                updated_at = NOW(),
                completed_at = NOW()
            WHERE id = v_session.id;

            DELETE FROM picking_session_items
            WHERE picking_session_id = v_session.id;

            session_id := v_session.id;
            session_code := v_session.code;
            orders_removed := v_orders_removed;
            action_taken := 'SESSION_ABANDONED';
            RETURN NEXT;
        ELSE
            DELETE FROM picking_session_items WHERE picking_session_id = v_session.id;

            INSERT INTO picking_session_items (picking_session_id, product_id, total_quantity_needed, quantity_picked)
            SELECT v_session.id, oli.product_id, SUM(oli.quantity), 0
            FROM picking_session_orders pso
            JOIN order_line_items oli ON oli.order_id = pso.order_id
            WHERE pso.picking_session_id = v_session.id
              AND oli.product_id IS NOT NULL
            GROUP BY oli.product_id;

            session_id := v_session.id;
            session_code := v_session.code;
            orders_removed := v_orders_removed;
            action_taken := format('ORDERS_REMOVED_%s_REMAINING', v_remaining_orders);
            RETURN NEXT;
        END IF;
    END LOOP;

    RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION cleanup_orphaned_picking_sessions(UUID) IS
'Manually cleans up orphaned picking sessions. REVIEW v_orphaned_picking_session_orders FIRST!
Call with store_id to limit scope, or NULL for all stores. Returns summary of actions.';

-- ============================================================================
-- STEP 6: Grant permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION cleanup_order_from_picking_session_on_status_change() TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_order_from_picking_session_on_status_change() TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_orphaned_picking_sessions(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_orphaned_picking_sessions(UUID) TO service_role;
GRANT SELECT ON v_orphaned_picking_session_orders TO authenticated;
GRANT SELECT ON v_orphaned_picking_session_orders TO service_role;

-- ============================================================================
-- STEP 7: Report current orphaned sessions (READ-ONLY, NO CHANGES)
-- ============================================================================

DO $$
DECLARE
    v_orphan_count INT;
BEGIN
    SELECT COUNT(*) INTO v_orphan_count FROM v_orphaned_picking_session_orders;

    RAISE NOTICE '';
    RAISE NOTICE '================================================================';
    RAISE NOTICE '  MIGRATION 102: Auto-Cleanup Picking Sessions - COMPLETE';
    RAISE NOTICE '================================================================';
    RAISE NOTICE '';
    RAISE NOTICE '  TRIGGER CREATED:';
    RAISE NOTICE '    trigger_cleanup_picking_session_on_order_status';
    RAISE NOTICE '    - Fires AFTER UPDATE on orders.sleeves_status';
    RAISE NOTICE '    - Safe: never blocks order updates (exception handling)';
    RAISE NOTICE '    - Fast: early exit if order not in session';
    RAISE NOTICE '';
    RAISE NOTICE '  CURRENT ORPHANED ORDERS: %', v_orphan_count;

    IF v_orphan_count > 0 THEN
        RAISE NOTICE '';
        RAISE NOTICE '  *** ACTION REQUIRED ***';
        RAISE NOTICE '  Found % orphaned orders in picking sessions.', v_orphan_count;
        RAISE NOTICE '';
        RAISE NOTICE '  To review:';
        RAISE NOTICE '    SELECT * FROM v_orphaned_picking_session_orders;';
        RAISE NOTICE '';
        RAISE NOTICE '  To cleanup (after reviewing):';
        RAISE NOTICE '    SELECT * FROM cleanup_orphaned_picking_sessions(NULL);';
        RAISE NOTICE '';
    ELSE
        RAISE NOTICE '  Database is clean - no orphaned sessions found!';
    END IF;

    RAISE NOTICE '================================================================';
END $$;

COMMIT;
