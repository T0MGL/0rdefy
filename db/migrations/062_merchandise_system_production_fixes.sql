-- ================================================================
-- MERCHANDISE SYSTEM PRODUCTION FIXES
-- ================================================================
-- Migration: 062_merchandise_system_production_fixes.sql
-- Author: Bright Idea
-- Date: 2026-01-13
--
-- Fixes identified issues:
-- 1. Race condition in generate_inbound_reference (atomic with retry)
-- 2. receive_shipment_items overwrites instead of accumulating (delta calculation)
-- 3. No inventory_movements for manual receptions (audit trail)
-- 4. Duplicate Shopify import shipments (prevention)
-- 5. Product inline creation without uniqueness check
-- ================================================================

-- ================================================================
-- FIX 1: Atomic reference generation with advisory lock
-- ================================================================
-- Replaces the race-condition-prone COUNT(*) + 1 approach

CREATE OR REPLACE FUNCTION generate_inbound_reference(p_store_id UUID)
RETURNS VARCHAR(50) AS $$
DECLARE
  v_date_part VARCHAR(8);
  v_sequence INTEGER;
  v_reference VARCHAR(50);
  v_lock_key BIGINT;
  v_max_attempts INTEGER := 5;
  v_attempt INTEGER := 0;
BEGIN
  -- Get date part: YYYYMMDD
  v_date_part := TO_CHAR(NOW(), 'YYYYMMDD');

  -- Generate a lock key based on store_id and date
  -- This ensures only one process per store per day can generate references
  v_lock_key := ('x' || substr(md5(p_store_id::text || v_date_part), 1, 15))::bit(60)::bigint;

  -- Acquire advisory lock for this store+date combination
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Get the maximum sequence for today (handles gaps from deletions)
  SELECT COALESCE(
    MAX(
      CASE
        WHEN internal_reference ~ '^ISH-[0-9]{8}-[0-9]{3}$'
        THEN SUBSTRING(internal_reference FROM 14 FOR 3)::INTEGER
        ELSE 0
      END
    ), 0
  ) + 1 INTO v_sequence
  FROM inbound_shipments
  WHERE store_id = p_store_id
    AND internal_reference LIKE 'ISH-' || v_date_part || '-%';

  -- Cap at 999 per day (3 digits)
  IF v_sequence > 999 THEN
    RAISE EXCEPTION 'Maximum daily shipments (999) exceeded for store % on %', p_store_id, v_date_part;
  END IF;

  -- Format: ISH-20260113-001
  v_reference := 'ISH-' || v_date_part || '-' || LPAD(v_sequence::TEXT, 3, '0');

  RETURN v_reference;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_inbound_reference(UUID) IS
'Generates unique inbound shipment reference with advisory lock to prevent race conditions. Format: ISH-YYYYMMDD-NNN';


-- ================================================================
-- FIX 2 & 3: Improved receive_shipment_items with delta calculation
-- and inventory_movements audit trail
-- ================================================================

CREATE OR REPLACE FUNCTION receive_shipment_items(
  p_shipment_id UUID,
  p_items JSONB, -- Array of {item_id, qty_received, qty_rejected, discrepancy_notes}
  p_received_by UUID
)
RETURNS JSONB AS $$
DECLARE
  v_item JSONB;
  v_item_id UUID;
  v_product_id UUID;
  v_store_id UUID;
  v_new_qty_received INTEGER;
  v_new_qty_rejected INTEGER;
  v_old_qty_received INTEGER;
  v_old_qty_rejected INTEGER;
  v_qty_ordered INTEGER;
  v_delta_received INTEGER;
  v_stock_before INTEGER;
  v_stock_after INTEGER;
  v_all_complete BOOLEAN := TRUE;
  v_any_received BOOLEAN := FALSE;
  v_updated_count INTEGER := 0;
  v_movements_created INTEGER := 0;
