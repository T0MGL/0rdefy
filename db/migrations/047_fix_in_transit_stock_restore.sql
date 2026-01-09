-- ================================================================
-- FIX: Comprehensive stock restoration for all manual status changes
-- ================================================================
-- Updates the inventory management trigger to:
-- 1. Include 'in_transit' in stock restoration triggers
-- 2. Handle 'returned' status (restore stock when marked as returned)
-- 3. Support reverting from any post-ready_to_ship status
-- ================================================================

-- ================================================================
-- FUNCTION: Update product stock based on order status changes (UPDATED)
-- ================================================================

CREATE OR REPLACE FUNCTION update_product_stock_on_order_status()
RETURNS TRIGGER AS $$
DECLARE
    line_item JSONB;
    product_uuid UUID;
    item_quantity INT;
    stock_before_change INT;
    stock_after_change INT;
    should_restore_stock BOOLEAN := FALSE;
    movement_type_val VARCHAR(50);
    movement_notes TEXT;
BEGIN
    -- Only process if sleeves_status changed
    IF (TG_OP = 'UPDATE' AND OLD.sleeves_status = NEW.sleeves_status) THEN
        RETURN NEW;
    END IF;

    -- Define states where stock has been decremented
    -- (ready_to_ship, shipped, in_transit, delivered)

    -- Case 1: Order moves to ready_to_ship (decrement stock)
    -- This happens after picking/packing is complete
    IF (TG_OP = 'INSERT' AND NEW.sleeves_status = 'ready_to_ship') OR
       (TG_OP = 'UPDATE' AND NEW.sleeves_status = 'ready_to_ship' AND
        OLD.sleeves_status NOT IN ('ready_to_ship', 'shipped', 'in_transit', 'delivered')) THEN

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
                        -- Product not found - log warning but don't fail (product might have been deleted)
                        RAISE WARNING 'Product % not found for order % - skipping stock decrement', product_uuid, NEW.id;
                    END IF;
                END IF;
            END LOOP;
        END IF;

        RAISE NOTICE 'Stock decremented for order % (% items)', NEW.id, COALESCE(jsonb_array_length(NEW.line_items), 0);
    END IF;

    -- Case 2: Order cancelled/rejected/returned from any stock-deducted state
    -- This restores stock when order is cancelled, rejected, or returned
    IF (TG_OP = 'UPDATE' AND
        NEW.sleeves_status IN ('cancelled', 'rejected', 'returned') AND
        OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'in_transit', 'delivered')) THEN

        should_restore_stock := TRUE;

        IF NEW.sleeves_status = 'returned' THEN
            movement_type_val := 'return_accepted';
            movement_notes := 'Stock restaurado por devolución de pedido';
        ELSE
            movement_type_val := 'order_cancelled';
            movement_notes := 'Stock restaurado al cancelar/rechazar pedido';
        END IF;
    END IF;

    -- Case 3: Order reverted from post-ready_to_ship to pre-ready_to_ship
    -- This handles manual status changes that revert the order flow
    IF (TG_OP = 'UPDATE' AND
        OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'in_transit', 'delivered') AND
        NEW.sleeves_status IN ('pending', 'confirmed', 'in_preparation')) THEN

        should_restore_stock := TRUE;
        movement_type_val := 'order_reverted';
        movement_notes := 'Stock restaurado al revertir pedido a estado anterior';
    END IF;

    -- Execute stock restoration if needed
    IF should_restore_stock THEN
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
                            movement_type_val,
                            OLD.sleeves_status,
                            NEW.sleeves_status,
                            movement_notes
                        );
                    ELSE
                        -- Product not found - log warning but don't fail
                        RAISE WARNING 'Product % not found for order % - skipping stock restore', product_uuid, NEW.id;
                    END IF;
                END IF;
            END LOOP;
        END IF;

        RAISE NOTICE 'Stock restored for order % (status: % -> %)', NEW.id, OLD.sleeves_status, NEW.sleeves_status;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- COMMENTS
-- ================================================================

COMMENT ON FUNCTION update_product_stock_on_order_status() IS
'Automatically updates product stock when order status changes:
- Decrements stock when order reaches ready_to_ship (from any earlier status)
- Restores stock when order is cancelled, rejected, or returned from stock-deducted states
- Restores stock when order is reverted to pre-ready_to_ship status
- Uses SELECT FOR UPDATE to prevent race conditions
- Logs all movements to inventory_movements table
- Handles missing products gracefully (warning, not error)

States with stock deducted: ready_to_ship, shipped, in_transit, delivered
Stock restoration triggers:
- cancelled from any deducted state
- rejected from any deducted state
- returned from any deducted state
- reverted to pending/confirmed/in_preparation from deducted state';
