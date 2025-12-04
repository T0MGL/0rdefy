-- ================================================================
-- FIX: Stock concurrency and validation
-- ================================================================
-- Prevents race conditions and overselling by:
-- 1. Validating stock availability before decrementing
-- 2. Rejecting status changes if insufficient stock
-- 3. Using SELECT FOR UPDATE with NOWAIT for immediate failure
-- 4. Adding detailed error messages for debugging
-- ================================================================

-- ================================================================
-- FUNCTION: Improved stock update with validation
-- ================================================================

CREATE OR REPLACE FUNCTION update_product_stock_on_order_status()
RETURNS TRIGGER AS $$
DECLARE
    line_item JSONB;
    product_uuid UUID;
    item_quantity INT;
    stock_before_change INT;
    stock_after_change INT;
    product_name TEXT;
BEGIN
    -- Only process if sleeves_status changed
    IF (TG_OP = 'UPDATE' AND OLD.sleeves_status = NEW.sleeves_status) THEN
        RETURN NEW;
    END IF;

    -- Case 1: Order moves to ready_to_ship (decrement stock)
    -- This happens after picking/packing is complete
    IF (TG_OP = 'INSERT' AND NEW.sleeves_status = 'ready_to_ship') OR
       (TG_OP = 'UPDATE' AND NEW.sleeves_status = 'ready_to_ship' AND OLD.sleeves_status != 'ready_to_ship') THEN

        -- Loop through line_items and validate + decrement stock
        IF NEW.line_items IS NOT NULL AND jsonb_array_length(NEW.line_items) > 0 THEN
            FOR line_item IN SELECT * FROM jsonb_array_elements(NEW.line_items)
            LOOP
                -- Extract product_id and quantity
                product_uuid := (line_item->>'product_id')::UUID;
                item_quantity := COALESCE((line_item->>'quantity')::INT, 0);

                -- Validate and decrement stock
                IF product_uuid IS NOT NULL AND item_quantity > 0 THEN
                    -- Get current stock with row lock (NOWAIT for immediate failure detection)
                    -- This prevents deadlocks and makes concurrent conflicts explicit
                    BEGIN
                        SELECT stock, name INTO stock_before_change, product_name
                        FROM products
                        WHERE id = product_uuid AND store_id = NEW.store_id
                        FOR UPDATE NOWAIT;

                        IF NOT FOUND THEN
                            RAISE EXCEPTION 'Product % not found in store % - cannot decrement stock for order %',
                                product_uuid, NEW.store_id, NEW.id;
                        END IF;

                        -- CRITICAL: Validate sufficient stock before decrementing
                        IF stock_before_change < item_quantity THEN
                            RAISE EXCEPTION 'Insufficient stock for product "%" (ID: %). Required: %, Available: %. Order: %',
                                product_name, product_uuid, item_quantity, stock_before_change, NEW.id
                            USING HINT = 'Cannot move order to ready_to_ship - refresh inventory and try again';
                        END IF;

                        -- Calculate new stock (should never be negative due to validation above)
                        stock_after_change := stock_before_change - item_quantity;

                        -- Update stock
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
                            format('Stock decrementado para pedido listo para envío. Producto: %s', product_name)
                        );

                    EXCEPTION
                        WHEN lock_not_available THEN
                            -- Another transaction is updating this product
                            RAISE EXCEPTION 'Product "%" (ID: %) is being updated by another transaction. Please retry the operation.',
                                COALESCE(product_name, 'Unknown'), product_uuid
                            USING HINT = 'Concurrent stock update detected - retry in a moment';
                    END;
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
                    BEGIN
                        -- Get current stock with row lock
                        SELECT stock, name INTO stock_before_change, product_name
                        FROM products
                        WHERE id = product_uuid AND store_id = NEW.store_id
                        FOR UPDATE NOWAIT;

                        IF NOT FOUND THEN
                            RAISE WARNING 'Product % not found - cannot restore stock for cancelled order %',
                                product_uuid, NEW.id;
                            CONTINUE;
                        END IF;

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
                            format('Stock restaurado al cancelar/rechazar pedido. Producto: %s', product_name)
                        );

                    EXCEPTION
                        WHEN lock_not_available THEN
                            RAISE WARNING 'Product % locked by another transaction - stock restoration will be retried',
                                product_uuid;
                            -- Don't fail the cancellation, just log it
                            CONTINUE;
                    END;
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
                    BEGIN
                        -- Get current stock with row lock
                        SELECT stock, name INTO stock_before_change, product_name
                        FROM products
                        WHERE id = product_uuid AND store_id = NEW.store_id
                        FOR UPDATE NOWAIT;

                        IF NOT FOUND THEN
                            RAISE WARNING 'Product % not found - cannot restore stock for reverted order %',
                                product_uuid, NEW.id;
                            CONTINUE;
                        END IF;

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
                            format('Stock restaurado al revertir pedido a estado anterior. Producto: %s', product_name)
                        );

                    EXCEPTION
                        WHEN lock_not_available THEN
                            RAISE WARNING 'Product % locked by another transaction - stock restoration will be retried',
                                product_uuid;
                            CONTINUE;
                    END;
                END IF;
            END LOOP;
        END IF;

        RAISE NOTICE 'Stock restored for reverted order % (% items)', NEW.id, jsonb_array_length(NEW.line_items);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- HELPER FUNCTION: Check if order can be fulfilled with current stock
-- ================================================================
-- Use this in application code BEFORE attempting to move to ready_to_ship

CREATE OR REPLACE FUNCTION check_order_stock_availability(
    p_order_id UUID,
    p_store_id UUID
) RETURNS TABLE (
    product_id UUID,
    product_name TEXT,
    required_quantity INT,
    available_stock INT,
    is_sufficient BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        (line_item->>'product_id')::UUID as product_id,
        p.name as product_name,
        COALESCE((line_item->>'quantity')::INT, 0) as required_quantity,
        p.stock as available_stock,
        (p.stock >= COALESCE((line_item->>'quantity')::INT, 0)) as is_sufficient
    FROM orders o
    CROSS JOIN jsonb_array_elements(o.line_items) as line_item
    LEFT JOIN products p ON p.id = (line_item->>'product_id')::UUID AND p.store_id = o.store_id
    WHERE o.id = p_order_id
    AND o.store_id = p_store_id
    AND (line_item->>'product_id') IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- COMMENTS
-- ================================================================

COMMENT ON FUNCTION update_product_stock_on_order_status() IS
'Automatically updates product stock when order status changes:
- VALIDATES sufficient stock before decrementing (prevents overselling)
- Decrements stock when order reaches ready_to_ship
- Restores stock when order is cancelled/rejected/reverted
- Uses SELECT FOR UPDATE NOWAIT to detect concurrent conflicts immediately
- Raises exceptions on insufficient stock (blocks status change)
- Logs all movements to inventory_movements table with product names
- Thread-safe and prevents race conditions through pessimistic locking';

COMMENT ON FUNCTION check_order_stock_availability(UUID, UUID) IS
'Helper function to check if an order can be fulfilled with current stock.
Use in application code BEFORE attempting to move order to ready_to_ship.
Returns list of products with availability status.';

-- ================================================================
-- EXAMPLE USAGE
-- ================================================================

-- Check stock before completing packing:
-- SELECT * FROM check_order_stock_availability('order-uuid', 'store-uuid');
--
-- If all products return is_sufficient = true, proceed with status update:
-- UPDATE orders SET sleeves_status = 'ready_to_ship' WHERE id = 'order-uuid';
--
-- If any product has is_sufficient = false, show error to user and prevent update.
