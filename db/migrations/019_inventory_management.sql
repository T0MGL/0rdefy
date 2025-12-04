-- ================================================================
-- INVENTORY MANAGEMENT SYSTEM
-- ================================================================
-- Automatically updates product stock when orders change status
--
-- Stock Flow:
-- 1. ready_to_ship: Stock is decremented (physical inventory removed)
-- 2. cancelled/rejected: Stock is restored
--
-- This ensures accurate inventory tracking throughout the order lifecycle
-- ================================================================

-- ================================================================
-- TABLE: Inventory audit log
-- ================================================================

CREATE TABLE IF NOT EXISTS inventory_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    quantity_change INT NOT NULL,
    stock_before INT NOT NULL,
    stock_after INT NOT NULL,
    movement_type VARCHAR(50) NOT NULL, -- 'order_ready', 'order_cancelled', 'order_reverted', 'manual_adjustment'
    order_status_from VARCHAR(50),
    order_status_to VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_store ON inventory_movements(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product ON inventory_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_order ON inventory_movements(order_id);

COMMENT ON TABLE inventory_movements IS 'Audit log for all inventory changes';
COMMENT ON COLUMN inventory_movements.movement_type IS 'Type: order_ready, order_cancelled, order_reverted, manual_adjustment';

-- ================================================================
-- FUNCTION: Update product stock based on order status changes
-- ================================================================

CREATE OR REPLACE FUNCTION update_product_stock_on_order_status()
RETURNS TRIGGER AS $$
DECLARE
    line_item JSONB;
    product_uuid UUID;
    item_quantity INT;
    stock_before_change INT;
    stock_after_change INT;
BEGIN
    -- Only process if sleeves_status changed
    IF (TG_OP = 'UPDATE' AND OLD.sleeves_status = NEW.sleeves_status) THEN
        RETURN NEW;
    END IF;

    -- Case 1: Order moves to ready_to_ship (decrement stock)
    -- This happens after picking/packing is complete
    IF (TG_OP = 'INSERT' AND NEW.sleeves_status = 'ready_to_ship') OR
       (TG_OP = 'UPDATE' AND NEW.sleeves_status = 'ready_to_ship' AND OLD.sleeves_status != 'ready_to_ship') THEN

        -- Loop through line_items and decrement stock
        IF NEW.line_items IS NOT NULL AND jsonb_array_length(NEW.line_items) > 0 THEN
            FOR line_item IN SELECT * FROM jsonb_array_elements(NEW.line_items)
            LOOP
                -- Extract product_id and quantity
                product_uuid := (line_item->>'product_id')::UUID;
                item_quantity := COALESCE((line_item->>'quantity')::INT, 0);

                -- Decrement stock (don't allow negative stock)
                IF product_uuid IS NOT NULL AND item_quantity > 0 THEN
                    -- Get current stock with row lock to prevent concurrent updates
                    SELECT stock INTO stock_before_change
                    FROM products
                    WHERE id = product_uuid AND store_id = NEW.store_id
                    FOR UPDATE;

                    IF FOUND THEN
                        -- Update stock
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
                    ELSE
                        RAISE EXCEPTION 'Product % not found for order % - cannot decrement stock', product_uuid, NEW.id;
                    END IF;
                END IF;
            END LOOP;
        END IF;

        RAISE NOTICE 'Stock decremented for order % (% items)', NEW.id, jsonb_array_length(NEW.line_items);
    END IF;

    -- Case 2: Order cancelled/rejected from ready_to_ship or later (restore stock)
    IF (TG_OP = 'UPDATE' AND
        NEW.sleeves_status IN ('cancelled', 'rejected') AND
        OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'delivered')) THEN

        -- Loop through line_items and restore stock
        IF NEW.line_items IS NOT NULL AND jsonb_array_length(NEW.line_items) > 0 THEN
            FOR line_item IN SELECT * FROM jsonb_array_elements(NEW.line_items)
            LOOP
                -- Extract product_id and quantity
                product_uuid := (line_item->>'product_id')::UUID;
                item_quantity := COALESCE((line_item->>'quantity')::INT, 0);

                -- Restore stock
                IF product_uuid IS NOT NULL AND item_quantity > 0 THEN
                    -- Get current stock with row lock to prevent concurrent updates
                    SELECT stock INTO stock_before_change
                    FROM products
                    WHERE id = product_uuid AND store_id = NEW.store_id
                    FOR UPDATE;

                    IF FOUND THEN
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
                    ELSE
                        RAISE EXCEPTION 'Product % not found for order % - cannot restore stock', product_uuid, NEW.id;
                    END IF;
                END IF;
            END LOOP;
        END IF;

        RAISE NOTICE 'Stock restored for cancelled/rejected order % (% items)', NEW.id, jsonb_array_length(NEW.line_items);
    END IF;

    -- Case 3: Order reverted from ready_to_ship back to earlier status (restore stock)
    IF (TG_OP = 'UPDATE' AND
        OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'delivered') AND
        NEW.sleeves_status IN ('pending', 'confirmed', 'in_preparation')) THEN

        -- Loop through line_items and restore stock
        IF NEW.line_items IS NOT NULL AND jsonb_array_length(NEW.line_items) > 0 THEN
            FOR line_item IN SELECT * FROM jsonb_array_elements(NEW.line_items)
            LOOP
                product_uuid := (line_item->>'product_id')::UUID;
                item_quantity := COALESCE((line_item->>'quantity')::INT, 0);

                IF product_uuid IS NOT NULL AND item_quantity > 0 THEN
                    -- Get current stock with row lock to prevent concurrent updates
                    SELECT stock INTO stock_before_change
                    FROM products
                    WHERE id = product_uuid AND store_id = NEW.store_id
                    FOR UPDATE;

                    IF FOUND THEN
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
                    ELSE
                        RAISE EXCEPTION 'Product % not found for order % - cannot restore stock on revert', product_uuid, NEW.id;
                    END IF;
                END IF;
            END LOOP;
        END IF;

        RAISE NOTICE 'Stock restored for reverted order % (% items)', NEW.id, jsonb_array_length(NEW.line_items);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- TRIGGER: Apply stock updates on order status changes
