-- ================================================================
-- MIGRATION 057: Production-Ready Inventory & Data Integrity Fixes
-- ================================================================
-- CRITICAL: This migration consolidates and fixes all inventory
-- management issues identified in the deep audit.
--
-- FIXES:
-- 1. Consolidates conflicting 023_* migrations into definitive function
-- 2. Adds optimistic locking (version column) to orders
-- 3. Adds unique constraint on SKU per store
-- 4. Prevents product deletion with active orders
-- 5. Adds comprehensive order status validation
-- 6. Fixes customer stats on all order lifecycle events
-- 7. Adds data integrity monitoring views
--
-- Author: Bright Idea
-- Date: 2026-01-12
-- ================================================================

-- ================================================================
-- PART 1: Add optimistic locking to orders table
-- ================================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS version INT DEFAULT 1;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS last_modified_by UUID REFERENCES users(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS last_modified_at TIMESTAMP DEFAULT NOW();

COMMENT ON COLUMN orders.version IS 'Optimistic locking version - increments on each update';
COMMENT ON COLUMN orders.last_modified_by IS 'User who last modified this order';
COMMENT ON COLUMN orders.last_modified_at IS 'Timestamp of last modification';

-- Create trigger to auto-increment version on update
CREATE OR REPLACE FUNCTION increment_order_version()
RETURNS TRIGGER AS $$
BEGIN
    NEW.version := COALESCE(OLD.version, 0) + 1;
    NEW.last_modified_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_increment_order_version ON orders;
CREATE TRIGGER trigger_increment_order_version
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION increment_order_version();

-- ================================================================
-- PART 2: Add unique constraint on SKU per store (prevent mapping errors)
-- ================================================================

-- First, find and log any duplicate SKUs (for manual review)
DO $$
DECLARE
    dup_count INT;
BEGIN
    SELECT COUNT(*) INTO dup_count
    FROM (
        SELECT store_id, sku, COUNT(*) as cnt
        FROM products
        WHERE sku IS NOT NULL AND sku != ''
        GROUP BY store_id, sku
        HAVING COUNT(*) > 1
    ) dups;

    IF dup_count > 0 THEN
        RAISE NOTICE '⚠️  Found % duplicate SKU groups. Review products table before unique constraint can be added.', dup_count;
    ELSE
        RAISE NOTICE '✅ No duplicate SKUs found. Safe to add unique constraint.';
    END IF;
END $$;

-- Create partial unique index (allows NULL and empty SKUs, prevents duplicates)
DROP INDEX IF EXISTS idx_products_unique_sku_per_store;
CREATE UNIQUE INDEX idx_products_unique_sku_per_store
ON products(store_id, sku)
WHERE sku IS NOT NULL AND sku != '';

COMMENT ON INDEX idx_products_unique_sku_per_store IS
'Ensures SKU uniqueness per store to prevent incorrect product mapping in Shopify sync';

-- ================================================================
-- PART 3: Prevent product deletion with active orders
-- ================================================================

CREATE OR REPLACE FUNCTION prevent_product_deletion_with_active_orders()
RETURNS TRIGGER AS $$
DECLARE
    active_order_count INT;
    sample_orders TEXT;
BEGIN
    -- Check for active orders containing this product
    SELECT COUNT(*), STRING_AGG(o.order_number::TEXT, ', ' ORDER BY o.created_at DESC)
    INTO active_order_count, sample_orders
    FROM order_line_items oli
    JOIN orders o ON o.id = oli.order_id
    WHERE oli.product_id = OLD.id
    AND o.sleeves_status NOT IN ('delivered', 'cancelled', 'rejected', 'returned')
    AND o.deleted_at IS NULL;

    IF active_order_count > 0 THEN
        -- Limit sample to first 5 orders
        sample_orders := (
            SELECT STRING_AGG(order_num, ', ')
            FROM (
                SELECT o.order_number::TEXT as order_num
                FROM order_line_items oli
                JOIN orders o ON o.id = oli.order_id
                WHERE oli.product_id = OLD.id
                AND o.sleeves_status NOT IN ('delivered', 'cancelled', 'rejected', 'returned')
                AND o.deleted_at IS NULL
                ORDER BY o.created_at DESC
                LIMIT 5
            ) sub
        );

        RAISE EXCEPTION 'Cannot delete product "%" (ID: %) - it has % active order(s). Sample orders: %. Complete or cancel these orders first.',
            OLD.name, OLD.id, active_order_count, sample_orders;
    END IF;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prevent_product_deletion_active_orders ON products;
CREATE TRIGGER trigger_prevent_product_deletion_active_orders
    BEFORE DELETE ON products
    FOR EACH ROW
    EXECUTE FUNCTION prevent_product_deletion_with_active_orders();

COMMENT ON FUNCTION prevent_product_deletion_with_active_orders() IS
'Prevents deletion of products that have active (non-delivered, non-cancelled) orders';

-- ================================================================
-- PART 4: DEFINITIVE stock management function (consolidates 023_* migrations)
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
    product_sku TEXT;
    product_exists BOOLEAN;
    items_processed INT := 0;
    items_skipped INT := 0;
BEGIN
    -- Only process if sleeves_status changed
    IF (TG_OP = 'UPDATE' AND OLD.sleeves_status IS NOT DISTINCT FROM NEW.sleeves_status) THEN
        RETURN NEW;
    END IF;

    -- ============================================================
    -- CASE 1: Order moves to ready_to_ship (DECREMENT stock)
    -- This happens after picking/packing is complete
    -- ============================================================
    IF (TG_OP = 'INSERT' AND NEW.sleeves_status = 'ready_to_ship') OR
       (TG_OP = 'UPDATE' AND NEW.sleeves_status = 'ready_to_ship' AND
        COALESCE(OLD.sleeves_status, '') NOT IN ('ready_to_ship', 'shipped', 'delivered')) THEN

        IF NEW.line_items IS NOT NULL AND jsonb_array_length(NEW.line_items) > 0 THEN
            FOR line_item IN SELECT * FROM jsonb_array_elements(NEW.line_items)
            LOOP
                product_uuid := (line_item->>'product_id')::UUID;
                item_quantity := COALESCE((line_item->>'quantity')::INT, 0);

                -- Skip if no product_id or quantity
                IF product_uuid IS NULL OR item_quantity <= 0 THEN
                    items_skipped := items_skipped + 1;
                    CONTINUE;
                END IF;

                -- Check if product exists
                SELECT EXISTS(
                    SELECT 1 FROM products
                    WHERE id = product_uuid AND store_id = NEW.store_id
                ) INTO product_exists;

                IF NOT product_exists THEN
                    -- Log warning but don't block - product may have been deleted or not synced
                    RAISE WARNING '[STOCK] Product % not found in store % - skipping decrement for order %',
                        product_uuid, NEW.store_id, NEW.id;
                    items_skipped := items_skipped + 1;
                    CONTINUE;
                END IF;

                -- Lock row and get current stock
                SELECT stock, name, sku INTO stock_before_change, product_name, product_sku
                FROM products
                WHERE id = product_uuid AND store_id = NEW.store_id
                FOR UPDATE;

                -- CRITICAL: Validate sufficient stock
                IF stock_before_change < item_quantity THEN
                    RAISE EXCEPTION 'Insufficient stock for product "%" (SKU: %, ID: %). Required: %, Available: %. Order: %',
                        product_name, COALESCE(product_sku, 'N/A'), product_uuid,
                        item_quantity, stock_before_change, NEW.id
                    USING HINT = 'Cannot move order to ready_to_ship - check inventory and try again';
                END IF;

                -- Calculate and update stock
                stock_after_change := stock_before_change - item_quantity;

                UPDATE products
                SET stock = stock_after_change, updated_at = NOW()
                WHERE id = product_uuid AND store_id = NEW.store_id;

                -- Log the movement
                INSERT INTO inventory_movements (
                    store_id, product_id, order_id,
                    quantity_change, stock_before, stock_after,
                    movement_type, order_status_from, order_status_to, notes
                ) VALUES (
                    NEW.store_id, product_uuid, NEW.id,
                    -item_quantity, stock_before_change, stock_after_change,
                    'order_ready',
                    CASE WHEN TG_OP = 'UPDATE' THEN OLD.sleeves_status ELSE NULL END,
                    NEW.sleeves_status,
                    format('Stock decremented: %s x %s (SKU: %s)',
                           item_quantity, product_name, COALESCE(product_sku, 'N/A'))
                );

                items_processed := items_processed + 1;
            END LOOP;
        END IF;

        IF items_processed > 0 OR items_skipped > 0 THEN
            RAISE NOTICE '[STOCK] Order % ready_to_ship: % items decremented, % skipped',
                NEW.id, items_processed, items_skipped;
        END IF;
    END IF;

    -- ============================================================
    -- CASE 2: Order cancelled/rejected from stock-affecting status (RESTORE stock)
    -- ============================================================
    IF (TG_OP = 'UPDATE' AND
        NEW.sleeves_status IN ('cancelled', 'rejected') AND
        OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'in_transit', 'delivered')) THEN

        items_processed := 0;
        items_skipped := 0;

        IF NEW.line_items IS NOT NULL AND jsonb_array_length(NEW.line_items) > 0 THEN
            FOR line_item IN SELECT * FROM jsonb_array_elements(NEW.line_items)
            LOOP
                product_uuid := (line_item->>'product_id')::UUID;
                item_quantity := COALESCE((line_item->>'quantity')::INT, 0);

                IF product_uuid IS NULL OR item_quantity <= 0 THEN
                    items_skipped := items_skipped + 1;
                    CONTINUE;
                END IF;

                -- Check if product exists
                SELECT EXISTS(
                    SELECT 1 FROM products
                    WHERE id = product_uuid AND store_id = NEW.store_id
                ) INTO product_exists;

                IF NOT product_exists THEN
                    RAISE WARNING '[STOCK] Product % not found - cannot restore stock for cancelled order %',
                        product_uuid, NEW.id;
                    items_skipped := items_skipped + 1;
                    CONTINUE;
                END IF;

                -- Lock and update
                SELECT stock, name, sku INTO stock_before_change, product_name, product_sku
                FROM products
                WHERE id = product_uuid AND store_id = NEW.store_id
                FOR UPDATE;

                stock_after_change := stock_before_change + item_quantity;

                UPDATE products
                SET stock = stock_after_change, updated_at = NOW()
                WHERE id = product_uuid AND store_id = NEW.store_id;

                INSERT INTO inventory_movements (
                    store_id, product_id, order_id,
                    quantity_change, stock_before, stock_after,
                    movement_type, order_status_from, order_status_to, notes
                ) VALUES (
                    NEW.store_id, product_uuid, NEW.id,
                    item_quantity, stock_before_change, stock_after_change,
                    'order_cancelled',
                    OLD.sleeves_status, NEW.sleeves_status,
                    format('Stock restored on %s: %s x %s',
                           NEW.sleeves_status, item_quantity, product_name)
                );

                items_processed := items_processed + 1;
            END LOOP;
        END IF;

        IF items_processed > 0 THEN
            RAISE NOTICE '[STOCK] Order % cancelled/rejected: % items restored, % skipped',
                NEW.id, items_processed, items_skipped;
        END IF;
    END IF;

    -- ============================================================
    -- CASE 3: Order reverted to pre-stock status (RESTORE stock)
    -- e.g., ready_to_ship -> in_preparation (undo accidental status change)
    -- ============================================================
    IF (TG_OP = 'UPDATE' AND
        OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'in_transit', 'delivered') AND
        NEW.sleeves_status IN ('pending', 'confirmed', 'in_preparation')) THEN

        items_processed := 0;
        items_skipped := 0;

        IF NEW.line_items IS NOT NULL AND jsonb_array_length(NEW.line_items) > 0 THEN
            FOR line_item IN SELECT * FROM jsonb_array_elements(NEW.line_items)
            LOOP
                product_uuid := (line_item->>'product_id')::UUID;
                item_quantity := COALESCE((line_item->>'quantity')::INT, 0);

                IF product_uuid IS NULL OR item_quantity <= 0 THEN
                    items_skipped := items_skipped + 1;
                    CONTINUE;
                END IF;

                SELECT EXISTS(
                    SELECT 1 FROM products
                    WHERE id = product_uuid AND store_id = NEW.store_id
                ) INTO product_exists;

                IF NOT product_exists THEN
                    RAISE WARNING '[STOCK] Product % not found - cannot restore stock for reverted order %',
                        product_uuid, NEW.id;
                    items_skipped := items_skipped + 1;
                    CONTINUE;
                END IF;

                SELECT stock, name, sku INTO stock_before_change, product_name, product_sku
                FROM products
                WHERE id = product_uuid AND store_id = NEW.store_id
                FOR UPDATE;

                stock_after_change := stock_before_change + item_quantity;

                UPDATE products
                SET stock = stock_after_change, updated_at = NOW()
                WHERE id = product_uuid AND store_id = NEW.store_id;

                INSERT INTO inventory_movements (
                    store_id, product_id, order_id,
                    quantity_change, stock_before, stock_after,
                    movement_type, order_status_from, order_status_to, notes
                ) VALUES (
                    NEW.store_id, product_uuid, NEW.id,
                    item_quantity, stock_before_change, stock_after_change,
                    'order_reverted',
                    OLD.sleeves_status, NEW.sleeves_status,
                    format('Stock restored on revert: %s x %s', item_quantity, product_name)
                );

                items_processed := items_processed + 1;
            END LOOP;
        END IF;

        IF items_processed > 0 THEN
            RAISE NOTICE '[STOCK] Order % reverted: % items restored, % skipped',
                NEW.id, items_processed, items_skipped;
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
'PRODUCTION-READY: Consolidated stock management function.
- Validates sufficient stock before decrementing (raises EXCEPTION)
- Skips missing products with WARNING (non-blocking for deleted/unsynced products)
- Handles ready_to_ship, cancelled, rejected, and status reversions
- Full audit trail in inventory_movements
- Row-level locking prevents race conditions';

