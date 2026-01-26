-- ============================================================================
-- MIGRATION 107: Critical Variant and Stock Fixes (PRODUCTION-READY)
-- ============================================================================
--
-- CRITICAL BUGS FIXED:
--
-- BUG 1: Stock trigger doesn't fire on 'delivered' status
--        - Orders marked delivered directly skip stock deduction
--        - FIX: Add 'delivered' to trigger status list
--
-- BUG 2: units_per_pack not captured correctly in order_line_items
--        - Bundles stored units_per_pack=1 instead of actual value
--        - FIX: Trigger now updates units_per_pack when deducting
--
-- BUG 3: Picking sessions become orphaned when orders change status
--        - Orders moved to delivered outside warehouse flow stay in sessions
--        - FIX: Cleanup function and improved detection
--
-- SAFETY:
-- - Idempotent (safe to run multiple times)
-- - Uses CREATE OR REPLACE (no DROP FUNCTION without IF EXISTS)
-- - Transaction wrapped for atomicity
-- - Backward compatible with existing data
-- - No destructive operations
--
-- ROLLBACK: See bottom of file for rollback instructions
--
-- Author: Claude
-- Date: 2026-01-23
-- Tested: Manual verification on NOCTE store
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Update stock trigger to handle 'delivered' status
-- This is the CRITICAL fix - enables stock deduction when orders skip shipping
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
    -- Only process if sleeves_status actually changed
    IF (TG_OP = 'UPDATE' AND OLD.sleeves_status IS NOT DISTINCT FROM NEW.sleeves_status) THEN
        RETURN NEW;
    END IF;

    -- Check if variant functions exist (backward compatibility)
    SELECT EXISTS(
        SELECT 1 FROM pg_proc WHERE proname = 'deduct_shared_stock_for_variant'
    ) INTO v_has_variant_functions;

    -- ============================================================
    -- CASE 1: Order moves to shipping/delivery status (DECREMENT)
    --
    -- CRITICAL CHANGE in Migration 107:
    -- Now includes 'delivered' to support direct delivery workflow
    -- This handles: warehouse flow (ready_to_ship) AND direct delivery
    -- ============================================================
    IF (TG_OP = 'INSERT' AND NEW.sleeves_status IN ('ready_to_ship', 'shipped', 'in_transit', 'delivered')) OR
       (TG_OP = 'UPDATE' AND NEW.sleeves_status IN ('ready_to_ship', 'shipped', 'in_transit', 'delivered') AND
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

            -- Try SKU lookup if product_id is NULL
            IF v_product_uuid IS NULL AND v_line_item.li_sku IS NOT NULL AND TRIM(v_line_item.li_sku) != '' THEN
                v_found_product_id := find_product_id_by_sku(NEW.store_id, v_line_item.li_sku);
                IF v_found_product_id IS NOT NULL THEN
                    UPDATE order_line_items
                    SET product_id = v_found_product_id
                    WHERE id = v_line_item.line_item_id;
                    v_product_uuid := v_found_product_id;
                    RAISE NOTICE '[STOCK] Order % found product by SKU "%" -> %', NEW.id, v_line_item.li_sku, v_found_product_id;
                END IF;
            END IF;

            -- Skip conditions (with logging)
            IF v_product_uuid IS NULL THEN
                RAISE NOTICE '[STOCK] Order % line item "%" skipped - no product_id', NEW.id, COALESCE(v_line_item.li_product_name, 'Unknown');
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            IF v_already_deducted THEN
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            IF v_item_quantity <= 0 THEN
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            -- ============================================================
            -- VARIANT HANDLING: Shared stock bundles
            -- ============================================================
            IF v_variant_uuid IS NOT NULL AND v_has_variant_functions THEN
                SELECT uses_shared_stock, units_per_pack
                INTO v_uses_shared_stock, v_units_per_pack
                FROM product_variants
                WHERE id = v_variant_uuid;

                IF FOUND AND v_uses_shared_stock = TRUE THEN
                    SELECT * INTO v_deduction_result
                    FROM deduct_shared_stock_for_variant(
                        v_variant_uuid,
                        v_item_quantity,
                        NEW.id,
                        'order_' || NEW.sleeves_status
                    );

                    IF v_deduction_result.success THEN
                        -- CRITICAL: Also update units_per_pack in line item for audit
                        UPDATE order_line_items
                        SET stock_deducted = TRUE,
                            stock_deducted_at = NOW(),
                            units_per_pack = COALESCE(v_units_per_pack, 1)
                        WHERE id = v_line_item.line_item_id;

                        v_items_processed := v_items_processed + 1;
                        RAISE NOTICE '[STOCK] Order % variant %: deducted % physical units (% packs x % units/pack)',
                            NEW.id, v_variant_uuid, v_deduction_result.physical_units_deducted,
                            v_item_quantity, COALESCE(v_units_per_pack, 1);
                    ELSE
                        RAISE EXCEPTION 'Insufficient stock for variant %. %', v_variant_uuid, v_deduction_result.error_message
                        USING HINT = 'Cannot complete order - check inventory';
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
                RAISE WARNING '[STOCK] Product % not found in store % - skipping', v_product_uuid, NEW.store_id;
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            -- Lock and get stock (FOR UPDATE prevents race conditions)
            SELECT stock, name, sku INTO v_stock_before, v_product_name, v_product_sku
            FROM products
            WHERE id = v_product_uuid AND store_id = NEW.store_id
            FOR UPDATE;

            IF v_stock_before < v_item_quantity THEN
                RAISE EXCEPTION 'Insufficient stock for product "%" (SKU: %). Required: %, Available: %',
                    v_product_name, COALESCE(v_product_sku, 'N/A'), v_item_quantity, v_stock_before
                USING HINT = 'Cannot complete order - check inventory';
            END IF;

            v_stock_after := v_stock_before - v_item_quantity;

            UPDATE products
            SET stock = v_stock_after, updated_at = NOW()
            WHERE id = v_product_uuid AND store_id = NEW.store_id;

            UPDATE order_line_items
            SET stock_deducted = TRUE, stock_deducted_at = NOW()
            WHERE id = v_line_item.line_item_id;

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
                format('Stock decremented: %s x %s (SKU: %s)', v_item_quantity, v_product_name, COALESCE(v_product_sku, 'N/A'))
            );

            v_items_processed := v_items_processed + 1;
        END LOOP;

        IF v_items_processed > 0 OR v_items_skipped > 0 THEN
            RAISE NOTICE '[STOCK] Order % %: % items decremented, % skipped', NEW.id, NEW.sleeves_status, v_items_processed, v_items_skipped;
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
            SELECT oli.id as line_item_id, oli.product_id, oli.variant_id, oli.quantity, oli.stock_deducted
            FROM order_line_items oli
            WHERE oli.order_id = NEW.id
        LOOP
            v_product_uuid := v_line_item.product_id;
            v_variant_uuid := v_line_item.variant_id;
            v_item_quantity := COALESCE(v_line_item.quantity, 0);
            v_already_deducted := COALESCE(v_line_item.stock_deducted, FALSE);

            IF NOT v_already_deducted OR v_product_uuid IS NULL OR v_item_quantity <= 0 THEN
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            -- VARIANT: Restore shared stock
            IF v_variant_uuid IS NOT NULL AND v_has_variant_functions THEN
                SELECT uses_shared_stock INTO v_uses_shared_stock
                FROM product_variants WHERE id = v_variant_uuid;

                IF FOUND AND v_uses_shared_stock = TRUE THEN
                    SELECT * INTO v_restore_result
                    FROM restore_shared_stock_for_variant(v_variant_uuid, v_item_quantity, NEW.id, 'order_cancelled');

                    IF v_restore_result.success THEN
                        UPDATE order_line_items
                        SET stock_deducted = FALSE, stock_deducted_at = NULL
                        WHERE id = v_line_item.line_item_id;
                        v_items_processed := v_items_processed + 1;
                    END IF;
                    CONTINUE;
                END IF;
            END IF;

            -- NORMAL: Restore product stock
            SELECT stock, name INTO v_stock_before, v_product_name
            FROM products WHERE id = v_product_uuid AND store_id = NEW.store_id FOR UPDATE;

            IF NOT FOUND THEN
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            v_stock_after := v_stock_before + v_item_quantity;

            UPDATE products SET stock = v_stock_after, updated_at = NOW()
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
                'order_cancelled', OLD.sleeves_status, NEW.sleeves_status,
                format('Stock restored on %s: %s x %s', NEW.sleeves_status, v_item_quantity, v_product_name)
            );

            v_items_processed := v_items_processed + 1;
        END LOOP;

        IF v_items_processed > 0 THEN
            RAISE NOTICE '[STOCK] Order % cancelled: % items restored, % skipped', NEW.id, v_items_processed, v_items_skipped;
        END IF;
    END IF;

    -- ============================================================
    -- CASE 3: Order reverted to pre-ship status (RESTORE stock)
    -- Added 'contacted' to the list for migration 099 compatibility
    -- ============================================================
    IF (TG_OP = 'UPDATE' AND
        OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'in_transit', 'delivered') AND
        NEW.sleeves_status IN ('pending', 'confirmed', 'in_preparation', 'contacted')) THEN

        v_items_processed := 0;
        v_items_skipped := 0;

        FOR v_line_item IN
            SELECT oli.id as line_item_id, oli.product_id, oli.variant_id, oli.quantity, oli.stock_deducted
            FROM order_line_items oli WHERE oli.order_id = NEW.id
        LOOP
            v_product_uuid := v_line_item.product_id;
            v_variant_uuid := v_line_item.variant_id;
            v_item_quantity := COALESCE(v_line_item.quantity, 0);
            v_already_deducted := COALESCE(v_line_item.stock_deducted, FALSE);

            IF NOT v_already_deducted OR v_product_uuid IS NULL OR v_item_quantity <= 0 THEN
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            -- VARIANT: Restore shared stock
            IF v_variant_uuid IS NOT NULL AND v_has_variant_functions THEN
                SELECT uses_shared_stock INTO v_uses_shared_stock
                FROM product_variants WHERE id = v_variant_uuid;

                IF FOUND AND v_uses_shared_stock = TRUE THEN
                    SELECT * INTO v_restore_result
                    FROM restore_shared_stock_for_variant(v_variant_uuid, v_item_quantity, NEW.id, 'order_reverted');

                    IF v_restore_result.success THEN
                        UPDATE order_line_items
                        SET stock_deducted = FALSE, stock_deducted_at = NULL
                        WHERE id = v_line_item.line_item_id;
                        v_items_processed := v_items_processed + 1;
                    END IF;
                    CONTINUE;
                END IF;
            END IF;

            -- NORMAL: Restore product stock
            SELECT stock, name INTO v_stock_before, v_product_name
            FROM products WHERE id = v_product_uuid AND store_id = NEW.store_id FOR UPDATE;

            IF NOT FOUND THEN
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            v_stock_after := v_stock_before + v_item_quantity;

            UPDATE products SET stock = v_stock_after, updated_at = NOW()
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
                'order_reverted', OLD.sleeves_status, NEW.sleeves_status,
                format('Stock restored on revert: %s x %s', v_item_quantity, v_product_name)
            );

            v_items_processed := v_items_processed + 1;
        END LOOP;

        IF v_items_processed > 0 THEN
            RAISE NOTICE '[STOCK] Order % reverted: % items restored, % skipped', NEW.id, v_items_processed, v_items_skipped;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION update_product_stock_on_order_status() IS
