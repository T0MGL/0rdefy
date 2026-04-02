-- ============================================================================
-- MIGRATION 146: Bundle Composition (Mixed Variant Selection)
-- ============================================================================
--
-- Allows selecting which variations compose a bundle order.
-- Example: Pack Pareja (2 units) can now be 1 Naranja + 1 Rojo
-- instead of forcing 2 of the same color.
--
-- CHANGES:
-- 1. Add bundle_selections JSONB to order_line_items
-- 2. Add bundle_selections JSONB to return_session_items
-- 3. Update stock trigger to deduct from individual variations
--    when bundle_selections is present
--
-- BACKWARD COMPATIBLE:
-- - bundle_selections = NULL: existing behavior (deduct from parent)
-- - bundle_selections = [...]: deduct from each selected variation
--
-- Author: Bright Idea
-- Date: 2026-04-02
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Add bundle_selections column to order_line_items
-- ============================================================================
-- Format: [{"variant_id": "uuid", "variant_name": "Naranja", "quantity": 1}, ...]
-- Constraint: sum of quantities = line_item.quantity * units_per_pack

ALTER TABLE order_line_items
  ADD COLUMN IF NOT EXISTS bundle_selections JSONB;

COMMENT ON COLUMN order_line_items.bundle_selections IS
  'When a bundle is composed of specific variations, stores [{variant_id, variant_name, quantity}]. Stock deducts from each variation instead of parent.';

-- Also add to return_session_items for audit trail on returns
ALTER TABLE return_session_items
  ADD COLUMN IF NOT EXISTS bundle_selections JSONB;

COMMENT ON COLUMN return_session_items.bundle_selections IS
  'Copied from order_line_items.bundle_selections for variant-aware stock restoration on returns.';


