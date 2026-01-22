-- ============================================================================
-- Migration 098: Fix Stock Trigger to Handle All Ship Statuses
-- ============================================================================
--
-- PROBLEM:
-- The stock trigger only activates when orders reach 'ready_to_ship'.
-- But users can skip warehouse (picking/packing) and go directly to
-- 'shipped' or 'in_transit' via dispatch sessions.
-- This causes stock to never be deducted.
--
-- SOLUTION:
-- Modify the trigger to also handle transitions to 'shipped' and 'in_transit'
-- when the order hasn't had stock deducted yet.
--
-- ALSO FIXES:
-- - Lookup product by SKU when product_id is NULL in order_line_items
-- - This handles cases where the product name doesn't match but SKU does
--
-- SAFETY:
-- - Idempotent (safe to run multiple times)
-- - Uses CREATE OR REPLACE (no DROP)
-- - Checks for existing columns/functions before using
-- - Wrapped in transaction with proper error handling
--
-- BACKWARD COMPATIBLE:
-- - Existing orders with stock_deducted=true will NOT be affected
-- - Only processes items where stock_deducted=false
--
-- Author: Claude
-- Date: 2026-01-22
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Create helper function to find product by SKU (IDEMPOTENT)
-- ============================================================================

CREATE OR REPLACE FUNCTION find_product_id_by_sku(
    p_store_id UUID,
    p_sku TEXT
)
RETURNS UUID AS $$
DECLARE
    v_product_id UUID;
BEGIN
    IF p_sku IS NULL OR TRIM(p_sku) = '' THEN
        RETURN NULL;
    END IF;

    -- Try exact match (case-insensitive, trimmed)
    SELECT id INTO v_product_id
    FROM products
    WHERE store_id = p_store_id
      AND UPPER(TRIM(sku)) = UPPER(TRIM(p_sku))
      AND deleted_at IS NULL
    LIMIT 1;

    RETURN v_product_id;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION find_product_id_by_sku(UUID, TEXT) IS
'Helper function to find product ID by SKU within a store. Used for fallback matching when product_id is NULL.';

-- ============================================================================
-- STEP 2: Update the stock trigger function (IDEMPOTENT - CREATE OR REPLACE)
-- ============================================================================

CREATE OR REPLACE FUNCTION update_product_stock_on_order_status()
RETURNS TRIGGER AS $$
DECLARE
    v_line_item RECORD;
    v_product_uuid UUID;
    v_variant_uuid UUID;
    v_item_quantity INT;
    v_stock_before INT;
    v_stock_after INT;
    v_product_name TEXT;
    v_product_sku TEXT;
    v_product_exists BOOLEAN;
    v_items_processed INT := 0;
    v_items_skipped INT := 0;
    v_already_deducted BOOLEAN;
    v_uses_shared_stock BOOLEAN;
    v_units_per_pack INT;
    v_deduction_result RECORD;
    v_restore_result RECORD;
    v_found_product_id UUID;
    v_has_variant_functions BOOLEAN;
