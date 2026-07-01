-- ============================================================================
-- Migration 207: Fix variation stock-decrement routing in status trigger
-- ============================================================================
--
-- BUG (confirmed against prod vgqecqqleuowvoimcoxg, store 1eeaf2c7-...)
-- --------------------------------------------------------------------
-- update_product_stock_on_order_status() routed stock movements to the wrong
-- column for VARIATIONS (variant_type = 'variation', uses_shared_stock = FALSE,
-- units_per_pack = 1, own product_variants.stock).
--
-- All three variant blocks (deduct, restore-on-cancel, revert) gated the
-- variant path on:
--     IF FOUND AND v_uses_shared_stock = TRUE THEN ... CONTINUE; END IF;
-- For a variation the variant row IS FOUND but uses_shared_stock is FALSE, so
-- the block was skipped and execution fell through to the parent-product
-- fallback. Result: the movement hit products.stock instead of the variation's
-- own product_variants.stock.
--
-- Evidence: for variation d222a082 (SKU NOCTE-GLASSES-ROJO, product 91f20b61),
-- 56 orders correctly decremented product_variants.stock via
-- deduct_shared_stock_for_variant ('VARIANTE "..." N units (independent
-- stock)'), while 78 orders wrongly decremented the parent products.stock
-- ('Stock decremented: N x NOCTE Glasses'). Two disjoint order populations on
-- two stock columns: a routing bug, not a double-count.
--
-- FIX
-- ---
-- deduct_shared_stock_for_variant / restore_shared_stock_for_variant already
-- route correctly per type internally (uses_shared_stock IS NOT TRUE ->
-- variation's own stock; TRUE -> parent * units_per_pack). The trigger simply
-- never called them for variations. So the gate changes from
--     IF FOUND AND v_uses_shared_stock = TRUE THEN
-- to
--     IF FOUND THEN
-- Inside, the bundle_selections composition path stays guarded by
-- uses_shared_stock = TRUE (only real bundles carry selections). Any other
-- FOUND variant (variation, or bundle without selections) routes through the
-- single-variant helper, then CONTINUE so a line item with a valid variant_id
-- NEVER falls through to the parent-product path.
--
-- Orphan guard preserved: variant_id set but variant row NOT FOUND keeps the
-- old parent-product fallback so deleted-variant line items still process.
--
-- restore_shared_stock_for_variant already has the variation branch (verified
-- against live prod), so it is NOT modified here.
--
-- NO historical data repair here: the 78 mis-decremented orders are a separate
-- reconciliation (see optional 207b). This migration only fixes forward routing.
--
-- Preserved verbatim from the live body: SECURITY DEFINER, all RAISE EXCEPTION
-- on insufficient stock, all inventory_movements logging, is_demo handling,
-- stock_deducted idempotency flag, bundle_selections total validation, SKU
-- fallback product resolution.
--
-- Idempotent: CREATE OR REPLACE. Trigger binding unchanged (not re-created).
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
    v_bundle_selections JSONB;
    v_selection JSONB;
    v_sel_variant_id UUID;
    v_sel_quantity INT;
    v_sel_total INT;
    v_variant_found BOOLEAN;
BEGIN
    IF (TG_OP = 'UPDATE' AND OLD.sleeves_status IS NOT DISTINCT FROM NEW.sleeves_status) THEN
        RETURN NEW;
    END IF;

    v_is_demo := COALESCE(NEW.is_demo, FALSE);

    SELECT EXISTS(
        SELECT 1 FROM pg_proc WHERE proname = 'deduct_shared_stock_for_variant'
    ) INTO v_has_variant_functions;

    -- ------------------------------------------------------------------
    -- DEDUCT: ready_to_ship / shipped / in_transit / delivered
    -- ------------------------------------------------------------------
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
                v_variant_found := FOUND;

                -- Any FOUND variant (variation OR bundle) routes through the
                -- variant helpers, which decrement the correct column per type.
                -- Only a NOT FOUND variant (deleted) falls to the product path.
                IF v_variant_found THEN

                    -- Bundle with resolved selections: deduct each selection
                    -- from its own variation stock (migration 146/198 branch).
                    IF v_uses_shared_stock = TRUE
                       AND v_bundle_selections IS NOT NULL
                       AND jsonb_array_length(v_bundle_selections) > 0 THEN

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

                    -- Variation (own stock), or bundle without selections
                    -- (parent * units_per_pack). The helper routes per type.
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
                        RAISE NOTICE '[STOCK] Order % variant %: deducted % physical units (% qty x % units/pack)',
                            NEW.id, v_variant_uuid, v_deduction_result.physical_units_deducted,
                            v_item_quantity, COALESCE(v_units_per_pack, 1);
                    ELSE
                        RAISE EXCEPTION 'Insufficient stock for variant %. %', v_variant_uuid, v_deduction_result.error_message
                        USING HINT = 'Cannot complete order - check inventory';
                    END IF;
                    CONTINUE;
                END IF;
            END IF;

            -- Parent-product path: no variant_id, or variant deleted (orphan).
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

    -- ------------------------------------------------------------------
    -- RESTORE: cancelled / rejected / returned (from a shipped-family state)
    -- ------------------------------------------------------------------
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
                v_variant_found := FOUND;

                IF v_variant_found THEN

                    IF v_uses_shared_stock = TRUE
                       AND v_bundle_selections IS NOT NULL
                       AND jsonb_array_length(v_bundle_selections) > 0 THEN
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

    -- ------------------------------------------------------------------
    -- REVERT: shipped-family state back to pending/confirmed/in_preparation/contacted
    -- ------------------------------------------------------------------
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
                v_variant_found := FOUND;

                IF v_variant_found THEN

                    IF v_uses_shared_stock = TRUE
                       AND v_bundle_selections IS NOT NULL
                       AND jsonb_array_length(v_bundle_selections) > 0 THEN
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
