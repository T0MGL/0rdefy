-- Cleanup Script: Delete Bright Idea orders and return sessions
-- This script deletes all data related to Bright Idea store

-- Find Bright Idea store ID
DO $$
DECLARE
  v_store_id UUID;
  v_orders_count INT;
  v_sessions_count INT;
BEGIN
  -- Get Bright Idea store ID
  SELECT id INTO v_store_id
  FROM stores
  WHERE name = 'Bright Idea'
  LIMIT 1;

  IF v_store_id IS NULL THEN
    RAISE NOTICE 'No store found with name "Bright Idea"';
    RETURN;
  END IF;

  RAISE NOTICE 'Found Bright Idea store: %', v_store_id;

  -- Count return sessions
  SELECT COUNT(*) INTO v_sessions_count
  FROM return_sessions
  WHERE store_id = v_store_id;

  RAISE NOTICE 'Found % return session(s)', v_sessions_count;

  -- Delete return sessions (CASCADE will handle related tables)
  DELETE FROM return_sessions
  WHERE store_id = v_store_id;

  RAISE NOTICE 'Deleted % return session(s)', v_sessions_count;

  -- Count orders
  SELECT COUNT(*) INTO v_orders_count
  FROM orders
  WHERE store_id = v_store_id;

  RAISE NOTICE 'Found % order(s)', v_orders_count;

  -- Delete order line items first
  DELETE FROM order_line_items
  WHERE order_id IN (
    SELECT id FROM orders WHERE store_id = v_store_id
  );

  RAISE NOTICE 'Deleted order line items';

  -- Delete inventory movements
  DELETE FROM inventory_movements
  WHERE order_id IN (
    SELECT id FROM orders WHERE store_id = v_store_id
  );

  RAISE NOTICE 'Deleted inventory movements';

  -- Delete order status history
  DELETE FROM order_status_history
  WHERE order_id IN (
    SELECT id FROM orders WHERE store_id = v_store_id
  );

  RAISE NOTICE 'Deleted order status history';

  -- Delete orders
  DELETE FROM orders
  WHERE store_id = v_store_id;

  RAISE NOTICE 'Deleted % order(s)', v_orders_count;

  RAISE NOTICE 'Cleanup completed successfully!';

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error during cleanup: %', SQLERRM;
END $$;
