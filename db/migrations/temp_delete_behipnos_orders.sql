-- ================================================================
-- TEMPORARY MIGRATION: Delete BEHIPNOS orders
-- This should be run via Supabase SQL Editor or psql
-- After running, delete this file
-- ================================================================

-- Store ID: dba0c44d-85ba-42fc-9375-a1d4ffc9ced4

-- Step 1: Disable triggers temporarily
ALTER TABLE orders DISABLE TRIGGER trigger_cascade_delete_order_data;
ALTER TABLE orders DISABLE TRIGGER trigger_prevent_order_deletion;
ALTER TABLE orders DISABLE TRIGGER trigger_prevent_line_items_edit;

-- Step 2: Delete all related data for these orders
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

-- Step 4: Re-enable triggers
ALTER TABLE orders ENABLE TRIGGER trigger_cascade_delete_order_data;
ALTER TABLE orders ENABLE TRIGGER trigger_prevent_order_deletion;
ALTER TABLE orders ENABLE TRIGGER trigger_prevent_line_items_edit;

-- Verify
SELECT COUNT(*) as remaining_orders FROM orders WHERE store_id = 'dba0c44d-85ba-42fc-9375-a1d4ffc9ced4';
