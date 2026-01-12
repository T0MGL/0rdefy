-- ================================================================
-- TEMPORARY MIGRATION: Delete BEHIPNOS orders and customers
-- This should be run via Supabase SQL Editor or psql
-- After running, delete this file
-- ================================================================

-- Store ID: dba0c44d-85ba-42fc-9375-a1d4ffc9ced4

-- Step 0: Disable the cascade delete trigger (has UUID casting issues with Shopify IDs)
DROP TRIGGER IF EXISTS trigger_cascade_delete_order_data ON orders;

-- Step 1: Delete all related data for these orders
DELETE FROM order_line_items WHERE order_id IN (
  SELECT id FROM orders WHERE store_id = 'dba0c44d-85ba-42fc-9375-a1d4ffc9ced4'
);

DELETE FROM order_status_history WHERE order_id IN (
  SELECT id FROM orders WHERE store_id = 'dba0c44d-85ba-42fc-9375-a1d4ffc9ced4'
);

DELETE FROM follow_up_log WHERE order_id IN (
  SELECT id FROM orders WHERE store_id = 'dba0c44d-85ba-42fc-9375-a1d4ffc9ced4'
);

DELETE FROM delivery_attempts WHERE order_id IN (
  SELECT id FROM orders WHERE store_id = 'dba0c44d-85ba-42fc-9375-a1d4ffc9ced4'
);

DELETE FROM inventory_movements WHERE order_id IN (
  SELECT id FROM orders WHERE store_id = 'dba0c44d-85ba-42fc-9375-a1d4ffc9ced4'
);

DELETE FROM settlement_orders WHERE order_id IN (
  SELECT id FROM orders WHERE store_id = 'dba0c44d-85ba-42fc-9375-a1d4ffc9ced4'
);

DELETE FROM dispatch_session_orders WHERE order_id IN (
  SELECT id FROM orders WHERE store_id = 'dba0c44d-85ba-42fc-9375-a1d4ffc9ced4'
);

DELETE FROM picking_session_orders WHERE order_id IN (
  SELECT id FROM orders WHERE store_id = 'dba0c44d-85ba-42fc-9375-a1d4ffc9ced4'
);

DELETE FROM packing_progress WHERE order_id IN (
  SELECT id FROM orders WHERE store_id = 'dba0c44d-85ba-42fc-9375-a1d4ffc9ced4'
);

DELETE FROM return_session_orders WHERE order_id IN (
  SELECT id FROM orders WHERE store_id = 'dba0c44d-85ba-42fc-9375-a1d4ffc9ced4'
);

-- Step 3: Delete the orders
DELETE FROM orders WHERE store_id = 'dba0c44d-85ba-42fc-9375-a1d4ffc9ced4';

-- Step 4: Delete customers (now that orders are gone)
DELETE FROM customers WHERE store_id = 'dba0c44d-85ba-42fc-9375-a1d4ffc9ced4';

-- Step 5: Re-enable the cascade delete trigger
CREATE TRIGGER trigger_cascade_delete_order_data
    BEFORE DELETE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION cascade_delete_order_data();

-- Verify
SELECT
  (SELECT COUNT(*) FROM orders WHERE store_id = 'dba0c44d-85ba-42fc-9375-a1d4ffc9ced4') as remaining_orders,
  (SELECT COUNT(*) FROM customers WHERE store_id = 'dba0c44d-85ba-42fc-9375-a1d4ffc9ced4') as remaining_customers;