-- ============================================================================
-- STEP 2: Update stock trigger with bundle_selections awareness
-- ============================================================================
-- The trigger now checks bundle_selections on each line item.
-- If present and the variant is a bundle (uses_shared_stock=TRUE),
-- it iterates each selection and deducts from the variation's
-- independent stock via deduct_shared_stock_for_variant (which
-- already handles uses_shared_stock=FALSE variants correctly).

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
    -- Migration 146: bundle composition variables
    v_bundle_selections JSONB;
    v_selection JSONB;
    v_sel_variant_id UUID;
    v_sel_quantity INT;
    v_sel_all_ok BOOLEAN;
    v_sel_total INT;
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
                oli.sku as li_sku,
                oli.bundle_selections  -- Migration 146
            FROM order_line_items oli
            WHERE oli.order_id = NEW.id
        LOOP
            v_product_uuid := v_line_item.product_id;
            v_variant_uuid := v_line_item.variant_id;
            v_item_quantity := COALESCE(v_line_item.quantity, 0);
            v_already_deducted := COALESCE(v_line_item.stock_deducted, FALSE);
            v_bundle_selections := v_line_item.bundle_selections;  -- Migration 146

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

                    -- ==========================================================
                    -- Migration 146: Bundle with composition selections
                    -- Deduct from each selected variation's independent stock
                    -- ==========================================================
                    IF v_bundle_selections IS NOT NULL AND jsonb_array_length(v_bundle_selections) > 0 THEN

                        -- Validate: sum of selection quantities = quantity * units_per_pack
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

                        -- Deduct from each selected variation
                        v_sel_all_ok := TRUE;
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

                        -- Mark line item as deducted
                        UPDATE order_line_items
                        SET stock_deducted = TRUE,
                            stock_deducted_at = NOW(),
                            units_per_pack = COALESCE(v_units_per_pack, 1)
                        WHERE id = v_line_item.line_item_id;

                        v_items_processed := v_items_processed + 1;
                        CONTINUE;
                    END IF;
                    -- ==========================================================
                    -- END Migration 146 block
                    -- ==========================================================

                    -- Legacy path: no bundle_selections, deduct from parent
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
            SELECT oli.id as line_item_id, oli.product_id, oli.variant_id,
                   oli.quantity, oli.stock_deducted, oli.bundle_selections  -- Migration 146
            FROM order_line_items oli
            WHERE oli.order_id = NEW.id
        LOOP
            v_product_uuid := v_line_item.product_id;
            v_variant_uuid := v_line_item.variant_id;
            v_item_quantity := COALESCE(v_line_item.quantity, 0);
            v_already_deducted := COALESCE(v_line_item.stock_deducted, FALSE);
            v_bundle_selections := v_line_item.bundle_selections;  -- Migration 146

            IF NOT v_already_deducted OR v_product_uuid IS NULL OR v_item_quantity <= 0 THEN
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            -- VARIANT: Restore shared stock
            IF v_variant_uuid IS NOT NULL AND v_has_variant_functions THEN
                SELECT uses_shared_stock INTO v_uses_shared_stock
                FROM product_variants WHERE id = v_variant_uuid;

                IF FOUND AND v_uses_shared_stock = TRUE THEN

                    -- Migration 146: Restore from each selected variation
                    IF v_bundle_selections IS NOT NULL AND jsonb_array_length(v_bundle_selections) > 0 THEN
                        FOR v_selection IN SELECT * FROM jsonb_array_elements(v_bundle_selections)
                        LOOP
                            v_sel_variant_id := (v_selection->>'variant_id')::UUID;
                            v_sel_quantity := (v_selection->>'quantity')::INT;

                            IF v_sel_quantity <= 0 THEN
                                CONTINUE;
                            END IF;

                            SELECT * INTO v_restore_result
                            FROM restore_shared_stock_for_variant(v_sel_variant_id, v_sel_quantity, NEW.id, 'order_cancelled');

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

                    -- Legacy: restore to parent
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
    -- ============================================================
    IF (TG_OP = 'UPDATE' AND
        OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'in_transit', 'delivered') AND
        NEW.sleeves_status IN ('pending', 'confirmed', 'in_preparation', 'contacted')) THEN

        v_items_processed := 0;
        v_items_skipped := 0;

        FOR v_line_item IN
            SELECT oli.id as line_item_id, oli.product_id, oli.variant_id,
                   oli.quantity, oli.stock_deducted, oli.bundle_selections  -- Migration 146
            FROM order_line_items oli WHERE oli.order_id = NEW.id
        LOOP
            v_product_uuid := v_line_item.product_id;
            v_variant_uuid := v_line_item.variant_id;
            v_item_quantity := COALESCE(v_line_item.quantity, 0);
            v_already_deducted := COALESCE(v_line_item.stock_deducted, FALSE);
            v_bundle_selections := v_line_item.bundle_selections;  -- Migration 146

            IF NOT v_already_deducted OR v_product_uuid IS NULL OR v_item_quantity <= 0 THEN
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            -- VARIANT: Restore shared stock
            IF v_variant_uuid IS NOT NULL AND v_has_variant_functions THEN
                SELECT uses_shared_stock INTO v_uses_shared_stock
                FROM product_variants WHERE id = v_variant_uuid;

                IF FOUND AND v_uses_shared_stock = TRUE THEN

                    -- Migration 146: Restore from each selected variation
                    IF v_bundle_selections IS NOT NULL AND jsonb_array_length(v_bundle_selections) > 0 THEN
                        FOR v_selection IN SELECT * FROM jsonb_array_elements(v_bundle_selections)
                        LOOP
                            v_sel_variant_id := (v_selection->>'variant_id')::UUID;
                            v_sel_quantity := (v_selection->>'quantity')::INT;

                            IF v_sel_quantity <= 0 THEN
                                CONTINUE;
                            END IF;

                            SELECT * INTO v_restore_result
                            FROM restore_shared_stock_for_variant(v_sel_variant_id, v_sel_quantity, NEW.id, 'order_reverted');

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

                    -- Legacy: restore to parent
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
$$ LANGUAGE plpgsql;

-- Verify trigger is attached (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trigger_update_stock_on_order_status'
        AND tgrelid = 'orders'::regclass
    ) THEN
        CREATE TRIGGER trigger_update_stock_on_order_status
        AFTER INSERT OR UPDATE OF sleeves_status ON orders
        FOR EACH ROW
        EXECUTE FUNCTION update_product_stock_on_order_status();
    END IF;
END $$;


-- ============================================================================
-- STEP 3: Update complete_return_session for bundle composition awareness
-- ============================================================================
-- When a return item has bundle_selections, restore stock to each
-- individual variation instead of restoring to the bundle's parent stock.

CREATE OR REPLACE FUNCTION complete_return_session(p_session_id UUID)
RETURNS JSON AS $$
DECLARE
  v_session RECORD;
  v_item RECORD;
  v_order_id UUID;
  v_accepted_count INT := 0;
  v_rejected_count INT := 0;
  v_result JSON;
  v_restore_result RECORD;
  -- Migration 146: bundle composition variables
  v_selection JSONB;
  v_sel_variant_id UUID;
  v_sel_quantity INT;