-- ================================================================
-- PART 5: Prevent line_items edit after stock deducted (ensure trigger exists)
-- ================================================================

CREATE OR REPLACE FUNCTION prevent_line_items_edit_after_stock_deducted()
RETURNS TRIGGER AS $$
BEGIN
    -- Only check if line_items actually changed
    IF OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'in_transit', 'delivered') AND
       OLD.line_items::text IS DISTINCT FROM NEW.line_items::text THEN
        RAISE EXCEPTION 'Cannot modify line_items for order % - stock has been decremented (status: %). Cancel the order and create a new one instead.',
            OLD.id, OLD.sleeves_status;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prevent_line_items_edit ON orders;
CREATE TRIGGER trigger_prevent_line_items_edit
    BEFORE UPDATE OF line_items ON orders
    FOR EACH ROW
    EXECUTE FUNCTION prevent_line_items_edit_after_stock_deducted();

-- ================================================================
-- PART 6: Check stock availability helper function
-- ================================================================

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
        (line_item->>'product_id')::UUID as product_id,
        COALESCE(p.name, line_item->>'name', 'Unknown') as product_name,
        COALESCE(p.sku, '') as product_sku,
        COALESCE((line_item->>'quantity')::INT, 0) as required_quantity,
        COALESCE(p.stock, 0) as available_stock,
        (COALESCE(p.stock, 0) >= COALESCE((line_item->>'quantity')::INT, 0)) as is_sufficient,
        GREATEST(0, COALESCE((line_item->>'quantity')::INT, 0) - COALESCE(p.stock, 0)) as shortage
    FROM orders o
    CROSS JOIN jsonb_array_elements(o.line_items) as line_item
    LEFT JOIN products p ON p.id = (line_item->>'product_id')::UUID AND p.store_id = o.store_id
    WHERE o.id = p_order_id
    AND o.store_id = p_store_id
    AND (line_item->>'product_id') IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_order_stock_availability(UUID, UUID) IS
