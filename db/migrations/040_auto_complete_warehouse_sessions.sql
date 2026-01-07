-- ================================================================
-- MIGRATION 040: Auto-Complete Warehouse Sessions on Dispatch
-- ================================================================
-- Automatically completes warehouse sessions when all orders are dispatched
-- Prevents dispatched orders from appearing in packing view
-- ================================================================

-- ================================================================
-- PART 1: Function to auto-complete warehouse sessions
-- ================================================================

CREATE OR REPLACE FUNCTION auto_complete_warehouse_session()
RETURNS TRIGGER AS $$
DECLARE
  v_session_id UUID;
  v_all_dispatched BOOLEAN;
  v_session_orders_count INT;
  v_dispatched_orders_count INT;
BEGIN
  -- Only process when order status changes FROM ready_to_ship TO shipped/delivered/cancelled
  IF NEW.sleeves_status IN ('shipped', 'delivered', 'cancelled')
     AND OLD.sleeves_status = 'ready_to_ship' THEN

    -- Find all active packing sessions containing this order
    FOR v_session_id IN
      SELECT DISTINCT ps.id
      FROM picking_sessions ps
      INNER JOIN picking_session_orders pso ON ps.id = pso.picking_session_id
      WHERE pso.order_id = NEW.id
        AND ps.status = 'packing'  -- Only active packing sessions
    LOOP
      -- Count total orders in this session
      SELECT COUNT(DISTINCT pso.order_id)
      INTO v_session_orders_count
      FROM picking_session_orders pso
      WHERE pso.picking_session_id = v_session_id;

      -- Count how many orders are already dispatched (shipped/delivered/cancelled)
      SELECT COUNT(DISTINCT o.id)
      INTO v_dispatched_orders_count
      FROM picking_session_orders pso
      INNER JOIN orders o ON pso.order_id = o.id
      WHERE pso.picking_session_id = v_session_id
        AND o.sleeves_status IN ('shipped', 'delivered', 'cancelled');

      -- If all orders are dispatched, complete the session
      v_all_dispatched := (v_session_orders_count = v_dispatched_orders_count);

      IF v_all_dispatched THEN
        UPDATE picking_sessions
        SET status = 'completed',
            completed_at = NOW()
        WHERE id = v_session_id;

        RAISE NOTICE 'Warehouse session % auto-completed - all orders dispatched', v_session_id;
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION auto_complete_warehouse_session() IS
'Automatically completes warehouse (packing) sessions when all orders are dispatched';

-- ================================================================
-- PART 2: Create trigger
-- ================================================================

DROP TRIGGER IF EXISTS trigger_auto_complete_warehouse_session ON orders;

CREATE TRIGGER trigger_auto_complete_warehouse_session
  AFTER UPDATE OF sleeves_status
  ON orders
  FOR EACH ROW
  EXECUTE FUNCTION auto_complete_warehouse_session();

COMMENT ON TRIGGER trigger_auto_complete_warehouse_session ON orders IS
'Auto-completes packing sessions when all orders are dispatched (shipped/delivered/cancelled)';

-- ================================================================
-- VERIFICATION QUERIES
-- ================================================================

-- Check sessions with dispatched orders
-- SELECT
--   ps.id,
--   ps.session_code,
--   ps.status,
--   COUNT(DISTINCT pso.order_id) as total_orders,
--   COUNT(DISTINCT o.id) FILTER (WHERE o.sleeves_status IN ('shipped', 'delivered', 'cancelled')) as dispatched_orders,
--   COUNT(DISTINCT o.id) FILTER (WHERE o.sleeves_status = 'ready_to_ship') as pending_orders
-- FROM picking_sessions ps
-- INNER JOIN picking_session_orders pso ON ps.id = pso.picking_session_id
-- INNER JOIN orders o ON pso.order_id = o.id
-- WHERE ps.status = 'packing'
-- GROUP BY ps.id, ps.session_code, ps.status;

-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================
