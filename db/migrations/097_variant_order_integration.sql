-- ================================================================
-- MIGRATION 097: Variant Order Integration - Complete System
-- ================================================================
-- PURPOSE: Connect the existing variant system (Migrations 086/087) to the
-- order flow. This enables selecting variants when creating orders and
-- properly handles shared stock deduction/restoration.
--
-- CHANGES:
-- 1. Add units_per_pack to order_line_items (snapshot for audit)
-- 2. Add variant_id to picking_session_items
-- 3. Update stock trigger to handle shared_stock variants
-- 4. Update check_order_stock_availability for variants
-- 5. Create function to find product+variant by Shopify IDs
-- 6. Update create_line_items_from_shopify to populate variant_id
--
-- BACKWARD COMPATIBLE: Products without variants continue working unchanged
--
-- Author: Claude Code
-- Date: 2026-01-22
-- ================================================================

BEGIN;

-- ================================================================
-- PART 1: ADD COLUMNS
-- ================================================================

DO $$
BEGIN
    -- Add units_per_pack to order_line_items (snapshot at order time)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'order_line_items' AND column_name = 'units_per_pack'
    ) THEN
        ALTER TABLE order_line_items ADD COLUMN units_per_pack INTEGER DEFAULT 1;
        RAISE NOTICE '  Added units_per_pack column to order_line_items';
    ELSE
        RAISE NOTICE '  units_per_pack already exists in order_line_items';
    END IF;

    -- Add variant_id to picking_session_items
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'picking_session_items' AND column_name = 'variant_id'
    ) THEN
        ALTER TABLE picking_session_items ADD COLUMN variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL;
        RAISE NOTICE '  Added variant_id column to picking_session_items';
    ELSE
        RAISE NOTICE '  variant_id already exists in picking_session_items';
    END IF;

    -- Add variant_id index to order_line_items if not exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'idx_order_line_items_variant_id'
    ) THEN
        CREATE INDEX idx_order_line_items_variant_id ON order_line_items(variant_id) WHERE variant_id IS NOT NULL;
        RAISE NOTICE '  Created index idx_order_line_items_variant_id';
    END IF;
END $$;

-- ================================================================
-- PART 2: UPDATE STOCK TRIGGER TO HANDLE VARIANTS
-- This is the CRITICAL change that connects variants to stock management
-- ================================================================

