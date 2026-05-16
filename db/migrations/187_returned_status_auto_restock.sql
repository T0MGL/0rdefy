-- ============================================================================
-- Migration 187: Auto restock on `returned` status
-- ============================================================================
--
-- CONTEXT (Solenne stock reconciliation, 2026-05-16)
--   The existing update_product_stock_on_order_status trigger (last touched
--   in migration 167) restores stock only when an order transitions from a
--   stock-deducted status to 'cancelled' or 'rejected'. The 'returned'
--   status was never wired up. As a result, 22 returned Solenne orders kept
--   stock_deducted=true on every line item and inventory drifted: the system
--   thinks 252 PDRN packs left the warehouse when reality is 230 (22 came
--   back).
--
-- FIX
--   Add 'returned' as a valid target status for the restore branch (CASE 2).
--   The transition guard is unchanged: we only restore when the order had
--   reached a status that actually deducted stock
--   (ready_to_ship / shipped / in_transit / delivered). Idempotency is
--   inherited from the existing `IF NOT v_already_deducted` check on every
--   line item, so a manual restock followed by an automatic restock will
--   never double-credit the inventory pool.
--
-- IDEMPOTENT
--   - CREATE OR REPLACE FUNCTION (no DROP)
--   - The trigger function itself short-circuits when stock_deducted is
--     already FALSE on a line item
--   - Re-running this migration is a no-op
--
-- BACKWARDS COMPATIBLE
--   - All other transitions keep the migration 167 semantics
--   - is_demo tagging in inventory_movements is preserved (migration 166)
--   - SHARED-STOCK variant handling is preserved (migration 087/146)
--   - SKU fallback when product_id is NULL is preserved (migration 098)
-- ============================================================================

BEGIN;

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
    v_is_demo BOOLEAN;
