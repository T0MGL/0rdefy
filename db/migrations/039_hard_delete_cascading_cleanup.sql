-- ================================================================
-- MIGRATION 039: Hard Delete with Complete Cascading Cleanup
-- ================================================================
-- Implements dual deletion system:
-- - Non-owners: Soft delete (deleted_at timestamp, reduced opacity in UI)
-- - Owner: Hard delete (permanent removal + cascading cleanup)
-- - Cleans up: order_status_history, delivery_attempts, picking_sessions,
--              packing_progress, return_sessions, order_line_items, etc.
-- ================================================================

-- ================================================================
-- PART 1: Ensure soft delete columns exist (keep for non-owners)
-- ================================================================

-- Add soft delete columns if they don't exist
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP DEFAULT NULL,
ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS deletion_type VARCHAR(20) CHECK (deletion_type IN ('soft', 'hard')) DEFAULT NULL;

-- Create/recreate indexes for soft delete
DROP INDEX IF EXISTS idx_orders_deleted_at;
DROP INDEX IF EXISTS idx_orders_active;
CREATE INDEX idx_orders_deleted_at ON orders(store_id, deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_orders_active ON orders(store_id, deleted_at) WHERE deleted_at IS NULL;

COMMENT ON COLUMN orders.deleted_at IS 'Soft delete timestamp (non-owners). NULL = active, NOT NULL = hidden in UI';
COMMENT ON COLUMN orders.deleted_by IS 'User who soft-deleted the order (for audit)';
COMMENT ON COLUMN orders.deletion_type IS 'Type: soft (non-owner, reversible) or hard (owner, permanent)';

-- ================================================================
-- PART 2: Cascading Hard Delete Function
-- ================================================================
-- This function will be called BEFORE deleting the order
-- It will clean up ALL related data in the correct order

CREATE OR REPLACE FUNCTION cascade_delete_order_data()
RETURNS TRIGGER AS $$
DECLARE
    line_item JSONB;
    v_product_id UUID;
    v_quantity INT;
    v_product_name TEXT;
    v_picking_session_ids UUID[];
    v_return_session_ids UUID[];
BEGIN
    RAISE NOTICE '🗑️ [CASCADE DELETE] Starting complete cleanup for order %', OLD.id;

    -- ============================================================
    -- STEP 1: Restore stock if order affected inventory
    -- ============================================================
    IF OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'delivered') THEN
        RAISE NOTICE '📦 [STOCK] Order % affected inventory. Restoring stock...', OLD.id;

        -- Loop through line_items and restore stock
        FOR line_item IN SELECT * FROM jsonb_array_elements(OLD.line_items)
        LOOP
            v_product_id := (line_item->>'product_id')::UUID;
            v_quantity := (line_item->>'quantity')::INT;
            v_product_name := line_item->>'product_name';

            IF v_product_id IS NULL THEN
                RAISE NOTICE '⚠️ Skipping item "%" - no product_id', v_product_name;
                CONTINUE;
            END IF;

            -- Get current stock before update
            DECLARE
                v_stock_before INT;
                v_stock_after INT;
            BEGIN
                SELECT stock INTO v_stock_before FROM products WHERE id = v_product_id;
                v_stock_after := v_stock_before + v_quantity;

                -- Restore stock
                UPDATE products
                SET stock = v_stock_after,
                    updated_at = NOW()
                WHERE id = v_product_id;

                -- Log restoration
                INSERT INTO inventory_movements (
                    product_id, store_id, order_id, movement_type,
                    quantity_change, stock_before, stock_after,
                    reason, notes, created_at
                ) VALUES (
                    v_product_id, OLD.store_id, OLD.id,
                    'order_hard_delete_restoration',
                    v_quantity, v_stock_before, v_stock_after,
                    'order_deletion',
                    format('Stock restored due to permanent deletion of order %s (status: %s)',
                        OLD.id, OLD.sleeves_status),
                    NOW()
                );
            END;

            RAISE NOTICE '✅ Restored % units of product % (ID: %)', v_quantity, v_product_name, v_product_id;
        END LOOP;
    END IF;

    -- ============================================================
    -- STEP 2: Delete from picking/packing sessions
    -- ============================================================
    -- Find all picking sessions containing this order
    SELECT ARRAY_AGG(DISTINCT picking_session_id)
    INTO v_picking_session_ids
    FROM picking_session_orders
    WHERE order_id = OLD.id;

    IF v_picking_session_ids IS NOT NULL AND array_length(v_picking_session_ids, 1) > 0 THEN
        RAISE NOTICE '📋 [PICKING] Cleaning up % picking sessions', array_length(v_picking_session_ids, 1);

        -- Delete packing progress for this order
        DELETE FROM packing_progress WHERE order_id = OLD.id;
        RAISE NOTICE '✅ Deleted packing progress';

        -- Delete picking session orders
        DELETE FROM picking_session_orders WHERE order_id = OLD.id;
        RAISE NOTICE '✅ Deleted from picking sessions';

        -- Delete orphaned picking sessions (no orders left)
        DELETE FROM picking_sessions
        WHERE id = ANY(v_picking_session_ids)
        AND NOT EXISTS (
            SELECT 1 FROM picking_session_orders WHERE picking_session_id = picking_sessions.id
        );
        RAISE NOTICE '✅ Deleted orphaned picking sessions';
    END IF;

    -- ============================================================
    -- STEP 3: Delete from return sessions
    -- ============================================================
    SELECT ARRAY_AGG(DISTINCT return_session_id)
    INTO v_return_session_ids
    FROM return_session_orders
    WHERE order_id = OLD.id;

    IF v_return_session_ids IS NOT NULL AND array_length(v_return_session_ids, 1) > 0 THEN
        RAISE NOTICE '↩️ [RETURNS] Cleaning up % return sessions', array_length(v_return_session_ids, 1);

        -- Delete return session orders
        DELETE FROM return_session_orders WHERE order_id = OLD.id;
        RAISE NOTICE '✅ Deleted from return sessions';

        -- Delete orphaned return sessions (no orders left)
        DELETE FROM return_sessions
        WHERE id = ANY(v_return_session_ids)
        AND NOT EXISTS (
            SELECT 1 FROM return_session_orders WHERE return_session_id = return_sessions.id
        );
        RAISE NOTICE '✅ Deleted orphaned return sessions';
    END IF;

    -- ============================================================
    -- STEP 4: Delete order line items (normalized table)
    -- ============================================================
    DELETE FROM order_line_items WHERE order_id = OLD.id;
    RAISE NOTICE '✅ Deleted order line items';

    -- ============================================================
    -- STEP 5: Delete delivery attempts
    -- ============================================================
    DELETE FROM delivery_attempts WHERE order_id = OLD.id;
    RAISE NOTICE '✅ Deleted delivery attempts';

    -- ============================================================
    -- STEP 6: Delete from daily settlements
    -- ============================================================
    DELETE FROM settlement_orders WHERE order_id = OLD.id;
    RAISE NOTICE '✅ Deleted from settlements';

    -- ============================================================
    -- STEP 7: Delete order status history
    -- ============================================================
    DELETE FROM order_status_history WHERE order_id = OLD.id;
    RAISE NOTICE '✅ Deleted order status history';

    -- ============================================================
    -- STEP 8: Delete follow-up logs
    -- ============================================================
    DELETE FROM follow_up_log WHERE order_id = OLD.id;
    RAISE NOTICE '✅ Deleted follow-up logs';

    -- ============================================================
    -- STEP 9: Clean up Shopify idempotency records
    -- ============================================================
    IF OLD.shopify_order_id IS NOT NULL THEN
        DELETE FROM shopify_webhook_idempotency WHERE shopify_event_id = OLD.shopify_order_id;
        DELETE FROM shopify_webhook_events
        WHERE shopify_event_id = OLD.shopify_order_id AND store_id = OLD.store_id;
        RAISE NOTICE '✅ Deleted Shopify webhook records';
    END IF;

    -- ============================================================
    -- FINAL: Allow order deletion to proceed
    -- ============================================================
    RAISE NOTICE '✅ [CASCADE DELETE] Complete cleanup finished for order %', OLD.id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- PART 3: Create trigger for cascading delete
