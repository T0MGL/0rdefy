-- ================================================================
-- MIGRATION 039: Fix Cascade Delete for Orders
-- ================================================================
-- Ensures all related records are properly deleted when orders are removed
-- ================================================================

-- ================================================================
-- PART 1: Verify and recreate foreign keys with ON DELETE CASCADE
-- ================================================================

-- Drop existing foreign keys if they exist (to recreate with CASCADE)
ALTER TABLE picking_session_orders DROP CONSTRAINT IF EXISTS picking_session_orders_order_id_fkey;
ALTER TABLE return_session_orders DROP CONSTRAINT IF EXISTS return_session_orders_order_id_fkey;
ALTER TABLE packing_progress DROP CONSTRAINT IF EXISTS packing_progress_order_id_fkey;
ALTER TABLE order_status_history DROP CONSTRAINT IF EXISTS order_status_history_order_id_fkey;
ALTER TABLE delivery_attempts DROP CONSTRAINT IF EXISTS delivery_attempts_order_id_fkey;
ALTER TABLE follow_up_log DROP CONSTRAINT IF EXISTS follow_up_log_order_id_fkey;
ALTER TABLE settlement_orders DROP CONSTRAINT IF EXISTS settlement_orders_order_id_fkey;
ALTER TABLE inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_order_id_fkey;
ALTER TABLE order_line_items DROP CONSTRAINT IF EXISTS order_line_items_order_id_fkey;

-- Recreate all foreign keys with ON DELETE CASCADE
ALTER TABLE picking_session_orders
ADD CONSTRAINT picking_session_orders_order_id_fkey
FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

ALTER TABLE return_session_orders
ADD CONSTRAINT return_session_orders_order_id_fkey
FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

ALTER TABLE packing_progress
ADD CONSTRAINT packing_progress_order_id_fkey
FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

ALTER TABLE order_status_history
ADD CONSTRAINT order_status_history_order_id_fkey
FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

ALTER TABLE delivery_attempts
ADD CONSTRAINT delivery_attempts_order_id_fkey
FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

ALTER TABLE follow_up_log
ADD CONSTRAINT follow_up_log_order_id_fkey
FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

ALTER TABLE settlement_orders
ADD CONSTRAINT settlement_orders_order_id_fkey
FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

-- Special case: inventory_movements should SET NULL (preserve audit trail)
ALTER TABLE inventory_movements
ADD CONSTRAINT inventory_movements_order_id_fkey
FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;

-- Special case: order_line_items should CASCADE (normalized table)
ALTER TABLE order_line_items
ADD CONSTRAINT order_line_items_order_id_fkey
FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

-- ================================================================
-- PART 2: Add comments for clarity
-- ================================================================

COMMENT ON CONSTRAINT picking_session_orders_order_id_fkey ON picking_session_orders IS
'Cascade delete: Remove picking session associations when order is deleted';

COMMENT ON CONSTRAINT return_session_orders_order_id_fkey ON return_session_orders IS
'Cascade delete: Remove return session associations when order is deleted';

COMMENT ON CONSTRAINT packing_progress_order_id_fkey ON packing_progress IS
'Cascade delete: Remove packing progress when order is deleted';

COMMENT ON CONSTRAINT order_status_history_order_id_fkey ON order_status_history IS
'Cascade delete: Remove status history when order is deleted';

COMMENT ON CONSTRAINT delivery_attempts_order_id_fkey ON delivery_attempts IS
'Cascade delete: Remove delivery attempts when order is deleted';

COMMENT ON CONSTRAINT follow_up_log_order_id_fkey ON follow_up_log IS
'Cascade delete: Remove follow-up logs when order is deleted';

COMMENT ON CONSTRAINT settlement_orders_order_id_fkey ON settlement_orders IS
'Cascade delete: Remove settlement associations when order is deleted';

COMMENT ON CONSTRAINT inventory_movements_order_id_fkey ON inventory_movements IS
'SET NULL: Preserve audit trail even when order is deleted';

COMMENT ON CONSTRAINT order_line_items_order_id_fkey ON order_line_items IS
'Cascade delete: Remove line items when order is deleted (normalized table)';

-- ================================================================
-- VERIFICATION QUERIES
-- ================================================================

-- Verify foreign key constraints
-- SELECT
--     tc.table_name,
--     kcu.column_name,
--     ccu.table_name AS foreign_table_name,
--     ccu.column_name AS foreign_column_name,
--     rc.delete_rule
-- FROM information_schema.table_constraints AS tc
-- JOIN information_schema.key_column_usage AS kcu
--     ON tc.constraint_name = kcu.constraint_name
--     AND tc.table_schema = kcu.table_schema
-- JOIN information_schema.constraint_column_usage AS ccu
--     ON ccu.constraint_name = tc.constraint_name
--     AND ccu.table_schema = tc.table_schema
-- JOIN information_schema.referential_constraints AS rc
--     ON rc.constraint_name = tc.constraint_name
-- WHERE tc.constraint_type = 'FOREIGN KEY'
--     AND ccu.table_name = 'orders'
-- ORDER BY tc.table_name;

-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================