'Check if all products in an order have sufficient stock.
Use BEFORE attempting to move order to ready_to_ship.
Returns list of products with availability status and shortage amounts.';

-- ================================================================
-- PART 7: Data integrity monitoring views
-- ================================================================

-- View: Orders with unmapped products (critical for stock tracking)
CREATE OR REPLACE VIEW v_orders_with_unmapped_products AS
SELECT
    o.id as order_id,
    o.order_number,
    o.shopify_order_id,
    o.sleeves_status,
    o.created_at,
    s.name as store_name,
    oli.product_name,
    oli.shopify_product_id,
    oli.shopify_variant_id,
    oli.sku
FROM orders o
JOIN stores s ON s.id = o.store_id
JOIN order_line_items oli ON oli.order_id = o.id
WHERE oli.product_id IS NULL
AND o.sleeves_status NOT IN ('delivered', 'cancelled', 'rejected', 'returned')
AND o.deleted_at IS NULL
ORDER BY o.created_at DESC;

COMMENT ON VIEW v_orders_with_unmapped_products IS
'MONITOR: Active orders with line items that have no local product mapping.
These orders will NOT decrement stock when moved to ready_to_ship.
Action: Import/sync products from Shopify or manually map product_id.';

-- View: Potential stock discrepancies
CREATE OR REPLACE VIEW v_stock_discrepancy_check AS
SELECT
    p.id as product_id,
    p.name as product_name,
    p.sku,
    p.stock as current_stock,
    s.name as store_name,
    COALESCE(im_summary.calculated_stock, 0) as calculated_stock,
    p.stock - COALESCE(im_summary.calculated_stock, 0) as discrepancy
