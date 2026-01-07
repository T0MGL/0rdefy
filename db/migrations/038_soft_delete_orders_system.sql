-- ================================================================
-- MIGRATION 038: Soft Delete System for Orders
-- ================================================================
-- Implements role-based soft delete system for orders:
-- - Soft delete: Mark as deleted (deleted_at timestamp)
-- - Hard delete: Permanently remove from database (owner only)
-- - Triggers updated to allow soft delete, block hard delete if stock affected
-- ================================================================

-- ================================================================
-- PART 1: Add soft delete columns to orders table
-- ================================================================

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP DEFAULT NULL,
ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS deletion_type VARCHAR(20) CHECK (deletion_type IN ('soft', 'hard')) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS marked_test_by UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS marked_test_at TIMESTAMP DEFAULT NULL;

-- Create index for filtering deleted orders
CREATE INDEX IF NOT EXISTS idx_orders_deleted_at ON orders(store_id, deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_active ON orders(store_id, deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_orders_test ON orders(store_id, is_test) WHERE is_test = TRUE;

COMMENT ON COLUMN orders.deleted_at IS 'Timestamp when order was soft-deleted. NULL = active order';
COMMENT ON COLUMN orders.deleted_by IS 'User who deleted the order (for audit trail)';
COMMENT ON COLUMN orders.deletion_type IS 'Type of deletion: soft (recoverable) or hard (permanent)';
COMMENT ON COLUMN orders.is_test IS 'TRUE if order is marked as test/demo order (shows with reduced opacity)';
COMMENT ON COLUMN orders.marked_test_by IS 'User who marked the order as test';
COMMENT ON COLUMN orders.marked_test_at IS 'Timestamp when order was marked as test';

-- ================================================================
-- PART 2: Update triggers to allow soft delete
-- ================================================================

-- Drop existing restrictive trigger
DROP TRIGGER IF EXISTS trigger_prevent_order_deletion ON orders;

-- ================================================================
-- FUNCTION: Restore stock automatically on hard delete if affected
-- ================================================================
CREATE OR REPLACE FUNCTION smart_order_deletion_with_stock_restoration()
RETURNS TRIGGER AS $$
DECLARE
    line_item JSONB;
    v_product_id UUID;
    v_quantity INT;
    v_product_name TEXT;
BEGIN
    -- Check if this is a hard delete of an order that affected inventory
    IF OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'delivered') THEN
        -- Stock was decremented, we need to restore it before deleting
        RAISE NOTICE 'Order % affected inventory. Restoring stock before permanent deletion...', OLD.id;

        -- Loop through line_items and restore stock for each product
        FOR line_item IN SELECT * FROM jsonb_array_elements(OLD.line_items)
        LOOP
            -- Extract product_id and quantity from line_item
            v_product_id := (line_item->>'product_id')::UUID;
            v_quantity := (line_item->>'quantity')::INT;
            v_product_name := line_item->>'product_name';

            -- Skip if no product_id (might be a custom item)
            IF v_product_id IS NULL THEN
                RAISE NOTICE 'Skipping item "%" - no product_id', v_product_name;
                CONTINUE;
            END IF;

            -- Restore stock
            UPDATE products
            SET stock = stock + v_quantity,
                updated_at = NOW()
            WHERE id = v_product_id;

            -- Log the restoration
            INSERT INTO inventory_movements (
                product_id,
                store_id,
                order_id,
                movement_type,
                quantity,
                reference_type,
                notes,
                created_at
            ) VALUES (
                v_product_id,
                OLD.store_id,
                OLD.id,
                'order_hard_delete_restoration',
                v_quantity,
                'order_deletion',
                format('Stock restored due to permanent deletion of order %s (was in status: %s)',
                    OLD.id, OLD.sleeves_status),
                NOW()
            );

            RAISE NOTICE 'Restored % units of product % (ID: %)', v_quantity, v_product_name, v_product_id;
        END LOOP;

        RAISE NOTICE 'Stock restoration completed for order %', OLD.id;
    END IF;

    -- Allow deletion (stock has been restored if needed)
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- TRIGGER: Restore stock on hard delete if needed
-- ================================================================
CREATE TRIGGER trigger_restore_stock_on_hard_delete
    BEFORE DELETE
    ON orders
    FOR EACH ROW
    EXECUTE FUNCTION smart_order_deletion_with_stock_restoration();

COMMENT ON FUNCTION smart_order_deletion_with_stock_restoration() IS
'Automatically restores stock when owner permanently deletes an order that affected inventory';

COMMENT ON TRIGGER trigger_restore_stock_on_hard_delete ON orders IS
'Restores inventory when order is hard-deleted (permanent deletion by owner)';

-- ================================================================
-- PART 3: Function to restore soft-deleted orders
-- ================================================================
CREATE OR REPLACE FUNCTION restore_soft_deleted_order(
    p_order_id UUID,
    p_restored_by UUID
)
RETURNS TABLE (
    success BOOLEAN,
    message TEXT,
    order_id UUID
) AS $$
DECLARE
    v_order_exists BOOLEAN;
    v_is_deleted BOOLEAN;
BEGIN
    -- Check if order exists and is soft-deleted
    SELECT EXISTS(SELECT 1 FROM orders WHERE id = p_order_id),
           deleted_at IS NOT NULL
    INTO v_order_exists, v_is_deleted
    FROM orders
    WHERE id = p_order_id;

    IF NOT v_order_exists THEN
        RETURN QUERY SELECT FALSE, 'Order not found'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    IF NOT v_is_deleted THEN
        RETURN QUERY SELECT FALSE, 'Order is not deleted'::TEXT, p_order_id;
        RETURN;
    END IF;

    -- Restore the order
    UPDATE orders
    SET deleted_at = NULL,
        deleted_by = NULL,
        deletion_type = NULL,
        updated_at = NOW()
    WHERE id = p_order_id;

    -- Log to order status history
    INSERT INTO order_status_history (
        order_id,
        store_id,
        previous_status,
        new_status,
        changed_by,
        change_source,
        notes
    )
    SELECT
        id,
        store_id,
        sleeves_status,
        sleeves_status,
        p_restored_by::TEXT,
        'dashboard',
        'Order restored from soft delete'
    FROM orders
    WHERE id = p_order_id;

    RETURN QUERY SELECT TRUE, 'Order restored successfully'::TEXT, p_order_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION restore_soft_deleted_order IS
'Restores a soft-deleted order by clearing deleted_at timestamp';

-- ================================================================
-- PART 4: Functions to mark/unmark orders as test
-- ================================================================

CREATE OR REPLACE FUNCTION mark_order_as_test(
    p_order_id UUID,
    p_marked_by UUID,
    p_is_test BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
    success BOOLEAN,
    message TEXT,
    order_id UUID
) AS $$
DECLARE
    v_order_exists BOOLEAN;
BEGIN
    -- Check if order exists
    SELECT EXISTS(SELECT 1 FROM orders WHERE id = p_order_id)
    INTO v_order_exists;

    IF NOT v_order_exists THEN
        RETURN QUERY SELECT FALSE, 'Order not found'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- Update test flag
    UPDATE orders
    SET is_test = p_is_test,
        marked_test_by = CASE WHEN p_is_test THEN p_marked_by ELSE NULL END,
        marked_test_at = CASE WHEN p_is_test THEN NOW() ELSE NULL END,
        updated_at = NOW()
    WHERE id = p_order_id;

    -- Log to order status history
    INSERT INTO order_status_history (
        order_id,
        store_id,
        previous_status,
        new_status,
        changed_by,
        change_source,
        notes
    )
    SELECT
        id,
        store_id,
        sleeves_status,
        sleeves_status,
        p_marked_by::TEXT,
        'dashboard',
        CASE WHEN p_is_test THEN 'Order marked as test' ELSE 'Order unmarked as test' END
    FROM orders
    WHERE id = p_order_id;

    RETURN QUERY SELECT
        TRUE,
        CASE WHEN p_is_test THEN 'Order marked as test'::TEXT ELSE 'Order unmarked as test'::TEXT END,
        p_order_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION mark_order_as_test IS
'Marks or unmarks an order as test/demo order (shows with reduced opacity in UI)';

-- ================================================================
-- PART 5: Update existing queries to exclude soft-deleted orders
-- ================================================================
-- Note: API queries should add WHERE deleted_at IS NULL to exclude deleted orders
-- Or add a toggle to show deleted orders: WHERE (deleted_at IS NULL OR :show_deleted = true)

-- ================================================================
-- VERIFICATION QUERIES
-- ================================================================

-- Count active vs deleted orders
-- SELECT
--     store_id,
--     COUNT(*) FILTER (WHERE deleted_at IS NULL) as active_orders,
--     COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) as deleted_orders
-- FROM orders
-- GROUP BY store_id;

-- View deleted orders with details
-- SELECT
--     id,
--     customer_first_name,
--     customer_last_name,
--     total_price,
--     sleeves_status,
--     deleted_at,
--     deleted_by,
--     deletion_type
-- FROM orders
-- WHERE deleted_at IS NOT NULL
-- ORDER BY deleted_at DESC;

-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================