BEGIN
  -- Get store_id from shipment
  SELECT store_id INTO v_store_id
  FROM inbound_shipments
  WHERE id = p_shipment_id;

  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'Shipment % not found', p_shipment_id;
  END IF;

  -- Loop through each item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id := (v_item->>'item_id')::UUID;
    v_new_qty_received := COALESCE((v_item->>'qty_received')::INTEGER, 0);
    v_new_qty_rejected := COALESCE((v_item->>'qty_rejected')::INTEGER, 0);

    -- Get current item state with row lock
    SELECT
      product_id,
      qty_ordered,
      COALESCE(qty_received, 0),
      COALESCE(qty_rejected, 0)
    INTO v_product_id, v_qty_ordered, v_old_qty_received, v_old_qty_rejected
    FROM inbound_shipment_items
    WHERE id = v_item_id
    FOR UPDATE;

    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'Shipment item % not found', v_item_id;
    END IF;

    -- Calculate what's being added (delta), not total
    -- If user sends qty_received=5 and we already had qty_received=3,
    -- the delta is 5-3=2 (only add 2 more to stock)
    v_delta_received := v_new_qty_received - v_old_qty_received;

    -- Validate totals don't exceed ordered
    IF (v_new_qty_received + v_new_qty_rejected) > v_qty_ordered THEN
      RAISE EXCEPTION 'Total received (%) + rejected (%) exceeds ordered (%) for item %',
        v_new_qty_received, v_new_qty_rejected, v_qty_ordered, v_item_id;
    END IF;

    -- Update the shipment item with new totals
    UPDATE inbound_shipment_items
    SET
      qty_received = v_new_qty_received,
      qty_rejected = v_new_qty_rejected,
      discrepancy_notes = COALESCE(v_item->>'discrepancy_notes', discrepancy_notes),
      updated_at = NOW()
    WHERE id = v_item_id;

    -- Update product inventory ONLY for the delta
    IF v_delta_received != 0 THEN
      -- Get current stock with row lock to prevent concurrent updates
      SELECT stock INTO v_stock_before
      FROM products
      WHERE id = v_product_id AND store_id = v_store_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Product % not found in store %', v_product_id, v_store_id;
      END IF;

      -- Calculate new stock (allow negative delta for corrections)
      v_stock_after := GREATEST(0, v_stock_before + v_delta_received);

      -- Update product stock
      UPDATE products
      SET
        stock = v_stock_after,
        updated_at = NOW()
      WHERE id = v_product_id
        AND store_id = v_store_id;

      -- Create inventory movement record for audit trail
      INSERT INTO inventory_movements (
        store_id,
        product_id,
        order_id,
        quantity_change,
        stock_before,
        stock_after,
        movement_type,
        order_status_from,
        order_status_to,
        notes
      ) VALUES (
        v_store_id,
        v_product_id,
        NULL, -- No order_id for inbound receipts
        v_delta_received,
        v_stock_before,
        v_stock_after,
        CASE
          WHEN v_delta_received > 0 THEN 'inbound_receipt'
          ELSE 'inbound_correction'
        END,
        NULL,
        NULL,
        'Recepción de mercadería: ' ||
        CASE
          WHEN v_delta_received > 0 THEN '+' || v_delta_received
          ELSE v_delta_received::TEXT
        END ||
        ' unidades (Shipment: ' || p_shipment_id || ')'
      );

      v_movements_created := v_movements_created + 1;
      v_any_received := TRUE;
    END IF;

    -- Check if this item is complete
    IF v_new_qty_received + v_new_qty_rejected < v_qty_ordered THEN
      v_all_complete := FALSE;
    END IF;

    v_updated_count := v_updated_count + 1;
  END LOOP;

  -- Update shipment status
  UPDATE inbound_shipments
  SET
    status = CASE
      WHEN v_all_complete THEN 'received'
      WHEN v_any_received OR EXISTS (
        SELECT 1 FROM inbound_shipment_items
        WHERE shipment_id = p_shipment_id
        AND COALESCE(qty_received, 0) > 0
      ) THEN 'partial'
      ELSE 'pending'
    END,
    received_date = CASE
      WHEN v_any_received OR received_date IS NOT NULL THEN COALESCE(received_date, NOW())
      ELSE received_date
    END,
    received_by = CASE
      WHEN v_any_received THEN p_received_by
      ELSE received_by
    END,
    updated_at = NOW()
  WHERE id = p_shipment_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'items_updated', v_updated_count,
    'inventory_movements_created', v_movements_created,
    'status', CASE
      WHEN v_all_complete THEN 'received'
      WHEN v_any_received THEN 'partial'
      ELSE 'pending'
    END
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION receive_shipment_items(UUID, JSONB, UUID) IS
'Receives shipment items with delta-based stock updates and audit trail.
- Calculates delta between old and new qty_received to prevent double-counting
- Creates inventory_movements records for complete audit trail
- Uses row-level locks to prevent race conditions
- Supports partial receptions and corrections';


-- ================================================================
-- FIX 4: Helper function to check for duplicate Shopify imports
-- ================================================================