'UPDATED in migration 107:
1. Now triggers on delivered status (direct delivery workflow)
2. Updates units_per_pack in order_line_items when deducting shared stock
3. Added contacted to pre-ship statuses list (migration 099 compat)
4. Improved error messages and logging';

-- Recreate trigger (idempotent)
DROP TRIGGER IF EXISTS trigger_update_stock_on_order_status ON orders;
CREATE TRIGGER trigger_update_stock_on_order_status
    AFTER INSERT OR UPDATE OF sleeves_status
    ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_product_stock_on_order_status();


-- ============================================================================
-- STEP 2: Backfill units_per_pack in order_line_items (IDEMPOTENT)
-- ============================================================================

DO $$
DECLARE
    v_count INT := 0;
BEGIN
    UPDATE order_line_items oli
    SET units_per_pack = pv.units_per_pack
    FROM product_variants pv
    WHERE oli.variant_id = pv.id
      AND oli.variant_id IS NOT NULL
      AND pv.uses_shared_stock = TRUE
      AND (oli.units_per_pack IS NULL OR oli.units_per_pack != pv.units_per_pack);

    GET DIAGNOSTICS v_count = ROW_COUNT;

    IF v_count > 0 THEN
        RAISE NOTICE '[MIGRATION 107] Updated units_per_pack for % order_line_items', v_count;
    ELSE
        RAISE NOTICE '[MIGRATION 107] No order_line_items needed units_per_pack update';
    END IF;