BEGIN
    IF (TG_OP = 'UPDATE' AND OLD.sleeves_status IS NOT DISTINCT FROM NEW.sleeves_status) THEN
        RETURN NEW;
    END IF;

    v_is_demo := COALESCE(NEW.is_demo, FALSE);

    SELECT EXISTS(
        SELECT 1 FROM pg_proc WHERE proname = 'deduct_shared_stock_for_variant'
    ) INTO v_has_variant_functions;

    -- ========================================================================
    -- CASE 1: Order moves to shipping/delivery status (DECREMENT)
    -- Unchanged from migration 167.
    -- ========================================================================
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

            SELECT EXISTS(
                SELECT 1 FROM products
                WHERE id = v_product_uuid AND store_id = NEW.store_id
            ) INTO v_product_exists;

            IF NOT v_product_exists THEN
                RAISE WARNING '[STOCK] Product % not found in store % - skipping', v_product_uuid, NEW.store_id;
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

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
                movement_type, order_status_from, order_status_to, notes,
                is_demo
            ) VALUES (
                NEW.store_id, v_product_uuid, v_variant_uuid, NEW.id,
                -v_item_quantity, v_stock_before, v_stock_after,
                'order_' || NEW.sleeves_status,
                CASE WHEN TG_OP = 'UPDATE' THEN OLD.sleeves_status ELSE NULL END,
                NEW.sleeves_status,
                format('Stock decremented: %s x %s (SKU: %s)', v_item_quantity, v_product_name, COALESCE(v_product_sku, 'N/A')),
                v_is_demo
            );

            v_items_processed := v_items_processed + 1;
        END LOOP;

        IF v_items_processed > 0 OR v_items_skipped > 0 THEN
            RAISE NOTICE '[STOCK] Order % %: % items decremented, % skipped', NEW.id, NEW.sleeves_status, v_items_processed, v_items_skipped;
        END IF;
    END IF;

    -- ========================================================================
    -- CASE 2: Order cancelled / rejected / RETURNED (RESTORE stock)
    -- CHANGED in migration 187: added 'returned' to the target set.
    -- The transition guard still requires the previous status to be one of
    -- ready_to_ship / shipped / in_transit / delivered, i.e. a state that
    -- actually deducted stock. Idempotency: per-line-item check on
    -- stock_deducted prevents double restock when the row was already
    -- restored manually (e.g. the 22 Solenne orders restocked on 2026-05-16).
    -- ========================================================================
    IF (TG_OP = 'UPDATE' AND
        NEW.sleeves_status IN ('cancelled', 'rejected', 'returned') AND
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

            -- Idempotency: skip rows that have already been restored (covers
            -- the manual backfill done by solenne-ceo for the 22 historical
            -- returned orders, and any retry of this trigger).
            IF NOT v_already_deducted OR v_product_uuid IS NULL OR v_item_quantity <= 0 THEN
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            IF v_variant_uuid IS NOT NULL AND v_has_variant_functions THEN
                SELECT uses_shared_stock INTO v_uses_shared_stock
                FROM product_variants WHERE id = v_variant_uuid;

                IF FOUND AND v_uses_shared_stock = TRUE THEN
                    SELECT * INTO v_restore_result
                    FROM restore_shared_stock_for_variant(
                        v_variant_uuid,
                        v_item_quantity,
                        NEW.id,
                        'order_' || NEW.sleeves_status
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
                movement_type, order_status_from, order_status_to, notes,
                is_demo
            ) VALUES (
                NEW.store_id, v_product_uuid, v_variant_uuid, NEW.id,
                v_item_quantity, v_stock_before, v_stock_after,
                'order_' || NEW.sleeves_status, OLD.sleeves_status, NEW.sleeves_status,
                format('Stock restored on %s: %s x %s', NEW.sleeves_status, v_item_quantity, v_product_name),
                v_is_demo
            );

            v_items_processed := v_items_processed + 1;
        END LOOP;

        IF v_items_processed > 0 THEN
            RAISE NOTICE '[STOCK] Order % %: % items restored, % skipped', NEW.id, NEW.sleeves_status, v_items_processed, v_items_skipped;
        END IF;
    END IF;

    -- ========================================================================
    -- CASE 3: Order reverted to pre-ship status (RESTORE stock)
    -- Unchanged from migration 167.
    -- ========================================================================
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
                movement_type, order_status_from, order_status_to, notes,
                is_demo
            ) VALUES (
                NEW.store_id, v_product_uuid, v_variant_uuid, NEW.id,
                v_item_quantity, v_stock_before, v_stock_after,
                'order_reverted', OLD.sleeves_status, NEW.sleeves_status,
                format('Stock restored on revert: %s x %s', v_item_quantity, v_product_name),
                v_is_demo
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
  'UPDATED in migration 187 (returned -> auto restock): adds the `returned` '
  'target status to the cancel/reject restore branch so returned orders '
  'release the stock they had deducted. Idempotent via the per-line-item '
  'stock_deducted check (does not double-credit if the row was already '
  'restored manually). All other behavior is preserved from migration 167.';

DROP TRIGGER IF EXISTS trigger_update_stock_on_order_status ON orders;
CREATE TRIGGER trigger_update_stock_on_order_status
    AFTER INSERT OR UPDATE OF sleeves_status
    ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_product_stock_on_order_status();

DO $$
BEGIN
    RAISE NOTICE '================================================================';
    RAISE NOTICE '  MIGRATION 187: returned -> auto restock';
    RAISE NOTICE '================================================================';
    RAISE NOTICE '  CHANGES:';
    RAISE NOTICE '    1. Restore branch now triggers on cancelled / rejected / returned';
    RAISE NOTICE '    2. Idempotent via line-item stock_deducted check';
    RAISE NOTICE '  SAFE:';
    RAISE NOTICE '    - 22 historical Solenne orders already restocked manually';
    RAISE NOTICE '    - those will NOT be double-restored';
END $$;

COMMIT;
