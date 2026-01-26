-- ================================================================
-- Migration 110: Returns System Variant & Bundle Support
-- ================================================================
-- Created: 2026-01-25
-- Description: Adds variant awareness to the returns system so that
--              stock restoration correctly handles bundles and variations.
--
-- Problem: When returning a NOCTE "Pareja" bundle (2 units_per_pack),
--          the current system restores only 1 unit to product stock.
--          It should restore 2 physical units (quantity * units_per_pack).
--          Similarly, variations restore to parent stock instead of
--          the variant's own independent stock.
--
-- Solution:
--   1. Add variant_id, variant_type, units_per_pack to return_session_items
--   2. Update complete_return_session() to use restore_shared_stock_for_variant()
--      for items with variants, which correctly handles both bundle→parent
--      and variation→own stock restoration.
-- ================================================================

BEGIN;

-- ================================================================
-- STEP 1: Add variant columns to return_session_items
-- ================================================================

-- variant_id: Links to the specific variant being returned
ALTER TABLE return_session_items
ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL;

-- variant_type: 'bundle' or 'variation' (audit trail)
ALTER TABLE return_session_items
ADD COLUMN IF NOT EXISTS variant_type VARCHAR(20);

-- units_per_pack: How many physical units per pack (for bundles)
-- Default 1 for regular products and variations
ALTER TABLE return_session_items
ADD COLUMN IF NOT EXISTS units_per_pack INT DEFAULT 1;

-- Index for variant lookups
CREATE INDEX IF NOT EXISTS idx_return_session_items_variant
ON return_session_items(variant_id) WHERE variant_id IS NOT NULL;