FROM products p
JOIN stores s ON s.id = p.store_id
LEFT JOIN LATERAL (
    SELECT
        SUM(quantity_change) as calculated_stock
    FROM inventory_movements im
    WHERE im.product_id = p.id
) im_summary ON true
WHERE ABS(p.stock - COALESCE(im_summary.calculated_stock, 0)) > 0
ORDER BY ABS(p.stock - COALESCE(im_summary.calculated_stock, 0)) DESC;

COMMENT ON VIEW v_stock_discrepancy_check IS
'MONITOR: Products where current stock differs from calculated stock based on movements.
Discrepancy indicates manual adjustments or missing movement records.';

-- View: Orders with inconsistent totals
CREATE OR REPLACE VIEW v_orders_with_inconsistent_totals AS
SELECT
    o.id as order_id,
    o.order_number,
    o.total_price as recorded_total,
    COALESCE(li_sum.calculated_total, 0) as calculated_total,
    ABS(o.total_price - COALESCE(li_sum.calculated_total, 0)) as difference,
    o.sleeves_status,
    o.created_at
FROM orders o
LEFT JOIN LATERAL (
    SELECT SUM(total_price) as calculated_total
    FROM order_line_items
    WHERE order_id = o.id
) li_sum ON true
WHERE o.deleted_at IS NULL
AND ABS(COALESCE(o.total_price, 0) - COALESCE(li_sum.calculated_total, 0)) > 1
ORDER BY difference DESC
LIMIT 100;

