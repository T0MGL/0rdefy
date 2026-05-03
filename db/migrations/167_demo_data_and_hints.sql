-- ============================================================================
-- Migration 167: Demo Data Flag + Onboarding Hints + Multi-Tenant Guard
-- ============================================================================
--
-- PURPOSE
--   Foundation for the onboarding rewrite (PR1). Adds an `is_demo` flag to
--   business tables so seed data created during onboarding never contaminates
--   real metrics, billing usage, SIFEN invoices, Shopify sync, or outbound
--   webhooks. Also adds the JSONB columns the new dynamic checklist needs
--   (`dismissed_hints`, `behavior_signals`) and a reusable multi-tenant guard
--   helper (`is_user_in_store`).
--
--   PR1 closes 4 product decisions made by Gaston:
--     1. Demo data does NOT count toward plan quotas (orders/products/users/
--        carriers).
--     2. Stock trigger uses Option B: demo orders DO decrement stock for the
--        seeded demo product, but the resulting `inventory_movements` row is
--        marked `is_demo = TRUE` so financial/audit queries can exclude it.
--     3. The onboarding checklist filters out `is_demo = TRUE` rows. Seeding
--        the demo store does NOT mark "first order" as completed; the user
--        still has to ship a real order.
--     4. PR1 estimate accepted (6-8 days). This migration is step 1 of N.
--
-- WHAT THIS MIGRATION DOES
--   1. Adds `is_demo BOOLEAN NOT NULL DEFAULT FALSE` to:
--        orders, products, customers, carriers, inbound_shipments,
--        inventory_movements, order_line_items.
--      Each gets a partial index `WHERE is_demo = FALSE` so the hot path
--      (real data) stays fast and indexable. Demo data is rare and always
--      filtered IN, never the bulk path.
--   2. Adds `dismissed_hints JSONB DEFAULT '[]'` and
--      `behavior_signals JSONB DEFAULT '{}'` to `onboarding_progress`.
--   3. Updates `get_store_usage(p_store_id UUID)` to exclude `is_demo = TRUE`
--      from order/product/user counts. Signature is preserved exactly so all
--      existing callers keep working without code changes.
--   4. Updates `update_product_stock_on_order_status` trigger function to
--      propagate `orders.is_demo` into the `inventory_movements.is_demo`
--      column when logging stock changes. Stock IS decremented either way
--      (demo product needs realistic depletion), but audit/finance queries
--      can filter the demo movements out.
--   5. Adds `BEFORE INSERT` trigger on `order_line_items` to propagate
--      `orders.is_demo` into the line item row, so iterators inside the
--      stock trigger don't need a JOIN per line.
--   6. Creates `is_user_in_store(p_user_id UUID, p_store_id UUID)` returning
--      BOOLEAN. Used by upcoming guards in service entry points
--      (SIFEN invoicing, Shopify sync, outbound webhooks).
--
-- SAFETY
--   - Idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`).
--   - Wrapped in a single transaction.
--   - All new columns ship with safe defaults (FALSE / '[]' / '{}'), so
--     existing rows remain valid without backfill.
--   - Stock trigger preserves all prior behavior from migrations 098 and
--     107 (handles ready_to_ship/shipped/in_transit/delivered, SKU fallback,
--     shared-stock variants, restore on cancel/revert). Only the
--     `inventory_movements.is_demo` column write is added.
--
-- ROLLBACK
--   See bottom of file. Drop new columns + functions; the trigger function
--   reverts cleanly because it's CREATE OR REPLACE.
--
-- Author: ORDEFY CEO (PR1 onboarding rewrite, step 1)
-- Date: 2026-04-30
-- ============================================================================

BEGIN;

DO $$
BEGIN
  RAISE NOTICE '============================================================';
  RAISE NOTICE ' Migration 167: Demo data flag + onboarding hints + guard';
  RAISE NOTICE '============================================================';
END $$;

-- ============================================================================
-- STEP 1: Add is_demo column + partial index to all affected tables
-- ============================================================================

-- orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_orders_real_only
  ON orders (store_id, created_at DESC)
  WHERE is_demo = FALSE;
COMMENT ON COLUMN orders.is_demo IS
  'TRUE for orders seeded during onboarding demo. Excluded from plan usage, '
  'analytics, SIFEN invoicing, Shopify sync, outbound webhooks, settlements, '
  'and the onboarding checklist''s "first real order" milestone.';

-- products
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_products_real_only
  ON products (store_id, created_at DESC)
  WHERE is_demo = FALSE AND is_active = TRUE;
COMMENT ON COLUMN products.is_demo IS
  'TRUE for products seeded during onboarding demo. Excluded from plan '
  'usage, Shopify bidirectional sync, and product listings shown as "real".';

-- customers
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_customers_real_only
  ON customers (store_id, created_at DESC)
  WHERE is_demo = FALSE;
COMMENT ON COLUMN customers.is_demo IS
  'TRUE for customers seeded during onboarding demo. Excluded from CRM '
  'metrics, Shopify customer sync, and outbound webhook recipient lists.';

-- carriers
ALTER TABLE carriers
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_carriers_real_only
  ON carriers (store_id)
  WHERE is_demo = FALSE;
COMMENT ON COLUMN carriers.is_demo IS
  'TRUE for the seeded "Demo Carrier" used during onboarding. Excluded '
  'from settlement reconciliation and dispatch session real metrics.';

-- inbound_shipments
ALTER TABLE inbound_shipments
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_inbound_shipments_real_only
  ON inbound_shipments (store_id, created_at DESC)
  WHERE is_demo = FALSE;
COMMENT ON COLUMN inbound_shipments.is_demo IS
  'TRUE for the seeded inbound shipment that stocks the demo product. '
  'Excluded from supplier reports and merchandise audit.';

-- inventory_movements
ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_inventory_movements_real_only
  ON inventory_movements (store_id, created_at DESC)
  WHERE is_demo = FALSE;
COMMENT ON COLUMN inventory_movements.is_demo IS
  'TRUE when this movement was generated by a demo order. Stock was actually '
  'decremented (Option B), but real audit/finance reports must filter these '
  'out to avoid attributing demo activity to real warehouse operations.';

-- order_line_items
-- (denormalized from orders.is_demo; populated by trigger below so the
-- stock trigger does not need a JOIN per line item iteration)
ALTER TABLE order_line_items
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_order_line_items_real_only
  ON order_line_items (order_id)
  WHERE is_demo = FALSE;
COMMENT ON COLUMN order_line_items.is_demo IS
  'Denormalized from orders.is_demo. Set automatically by trigger '
  'trigger_propagate_is_demo_to_line_items on INSERT. Used by the stock '
  'trigger to tag inventory_movements.is_demo without JOINing back to orders '
  'on each iteration.';

-- ============================================================================
-- STEP 2: Trigger to propagate orders.is_demo into order_line_items.is_demo
-- ============================================================================
-- Fires BEFORE INSERT so the row goes in already tagged. Cheap (single
-- indexed lookup on orders.id PK). UPDATEs to orders.is_demo are not
-- expected (a demo order never becomes real), so we don't sync on UPDATE.

CREATE OR REPLACE FUNCTION propagate_is_demo_to_line_items()
RETURNS TRIGGER AS $$
DECLARE
  v_order_is_demo BOOLEAN;
BEGIN
  -- Only override if the inserter didn't already set is_demo explicitly
  IF NEW.is_demo IS NULL OR NEW.is_demo = FALSE THEN
    SELECT is_demo INTO v_order_is_demo
    FROM orders
    WHERE id = NEW.order_id;

    NEW.is_demo := COALESCE(v_order_is_demo, FALSE);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_propagate_is_demo_to_line_items ON order_line_items;
CREATE TRIGGER trigger_propagate_is_demo_to_line_items
  BEFORE INSERT ON order_line_items
  FOR EACH ROW
  EXECUTE FUNCTION propagate_is_demo_to_line_items();

COMMENT ON FUNCTION propagate_is_demo_to_line_items() IS
  'BEFORE INSERT trigger. Copies orders.is_demo into the new line item row '
  'so downstream iterators (stock trigger, shipping logic) can read the flag '
  'without a JOIN. Will not override an explicit TRUE set by the caller.';

-- ============================================================================
-- STEP 3: Add dismissed_hints and behavior_signals to onboarding_progress
-- ============================================================================

ALTER TABLE onboarding_progress
  ADD COLUMN IF NOT EXISTS dismissed_hints JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE onboarding_progress
  ADD COLUMN IF NOT EXISTS behavior_signals JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN onboarding_progress.dismissed_hints IS
  'JSONB array of hint IDs the user dismissed (X button). Schema: '
  '["hint-id-1", "hint-id-2", ...]. Hints in this list are never shown again '
  'for this user/store. Used by the dynamic checklist replacing the static '
  'OnboardingChecklist component.';
COMMENT ON COLUMN onboarding_progress.behavior_signals IS
  'JSONB object of behavior signals the dynamic checklist uses to surface '
  'context-aware hints. Schema example: '
  '{"viewed_orders_empty_state": 3, "first_login_at": "2026-04-30T10:00:00Z", '
  '"opened_shopify_modal_without_connecting": 1, ...}. Keys are signal IDs, '
  'values are counters or timestamps. Updated incrementally by frontend '
  'POST /api/onboarding/signal.';

-- ============================================================================
-- STEP 4: Update get_store_usage to exclude is_demo=TRUE
-- ============================================================================
-- Signature preserved exactly (input p_store_id UUID, output 7 columns).
-- All existing callers keep working without code changes. The change is
-- additive: filters added to the JOINs that count usage.

CREATE OR REPLACE FUNCTION get_store_usage(p_store_id UUID)
RETURNS TABLE(
  current_plan subscription_plan_type,
  max_orders_per_month INTEGER,
  max_products INTEGER,
  max_users INTEGER,
  total_orders_this_month INTEGER,
  total_products INTEGER,
  total_users INTEGER
) AS $$
DECLARE
  v_owner_id UUID;
  v_current_plan subscription_plan_type;
BEGIN
  -- Step 1: Get store owner (unchanged from migration 056)
  SELECT user_id INTO v_owner_id
  FROM user_stores
  WHERE store_id = p_store_id
    AND role = 'owner'
    AND is_active = true
  LIMIT 1;

  IF v_owner_id IS NULL THEN
    v_current_plan := 'free';
  ELSE
    -- Step 2: Get owner's subscription plan (unchanged from migration 056)
    SELECT COALESCE(s.plan, 'free'::subscription_plan_type) INTO v_current_plan
    FROM subscriptions s
    WHERE s.user_id = v_owner_id
      AND s.is_primary = true
    LIMIT 1;

    IF v_current_plan IS NULL THEN
      v_current_plan := 'free';
    END IF;
  END IF;

  -- Step 3: Return usage with plan limits, EXCLUDING demo data from counts
  RETURN QUERY
  WITH limits AS (
    SELECT
      pl.max_orders_per_month,
      pl.max_products,
      pl.max_users
    FROM plan_limits pl
    WHERE pl.plan = v_current_plan
  ),
  usage AS (
    SELECT
      COUNT(DISTINCT o.id) FILTER (
        WHERE o.created_at >= date_trunc('month', CURRENT_DATE)
          AND o.is_demo = FALSE                     -- DEMO EXCLUSION
      ) as orders_count,
      COUNT(DISTINCT p.id) FILTER (
        WHERE p.is_demo = FALSE                     -- DEMO EXCLUSION
      ) as products_count,
      COUNT(DISTINCT us.user_id) as users_count
    FROM stores s
    LEFT JOIN orders o ON o.store_id = s.id
    LEFT JOIN products p ON p.store_id = s.id
      AND (p.is_active = TRUE)
    LEFT JOIN user_stores us ON us.store_id = s.id AND us.is_active = true
    WHERE s.id = p_store_id
  )
  SELECT
    v_current_plan,
    l.max_orders_per_month,
    l.max_products,
    l.max_users,
    COALESCE(u.orders_count::INTEGER, 0),
    COALESCE(u.products_count::INTEGER, 0),
    COALESCE(u.users_count::INTEGER, 0)
  FROM limits l, usage u;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_store_usage(UUID) IS
  'Returns current plan limits and usage counts for a store. Updated in '
  'migration 167 to exclude is_demo=TRUE rows from orders and products '
  'counts (decision 1: demo data never consumes plan quota). Signature '
  'unchanged from migration 056.';

-- ============================================================================
-- STEP 5: Update stock trigger to propagate is_demo into inventory_movements
-- ============================================================================
-- This is Option B: demo orders DO decrement stock (so the demo product runs
-- out realistically), but the resulting inventory_movements row is tagged
-- is_demo=TRUE for audit/finance filtering.
--
-- The function body is copied verbatim from migration 107 (the current
-- production version that handles delivered status, units_per_pack, SKU
-- fallback, shared-stock variants, and the contacted revert path), with the
-- ONLY change being the addition of `is_demo` to all 3 INSERT INTO
-- inventory_movements statements (CASE 1 decrement, CASE 2 cancel, CASE 3
-- revert) plus reading NEW.is_demo into a local variable.

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
    v_is_demo BOOLEAN;                    -- ADDED in migration 167
BEGIN
    -- Only process if sleeves_status actually changed
    IF (TG_OP = 'UPDATE' AND OLD.sleeves_status IS NOT DISTINCT FROM NEW.sleeves_status) THEN
        RETURN NEW;
    END IF;

    -- ADDED in migration 167: capture is_demo for inventory_movements tagging
    v_is_demo := COALESCE(NEW.is_demo, FALSE);

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

            -- VARIANT HANDLING: Shared stock bundles
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

            -- NORMAL PRODUCT HANDLING
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

            -- MIGRATION 166: tag movement with is_demo from order
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

            -- MIGRATION 166: tag movement with is_demo from order
            INSERT INTO inventory_movements (
                store_id, product_id, variant_id, order_id,
                quantity_change, stock_before, stock_after,
                movement_type, order_status_from, order_status_to, notes,
                is_demo
            ) VALUES (
                NEW.store_id, v_product_uuid, v_variant_uuid, NEW.id,
                v_item_quantity, v_stock_before, v_stock_after,
                'order_cancelled', OLD.sleeves_status, NEW.sleeves_status,
                format('Stock restored on %s: %s x %s', NEW.sleeves_status, v_item_quantity, v_product_name),
                v_is_demo
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

            -- MIGRATION 166: tag movement with is_demo from order
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
  'UPDATED in migration 167 (Option B for demo orders): now propagates '
  'orders.is_demo into inventory_movements.is_demo for every stock change '
  '(decrement, cancel, revert). Demo orders DO decrement stock so the seeded '
  'demo product runs out realistically; the is_demo tag lets finance/audit '
  'queries exclude these movements. All other behavior unchanged from '
  'migration 107 (handles ready_to_ship/shipped/in_transit/delivered, SKU '
  'fallback, shared-stock variants, contacted revert, units_per_pack).';

-- Trigger reference unchanged; recreate idempotently
DROP TRIGGER IF EXISTS trigger_update_stock_on_order_status ON orders;
CREATE TRIGGER trigger_update_stock_on_order_status
    AFTER INSERT OR UPDATE OF sleeves_status
    ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_product_stock_on_order_status();

-- ============================================================================
-- STEP 6: Multi-tenant guard helper
-- ============================================================================
-- Used by upcoming PR1 service-entry-point guards (SIFEN invoicing,
-- Shopify sync, outbound webhooks). Returns TRUE iff p_user_id has an
-- active row in user_stores for p_store_id.

CREATE OR REPLACE FUNCTION is_user_in_store(
  p_user_id UUID,
  p_store_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
  IF p_user_id IS NULL OR p_store_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM user_stores
    WHERE user_id = p_user_id
      AND store_id = p_store_id
      AND is_active = TRUE
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION is_user_in_store(UUID, UUID) IS
  'Multi-tenant guard. Returns TRUE iff the user has an active membership '
  'in the given store. Used by service-entry-point guards (SIFEN invoicing, '
  'Shopify sync, outbound webhooks) to defend against cross-store data '
  'leakage even when the calling code forgot the WHERE clause. STABLE so it '
  'caches within a single statement.';

GRANT EXECUTE ON FUNCTION is_user_in_store(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION is_user_in_store(UUID, UUID) TO service_role;

-- ============================================================================
-- STEP 7: Verification
-- ============================================================================

DO $$
DECLARE
  v_orders_has_is_demo BOOLEAN;
  v_movements_has_is_demo BOOLEAN;
  v_onboarding_has_hints BOOLEAN;
  v_get_store_usage_filters_demo BOOLEAN;
  v_stock_trigger_writes_is_demo BOOLEAN;
  v_guard_function_exists BOOLEAN;
  v_propagate_trigger_exists BOOLEAN;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================';
  RAISE NOTICE '  MIGRATION 166 - VERIFICATION';
  RAISE NOTICE '============================================';

  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'is_demo'
  ) INTO v_orders_has_is_demo;

  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_movements' AND column_name = 'is_demo'
  ) INTO v_movements_has_is_demo;

  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'onboarding_progress' AND column_name = 'dismissed_hints'
  ) INTO v_onboarding_has_hints;

  SELECT prosrc LIKE '%is_demo = FALSE%'
  INTO v_get_store_usage_filters_demo
  FROM pg_proc
  WHERE proname = 'get_store_usage' AND pronargs = 1;

  SELECT prosrc LIKE '%v_is_demo%'
  INTO v_stock_trigger_writes_is_demo
  FROM pg_proc
  WHERE proname = 'update_product_stock_on_order_status';

  SELECT EXISTS(
    SELECT 1 FROM pg_proc WHERE proname = 'is_user_in_store' AND pronargs = 2
  ) INTO v_guard_function_exists;

  SELECT EXISTS(
    SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_propagate_is_demo_to_line_items'
  ) INTO v_propagate_trigger_exists;

  IF v_orders_has_is_demo THEN
    RAISE NOTICE 'OK: orders.is_demo column exists';
  ELSE
    RAISE EXCEPTION 'FAIL: orders.is_demo column missing';
  END IF;

  IF v_movements_has_is_demo THEN
    RAISE NOTICE 'OK: inventory_movements.is_demo column exists';
  ELSE
    RAISE EXCEPTION 'FAIL: inventory_movements.is_demo column missing';
  END IF;

  IF v_onboarding_has_hints THEN
    RAISE NOTICE 'OK: onboarding_progress.dismissed_hints column exists';
  ELSE
    RAISE EXCEPTION 'FAIL: onboarding_progress.dismissed_hints column missing';
  END IF;

  IF v_get_store_usage_filters_demo THEN
    RAISE NOTICE 'OK: get_store_usage filters is_demo';
  ELSE
    RAISE EXCEPTION 'FAIL: get_store_usage does not filter is_demo';
  END IF;

  IF v_stock_trigger_writes_is_demo THEN
    RAISE NOTICE 'OK: stock trigger captures is_demo';
  ELSE
    RAISE EXCEPTION 'FAIL: stock trigger does not capture is_demo';
  END IF;

  IF v_guard_function_exists THEN
    RAISE NOTICE 'OK: is_user_in_store(UUID, UUID) created';
  ELSE
    RAISE EXCEPTION 'FAIL: is_user_in_store function missing';
  END IF;

  IF v_propagate_trigger_exists THEN
    RAISE NOTICE 'OK: trigger_propagate_is_demo_to_line_items created';
  ELSE
    RAISE EXCEPTION 'FAIL: line item is_demo propagation trigger missing';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE 'NEXT STEP (PR1 second phase):';
  RAISE NOTICE '  Filter is_demo IS NOT TRUE in 398 read queries across api/.';
  RAISE NOTICE '  Recommended start: api/routes/orders.ts (75 queries).';
  RAISE NOTICE '============================================';
END $$;

COMMIT;

-- ============================================================================
-- ROLLBACK INSTRUCTIONS
-- ============================================================================
--
-- BEGIN;
--
-- -- Drop new functions / triggers
-- DROP TRIGGER IF EXISTS trigger_propagate_is_demo_to_line_items ON order_line_items;
-- DROP FUNCTION IF EXISTS propagate_is_demo_to_line_items();
-- DROP FUNCTION IF EXISTS is_user_in_store(UUID, UUID);
--
-- -- Restore previous get_store_usage (re-run migration 056)
-- -- Restore previous stock trigger (re-run migration 107)
--
-- -- Drop new columns (only if no demo data has been seeded)
-- ALTER TABLE orders DROP COLUMN IF EXISTS is_demo;
-- ALTER TABLE products DROP COLUMN IF EXISTS is_demo;
-- ALTER TABLE customers DROP COLUMN IF EXISTS is_demo;
-- ALTER TABLE carriers DROP COLUMN IF EXISTS is_demo;
-- ALTER TABLE inbound_shipments DROP COLUMN IF EXISTS is_demo;
-- ALTER TABLE inventory_movements DROP COLUMN IF EXISTS is_demo;
-- ALTER TABLE order_line_items DROP COLUMN IF EXISTS is_demo;
-- ALTER TABLE onboarding_progress DROP COLUMN IF EXISTS dismissed_hints;
-- ALTER TABLE onboarding_progress DROP COLUMN IF EXISTS behavior_signals;
--
-- -- Drop indexes (auto-dropped with columns, but listed for clarity)
-- DROP INDEX IF EXISTS idx_orders_real_only;
-- DROP INDEX IF EXISTS idx_products_real_only;
-- DROP INDEX IF EXISTS idx_customers_real_only;
-- DROP INDEX IF EXISTS idx_carriers_real_only;
-- DROP INDEX IF EXISTS idx_inbound_shipments_real_only;
-- DROP INDEX IF EXISTS idx_inventory_movements_real_only;
-- DROP INDEX IF EXISTS idx_order_line_items_real_only;
--
-- COMMIT;
--
-- ============================================================================