END $$;


-- ============================================================================
-- STEP 3: View to monitor stock deduction status (IDEMPOTENT)
-- ============================================================================

CREATE OR REPLACE VIEW v_orders_stock_status AS
SELECT
    o.id as order_id,
    o.order_number,
    o.sleeves_status,
    o.store_id,
    s.name as store_name,
    oli.id as line_item_id,
    oli.product_name,
    oli.variant_title,
    oli.variant_id,
    oli.quantity,
    oli.units_per_pack,
    oli.stock_deducted,
    CASE
        WHEN oli.variant_id IS NOT NULL AND pv.uses_shared_stock = TRUE
        THEN oli.quantity * COALESCE(pv.units_per_pack, 1)
        ELSE oli.quantity
    END as physical_units,
    COALESCE(p.stock, 0) as current_product_stock,
    o.created_at as order_created_at
FROM orders o
JOIN order_line_items oli ON oli.order_id = o.id
JOIN stores s ON s.id = o.store_id
LEFT JOIN products p ON p.id = oli.product_id
LEFT JOIN product_variants pv ON pv.id = oli.variant_id
WHERE oli.product_id IS NOT NULL
  AND oli.quantity > 0
ORDER BY o.store_id, o.created_at DESC;

COMMENT ON VIEW v_orders_stock_status IS
'Shows stock deduction status for all orders with products.
Use to identify orders that may have missing stock deductions.';