-- ================================================================

-- Drop old trigger if exists
DROP TRIGGER IF EXISTS trigger_restore_stock_on_hard_delete ON orders;
DROP TRIGGER IF EXISTS trigger_cascade_delete_order_data ON orders;

-- Create new comprehensive cascading delete trigger
CREATE TRIGGER trigger_cascade_delete_order_data
    BEFORE DELETE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION cascade_delete_order_data();

COMMENT ON FUNCTION cascade_delete_order_data() IS
'Cascading delete function that cleans up ALL related order data before deletion (owner only)';

COMMENT ON TRIGGER trigger_cascade_delete_order_data ON orders IS
'Ensures complete cleanup of all related tables when order is deleted (hard delete by owner)';

-- ================================================================
-- PART 4: Update inventory movement trigger to handle deletions
-- ================================================================
-- This trigger should NOT block deletions anymore (already handled by cascade function)

-- Drop old blocking trigger if exists
DROP TRIGGER IF EXISTS trigger_prevent_order_deletion_after_stock_deducted ON orders;

-- ================================================================
-- VERIFICATION QUERIES
-- ================================================================

-- To verify complete cleanup after deleting an order, run these queries:

-- Check if any orphaned records exist for a specific order_id
-- SELECT
--     'order_status_history' as table_name, COUNT(*) as count FROM order_status_history WHERE order_id = 'ORDER_ID_HERE'
-- UNION ALL
-- SELECT 'delivery_attempts', COUNT(*) FROM delivery_attempts WHERE order_id = 'ORDER_ID_HERE'
-- UNION ALL
-- SELECT 'picking_session_orders', COUNT(*) FROM picking_session_orders WHERE order_id = 'ORDER_ID_HERE'
-- UNION ALL
-- SELECT 'packing_progress', COUNT(*) FROM packing_progress WHERE order_id = 'ORDER_ID_HERE'
-- UNION ALL
-- SELECT 'return_session_orders', COUNT(*) FROM return_session_orders WHERE order_id = 'ORDER_ID_HERE'
-- UNION ALL
-- SELECT 'settlement_orders', COUNT(*) FROM settlement_orders WHERE order_id = 'ORDER_ID_HERE'
-- UNION ALL
-- SELECT 'follow_up_log', COUNT(*) FROM follow_up_log WHERE order_id = 'ORDER_ID_HERE'
-- UNION ALL
-- SELECT 'order_line_items', COUNT(*) FROM order_line_items WHERE order_id = 'ORDER_ID_HERE';

-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================
-- Owner can now delete orders completely without leaving orphaned data.
-- No soft delete, no restore functionality - just clean permanent deletion.
-- ================================================================