CREATE OR REPLACE FUNCTION update_product_stock_on_order_status()
RETURNS TRIGGER AS $$
DECLARE
    v_line_item RECORD;
    v_variant RECORD;
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
    v_physical_units INT;
    v_deduction_result RECORD;
    v_restore_result RECORD;
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

        FOR v_line_item IN
            SELECT
                oli.id as line_item_id,
                oli.product_id,
                oli.variant_id,
                oli.quantity,
                oli.stock_deducted,
                oli.product_name as li_product_name,
                oli.units_per_pack as li_units_per_pack
            FROM order_line_items oli
            WHERE oli.order_id = NEW.id
        LOOP
            v_product_uuid := v_line_item.product_id;
            v_variant_uuid := v_line_item.variant_id;
            v_item_quantity := COALESCE(v_line_item.quantity, 0);
            v_already_deducted := COALESCE(v_line_item.stock_deducted, FALSE);

            -- Skip if no product_id (unmapped product from Shopify)
            IF v_product_uuid IS NULL THEN
                RAISE NOTICE '[STOCK] Order % line item "%" has no product_id - skipping',
                    NEW.id, COALESCE(v_line_item.li_product_name, 'Unknown');
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            -- Skip if already deducted (prevents double deduction)
            IF v_already_deducted THEN
                RAISE NOTICE '[STOCK] Order % line item % already deducted - skipping',
                    NEW.id, v_line_item.line_item_id;
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            -- Skip if quantity is zero or negative
            IF v_item_quantity <= 0 THEN
                v_items_skipped := v_items_skipped + 1;
                CONTINUE;
            END IF;

            -- ============================================================
            -- VARIANT HANDLING: Check if line item has a variant
            -- ============================================================
            IF v_variant_uuid IS NOT NULL THEN
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
                        'order_ready_to_ship'
                    );

                    IF v_deduction_result.success THEN
                        -- Mark line item as stock deducted
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
                        -- Deduction failed (insufficient stock)
                        RAISE EXCEPTION 'Insufficient stock for variant %. %',
                            v_variant_uuid, v_deduction_result.error_message
                        USING HINT = 'Cannot move order to ready_to_ship - check inventory';
                    END IF;

                    CONTINUE;  -- Skip normal product handling
                END IF;
                -- If variant exists but doesn't use shared stock, fall through to normal handling
            END IF;

            -- ============================================================
            -- NORMAL PRODUCT/INDEPENDENT VARIANT HANDLING (existing logic)
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

            -- Lock row and get current stock
            SELECT stock, name, sku INTO v_stock_before, v_product_name, v_product_sku
            FROM products
            WHERE id = v_product_uuid AND store_id = NEW.store_id
            FOR UPDATE;

            -- Validate sufficient stock
            IF v_stock_before < v_item_quantity THEN
                RAISE EXCEPTION 'Insufficient stock for product "%" (SKU: %). Required: %, Available: %',
                    v_product_name, COALESCE(v_product_sku, 'N/A'),
                    v_item_quantity, v_stock_before
                USING HINT = 'Cannot move order to ready_to_ship - check inventory';
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

            -- Log movement (include variant_id if present)
            INSERT INTO inventory_movements (
                store_id, product_id, variant_id, order_id,
                quantity_change, stock_before, stock_after,
                movement_type, order_status_from, order_status_to, notes
            ) VALUES (
                NEW.store_id, v_product_uuid, v_variant_uuid, NEW.id,
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
                oli.stock_deducted,
                oli.units_per_pack as li_units_per_pack
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
            IF v_variant_uuid IS NOT NULL THEN
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
                        RAISE NOTICE '[STOCK] Order % variant %: restored % physical units',
                            NEW.id, v_variant_uuid, v_restore_result.physical_units_restored;
                    END IF;

                    CONTINUE;
                END IF;
            END IF;

            -- ============================================================
            -- NORMAL PRODUCT HANDLING (existing logic)
            -- ============================================================
            SELECT EXISTS(
                SELECT 1 FROM products
                WHERE id = v_product_uuid AND store_id = NEW.store_id
            ) INTO v_product_exists;

            IF NOT v_product_exists THEN
                RAISE WARNING '[STOCK] Product % not found - cannot restore',
                    v_product_uuid;
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
    -- CASE 3: Order reverted (same pattern as CASE 2)
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
                oli.stock_deducted,
                oli.units_per_pack as li_units_per_pack
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
            IF v_variant_uuid IS NOT NULL THEN
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
$$ LANGUAGE plpgsql;

-- Recreate trigger
DROP TRIGGER IF EXISTS trigger_update_stock_on_order_status ON orders;
CREATE TRIGGER trigger_update_stock_on_order_status
    AFTER INSERT OR UPDATE OF sleeves_status
    ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_product_stock_on_order_status();

COMMENT ON FUNCTION update_product_stock_on_order_status() IS
'UPDATED in migration 097: Now handles shared_stock variants.
When a line item has variant_id with uses_shared_stock=true, calls
deduct_shared_stock_for_variant/restore_shared_stock_for_variant.
For products/variants without shared_stock, uses existing direct stock update.';

-- ================================================================
-- PART 3: UPDATE check_order_stock_availability FOR VARIANTS
-- ================================================================

DROP FUNCTION IF EXISTS check_order_stock_availability(UUID, UUID);

CREATE OR REPLACE FUNCTION check_order_stock_availability(
    p_order_id UUID,
    p_store_id UUID
) RETURNS TABLE (
    product_id UUID,
    variant_id UUID,
    product_name TEXT,
    variant_title TEXT,
    product_sku TEXT,
    required_quantity INT,
    available_stock INT,
    is_sufficient BOOLEAN,
    shortage INT,
    uses_shared_stock BOOLEAN,
    units_per_pack INT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        oli.product_id,
        oli.variant_id,
        COALESCE(p.name, oli.product_name, 'Unknown Product')::TEXT as product_name,
        oli.variant_title::TEXT,
        COALESCE(pv.sku, p.sku, oli.sku, '')::TEXT as product_sku,
        COALESCE(oli.quantity, 0)::INT as required_quantity,
        -- Calculate available stock based on variant mode
        CASE
            WHEN oli.variant_id IS NOT NULL AND pv.uses_shared_stock = TRUE THEN
                FLOOR(COALESCE(p.stock, 0)::DECIMAL / COALESCE(pv.units_per_pack, 1))::INT
            WHEN oli.variant_id IS NOT NULL THEN
                COALESCE(pv.stock, 0)::INT
            ELSE
                COALESCE(p.stock, 0)::INT
        END as available_stock,
        -- Check if sufficient
        CASE
            WHEN oli.variant_id IS NOT NULL AND pv.uses_shared_stock = TRUE THEN
                (FLOOR(COALESCE(p.stock, 0)::DECIMAL / COALESCE(pv.units_per_pack, 1)) >= COALESCE(oli.quantity, 0))::BOOLEAN
            WHEN oli.variant_id IS NOT NULL THEN
                (COALESCE(pv.stock, 0) >= COALESCE(oli.quantity, 0))::BOOLEAN
            ELSE
                (COALESCE(p.stock, 0) >= COALESCE(oli.quantity, 0))::BOOLEAN
        END as is_sufficient,
        -- Calculate shortage
        CASE
            WHEN oli.variant_id IS NOT NULL AND pv.uses_shared_stock = TRUE THEN
                GREATEST(0, COALESCE(oli.quantity, 0) - FLOOR(COALESCE(p.stock, 0)::DECIMAL / COALESCE(pv.units_per_pack, 1)))::INT
            WHEN oli.variant_id IS NOT NULL THEN
                GREATEST(0, COALESCE(oli.quantity, 0) - COALESCE(pv.stock, 0))::INT
            ELSE
                GREATEST(0, COALESCE(oli.quantity, 0) - COALESCE(p.stock, 0))::INT
        END as shortage,
        COALESCE(pv.uses_shared_stock, FALSE)::BOOLEAN,
        COALESCE(pv.units_per_pack, 1)::INT
    FROM order_line_items oli
    LEFT JOIN products p ON p.id = oli.product_id AND p.store_id = p_store_id
    LEFT JOIN product_variants pv ON pv.id = oli.variant_id
    WHERE oli.order_id = p_order_id
    AND oli.product_id IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_order_stock_availability(UUID, UUID) IS
'UPDATED in migration 097: Now handles shared_stock variants.
Returns available packs (not raw units) for shared stock variants.';

GRANT EXECUTE ON FUNCTION check_order_stock_availability(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION check_order_stock_availability(UUID, UUID) TO service_role;

-- ================================================================
-- PART 4: FUNCTION TO FIND PRODUCT AND VARIANT BY SHOPIFY IDS
-- ================================================================

CREATE OR REPLACE FUNCTION find_product_and_variant_by_shopify_ids(
    p_store_id UUID,
    p_shopify_product_id VARCHAR,
    p_shopify_variant_id VARCHAR,
    p_sku VARCHAR DEFAULT NULL
) RETURNS TABLE (
    product_id UUID,
    variant_id UUID,
    match_method TEXT
) AS $$
DECLARE
    v_product_id UUID;
    v_variant_id UUID;
BEGIN
    -- First try to find variant by shopify_variant_id
    IF p_shopify_variant_id IS NOT NULL THEN
        SELECT pv.id, pv.product_id
        INTO v_variant_id, v_product_id
        FROM product_variants pv
        JOIN products p ON p.id = pv.product_id
        WHERE p.store_id = p_store_id
        AND pv.shopify_variant_id = p_shopify_variant_id
        AND pv.is_active = TRUE
        LIMIT 1;

        IF FOUND THEN
            RETURN QUERY SELECT v_product_id, v_variant_id, 'shopify_variant_id'::TEXT;
            RETURN;
        END IF;
    END IF;

    -- Try to find product by shopify_product_id
    IF p_shopify_product_id IS NOT NULL THEN
        SELECT p.id INTO v_product_id
        FROM products p
        WHERE p.store_id = p_store_id
        AND p.shopify_product_id = p_shopify_product_id
        AND p.is_active = TRUE
        LIMIT 1;

        IF FOUND THEN
            -- Check if there's a matching variant by SKU
            IF p_sku IS NOT NULL THEN
                SELECT pv.id INTO v_variant_id
                FROM product_variants pv
                WHERE pv.product_id = v_product_id
                AND pv.sku = p_sku
                AND pv.is_active = TRUE
                LIMIT 1;
            END IF;

            RETURN QUERY SELECT v_product_id, v_variant_id, 'shopify_product_id'::TEXT;
            RETURN;
        END IF;
    END IF;

    -- Try to find product by SKU
    IF p_sku IS NOT NULL THEN
        SELECT p.id INTO v_product_id
        FROM products p
        WHERE p.store_id = p_store_id
        AND p.sku = p_sku
        AND p.is_active = TRUE
        LIMIT 1;

        IF FOUND THEN
            RETURN QUERY SELECT v_product_id, NULL::UUID, 'sku'::TEXT;
            RETURN;
        END IF;

        -- Also try variant SKU
        SELECT pv.id, pv.product_id
        INTO v_variant_id, v_product_id
        FROM product_variants pv
        JOIN products p ON p.id = pv.product_id
        WHERE p.store_id = p_store_id
        AND pv.sku = p_sku
        AND pv.is_active = TRUE
        LIMIT 1;

        IF FOUND THEN
            RETURN QUERY SELECT v_product_id, v_variant_id, 'variant_sku'::TEXT;
            RETURN;
        END IF;
    END IF;

    -- No match found
    RETURN QUERY SELECT NULL::UUID, NULL::UUID, 'not_found'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION find_product_and_variant_by_shopify_ids(UUID, VARCHAR, VARCHAR, VARCHAR) IS
'Find local product and variant IDs from Shopify IDs.
Tries in order: shopify_variant_id, shopify_product_id, SKU.
Returns product_id, variant_id, and the match method used.';

GRANT EXECUTE ON FUNCTION find_product_and_variant_by_shopify_ids(UUID, VARCHAR, VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION find_product_and_variant_by_shopify_ids(UUID, VARCHAR, VARCHAR, VARCHAR) TO service_role;

-- ================================================================
-- PART 5: INDEXES FOR PERFORMANCE
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_product_variants_shopify_variant_id
ON product_variants(shopify_variant_id)
WHERE shopify_variant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_picking_session_items_variant_id
ON picking_session_items(variant_id)
WHERE variant_id IS NOT NULL;

-- ================================================================
-- PART 6: VERIFICATION
-- ================================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '================================================================';
    RAISE NOTICE '  MIGRATION 097 COMPLETE: Variant Order Integration';
    RAISE NOTICE '================================================================';
    RAISE NOTICE '';
    RAISE NOTICE 'COLUMNS ADDED:';
    RAISE NOTICE '  - order_line_items.units_per_pack (snapshot for audit)';
    RAISE NOTICE '  - picking_session_items.variant_id';
    RAISE NOTICE '';
    RAISE NOTICE 'FUNCTIONS UPDATED:';
    RAISE NOTICE '  - update_product_stock_on_order_status (handles shared_stock)';
    RAISE NOTICE '  - check_order_stock_availability (shows variant availability)';
    RAISE NOTICE '';
    RAISE NOTICE 'FUNCTIONS CREATED:';
    RAISE NOTICE '  - find_product_and_variant_by_shopify_ids';
    RAISE NOTICE '';
    RAISE NOTICE 'HOW IT WORKS:';
    RAISE NOTICE '  1. OrderForm selects product + variant';
    RAISE NOTICE '  2. order_line_items stores variant_id + units_per_pack';
    RAISE NOTICE '  3. When order -> ready_to_ship:';
    RAISE NOTICE '     - If variant.uses_shared_stock=true: calls deduct_shared_stock_for_variant';
    RAISE NOTICE '     - Otherwise: direct product stock update (existing behavior)';
    RAISE NOTICE '  4. When order cancelled/reverted: uses corresponding restore function';
    RAISE NOTICE '';
    RAISE NOTICE 'BACKWARD COMPATIBLE: Products without variants work unchanged';
    RAISE NOTICE '================================================================';
END $$;

COMMIT;
