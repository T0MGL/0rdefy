-- ================================================================
-- FIX ORDER CREATION AND DELETION
-- ================================================================
-- Solves critical issues preventing order creation and deletion:
-- 1. Allows order creation even with invalid/missing products
-- 2. Allows deletion of orders that haven't decremented stock
-- 3. Maintains data integrity for processed orders
-- Author: Bright Idea
-- Date: 2025-12-04
-- ================================================================

-- ================================================================
-- FUNCTION: Update product stock (FIXED - No exceptions on missing products)
-- ================================================================

CREATE OR REPLACE FUNCTION update_product_stock_on_order_status()
RETURNS TRIGGER AS $$
DECLARE
    line_item JSONB;
    product_uuid UUID;
    item_quantity INT;
    stock_before_change INT;
    stock_after_change INT;
    product_exists BOOLEAN;
BEGIN
    -- Only process if sleeves_status changed
    IF (TG_OP = 'UPDATE' AND OLD.sleeves_status = NEW.sleeves_status) THEN
        RETURN NEW;
    END IF;

    -- Case 1: Order moves to ready_to_ship (decrement stock)
    IF (TG_OP = 'INSERT' AND NEW.sleeves_status = 'ready_to_ship') OR
       (TG_OP = 'UPDATE' AND NEW.sleeves_status = 'ready_to_ship' AND OLD.sleeves_status != 'ready_to_ship') THEN

        -- Loop through line_items and decrement stock
        IF NEW.line_items IS NOT NULL AND jsonb_array_length(NEW.line_items) > 0 THEN
            FOR line_item IN SELECT * FROM jsonb_array_elements(NEW.line_items)
            LOOP
                -- Extract product_id and quantity
                product_uuid := (line_item->>'product_id')::UUID;
                item_quantity := COALESCE((line_item->>'quantity')::INT, 0);

                -- Skip if product_id is null or quantity is 0
                IF product_uuid IS NULL OR item_quantity <= 0 THEN
                    CONTINUE;
                END IF;

                -- Check if product exists BEFORE trying to update
                SELECT EXISTS(
                    SELECT 1 FROM products
                    WHERE id = product_uuid AND store_id = NEW.store_id
                ) INTO product_exists;

                IF NOT product_exists THEN
                    -- Don't throw exception - just log warning and continue
                    RAISE WARNING 'Product % not found for order % - skipping stock decrement', product_uuid, NEW.id;
                    CONTINUE;
                END IF;

                -- Get current stock with row lock
                SELECT stock INTO stock_before_change
                FROM products
                WHERE id = product_uuid AND store_id = NEW.store_id
                FOR UPDATE;

                -- Update stock (don't allow negative)
                stock_after_change := GREATEST(0, stock_before_change - item_quantity);

                UPDATE products
                SET
                    stock = stock_after_change,
                    updated_at = NOW()
                WHERE id = product_uuid
                AND store_id = NEW.store_id;

                -- Log the movement
                INSERT INTO inventory_movements (
                    store_id, product_id, order_id,
                    quantity_change, stock_before, stock_after,
                    movement_type, order_status_from, order_status_to,
                    notes
                ) VALUES (
                    NEW.store_id, product_uuid, NEW.id,
                    -item_quantity, stock_before_change, stock_after_change,
                    'order_ready',
                    CASE WHEN TG_OP = 'UPDATE' THEN OLD.sleeves_status ELSE NULL END,
                    NEW.sleeves_status,
                    'Stock decrementado para pedido listo para envío'
                );
            END LOOP;
        END IF;

        RAISE NOTICE 'Stock processing completed for order % (% items)', NEW.id, jsonb_array_length(NEW.line_items);
    END IF;

    -- Case 2: Order cancelled/rejected from ready_to_ship or later (restore stock)
    IF (TG_OP = 'UPDATE' AND
        NEW.sleeves_status IN ('cancelled', 'rejected') AND
        OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'delivered')) THEN

        IF NEW.line_items IS NOT NULL AND jsonb_array_length(NEW.line_items) > 0 THEN
            FOR line_item IN SELECT * FROM jsonb_array_elements(NEW.line_items)
            LOOP
                product_uuid := (line_item->>'product_id')::UUID;
                item_quantity := COALESCE((line_item->>'quantity')::INT, 0);

                IF product_uuid IS NULL OR item_quantity <= 0 THEN
                    CONTINUE;
                END IF;

                -- Check if product exists
                SELECT EXISTS(
                    SELECT 1 FROM products
                    WHERE id = product_uuid AND store_id = NEW.store_id
                ) INTO product_exists;

                IF NOT product_exists THEN
                    RAISE WARNING 'Product % not found for order % - skipping stock restoration', product_uuid, NEW.id;
                    CONTINUE;
                END IF;

                -- Get current stock with row lock
                SELECT stock INTO stock_before_change
                FROM products
                WHERE id = product_uuid AND store_id = NEW.store_id
                FOR UPDATE;

                stock_after_change := stock_before_change + item_quantity;

                UPDATE products
                SET
                    stock = stock_after_change,
                    updated_at = NOW()
                WHERE id = product_uuid
                AND store_id = NEW.store_id;

                -- Log the movement
                INSERT INTO inventory_movements (
                    store_id, product_id, order_id,
                    quantity_change, stock_before, stock_after,
                    movement_type, order_status_from, order_status_to,
                    notes
                ) VALUES (
                    NEW.store_id, product_uuid, NEW.id,
                    item_quantity, stock_before_change, stock_after_change,
                    'order_cancelled',
                    OLD.sleeves_status,
                    NEW.sleeves_status,
                    'Stock restaurado al cancelar/rechazar pedido'
                );
            END LOOP;
        END IF;

        RAISE NOTICE 'Stock restored for cancelled/rejected order % (% items)', NEW.id, jsonb_array_length(NEW.line_items);
    END IF;

    -- Case 3: Order reverted from ready_to_ship back to earlier status (restore stock)
    IF (TG_OP = 'UPDATE' AND
        OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'delivered') AND
        NEW.sleeves_status IN ('pending', 'confirmed', 'in_preparation')) THEN

        IF NEW.line_items IS NOT NULL AND jsonb_array_length(NEW.line_items) > 0 THEN
            FOR line_item IN SELECT * FROM jsonb_array_elements(NEW.line_items)
            LOOP
                product_uuid := (line_item->>'product_id')::UUID;
                item_quantity := COALESCE((line_item->>'quantity')::INT, 0);

                IF product_uuid IS NULL OR item_quantity <= 0 THEN
                    CONTINUE;
                END IF;

                -- Check if product exists
                SELECT EXISTS(
                    SELECT 1 FROM products
                    WHERE id = product_uuid AND store_id = NEW.store_id
                ) INTO product_exists;

                IF NOT product_exists THEN
                    RAISE WARNING 'Product % not found for order % - skipping stock restoration on revert', product_uuid, NEW.id;
                    CONTINUE;
                END IF;

                -- Get current stock with row lock
                SELECT stock INTO stock_before_change
                FROM products
                WHERE id = product_uuid AND store_id = NEW.store_id
                FOR UPDATE;

                stock_after_change := stock_before_change + item_quantity;

                UPDATE products
                SET
                    stock = stock_after_change,
                    updated_at = NOW()
                WHERE id = product_uuid
                AND store_id = NEW.store_id;

                -- Log the movement
                INSERT INTO inventory_movements (
                    store_id, product_id, order_id,
                    quantity_change, stock_before, stock_after,
                    movement_type, order_status_from, order_status_to,
                    notes
                ) VALUES (
                    NEW.store_id, product_uuid, NEW.id,
                    item_quantity, stock_before_change, stock_after_change,
                    'order_reverted',
                    OLD.sleeves_status,
                    NEW.sleeves_status,
                    'Stock restaurado al revertir pedido a estado anterior'
                );
            END LOOP;
        END IF;

        RAISE NOTICE 'Stock restored for reverted order % (% items)', NEW.id, jsonb_array_length(NEW.line_items);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- FUNCTION: Prevent deleting orders that decremented stock (FIXED)
