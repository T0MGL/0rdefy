-- ================================================================
-- MIGRATION 060: Fix Stock Trigger to Use order_line_items Table
-- ================================================================
-- CRITICAL FIX: The stock trigger was reading from orders.line_items JSONB
-- which contains Shopify product IDs (numbers), not local UUIDs.
--
-- ERROR SEEN IN PRODUCTION:
-- "invalid input syntax for type uuid: "10870121300161""
--
-- ROOT CAUSE:
-- The trigger was doing: (line_item->>'product_id')::UUID
-- But orders.line_items JSONB contains Shopify IDs like 10870121300161
--
-- FIX:
-- Read from order_line_items TABLE which has correctly mapped product_id UUID
--
-- CHANGES:
-- 1. Fix update_product_stock_on_order_status() to read from order_line_items
-- 2. Update stock_deducted column in order_line_items when stock is deducted
-- 3. Fix check_order_stock_availability() type mismatch (varchar vs text)
--
-- Author: Bright Idea
-- Date: 2026-01-13
-- ================================================================

BEGIN;

-- ================================================================
-- PART 1: LOG CURRENT STATE FOR VERIFICATION
-- ================================================================

DO $$
DECLARE
    v_movement_count INT;
    v_order_count INT;
    v_deducted_count INT;
BEGIN
    SELECT COUNT(*) INTO v_movement_count FROM inventory_movements;
    SELECT COUNT(*) INTO v_order_count FROM orders
        WHERE sleeves_status IN ('ready_to_ship', 'shipped', 'delivered', 'in_transit')
        AND deleted_at IS NULL;
    SELECT COUNT(*) INTO v_deducted_count FROM order_line_items WHERE stock_deducted = TRUE;

    RAISE NOTICE '';
    RAISE NOTICE '================================================================';
    RAISE NOTICE '  MIGRATION 060: FIX STOCK TRIGGER';
    RAISE NOTICE '================================================================';
    RAISE NOTICE '  Pre-migration state:';
    RAISE NOTICE '    - Inventory movements: %', v_movement_count;
    RAISE NOTICE '    - Orders past ready_to_ship: %', v_order_count;
    RAISE NOTICE '    - Line items with stock_deducted=true: %', v_deducted_count;
    RAISE NOTICE '================================================================';
    RAISE NOTICE '';
END $$;

-- ================================================================
-- PART 2: FIX STOCK MANAGEMENT FUNCTION
-- Now reads from order_line_items table instead of orders.line_items JSONB
-- ================================================================

CREATE OR REPLACE FUNCTION update_product_stock_on_order_status()
RETURNS TRIGGER AS $$
DECLARE
    v_line_item RECORD;
    v_product_uuid UUID;
    v_item_quantity INT;
    v_stock_before INT;
    v_stock_after INT;
    v_product_name TEXT;
    v_product_sku TEXT;
    v_product_exists BOOLEAN;
    v_items_processed INT := 0;
    v_items_skipped INT := 0;
    v_already_deducted BOOLEAN;