-- ================================================================

DROP TRIGGER IF EXISTS trigger_update_stock_on_order_status ON orders;

CREATE TRIGGER trigger_update_stock_on_order_status
    AFTER INSERT OR UPDATE OF sleeves_status
    ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_product_stock_on_order_status();

-- ================================================================
-- FUNCTION: Prevent editing line_items after stock deduction
-- ================================================================

CREATE OR REPLACE FUNCTION prevent_line_items_edit_after_stock_deducted()
RETURNS TRIGGER AS $$
BEGIN
    -- Prevent editing line_items if order reached ready_to_ship or later
    -- Only check if line_items actually changed
    IF OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'delivered') AND
       OLD.line_items::text != NEW.line_items::text THEN
        RAISE EXCEPTION 'Cannot modify line_items for order % - stock has been decremented. Cancel the order and create a new one instead.', OLD.id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- TRIGGER: Prevent line_items modification after stock deduction
-- ================================================================

DROP TRIGGER IF EXISTS trigger_prevent_line_items_edit ON orders;

CREATE TRIGGER trigger_prevent_line_items_edit
    BEFORE UPDATE OF line_items
    ON orders
    FOR EACH ROW
    EXECUTE FUNCTION prevent_line_items_edit_after_stock_deducted();

-- ================================================================
-- FUNCTION: Prevent deleting orders that already decremented stock
-- ================================================================

CREATE OR REPLACE FUNCTION prevent_order_deletion_after_stock_deducted()
RETURNS TRIGGER AS $$
BEGIN
    -- Prevent deletion if order reached ready_to_ship or later
    IF OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'delivered') THEN
        RAISE EXCEPTION 'Cannot delete order % - stock has been decremented. Cancel the order instead.', OLD.id;
    END IF;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- TRIGGER: Prevent order deletion after stock deduction
-- ================================================================

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
'Automatically updates product stock when order status changes:
- Decrements stock when order reaches ready_to_ship
- Restores stock when order is cancelled/rejected
- Restores stock when order is reverted to earlier status
- Uses SELECT FOR UPDATE to prevent race conditions in concurrent updates
- Logs all movements to inventory_movements table
- Raises exceptions if products not found to maintain data integrity';

COMMENT ON TRIGGER trigger_update_stock_on_order_status ON orders IS
'Maintains accurate inventory by tracking order status changes';

COMMENT ON FUNCTION prevent_line_items_edit_after_stock_deducted() IS
'Prevents editing line_items after stock has been decremented to maintain inventory accuracy';

COMMENT ON TRIGGER trigger_prevent_line_items_edit ON orders IS
'Blocks line_items modifications for orders that already affected inventory';

COMMENT ON TRIGGER trigger_prevent_order_deletion ON orders IS
'Prevents accidental deletion of orders that already affected inventory';