-- ================================================================
-- STEP 2: Update complete_return_session() to handle variants
-- ================================================================
-- Key changes:
--   - For items WITH variant_id: use restore_shared_stock_for_variant()
--     which handles bundle→parent and variation→self correctly
--   - For items WITHOUT variant_id: keep original behavior (restore to product)
--   - Inventory movements now log variant info for audit trail
-- ================================================================

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
        -- ================================================================
        -- VARIANT-AWARE RESTORE: Use restore_shared_stock_for_variant()
        -- This handles:
        --   - Bundles: restores quantity * units_per_pack to PARENT product
        --   - Variations: restores quantity to VARIANT's own stock
        -- ================================================================
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
          -- Continue processing other items even if one fails
        END IF;
      ELSE
        -- ================================================================
        -- REGULAR PRODUCT RESTORE: Original behavior (no variant)
        -- Restores quantity_accepted directly to product stock
        -- ================================================================
        DECLARE
          v_stock_before INT;
          v_stock_after INT;
          v_store_id UUID;
        BEGIN
          -- Get current stock and store_id
          SELECT stock, store_id INTO v_stock_before, v_store_id
          FROM products
          WHERE id = v_item.product_id
          FOR UPDATE;

          v_stock_after := v_stock_before + v_item.quantity_accepted;

          UPDATE products
          SET stock = v_stock_after,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = v_item.product_id;

          -- Log inventory movement
          INSERT INTO inventory_movements (
            store_id,
            product_id,
            order_id,
            movement_type,
            quantity_change,
            stock_before,
            stock_after,
            notes,
            created_at
          ) VALUES (
            v_store_id,
            v_item.product_id,
            v_item.order_id,
            'return_accepted',
            v_item.quantity_accepted,
            v_stock_before,
            v_stock_after,
            'Return session: ' || v_session.session_code,
            CURRENT_TIMESTAMP
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
        -- Get store_id and current stock for logging
        SELECT stock, store_id INTO v_current_stock, v_store_id
        FROM products
        WHERE id = v_item.product_id;

        INSERT INTO inventory_movements (
          store_id,
          product_id,
          order_id,
          movement_type,
          quantity_change,
          stock_before,
          stock_after,
          notes,
          created_at
        ) VALUES (
          v_store_id,
          v_item.product_id,
          v_item.order_id,
          'return_rejected',
          0,  -- No stock change for rejected items
          v_current_stock,
          v_current_stock,
          'Rejected - ' || COALESCE(v_item.rejection_reason, 'unknown') || ': ' || COALESCE(v_item.rejection_notes, '')
            || CASE WHEN v_item.variant_id IS NOT NULL THEN ' [variant: ' || v_item.variant_id::TEXT || ']' ELSE '' END,
          CURRENT_TIMESTAMP
        );
      END;

      v_rejected_count := v_rejected_count + v_item.quantity_rejected;
    END IF;

    -- Mark item as processed
    UPDATE return_session_items
    SET processed_at = CURRENT_TIMESTAMP
    WHERE id = v_item.id;
  END LOOP;

  -- Update order statuses to 'returned'
  FOR v_order_id IN
    SELECT DISTINCT order_id
    FROM return_session_items
    WHERE session_id = p_session_id
  LOOP
    UPDATE orders
    SET sleeves_status = 'returned',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = v_order_id;

    -- Mark order as processed in session
    UPDATE return_session_orders
    SET processed = TRUE,
        processed_at = CURRENT_TIMESTAMP
    WHERE session_id = p_session_id AND order_id = v_order_id;
  END LOOP;

  -- Update session status
  UPDATE return_sessions
  SET status = 'completed',
      completed_at = CURRENT_TIMESTAMP,
      accepted_items = v_accepted_count,
      rejected_items = v_rejected_count,
      processed_orders = (
        SELECT COUNT(DISTINCT order_id)
        FROM return_session_items
        WHERE session_id = p_session_id
      )
  WHERE id = p_session_id;

  -- Return summary
  SELECT json_build_object(
    'session_id', p_session_id,
    'session_code', v_session.session_code,
    'orders_processed', (SELECT processed_orders FROM return_sessions WHERE id = p_session_id),
    'items_accepted', v_accepted_count,
    'items_rejected', v_rejected_count,
    'completed_at', CURRENT_TIMESTAMP
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- STEP 3: Backfill existing return_session_items with variant data
-- ================================================================
-- For any past return sessions, try to populate variant info from order_line_items

UPDATE return_session_items rsi
SET variant_id = oli.variant_id,
    variant_type = oli.variant_type,
    units_per_pack = COALESCE(oli.units_per_pack, 1)
FROM order_line_items oli
WHERE rsi.order_id = oli.order_id
  AND rsi.product_id = oli.product_id
  AND oli.variant_id IS NOT NULL
  AND rsi.variant_id IS NULL;

-- ================================================================
-- STEP 4: Monitoring view for return variant issues
-- ================================================================

CREATE OR REPLACE VIEW v_returns_variant_status AS
SELECT
  rs.id AS session_id,
  rs.session_code,
  rs.status AS session_status,
  rsi.id AS item_id,
  rsi.product_id,
  rsi.variant_id,
  rsi.variant_type,
  rsi.units_per_pack,
  rsi.quantity_expected,
  rsi.quantity_accepted,
  rsi.quantity_rejected,
  p.name AS product_name,
  pv.variant_title,
  pv.uses_shared_stock,
  CASE
    WHEN rsi.variant_id IS NULL THEN 'REGULAR'
    WHEN rsi.variant_type = 'bundle' THEN 'BUNDLE'
    WHEN rsi.variant_type = 'variation' THEN 'VARIATION'
    ELSE 'UNKNOWN'
  END AS stock_restore_mode,
  CASE
    WHEN rsi.variant_type = 'bundle' THEN rsi.quantity_accepted * COALESCE(rsi.units_per_pack, 1)
    ELSE rsi.quantity_accepted
  END AS physical_units_to_restore
FROM return_session_items rsi
JOIN return_sessions rs ON rs.id = rsi.session_id
JOIN products p ON p.id = rsi.product_id
LEFT JOIN product_variants pv ON pv.id = rsi.variant_id
ORDER BY rs.created_at DESC, rsi.order_id;

-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================

DO $$
BEGIN
  RAISE NOTICE '================================================================';
  RAISE NOTICE 'Migration 110 complete: Returns Variant & Bundle Support';
  RAISE NOTICE '================================================================';
  RAISE NOTICE '  Added columns to return_session_items:';
  RAISE NOTICE '    - variant_id UUID (nullable)';
  RAISE NOTICE '    - variant_type VARCHAR(20) (bundle/variation)';
  RAISE NOTICE '    - units_per_pack INT (default 1)';
  RAISE NOTICE '';
  RAISE NOTICE '  Updated complete_return_session():';
  RAISE NOTICE '    - Bundle returns: restores qty * units_per_pack to parent';
  RAISE NOTICE '    - Variation returns: restores to variant own stock';
  RAISE NOTICE '    - Regular returns: unchanged (1:1 to product)';
  RAISE NOTICE '';
  RAISE NOTICE '  Backfilled existing items from order_line_items';
  RAISE NOTICE '  Created view: v_returns_variant_status';
  RAISE NOTICE '================================================================';
  RAISE NOTICE '';
  RAISE NOTICE '  Example - Returning NOCTE "Pareja" (units_per_pack=2):';
  RAISE NOTICE '    BEFORE: Accept 1x Pareja → restores 1 unit (WRONG)';
  RAISE NOTICE '    AFTER:  Accept 1x Pareja → restores 2 units (CORRECT)';
  RAISE NOTICE '================================================================';
END $$;

COMMIT;