BEGIN
    -- Only process if sleeves_status changed
    IF (TG_OP = 'UPDATE' AND OLD.sleeves_status IS NOT DISTINCT FROM NEW.sleeves_status) THEN
        RETURN NEW;
    END IF;

    -- ============================================================
    -- CASE 1: Order moves to ready_to_ship (DECREMENT stock)
    -- ============================================================
    IF (TG_OP = 'INSERT' AND NEW.sleeves_status = 'ready_to_ship') OR
       (TG_OP = 'UPDATE' AND NEW.sleeves_status = 'ready_to_ship' AND
        COALESCE(OLD.sleeves_status, '') NOT IN ('ready_to_ship', 'shipped', 'delivered', 'in_transit')) THEN

        -- FIXED: Read from order_line_items TABLE (has correctly mapped product_id UUID)
        -- instead of orders.line_items JSONB (has Shopify numeric IDs)
        FOR v_line_item IN
            SELECT oli.id as line_item_id, oli.product_id, oli.quantity, oli.stock_deducted, oli.product_name as li_product_name
            FROM order_line_items oli
            WHERE oli.order_id = NEW.id
        LOOP
            v_product_uuid := v_line_item.product_id;
            v_item_quantity := COALESCE(v_line_item.quantity, 0);
            v_already_deducted := COALESCE(v_line_item.stock_deducted, FALSE);

            -- Skip if no product_id (unmapped product from Shopify)
            IF v_product_uuid IS NULL THEN
                RAISE NOTICE '[STOCK] Order % line item "%" has no product_id - skipping (unmapped product)',
                    NEW.id, COALESCE(v_line_item.li_product_name, 'Unknown');
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            -- Skip if already deducted (prevents double deduction)
            IF v_already_deducted THEN
                RAISE NOTICE '[STOCK] Order % line item % already has stock_deducted=true - skipping',
                    NEW.id, v_line_item.line_item_id;
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            -- Skip if quantity is zero or negative
            IF v_item_quantity <= 0 THEN
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            -- Check if product exists in store
            SELECT EXISTS(
                SELECT 1 FROM products
                WHERE id = v_product_uuid AND store_id = NEW.store_id
            ) INTO v_product_exists;

            IF NOT v_product_exists THEN
                RAISE WARNING '[STOCK] Product % not found in store % - skipping decrement for order %',
                    v_product_uuid, NEW.store_id, NEW.id;
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            -- Lock row and get current stock (prevents race conditions)
            SELECT stock, name, sku INTO v_stock_before, v_product_name, v_product_sku
            FROM products
            WHERE id = v_product_uuid AND store_id = NEW.store_id
            FOR UPDATE;

            -- CRITICAL: Validate sufficient stock
            IF v_stock_before < v_item_quantity THEN
                RAISE EXCEPTION 'Insufficient stock for product "%" (SKU: %, ID: %). Required: %, Available: %. Order: %',
                    v_product_name, COALESCE(v_product_sku, 'N/A'), v_product_uuid,
                    v_item_quantity, v_stock_before, NEW.id
                USING HINT = 'Cannot move order to ready_to_ship - check inventory and try again';
            END IF;

            -- Calculate and update stock
            v_stock_after := v_stock_before - v_item_quantity;

            UPDATE products
            SET stock = v_stock_after, updated_at = NOW()
            WHERE id = v_product_uuid AND store_id = NEW.store_id;

            -- Mark line item as stock deducted (for tracking and preventing double deduction)
            UPDATE order_line_items
            SET stock_deducted = TRUE, stock_deducted_at = NOW()
            WHERE id = v_line_item.line_item_id;

            -- Log the movement for audit trail
            INSERT INTO inventory_movements (
                store_id, product_id, order_id,
                quantity_change, stock_before, stock_after,
                movement_type, order_status_from, order_status_to, notes
            ) VALUES (
                NEW.store_id, v_product_uuid, NEW.id,
                -v_item_quantity, v_stock_before, v_stock_after,
                'order_ready',
                CASE WHEN TG_OP = 'UPDATE' THEN OLD.sleeves_status ELSE NULL END,
                NEW.sleeves_status,
                format('Stock decremented: %s x %s (SKU: %s)',
                       v_item_quantity, v_product_name, COALESCE(v_product_sku, 'N/A'))
            );

            v_items_processed := v_items_processed + 1;
        END LOOP;

        IF v_items_processed > 0 OR v_items_skipped > 0 THEN
            RAISE NOTICE '[STOCK] Order % ready_to_ship: % items decremented, % skipped',
                NEW.id, v_items_processed, v_items_skipped;
        END IF;
    END IF;

    -- ============================================================
    -- CASE 2: Order cancelled/rejected from stock-affecting status (RESTORE stock)
    -- ============================================================
    IF (TG_OP = 'UPDATE' AND
        NEW.sleeves_status IN ('cancelled', 'rejected') AND
        OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'in_transit', 'delivered')) THEN

        v_items_processed := 0;
        v_items_skipped := 0;

        FOR v_line_item IN
            SELECT oli.id as line_item_id, oli.product_id, oli.quantity, oli.stock_deducted
            FROM order_line_items oli
            WHERE oli.order_id = NEW.id
        LOOP
            v_product_uuid := v_line_item.product_id;
            v_item_quantity := COALESCE(v_line_item.quantity, 0);
            v_already_deducted := COALESCE(v_line_item.stock_deducted, FALSE);

            -- Only restore if stock was actually deducted
            IF NOT v_already_deducted THEN
                RAISE NOTICE '[STOCK] Order % line item % was never deducted - skipping restore',
                    NEW.id, v_line_item.line_item_id;
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            IF v_product_uuid IS NULL OR v_item_quantity <= 0 THEN
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            -- Check if product exists
            SELECT EXISTS(
                SELECT 1 FROM products
                WHERE id = v_product_uuid AND store_id = NEW.store_id
            ) INTO v_product_exists;

            IF NOT v_product_exists THEN
                RAISE WARNING '[STOCK] Product % not found - cannot restore stock for cancelled order %',
                    v_product_uuid, NEW.id;
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            -- Lock and update
            SELECT stock, name, sku INTO v_stock_before, v_product_name, v_product_sku
            FROM products
            WHERE id = v_product_uuid AND store_id = NEW.store_id
            FOR UPDATE;

            v_stock_after := v_stock_before + v_item_quantity;

            UPDATE products
            SET stock = v_stock_after, updated_at = NOW()
            WHERE id = v_product_uuid AND store_id = NEW.store_id;

            -- Mark line item as stock restored
            UPDATE order_line_items
            SET stock_deducted = FALSE, stock_deducted_at = NULL
            WHERE id = v_line_item.line_item_id;

            INSERT INTO inventory_movements (
                store_id, product_id, order_id,
                quantity_change, stock_before, stock_after,
                movement_type, order_status_from, order_status_to, notes
            ) VALUES (
                NEW.store_id, v_product_uuid, NEW.id,
                v_item_quantity, v_stock_before, v_stock_after,
                'order_cancelled',
                OLD.sleeves_status, NEW.sleeves_status,
                format('Stock restored on %s: %s x %s',
                       NEW.sleeves_status, v_item_quantity, v_product_name)
            );

            v_items_processed := v_items_processed + 1;
        END LOOP;

        IF v_items_processed > 0 THEN
            RAISE NOTICE '[STOCK] Order % cancelled/rejected: % items restored, % skipped',
                NEW.id, v_items_processed, v_items_skipped;
        END IF;
    END IF;

    -- ============================================================
    -- CASE 3: Order reverted to pre-stock status (RESTORE stock)
    -- e.g., ready_to_ship -> in_preparation (undo accidental status change)
    -- ============================================================
    IF (TG_OP = 'UPDATE' AND
        OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'in_transit', 'delivered') AND
        NEW.sleeves_status IN ('pending', 'confirmed', 'in_preparation')) THEN

        v_items_processed := 0;
        v_items_skipped := 0;

        FOR v_line_item IN
            SELECT oli.id as line_item_id, oli.product_id, oli.quantity, oli.stock_deducted
            FROM order_line_items oli
            WHERE oli.order_id = NEW.id
        LOOP
            v_product_uuid := v_line_item.product_id;
            v_item_quantity := COALESCE(v_line_item.quantity, 0);
            v_already_deducted := COALESCE(v_line_item.stock_deducted, FALSE);

            -- Only restore if stock was actually deducted
            IF NOT v_already_deducted THEN
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            IF v_product_uuid IS NULL OR v_item_quantity <= 0 THEN
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            SELECT EXISTS(
                SELECT 1 FROM products
                WHERE id = v_product_uuid AND store_id = NEW.store_id
            ) INTO v_product_exists;

            IF NOT v_product_exists THEN
                RAISE WARNING '[STOCK] Product % not found - cannot restore stock for reverted order %',
                    v_product_uuid, NEW.id;
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            SELECT stock, name, sku INTO v_stock_before, v_product_name, v_product_sku
            FROM products
            WHERE id = v_product_uuid AND store_id = NEW.store_id
            FOR UPDATE;

            v_stock_after := v_stock_before + v_item_quantity;

            UPDATE products
            SET stock = v_stock_after, updated_at = NOW()
            WHERE id = v_product_uuid AND store_id = NEW.store_id;

            -- Mark line item as stock restored
            UPDATE order_line_items
            SET stock_deducted = FALSE, stock_deducted_at = NULL
            WHERE id = v_line_item.line_item_id;

            INSERT INTO inventory_movements (
                store_id, product_id, order_id,
                quantity_change, stock_before, stock_after,
                movement_type, order_status_from, order_status_to, notes
            ) VALUES (
                NEW.store_id, v_product_uuid, NEW.id,
                v_item_quantity, v_stock_before, v_stock_after,
                'order_reverted',
                OLD.sleeves_status, NEW.sleeves_status,
                format('Stock restored on revert: %s x %s', v_item_quantity, v_product_name)
            );

            v_items_processed := v_items_processed + 1;
        END LOOP;

        IF v_items_processed > 0 THEN
            RAISE NOTICE '[STOCK] Order % reverted: % items restored, % skipped',
                NEW.id, v_items_processed, v_items_skipped;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate trigger