CREATE OR REPLACE FUNCTION check_shopify_import_duplicate(
  p_store_id UUID,
  p_tracking_prefix TEXT DEFAULT 'SHOPIFY-IMPORT-'
)
RETURNS TABLE (
  has_duplicate BOOLEAN,
  existing_shipment_id UUID,
  existing_reference VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    TRUE as has_duplicate,
    s.id as existing_shipment_id,
    s.internal_reference as existing_reference,
    s.created_at
  FROM inbound_shipments s
  WHERE s.store_id = p_store_id
    AND s.tracking_code LIKE p_tracking_prefix || '%'
    AND DATE(s.created_at) = CURRENT_DATE
  ORDER BY s.created_at DESC
  LIMIT 1;

  -- If no rows returned, return a "no duplicate" row
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::VARCHAR(50), NULL::TIMESTAMP WITH TIME ZONE;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_shopify_import_duplicate(UUID, TEXT) IS
'Checks if a Shopify import shipment was already created today to prevent duplicates';


-- ================================================================
-- FIX 5: Function to check product uniqueness before creation
-- ================================================================

CREATE OR REPLACE FUNCTION check_product_exists(
  p_store_id UUID,
  p_name TEXT,
  p_sku TEXT DEFAULT NULL
)
RETURNS TABLE (
  exists_by_name BOOLEAN,
  exists_by_sku BOOLEAN,
  existing_product_id UUID,
  existing_product_name VARCHAR(255),
  match_type TEXT
) AS $$
BEGIN
  -- First check by SKU if provided (most specific match)
  IF p_sku IS NOT NULL AND p_sku != '' THEN
    RETURN QUERY
    SELECT
      FALSE as exists_by_name,
      TRUE as exists_by_sku,
      p.id as existing_product_id,
      p.name as existing_product_name,
      'sku' as match_type
    FROM products p
    WHERE p.store_id = p_store_id
      AND p.sku = p_sku
    LIMIT 1;

    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  -- Check by exact name match (case-insensitive)
  RETURN QUERY
  SELECT
    TRUE as exists_by_name,
    FALSE as exists_by_sku,
    p.id as existing_product_id,
    p.name as existing_product_name,
    'name' as match_type
  FROM products p
  WHERE p.store_id = p_store_id
    AND LOWER(TRIM(p.name)) = LOWER(TRIM(p_name))
  LIMIT 1;

  -- If no match found, return empty result
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::VARCHAR(255), NULL::TEXT;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_product_exists(UUID, TEXT, TEXT) IS
'Checks if a product already exists by name or SKU before creating a new one';


-- ================================================================
-- Add reference_type and reference_id columns to inventory_movements
-- if they don't exist (for linking to inbound_shipments)
-- ================================================================

DO $$
BEGIN
  -- Add reference_type column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_movements'
    AND column_name = 'reference_type'
  ) THEN
    ALTER TABLE inventory_movements
    ADD COLUMN reference_type VARCHAR(50);

    COMMENT ON COLUMN inventory_movements.reference_type IS
    'Type of reference: order, inbound_shipment, return_session, manual_adjustment';
  END IF;

  -- Add reference_id column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_movements'
    AND column_name = 'reference_id'
  ) THEN
    ALTER TABLE inventory_movements
    ADD COLUMN reference_id UUID;

    COMMENT ON COLUMN inventory_movements.reference_id IS
    'UUID of the referenced entity (shipment, return, etc.)';
  END IF;

  -- Add created_by column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_movements'
    AND column_name = 'created_by'
  ) THEN
    ALTER TABLE inventory_movements
    ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE SET NULL;

    COMMENT ON COLUMN inventory_movements.created_by IS
    'User who created this inventory movement';
  END IF;
END $$;

-- Add indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_inventory_movements_reference
ON inventory_movements(reference_type, reference_id);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_type
ON inventory_movements(movement_type);


-- ================================================================
-- VIEW: Shipment items with reception history
-- ================================================================

CREATE OR REPLACE VIEW v_inbound_items_with_history AS
SELECT
  i.id as item_id,
  i.shipment_id,
  s.internal_reference as shipment_reference,
  s.status as shipment_status,
  i.product_id,
  p.name as product_name,
  p.sku as product_sku,
  p.stock as current_stock,
  i.qty_ordered,
  i.qty_received,
  i.qty_rejected,
  i.qty_ordered - COALESCE(i.qty_received, 0) - COALESCE(i.qty_rejected, 0) as qty_pending,
  i.unit_cost,
  i.total_cost,
  i.has_discrepancy,
  i.discrepancy_notes,
  i.created_at,
  i.updated_at,
  -- Latest inventory movement for this item
  (
    SELECT m.created_at
    FROM inventory_movements m
    WHERE m.product_id = i.product_id
      AND m.notes LIKE '%' || s.id::TEXT || '%'
    ORDER BY m.created_at DESC
    LIMIT 1
  ) as last_movement_at
FROM inbound_shipment_items i
JOIN inbound_shipments s ON i.shipment_id = s.id
JOIN products p ON i.product_id = p.id;

COMMENT ON VIEW v_inbound_items_with_history IS
'Inbound shipment items with current stock and reception history';