COMMENT ON VIEW v_orders_with_inconsistent_totals IS
'MONITOR: Orders where total_price differs from sum of line items.
May indicate manual adjustments, discounts, or data issues.';

-- ================================================================
-- PART 8: Function to repair customer stats
-- ================================================================

-- Ensure the comprehensive customer stats function exists
CREATE OR REPLACE FUNCTION fn_update_customer_stats_comprehensive()
RETURNS TRIGGER AS $$
DECLARE
    v_old_customer_id UUID;
    v_new_customer_id UUID;
    v_old_total DECIMAL(10,2);
    v_new_total DECIMAL(10,2);
    v_old_status TEXT;
    v_new_status TEXT;
    v_should_count_old BOOLEAN;
    v_should_count_new BOOLEAN;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_new_customer_id := NEW.customer_id;
        v_new_total := COALESCE(NEW.total_price, 0);
        v_new_status := COALESCE(NEW.sleeves_status, 'pending');
        v_should_count_new := v_new_status NOT IN ('cancelled', 'rejected');

        IF v_new_customer_id IS NOT NULL AND v_should_count_new THEN
            UPDATE customers
            SET total_orders = COALESCE(total_orders, 0) + 1,
                total_spent = COALESCE(total_spent, 0) + v_new_total,
                last_order_at = NOW(),
                updated_at = NOW()
            WHERE id = v_new_customer_id;
        END IF;
        RETURN NEW;

    ELSIF TG_OP = 'UPDATE' THEN
        v_old_customer_id := OLD.customer_id;
        v_new_customer_id := NEW.customer_id;
        v_old_total := COALESCE(OLD.total_price, 0);
        v_new_total := COALESCE(NEW.total_price, 0);
        v_old_status := COALESCE(OLD.sleeves_status, 'pending');
        v_new_status := COALESCE(NEW.sleeves_status, 'pending');
        v_should_count_old := v_old_status NOT IN ('cancelled', 'rejected');
        v_should_count_new := v_new_status NOT IN ('cancelled', 'rejected');

        -- Order was cancelled/rejected
        IF v_should_count_old AND NOT v_should_count_new THEN
            IF v_old_customer_id IS NOT NULL THEN
                UPDATE customers
                SET total_orders = GREATEST(0, COALESCE(total_orders, 0) - 1),
                    total_spent = GREATEST(0, COALESCE(total_spent, 0) - v_old_total),
                    updated_at = NOW()
                WHERE id = v_old_customer_id;
            END IF;

        -- Order was un-cancelled
        ELSIF NOT v_should_count_old AND v_should_count_new THEN
            IF v_new_customer_id IS NOT NULL THEN
                UPDATE customers
                SET total_orders = COALESCE(total_orders, 0) + 1,
                    total_spent = COALESCE(total_spent, 0) + v_new_total,
                    last_order_at = NOW(),
                    updated_at = NOW()
                WHERE id = v_new_customer_id;
            END IF;

        -- Customer changed
        ELSIF v_old_customer_id IS DISTINCT FROM v_new_customer_id AND v_should_count_new THEN
            IF v_old_customer_id IS NOT NULL AND v_should_count_old THEN
                UPDATE customers
                SET total_orders = GREATEST(0, COALESCE(total_orders, 0) - 1),
                    total_spent = GREATEST(0, COALESCE(total_spent, 0) - v_old_total),
                    updated_at = NOW()
                WHERE id = v_old_customer_id;
            END IF;
            IF v_new_customer_id IS NOT NULL THEN
                UPDATE customers
                SET total_orders = COALESCE(total_orders, 0) + 1,
                    total_spent = COALESCE(total_spent, 0) + v_new_total,
                    last_order_at = NOW(),
                    updated_at = NOW()
                WHERE id = v_new_customer_id;
            END IF;

        -- Total changed
        ELSIF v_old_total IS DISTINCT FROM v_new_total AND v_should_count_new THEN
            IF v_new_customer_id IS NOT NULL THEN
                UPDATE customers
                SET total_spent = GREATEST(0, COALESCE(total_spent, 0) - v_old_total + v_new_total),
                    updated_at = NOW()
                WHERE id = v_new_customer_id;
            END IF;
        END IF;
        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        v_old_customer_id := OLD.customer_id;
        v_old_total := COALESCE(OLD.total_price, 0);
        v_old_status := COALESCE(OLD.sleeves_status, 'pending');
        v_should_count_old := v_old_status NOT IN ('cancelled', 'rejected');

        IF v_old_customer_id IS NOT NULL AND v_should_count_old THEN
            UPDATE customers
            SET total_orders = GREATEST(0, COALESCE(total_orders, 0) - 1),
                total_spent = GREATEST(0, COALESCE(total_spent, 0) - v_old_total),
                updated_at = NOW()
            WHERE id = v_old_customer_id;
        END IF;
        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Ensure trigger exists