DROP TRIGGER IF EXISTS trigger_update_stock_on_order_status ON orders;
CREATE TRIGGER trigger_update_stock_on_order_status
    AFTER INSERT OR UPDATE OF sleeves_status
    ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_product_stock_on_order_status();

COMMENT ON FUNCTION update_product_stock_on_order_status() IS
'FIXED in migration 060: Now reads from order_line_items TABLE (has correct UUID product_id)
instead of orders.line_items JSONB (has Shopify numeric IDs).
Also updates stock_deducted flag in order_line_items for tracking and preventing double deduction.';

-- ================================================================
-- PART 3: FIX check_order_stock_availability() TYPE MISMATCH
-- Error was: "Returned type character varying does not match expected type text in column 2"
-- ================================================================

DROP FUNCTION IF EXISTS check_order_stock_availability(UUID, UUID);

CREATE OR REPLACE FUNCTION check_order_stock_availability(
    p_order_id UUID,
    p_store_id UUID
) RETURNS TABLE (
    product_id UUID,
    product_name TEXT,
    product_sku TEXT,
    required_quantity INT,
    available_stock INT,
    is_sufficient BOOLEAN,
    shortage INT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        oli.product_id,
        COALESCE(p.name, oli.product_name, 'Unknown Product')::TEXT as product_name,
        COALESCE(p.sku, oli.sku, '')::TEXT as product_sku,
        COALESCE(oli.quantity, 0)::INT as required_quantity,
        COALESCE(p.stock, 0)::INT as available_stock,
        (COALESCE(p.stock, 0) >= COALESCE(oli.quantity, 0))::BOOLEAN as is_sufficient,
        GREATEST(0, COALESCE(oli.quantity, 0) - COALESCE(p.stock, 0))::INT as shortage
    FROM order_line_items oli
    LEFT JOIN products p ON p.id = oli.product_id AND p.store_id = p_store_id
    WHERE oli.order_id = p_order_id
    AND oli.product_id IS NOT NULL;  -- Only check items with mapped products
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_order_stock_availability(UUID, UUID) IS
'FIXED in migration 060: Now reads from order_line_items TABLE with correct type casts.
Check if all products in an order have sufficient stock.
Use BEFORE attempting to move order to ready_to_ship.
Returns list of products with availability status and shortage amounts.';

-- Grant permissions
GRANT EXECUTE ON FUNCTION check_order_stock_availability(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION check_order_stock_availability(UUID, UUID) TO service_role;

-- ================================================================
-- PART 4: ADD INDEXES FOR FASTER LOOKUPS
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_order_line_items_order_id ON order_line_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_line_items_product_id ON order_line_items(product_id) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_line_items_stock_deducted ON order_line_items(order_id, stock_deducted) WHERE stock_deducted = TRUE;

-- ================================================================
-- PART 5: VERIFICATION
-- ================================================================

DO $$
DECLARE
    v_order_id UUID;
    v_store_id UUID;
    v_test_result RECORD;
    v_test_count INT := 0;
BEGIN
    -- Get a test order with line items
    SELECT o.id, o.store_id INTO v_order_id, v_store_id
    FROM orders o
    JOIN order_line_items oli ON oli.order_id = o.id
    WHERE o.deleted_at IS NULL
    AND oli.product_id IS NOT NULL
    LIMIT 1;

    IF v_order_id IS NOT NULL THEN
        -- Test the fixed function
        FOR v_test_result IN
            SELECT * FROM check_order_stock_availability(v_order_id, v_store_id)
        LOOP
            v_test_count := v_test_count + 1;
            RAISE NOTICE '  Test result: product="%" qty=% stock=% sufficient=%',
                v_test_result.product_name,
                v_test_result.required_quantity,
                v_test_result.available_stock,
                v_test_result.is_sufficient;
        END LOOP;

        IF v_test_count > 0 THEN
            RAISE NOTICE '  check_order_stock_availability: OK (% items checked)', v_test_count;
        ELSE
            RAISE NOTICE '  check_order_stock_availability: OK (no mapped products to check)';
        END IF;
    ELSE
        RAISE NOTICE '  No orders with mapped products found for testing';
    END IF;

    RAISE NOTICE '';
    RAISE NOTICE '================================================================';
    RAISE NOTICE '  MIGRATION 060 COMPLETE';
    RAISE NOTICE '================================================================';
    RAISE NOTICE '  Changes applied:';
    RAISE NOTICE '    1. Stock trigger now reads from order_line_items table';
    RAISE NOTICE '    2. Uses correctly mapped product_id UUID (not Shopify ID)';
    RAISE NOTICE '    3. Updates stock_deducted flag in order_line_items';
    RAISE NOTICE '    4. Fixed check_order_stock_availability type mismatch';
    RAISE NOTICE '    5. Added indexes for performance';
    RAISE NOTICE '';
    RAISE NOTICE '  TO VERIFY:';
    RAISE NOTICE '    1. Move a pending order to ready_to_ship';
    RAISE NOTICE '    2. Check inventory_movements for new record';
    RAISE NOTICE '    3. Check product stock decreased';
    RAISE NOTICE '    4. Check order_line_items.stock_deducted = true';
    RAISE NOTICE '================================================================';
END $$;

COMMIT;