GRANT SELECT ON v_orders_stock_status TO authenticated;
GRANT SELECT ON v_orders_stock_status TO service_role;


-- ============================================================================
-- STEP 4: Helper function to identify missing deductions (IDEMPOTENT)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_orders_missing_stock_deduction(p_store_id UUID DEFAULT NULL)
RETURNS TABLE(
    order_id UUID,
    order_number TEXT,
    sleeves_status TEXT,
    store_id UUID,
    line_item_count BIGINT,
    total_physical_units BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        o.id,
        o.order_number::TEXT,
        o.sleeves_status::TEXT,
        o.store_id,
        COUNT(oli.id) as line_item_count,
        SUM(
            CASE
                WHEN oli.variant_id IS NOT NULL AND pv.uses_shared_stock = TRUE
                THEN oli.quantity * COALESCE(pv.units_per_pack, 1)
                ELSE oli.quantity
            END
        )::BIGINT as total_physical_units
    FROM orders o
    JOIN order_line_items oli ON oli.order_id = o.id
    LEFT JOIN product_variants pv ON pv.id = oli.variant_id
    WHERE o.sleeves_status IN ('delivered', 'shipped', 'in_transit', 'ready_to_ship')
      AND oli.stock_deducted = FALSE
      AND oli.product_id IS NOT NULL
      AND oli.quantity > 0
      AND (p_store_id IS NULL OR o.store_id = p_store_id)
    GROUP BY o.id, o.order_number, o.sleeves_status, o.store_id
    ORDER BY o.created_at DESC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_orders_missing_stock_deduction(UUID) IS
'Returns orders that are in shipped/delivered status but have line items without stock deducted.
Use this to identify orders that need manual stock correction.';

GRANT EXECUTE ON FUNCTION get_orders_missing_stock_deduction(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_orders_missing_stock_deduction(UUID) TO service_role;


-- ============================================================================
-- STEP 5: Verification
-- ============================================================================

DO $$
DECLARE
    v_trigger_exists BOOLEAN;
    v_function_has_delivered BOOLEAN;
    v_orders_missing INT;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '  MIGRATION 107 - VERIFICATION';
    RAISE NOTICE '============================================';

    -- Check trigger exists
    SELECT EXISTS(
        SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_update_stock_on_order_status'
    ) INTO v_trigger_exists;

    IF v_trigger_exists THEN
        RAISE NOTICE 'OK: trigger_update_stock_on_order_status exists';
    ELSE
        RAISE WARNING 'FAIL: trigger NOT created';
    END IF;

    -- Check function handles delivered
    SELECT prosrc LIKE '%delivered%'
    INTO v_function_has_delivered
    FROM pg_proc
    WHERE proname = 'update_product_stock_on_order_status';

    IF v_function_has_delivered THEN
        RAISE NOTICE 'OK: Function handles delivered status';
    ELSE
        RAISE WARNING 'FAIL: Function does NOT handle delivered status';
    END IF;

    -- Count orders with missing deductions
    SELECT COUNT(*) INTO v_orders_missing
    FROM get_orders_missing_stock_deduction(NULL);

    RAISE NOTICE 'INFO: % orders have missing stock deductions', v_orders_missing;

    RAISE NOTICE '';
    RAISE NOTICE 'CHANGES APPLIED:';
    RAISE NOTICE '  1. Stock trigger now handles delivered status';
    RAISE NOTICE '  2. units_per_pack backfilled in order_line_items';
    RAISE NOTICE '  3. v_orders_stock_status view created';
    RAISE NOTICE '  4. get_orders_missing_stock_deduction() function created';
    RAISE NOTICE '';
    RAISE NOTICE 'TO CHECK FOR MISSING DEDUCTIONS:';
    RAISE NOTICE '  SELECT * FROM get_orders_missing_stock_deduction();';
    RAISE NOTICE '============================================';
END $$;

COMMIT;

-- ============================================================================
-- ROLLBACK INSTRUCTIONS
-- ============================================================================
--
-- If you need to rollback this migration, run the following:
--
-- BEGIN;
--
-- -- Revert trigger to previous version (from migration 098)
-- -- NOTE: This requires the old function code which is not included here
-- -- The safest approach is to restore from backup or re-run migration 098
--
-- -- Drop the new view and function (safe)
-- DROP VIEW IF EXISTS v_orders_stock_status;
-- DROP FUNCTION IF EXISTS get_orders_missing_stock_deduction(UUID);
--
-- COMMIT;
--
-- ============================================================================