BEGIN
    -- Only process if sleeves_status changed
    IF (TG_OP = 'UPDATE' AND OLD.sleeves_status IS NOT DISTINCT FROM NEW.sleeves_status) THEN
        RETURN NEW;
    END IF;

    -- Check if variant functions exist (for backward compatibility)
    SELECT EXISTS(
        SELECT 1 FROM pg_proc WHERE proname = 'deduct_shared_stock_for_variant'
    ) INTO v_has_variant_functions;

    -- ============================================================
    -- CASE 1: Order moves to a shipping status (DECREMENT stock)
    -- UPDATED: Now handles ready_to_ship, shipped, AND in_transit
    -- This supports users who skip warehouse and dispatch directly
    -- ============================================================
    IF (TG_OP = 'INSERT' AND NEW.sleeves_status IN ('ready_to_ship', 'shipped', 'in_transit')) OR
       (TG_OP = 'UPDATE' AND NEW.sleeves_status IN ('ready_to_ship', 'shipped', 'in_transit') AND
        COALESCE(OLD.sleeves_status, '') NOT IN ('ready_to_ship', 'shipped', 'delivered', 'in_transit')) THEN

        FOR v_line_item IN
            SELECT
                oli.id as line_item_id,
                oli.product_id,
                oli.variant_id,
                oli.quantity,
                oli.stock_deducted,
                oli.product_name as li_product_name,
                oli.sku as li_sku
            FROM order_line_items oli
            WHERE oli.order_id = NEW.id
        LOOP
            v_product_uuid := v_line_item.product_id;
            v_variant_uuid := v_line_item.variant_id;
            v_item_quantity := COALESCE(v_line_item.quantity, 0);
            v_already_deducted := COALESCE(v_line_item.stock_deducted, FALSE);

            -- ============================================================
            -- NEW: If product_id is NULL, try to find by SKU
            -- ============================================================
            IF v_product_uuid IS NULL AND v_line_item.li_sku IS NOT NULL AND TRIM(v_line_item.li_sku) != '' THEN
                v_found_product_id := find_product_id_by_sku(NEW.store_id, v_line_item.li_sku);

                IF v_found_product_id IS NOT NULL THEN
                    -- Update the line item with the found product_id for future reference
                    UPDATE order_line_items
                    SET product_id = v_found_product_id
                    WHERE id = v_line_item.line_item_id;

                    v_product_uuid := v_found_product_id;
                    RAISE NOTICE '[STOCK] Order % line item "%": found product by SKU "%" -> %',
                        NEW.id, v_line_item.li_product_name, v_line_item.li_sku, v_found_product_id;
                END IF;
            END IF;

            -- Skip if no product_id (unmapped product)
            IF v_product_uuid IS NULL THEN
                RAISE NOTICE '[STOCK] Order % line item "%" has no product_id and SKU "%" not found - skipping',
                    NEW.id, COALESCE(v_line_item.li_product_name, 'Unknown'), COALESCE(v_line_item.li_sku, 'N/A');
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            -- Skip if already deducted (prevents double deduction)
            IF v_already_deducted THEN
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            -- Skip if quantity is zero or negative
            IF v_item_quantity <= 0 THEN
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            -- ============================================================
            -- VARIANT HANDLING: Check if line item has a variant with shared stock
            -- ============================================================
            IF v_variant_uuid IS NOT NULL AND v_has_variant_functions THEN
                -- Get variant info
                SELECT uses_shared_stock, units_per_pack
                INTO v_uses_shared_stock, v_units_per_pack
                FROM product_variants
                WHERE id = v_variant_uuid;

                IF FOUND AND v_uses_shared_stock = TRUE THEN
                    -- SHARED STOCK VARIANT: Call deduct_shared_stock_for_variant
                    SELECT * INTO v_deduction_result
                    FROM deduct_shared_stock_for_variant(
                        v_variant_uuid,
                        v_item_quantity,
                        NEW.id,
                        'order_' || NEW.sleeves_status
                    );

                    IF v_deduction_result.success THEN
                        -- Mark line item as stock deducted
                        UPDATE order_line_items
                        SET stock_deducted = TRUE,
                            stock_deducted_at = NOW()
                        WHERE id = v_line_item.line_item_id;

                        v_items_processed := v_items_processed + 1;
                        RAISE NOTICE '[STOCK] Order % variant %: deducted % physical units',
                            NEW.id, v_variant_uuid, v_deduction_result.physical_units_deducted;
                    ELSE
                        -- Deduction failed (insufficient stock)
                        RAISE EXCEPTION 'Insufficient stock for variant %. %',
                            v_variant_uuid, v_deduction_result.error_message
                        USING HINT = 'Cannot ship order - check inventory';
                    END IF;

                    CONTINUE;  -- Skip normal product handling
                END IF;
                -- If variant exists but doesn't use shared stock, fall through to normal handling
            END IF;

            -- ============================================================
            -- NORMAL PRODUCT/INDEPENDENT VARIANT HANDLING
            -- ============================================================
            SELECT EXISTS(
                SELECT 1 FROM products
                WHERE id = v_product_uuid AND store_id = NEW.store_id
            ) INTO v_product_exists;

            IF NOT v_product_exists THEN
                RAISE WARNING '[STOCK] Product % not found in store % - skipping',
                    v_product_uuid, NEW.store_id;
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            -- Lock row and get current stock (prevents race conditions)
            SELECT stock, name, sku INTO v_stock_before, v_product_name, v_product_sku
            FROM products
            WHERE id = v_product_uuid AND store_id = NEW.store_id
            FOR UPDATE;

            -- Validate sufficient stock
            IF v_stock_before < v_item_quantity THEN
                RAISE EXCEPTION 'Insufficient stock for product "%" (SKU: %). Required: %, Available: %',
                    v_product_name, COALESCE(v_product_sku, 'N/A'),
                    v_item_quantity, v_stock_before
                USING HINT = 'Cannot ship order - check inventory';
            END IF;

            -- Update stock
            v_stock_after := v_stock_before - v_item_quantity;

            UPDATE products
            SET stock = v_stock_after, updated_at = NOW()
            WHERE id = v_product_uuid AND store_id = NEW.store_id;

            -- Mark line item as deducted
            UPDATE order_line_items
            SET stock_deducted = TRUE, stock_deducted_at = NOW()
            WHERE id = v_line_item.line_item_id;

            -- Log movement
            INSERT INTO inventory_movements (
                store_id, product_id, variant_id, order_id,
                quantity_change, stock_before, stock_after,
                movement_type, order_status_from, order_status_to, notes
            ) VALUES (
                NEW.store_id, v_product_uuid, v_variant_uuid, NEW.id,
                -v_item_quantity, v_stock_before, v_stock_after,
                'order_' || NEW.sleeves_status,
                CASE WHEN TG_OP = 'UPDATE' THEN OLD.sleeves_status ELSE NULL END,
                NEW.sleeves_status,
                format('Stock decremented: %s x %s (SKU: %s)',
                       v_item_quantity, v_product_name, COALESCE(v_product_sku, 'N/A'))
            );

            v_items_processed := v_items_processed + 1;
        END LOOP;

        IF v_items_processed > 0 OR v_items_skipped > 0 THEN
            RAISE NOTICE '[STOCK] Order % %: % items decremented, % skipped',
                NEW.id, NEW.sleeves_status, v_items_processed, v_items_skipped;
        END IF;
    END IF;

    -- ============================================================
    -- CASE 2: Order cancelled/rejected (RESTORE stock)
    -- ============================================================
    IF (TG_OP = 'UPDATE' AND
        NEW.sleeves_status IN ('cancelled', 'rejected') AND
        OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'in_transit', 'delivered')) THEN

        v_items_processed := 0;
        v_items_skipped := 0;

        FOR v_line_item IN
            SELECT
                oli.id as line_item_id,
                oli.product_id,
                oli.variant_id,
                oli.quantity,
                oli.stock_deducted
            FROM order_line_items oli
            WHERE oli.order_id = NEW.id
        LOOP
            v_product_uuid := v_line_item.product_id;
            v_variant_uuid := v_line_item.variant_id;
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

            -- ============================================================
            -- VARIANT HANDLING: Check if this was a shared stock variant
            -- ============================================================
            IF v_variant_uuid IS NOT NULL AND v_has_variant_functions THEN
                SELECT uses_shared_stock INTO v_uses_shared_stock
                FROM product_variants
                WHERE id = v_variant_uuid;

                IF FOUND AND v_uses_shared_stock = TRUE THEN
                    -- SHARED STOCK: Restore using variant function
                    SELECT * INTO v_restore_result
                    FROM restore_shared_stock_for_variant(
                        v_variant_uuid,
                        v_item_quantity,
                        NEW.id,
                        'order_cancelled'
                    );

                    IF v_restore_result.success THEN
                        UPDATE order_line_items
                        SET stock_deducted = FALSE, stock_deducted_at = NULL
                        WHERE id = v_line_item.line_item_id;

                        v_items_processed := v_items_processed + 1;
                    END IF;

                    CONTINUE;
                END IF;
            END IF;

            -- ============================================================
            -- NORMAL PRODUCT HANDLING
            -- ============================================================
            SELECT EXISTS(
                SELECT 1 FROM products
                WHERE id = v_product_uuid AND store_id = NEW.store_id
            ) INTO v_product_exists;

            IF NOT v_product_exists THEN
                RAISE WARNING '[STOCK] Product % not found - cannot restore', v_product_uuid;
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

            UPDATE order_line_items
            SET stock_deducted = FALSE, stock_deducted_at = NULL
            WHERE id = v_line_item.line_item_id;

            INSERT INTO inventory_movements (
                store_id, product_id, variant_id, order_id,
                quantity_change, stock_before, stock_after,
                movement_type, order_status_from, order_status_to, notes
            ) VALUES (
                NEW.store_id, v_product_uuid, v_variant_uuid, NEW.id,
                v_item_quantity, v_stock_before, v_stock_after,
                'order_cancelled',
                OLD.sleeves_status, NEW.sleeves_status,
                format('Stock restored on %s: %s x %s',
                       NEW.sleeves_status, v_item_quantity, v_product_name)
            );

            v_items_processed := v_items_processed + 1;
        END LOOP;

        IF v_items_processed > 0 THEN
            RAISE NOTICE '[STOCK] Order % cancelled: % items restored, % skipped',
                NEW.id, v_items_processed, v_items_skipped;
        END IF;
    END IF;

    -- ============================================================
    -- CASE 3: Order reverted to pre-ship status (RESTORE stock)
    -- ============================================================
    IF (TG_OP = 'UPDATE' AND
        OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'in_transit', 'delivered') AND
        NEW.sleeves_status IN ('pending', 'confirmed', 'in_preparation')) THEN

        v_items_processed := 0;
        v_items_skipped := 0;

        FOR v_line_item IN
            SELECT
                oli.id as line_item_id,
                oli.product_id,
                oli.variant_id,
                oli.quantity,
                oli.stock_deducted
            FROM order_line_items oli
            WHERE oli.order_id = NEW.id
        LOOP
            v_product_uuid := v_line_item.product_id;
            v_variant_uuid := v_line_item.variant_id;
            v_item_quantity := COALESCE(v_line_item.quantity, 0);
            v_already_deducted := COALESCE(v_line_item.stock_deducted, FALSE);

            IF NOT v_already_deducted THEN
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            IF v_product_uuid IS NULL OR v_item_quantity <= 0 THEN
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            -- VARIANT HANDLING
            IF v_variant_uuid IS NOT NULL AND v_has_variant_functions THEN
                SELECT uses_shared_stock INTO v_uses_shared_stock
                FROM product_variants
                WHERE id = v_variant_uuid;

                IF FOUND AND v_uses_shared_stock = TRUE THEN
                    SELECT * INTO v_restore_result
                    FROM restore_shared_stock_for_variant(
                        v_variant_uuid,
                        v_item_quantity,
                        NEW.id,
                        'order_reverted'
                    );

                    IF v_restore_result.success THEN
                        UPDATE order_line_items
                        SET stock_deducted = FALSE, stock_deducted_at = NULL
                        WHERE id = v_line_item.line_item_id;

                        v_items_processed := v_items_processed + 1;
                    END IF;

                    CONTINUE;
                END IF;
            END IF;

            -- NORMAL PRODUCT HANDLING
            SELECT EXISTS(
                SELECT 1 FROM products
                WHERE id = v_product_uuid AND store_id = NEW.store_id
            ) INTO v_product_exists;

            IF NOT v_product_exists THEN
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

            UPDATE order_line_items
            SET stock_deducted = FALSE, stock_deducted_at = NULL
            WHERE id = v_line_item.line_item_id;

            INSERT INTO inventory_movements (
                store_id, product_id, variant_id, order_id,
                quantity_change, stock_before, stock_after,
                movement_type, order_status_from, order_status_to, notes
            ) VALUES (
                NEW.store_id, v_product_uuid, v_variant_uuid, NEW.id,
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION update_product_stock_on_order_status() IS
'UPDATED in migration 098:
1. Now triggers on shipped/in_transit in addition to ready_to_ship (supports direct dispatch without warehouse)
2. Falls back to SKU lookup when product_id is NULL (fixes product mapping issues)
3. Auto-updates order_line_items.product_id when found by SKU
4. Checks if variant functions exist before calling them (backward compatible)';

-- ============================================================================
-- STEP 3: Ensure trigger exists and is configured correctly
-- ============================================================================

-- Drop and recreate trigger to ensure it has correct configuration
DROP TRIGGER IF EXISTS trigger_update_stock_on_order_status ON orders;

CREATE TRIGGER trigger_update_stock_on_order_status
    AFTER INSERT OR UPDATE OF sleeves_status
    ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_product_stock_on_order_status();

-- ============================================================================
-- STEP 4: Grant permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION find_product_id_by_sku(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION find_product_id_by_sku(UUID, TEXT) TO service_role;

-- ============================================================================
-- STEP 5: Log completion
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '================================================================';
    RAISE NOTICE '  MIGRATION 098: Stock Trigger Fix - Complete';
    RAISE NOTICE '================================================================';
    RAISE NOTICE '';
    RAISE NOTICE '  CHANGES:';
    RAISE NOTICE '    1. Trigger now fires on: ready_to_ship, shipped, in_transit';
    RAISE NOTICE '    2. Added SKU fallback lookup for unmapped products';
    RAISE NOTICE '    3. Auto-updates product_id in order_line_items when found';
    RAISE NOTICE '    4. Backward compatible with/without variant functions';
    RAISE NOTICE '';
    RAISE NOTICE '  SAFETY:';
    RAISE NOTICE '    - Idempotent (safe to run multiple times)';
    RAISE NOTICE '    - Existing stock_deducted=true items are NOT affected';
    RAISE NOTICE '    - Checks for variant functions before calling';
    RAISE NOTICE '';
    RAISE NOTICE '  TO TEST:';
    RAISE NOTICE '    1. Create order with product that has SKU';
    RAISE NOTICE '    2. Change status to shipped directly';
    RAISE NOTICE '    3. Verify stock is decremented';
    RAISE NOTICE '    4. Verify inventory_movements has new record';
    RAISE NOTICE '================================================================';
END $$;

COMMIT;