-- ================================================================
-- VIEW: Potential stock discrepancies
-- ================================================================

CREATE OR REPLACE VIEW v_merchandise_stock_discrepancies AS
SELECT
  p.id as product_id,
  p.name as product_name,
  p.sku,
  p.stock as current_stock,
  p.store_id,
  COALESCE(received.total_received, 0) as total_from_shipments,
  COALESCE(orders_out.total_shipped, 0) as total_shipped_orders,
  COALESCE(returns_in.total_returned, 0) as total_returned,
  -- Expected stock = received - shipped + returned
  COALESCE(received.total_received, 0) - COALESCE(orders_out.total_shipped, 0) + COALESCE(returns_in.total_returned, 0) as expected_stock,
  -- Discrepancy = current - expected
  p.stock - (COALESCE(received.total_received, 0) - COALESCE(orders_out.total_shipped, 0) + COALESCE(returns_in.total_returned, 0)) as discrepancy
FROM products p
LEFT JOIN (
  -- Total received from inbound shipments
  SELECT
    i.product_id,
    SUM(COALESCE(i.qty_received, 0)) as total_received
  FROM inbound_shipment_items i
  JOIN inbound_shipments s ON i.shipment_id = s.id
  WHERE s.status IN ('partial', 'received')
  GROUP BY i.product_id
) received ON p.id = received.product_id
LEFT JOIN (
  -- Total shipped in orders (from inventory_movements)
  SELECT
    m.product_id,
    SUM(ABS(m.quantity_change)) as total_shipped
  FROM inventory_movements m
  WHERE m.movement_type = 'order_ready'
    AND m.quantity_change < 0
  GROUP BY m.product_id
) orders_out ON p.id = orders_out.product_id
LEFT JOIN (
  -- Total returned
  SELECT
    m.product_id,
    SUM(m.quantity_change) as total_returned
  FROM inventory_movements m
  WHERE m.movement_type IN ('return_accepted', 'order_cancelled', 'order_reverted')
    AND m.quantity_change > 0
  GROUP BY m.product_id
) returns_in ON p.id = returns_in.product_id
WHERE (
    p.stock - (COALESCE(received.total_received, 0) - COALESCE(orders_out.total_shipped, 0) + COALESCE(returns_in.total_returned, 0))
  ) != 0;

COMMENT ON VIEW v_merchandise_stock_discrepancies IS
'Products with stock discrepancies between current stock and expected based on movements';


-- ================================================================
-- VIEW: Stuck shipments (pending too long)
-- ================================================================

CREATE OR REPLACE VIEW v_stuck_inbound_shipments AS
SELECT
  s.id,
  s.store_id,
  s.internal_reference,
  s.status,
  s.created_at,
  s.estimated_arrival_date,
  NOW() - s.created_at as age,
  EXTRACT(EPOCH FROM (NOW() - s.created_at)) / 86400 as days_old,
  COUNT(i.id) as item_count,
  SUM(i.qty_ordered) as total_qty_ordered,
  SUM(COALESCE(i.qty_received, 0)) as total_qty_received,
  sup.name as supplier_name,
  CASE
    WHEN EXTRACT(EPOCH FROM (NOW() - s.created_at)) / 86400 > 30 THEN 'CRITICAL'
    WHEN EXTRACT(EPOCH FROM (NOW() - s.created_at)) / 86400 > 14 THEN 'WARNING'
    ELSE 'NORMAL'
  END as urgency
FROM inbound_shipments s
LEFT JOIN inbound_shipment_items i ON s.id = i.shipment_id
LEFT JOIN suppliers sup ON s.supplier_id = sup.id
WHERE s.status = 'pending'
GROUP BY s.id, s.store_id, s.internal_reference, s.status,
         s.created_at, s.estimated_arrival_date, sup.name
HAVING NOW() - s.created_at > INTERVAL '7 days'
ORDER BY s.created_at ASC;

COMMENT ON VIEW v_stuck_inbound_shipments IS
'Inbound shipments stuck in pending status for more than 7 days';


-- ================================================================
-- Update movement types enum comment
-- ================================================================

COMMENT ON COLUMN inventory_movements.movement_type IS
'Type of movement:
- order_ready: Stock decremented when order ready to ship
- order_cancelled: Stock restored when order cancelled
- order_reverted: Stock restored when order reverted to earlier status
- inbound_receipt: Stock added from merchandise reception
- inbound_correction: Stock adjusted for merchandise correction
- return_accepted: Stock restored from accepted return
- return_rejected: Return rejected (no stock change, for audit)
- manual_adjustment: Manual stock correction';


-- ================================================================
-- Migration complete
-- ================================================================