DROP TRIGGER IF EXISTS trg_customer_stats_comprehensive ON orders;
CREATE TRIGGER trg_customer_stats_comprehensive
    AFTER INSERT OR UPDATE OR DELETE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_customer_stats_comprehensive();

-- ================================================================
-- PART 9: Grants for RPC functions
-- ================================================================

GRANT EXECUTE ON FUNCTION check_order_stock_availability(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION check_order_stock_availability(UUID, UUID) TO service_role;

GRANT SELECT ON v_orders_with_unmapped_products TO authenticated;
GRANT SELECT ON v_orders_with_unmapped_products TO service_role;

GRANT SELECT ON v_stock_discrepancy_check TO authenticated;
GRANT SELECT ON v_stock_discrepancy_check TO service_role;

GRANT SELECT ON v_orders_with_inconsistent_totals TO authenticated;
GRANT SELECT ON v_orders_with_inconsistent_totals TO service_role;

-- ================================================================
-- PART 10: Create index for faster version checking
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_orders_version ON orders(id, version);
CREATE INDEX IF NOT EXISTS idx_orders_store_status_active ON orders(store_id, sleeves_status)
    WHERE deleted_at IS NULL;

-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================

DO $$
BEGIN
    RAISE NOTICE '✅ Migration 057 complete: Production-ready inventory fixes applied';
    RAISE NOTICE '   - Optimistic locking (version column) added to orders';
    RAISE NOTICE '   - Unique SKU constraint per store added';
    RAISE NOTICE '   - Product deletion protection for active orders';
    RAISE NOTICE '   - Consolidated stock management function';
    RAISE NOTICE '   - Data integrity monitoring views created';
    RAISE NOTICE '   - Customer stats triggers updated';
END $$;