-- ================================================================
-- Only prevents deletion if order ACTUALLY decremented stock
-- (verified by checking inventory_movements table)
-- This allows deletion of orders in pending/confirmed status

CREATE OR REPLACE FUNCTION prevent_order_deletion_after_stock_deducted()
RETURNS TRIGGER AS $$
DECLARE
    has_stock_movements BOOLEAN;
BEGIN
    -- Check if this order has any stock decrement movements
    SELECT EXISTS(
        SELECT 1 FROM inventory_movements
        WHERE order_id = OLD.id
        AND movement_type IN ('order_ready', 'order_cancelled', 'order_reverted')
    ) INTO has_stock_movements;

    -- Only prevent deletion if stock was actually affected
    IF has_stock_movements THEN
        RAISE EXCEPTION 'Cannot delete order % - stock has been decremented. Cancel the order instead.', OLD.id;
    END IF;

    -- Allow deletion for orders that never affected inventory
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- Re-create triggers with fixed functions
-- ================================================================

DROP TRIGGER IF EXISTS trigger_update_stock_on_order_status ON orders;
CREATE TRIGGER trigger_update_stock_on_order_status
    AFTER INSERT OR UPDATE OF sleeves_status
    ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_product_stock_on_order_status();

DROP TRIGGER IF EXISTS trigger_prevent_order_deletion ON orders;
CREATE TRIGGER trigger_prevent_order_deletion
    BEFORE DELETE
    ON orders
    FOR EACH ROW
    EXECUTE FUNCTION prevent_order_deletion_after_stock_deducted();

-- ================================================================
-- COMMENTS
-- ================================================================

COMMENT ON FUNCTION update_product_stock_on_order_status() IS
'FIXED: Automatically updates product stock when order status changes.
- Decrements stock when order reaches ready_to_ship
- Restores stock when order is cancelled/rejected or reverted
- Does NOT throw exceptions for missing products (only warnings)
- Skips products that dont exist instead of blocking order creation
- Logs all movements to inventory_movements table';

COMMENT ON FUNCTION prevent_order_deletion_after_stock_deducted() IS
'FIXED: Prevents deletion only for orders that ACTUALLY decremented stock.
- Checks inventory_movements table instead of just order status
- Allows deletion of pending/confirmed orders
- Allows deletion of orders with invalid/missing products
- Maintains data integrity for processed orders';

COMMENT ON TRIGGER trigger_prevent_order_deletion ON orders IS
'Prevents deletion only for orders with actual inventory movements';