BEGIN
  -- Get session details (FOR UPDATE prevents concurrent completion)
  SELECT * INTO v_session
  FROM return_sessions
  WHERE id = p_session_id AND status = 'in_progress'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return session not found or already completed';
  END IF;

  -- Process each item
  FOR v_item IN
    SELECT * FROM return_session_items
    WHERE session_id = p_session_id
  LOOP
    -- Update product stock for accepted items
    IF v_item.quantity_accepted > 0 THEN
      -- Check if this item has a variant
      IF v_item.variant_id IS NOT NULL THEN

        -- Migration 146: Bundle with composition selections
        IF v_item.bundle_selections IS NOT NULL AND jsonb_array_length(v_item.bundle_selections) > 0 THEN
          -- Restore stock to each selected variation
          FOR v_selection IN SELECT * FROM jsonb_array_elements(v_item.bundle_selections)
          LOOP
            v_sel_variant_id := (v_selection->>'variant_id')::UUID;
            v_sel_quantity := (v_selection->>'quantity')::INT;

            IF v_sel_quantity > 0 AND v_sel_variant_id IS NOT NULL THEN
              -- Scale quantity by accepted ratio (full pack return for V1)
              SELECT * INTO v_restore_result
              FROM restore_shared_stock_for_variant(
                v_sel_variant_id,
                v_sel_quantity * v_item.quantity_accepted,
                v_item.order_id,
                'return_accepted'
              );

              IF v_restore_result.success IS NOT TRUE THEN
                RAISE WARNING 'Failed to restore variant stock for bundle selection %: %',
                  v_sel_variant_id, COALESCE(v_restore_result.error_message, 'unknown error');
              END IF;
            END IF;
          END LOOP;
        ELSE
          -- Legacy: restore via bundle variant (parent stock) or variation (own stock)
          SELECT * INTO v_restore_result
          FROM restore_shared_stock_for_variant(
            v_item.variant_id,
            v_item.quantity_accepted,
            v_item.order_id,
            'return_accepted'
          );

          IF v_restore_result.success IS NOT TRUE THEN
            RAISE WARNING 'Failed to restore variant stock for item %: %',
              v_item.id, COALESCE(v_restore_result.error_message, 'unknown error');
          END IF;
        END IF;

      ELSE
        -- REGULAR PRODUCT RESTORE: Original behavior (no variant)
        DECLARE
          v_stock_before INT;
          v_stock_after INT;
          v_store_id UUID;
        BEGIN
          SELECT stock, store_id INTO v_stock_before, v_store_id
          FROM products
          WHERE id = v_item.product_id
          FOR UPDATE;

          v_stock_after := v_stock_before + v_item.quantity_accepted;

          UPDATE products
          SET stock = v_stock_after,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = v_item.product_id;

          INSERT INTO inventory_movements (
            store_id, product_id, order_id,
            movement_type, quantity_change, stock_before, stock_after,
            notes, created_at
          ) VALUES (
            v_store_id, v_item.product_id, v_item.order_id,
            'return_accepted', v_item.quantity_accepted, v_stock_before, v_stock_after,
            'Return session: ' || v_session.session_code, CURRENT_TIMESTAMP
          );
        END;
      END IF;

      v_accepted_count := v_accepted_count + v_item.quantity_accepted;
    END IF;

    -- Log rejected items (no stock update)
    IF v_item.quantity_rejected > 0 THEN
      DECLARE
        v_current_stock INT;
        v_store_id UUID;
      BEGIN
        SELECT stock, store_id INTO v_current_stock, v_store_id
        FROM products
        WHERE id = v_item.product_id;

        INSERT INTO inventory_movements (
          store_id, product_id, order_id,
          movement_type, quantity_change, stock_before, stock_after,
          notes, created_at
        ) VALUES (
          v_store_id, v_item.product_id, v_item.order_id,
          'return_rejected', 0, v_current_stock, v_current_stock,
          'Return rejected (' || COALESCE(v_item.rejection_reason, 'unspecified') || '): ' || v_session.session_code,
          CURRENT_TIMESTAMP
        );
      END;
      v_rejected_count := v_rejected_count + v_item.quantity_rejected;
    END IF;
  END LOOP;

  -- Update all orders in the session to 'returned' status
  FOR v_order_id IN
    SELECT order_id FROM return_session_orders
    WHERE session_id = p_session_id
  LOOP
    UPDATE orders
    SET sleeves_status = 'returned',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = v_order_id;
  END LOOP;

  -- Mark session as completed
  UPDATE return_sessions
  SET status = 'completed',
      completed_at = CURRENT_TIMESTAMP,
      items_accepted = v_accepted_count,
      items_rejected = v_rejected_count
  WHERE id = p_session_id;

  -- Build result
  v_result := json_build_object(
    'session_id', p_session_id,
    'status', 'completed',
    'items_accepted', v_accepted_count,
    'items_rejected', v_rejected_count
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- ============================================================================
-- ROLLBACK INSTRUCTIONS
-- ============================================================================
-- To rollback, re-apply migration 107 to restore the original trigger:
--   psql -f db/migrations/107_critical_variant_and_stock_fixes.sql
-- Then drop the columns:
--   ALTER TABLE order_line_items DROP COLUMN IF EXISTS bundle_selections;
--   ALTER TABLE return_session_items DROP COLUMN IF EXISTS bundle_selections;
