-- ============================================================================
-- Migration 198: Restore bundle_selections branch in stock trigger
-- ============================================================================
--
-- REGRESSION FIXED
-- ----------------
-- Migration 181/187 (NOCTE Glasses consolidation) re-created
-- update_product_stock_on_order_status() WITHOUT the bundle_selections branch
-- that migration 146 had introduced. The deployed function, for any bundle
-- line item (uses_shared_stock = TRUE), called
-- deduct_shared_stock_for_variant(bundle_variant_id, qty), which deducts
-- units_per_pack from the PARENT product stock.
--
-- After the consolidation the canonical parent "NOCTE Glasses" (91f20b61)
-- holds stock 0 (stock now lives in the color variations: Rojo 200,
-- Naranja 50, Amarillo 44). The parent deduction therefore returns
-- success = FALSE ("Insufficient stock. Need 3 units, have 0") and the
-- trigger RAISEs, aborting every pack's transition to ready_to_ship.
--
-- This broke ALL NOCTE packs (mono and mixed), not just the mixed one.
--
-- FIX
-- ---
-- Re-introduce the migration 146 branch: when a bundle line item carries
-- resolved bundle_selections (each with a real variant_id), deduct / restore
-- each selection's quantity from its own VARIATION stock instead of from the
-- parent. The selection variants have uses_shared_stock = FALSE, so the helper
-- deduct_shared_stock_for_variant / restore_shared_stock_for_variant hit their
-- independent-stock branch and move the variation's own stock directly.
--
-- CROSS-TENANT SAFETY (Solenne intact)
-- ------------------------------------
-- The new logic is strictly conditional on bundle_selections being a non-empty
-- JSONB array. Solenne's 12 bundles use the legacy shared-stock model and have
-- ZERO line items with resolved bundle_selections (verified: 172 bundle lines,
-- 0 with selections). They keep hitting the legacy parent-deduction path with
-- byte-for-byte identical behavior. No Solenne code path changes.
--
-- This migration preserves every migration 187 addition:
--   - is_demo propagation into inventory_movements
--   - 'returned' in the CASE 2 restore target set
--   - SKU fallback (find_product_id_by_sku) when product_id is NULL
--
-- Idempotent: CREATE OR REPLACE FUNCTION. The trigger binding is unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_product_stock_on_order_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
    -- Migration 198 (re-introduced from 146): bundle composition handling
    v_bundle_selections JSONB;
    v_selection JSONB;
    v_sel_variant_id UUID;
    v_sel_quantity INT;
    v_sel_total INT;
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
                oli.sku as li_sku,
                oli.bundle_selections
            FROM order_line_items oli
            WHERE oli.order_id = NEW.id
        LOOP
            v_product_uuid := v_line_item.product_id;
            v_variant_uuid := v_line_item.variant_id;
            v_item_quantity := COALESCE(v_line_item.quantity, 0);
            v_already_deducted := COALESCE(v_line_item.stock_deducted, FALSE);
            v_bundle_selections := v_line_item.bundle_selections;

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

                    -- ==========================================================
                    -- Migration 198 (146): Bundle with composition selections.
                    -- Deduct from each selected VARIATION's independent stock.
                    -- This is the NOCTE post-consolidation path.
                    -- ==========================================================
                    IF v_bundle_selections IS NOT NULL AND jsonb_array_length(v_bundle_selections) > 0 THEN

                        v_sel_total := 0;
                        FOR v_selection IN SELECT * FROM jsonb_array_elements(v_bundle_selections)
                        LOOP
                            v_sel_total := v_sel_total + COALESCE((v_selection->>'quantity')::INT, 0);
                        END LOOP;

                        IF v_sel_total != v_item_quantity * COALESCE(v_units_per_pack, 1) THEN
                            RAISE EXCEPTION 'Bundle selections total (%) does not match expected (% packs x % units = %). Order: %',
                                v_sel_total, v_item_quantity, COALESCE(v_units_per_pack, 1),
                                v_item_quantity * COALESCE(v_units_per_pack, 1), NEW.id
                            USING HINT = 'bundle_selections quantities must sum to quantity * units_per_pack';
                        END IF;

                        FOR v_selection IN SELECT * FROM jsonb_array_elements(v_bundle_selections)
                        LOOP
                            v_sel_variant_id := (v_selection->>'variant_id')::UUID;
                            v_sel_quantity := (v_selection->>'quantity')::INT;

                            IF v_sel_quantity <= 0 THEN
                                CONTINUE;
                            END IF;

                            SELECT * INTO v_deduction_result
                            FROM deduct_shared_stock_for_variant(
                                v_sel_variant_id,
                                v_sel_quantity,
                                NEW.id,
                                'order_' || NEW.sleeves_status
                            );

                            IF NOT v_deduction_result.success THEN
                                RAISE EXCEPTION 'Insufficient stock for variation % in bundle composition. %',
                                    v_sel_variant_id, v_deduction_result.error_message
                                USING HINT = 'Cannot complete order - check variant inventory';
                            END IF;

                            RAISE NOTICE '[STOCK] Order % bundle composition: deducted % from variation %',
                                NEW.id, v_sel_quantity, v_sel_variant_id;
                        END LOOP;

                        UPDATE order_line_items
                        SET stock_deducted = TRUE,
                            stock_deducted_at = NOW(),
                            units_per_pack = COALESCE(v_units_per_pack, 1)
                        WHERE id = v_line_item.line_item_id;

                        v_items_processed := v_items_processed + 1;
                        CONTINUE;
                    END IF;
                    -- ==========================================================
                    -- END Migration 198 (146) bundle composition block.
                    -- Legacy path below: no bundle_selections, deduct from
                    -- parent (Solenne shared-stock bundles).
                    -- ==========================================================

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
    -- ========================================================================
    IF (TG_OP = 'UPDATE' AND
        NEW.sleeves_status IN ('cancelled', 'rejected', 'returned') AND
        OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'in_transit', 'delivered')) THEN

        v_items_processed := 0;
        v_items_skipped := 0;

        FOR v_line_item IN
            SELECT oli.id as line_item_id, oli.product_id, oli.variant_id,
                   oli.quantity, oli.stock_deducted, oli.bundle_selections
            FROM order_line_items oli
            WHERE oli.order_id = NEW.id
        LOOP
            v_product_uuid := v_line_item.product_id;
            v_variant_uuid := v_line_item.variant_id;
            v_item_quantity := COALESCE(v_line_item.quantity, 0);
            v_already_deducted := COALESCE(v_line_item.stock_deducted, FALSE);
            v_bundle_selections := v_line_item.bundle_selections;

            IF NOT v_already_deducted OR v_product_uuid IS NULL OR v_item_quantity <= 0 THEN
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            IF v_variant_uuid IS NOT NULL AND v_has_variant_functions THEN
                SELECT uses_shared_stock INTO v_uses_shared_stock
                FROM product_variants WHERE id = v_variant_uuid;

                IF FOUND AND v_uses_shared_stock = TRUE THEN

                    -- Migration 198 (146): restore from each selected VARIATION.
                    IF v_bundle_selections IS NOT NULL AND jsonb_array_length(v_bundle_selections) > 0 THEN
                        FOR v_selection IN SELECT * FROM jsonb_array_elements(v_bundle_selections)
                        LOOP
                            v_sel_variant_id := (v_selection->>'variant_id')::UUID;
                            v_sel_quantity := (v_selection->>'quantity')::INT;

                            IF v_sel_quantity <= 0 THEN
                                CONTINUE;
                            END IF;

                            SELECT * INTO v_restore_result
                            FROM restore_shared_stock_for_variant(
                                v_sel_variant_id,
                                v_sel_quantity,
                                NEW.id,
                                'order_' || NEW.sleeves_status
                            );

                            IF v_restore_result.success THEN
                                RAISE NOTICE '[STOCK] Order % bundle restore: restored % to variation %',
                                    NEW.id, v_sel_quantity, v_sel_variant_id;
                            END IF;
                        END LOOP;

                        UPDATE order_line_items
                        SET stock_deducted = FALSE, stock_deducted_at = NULL
                        WHERE id = v_line_item.line_item_id;
                        v_items_processed := v_items_processed + 1;
                        CONTINUE;
                    END IF;

                    -- Legacy: restore to parent (Solenne shared-stock bundles).
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
    -- ========================================================================
    IF (TG_OP = 'UPDATE' AND
        OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'in_transit', 'delivered') AND
        NEW.sleeves_status IN ('pending', 'confirmed', 'in_preparation', 'contacted')) THEN

        v_items_processed := 0;
        v_items_skipped := 0;

        FOR v_line_item IN
            SELECT oli.id as line_item_id, oli.product_id, oli.variant_id,
                   oli.quantity, oli.stock_deducted, oli.bundle_selections
            FROM order_line_items oli WHERE oli.order_id = NEW.id
        LOOP
            v_product_uuid := v_line_item.product_id;
            v_variant_uuid := v_line_item.variant_id;
            v_item_quantity := COALESCE(v_line_item.quantity, 0);
            v_already_deducted := COALESCE(v_line_item.stock_deducted, FALSE);
            v_bundle_selections := v_line_item.bundle_selections;

            IF NOT v_already_deducted OR v_product_uuid IS NULL OR v_item_quantity <= 0 THEN
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            IF v_variant_uuid IS NOT NULL AND v_has_variant_functions THEN
                SELECT uses_shared_stock INTO v_uses_shared_stock
                FROM product_variants WHERE id = v_variant_uuid;

                IF FOUND AND v_uses_shared_stock = TRUE THEN

                    -- Migration 198 (146): restore from each selected VARIATION.
                    IF v_bundle_selections IS NOT NULL AND jsonb_array_length(v_bundle_selections) > 0 THEN
                        FOR v_selection IN SELECT * FROM jsonb_array_elements(v_bundle_selections)
                        LOOP
                            v_sel_variant_id := (v_selection->>'variant_id')::UUID;
                            v_sel_quantity := (v_selection->>'quantity')::INT;

                            IF v_sel_quantity <= 0 THEN
                                CONTINUE;
                            END IF;

                            SELECT * INTO v_restore_result
                            FROM restore_shared_stock_for_variant(
                                v_sel_variant_id,
                                v_sel_quantity,
                                NEW.id,
                                'order_reverted'
                            );

                            IF v_restore_result.success THEN
                                RAISE NOTICE '[STOCK] Order % bundle revert: restored % to variation %',
                                    NEW.id, v_sel_quantity, v_sel_variant_id;
                            END IF;
                        END LOOP;

                        UPDATE order_line_items
                        SET stock_deducted = FALSE, stock_deducted_at = NULL
                        WHERE id = v_line_item.line_item_id;
                        v_items_processed := v_items_processed + 1;
                        CONTINUE;
                    END IF;

                    -- Legacy: restore to parent (Solenne shared-stock bundles).
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
$function$;
