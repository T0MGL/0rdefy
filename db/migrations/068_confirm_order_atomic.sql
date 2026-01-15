-- ================================================================
-- ATOMIC ORDER CONFIRMATION
-- ================================================================
-- Migration: 068_confirm_order_atomic.sql
-- Author: Bright Idea
-- Date: 2026-01-15
--
-- Purpose:
-- Wraps the order confirmation process in a single database transaction
-- to prevent inconsistent states when multiple operations are involved:
-- - Order status update
-- - Upsell product addition (line items + JSONB + totals)
-- - Discount application
-- - COD amount recalculation
--
-- Non-critical operations handled OUTSIDE the transaction:
-- - QR code generation (external service)
-- - n8n webhook notification (external service)
-- - Status history logging (audit, non-blocking)
--
-- Benefits:
-- 1. All-or-nothing: If any operation fails, entire confirmation rolls back
-- 2. Row locking: Prevents concurrent modifications to same order
-- 3. Consistent totals: Upsell + discount applied atomically
-- 4. Clear error messages: Returns specific failure reason
-- ================================================================


-- ================================================================
-- CLEANUP: Drop previous version if exists (different signature)
-- ================================================================
-- The original version had p_confirmed_by as UUID, but orders.confirmed_by is VARCHAR(100)
-- We need to drop the old signature before creating the new one

DROP FUNCTION IF EXISTS confirm_order_atomic(UUID, UUID, UUID, UUID, TEXT, DECIMAL, DECIMAL, TEXT, TEXT, DECIMAL, UUID, INTEGER, DECIMAL);

-- ================================================================
-- MAIN FUNCTION: confirm_order_atomic
-- ================================================================
-- Performs all confirmation operations in a single transaction with row locking

CREATE OR REPLACE FUNCTION confirm_order_atomic(
  p_order_id UUID,
  p_store_id UUID,
  p_confirmed_by TEXT,  -- VARCHAR(100) in orders table, can be user ID or 'confirmador'
  p_courier_id UUID,
  p_address TEXT DEFAULT NULL,
  p_latitude DECIMAL DEFAULT NULL,
  p_longitude DECIMAL DEFAULT NULL,
  p_google_maps_link TEXT DEFAULT NULL,
  p_delivery_zone TEXT DEFAULT NULL,
  p_shipping_cost DECIMAL DEFAULT NULL,
  p_upsell_product_id UUID DEFAULT NULL,
  p_upsell_quantity INTEGER DEFAULT 1,
  p_discount_amount DECIMAL DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_order RECORD;
  v_carrier RECORD;
  v_product RECORD;
  v_existing_line_item RECORD;
  v_current_line_items JSONB;
  v_updated_line_items JSONB;
  v_upsell_total DECIMAL := 0;
  v_new_total_price DECIMAL;
  v_new_cod_amount DECIMAL;
  v_is_paid_online BOOLEAN := FALSE;
  v_is_cod_order BOOLEAN := FALSE;
  v_effective_discount DECIMAL := 0;
  v_result JSON;
  v_upsell_applied BOOLEAN := FALSE;
  v_discount_applied BOOLEAN := FALSE;
BEGIN
  -- ================================================================
  -- STEP 1: Lock and validate order
  -- ================================================================
  SELECT * INTO v_order
  FROM orders
  WHERE id = p_order_id AND store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: Order % not found in store %', p_order_id, p_store_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_order.sleeves_status != 'pending' THEN
    RAISE EXCEPTION 'INVALID_STATUS: Order is already % (expected pending)', v_order.sleeves_status
      USING ERRCODE = 'P0002';
  END IF;

  -- ================================================================
  -- STEP 2: Validate carrier
  -- ================================================================
  SELECT id, name INTO v_carrier
  FROM carriers
  WHERE id = p_courier_id
    AND store_id = p_store_id
    AND is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CARRIER_NOT_FOUND: Carrier % not found or inactive', p_courier_id
      USING ERRCODE = 'P0003';
  END IF;

  -- ================================================================
  -- STEP 3: Determine payment type for COD calculation
  -- ================================================================
  v_is_paid_online := LOWER(COALESCE(v_order.financial_status, '')) IN ('paid', 'authorized');
  v_is_cod_order := LOWER(COALESCE(v_order.payment_gateway, '')) IN ('cash_on_delivery', 'cod', 'manual')
                    OR (v_order.cod_amount IS NOT NULL AND v_order.cod_amount > 0);

  -- Initialize totals from current order
  v_new_total_price := COALESCE(v_order.total_price, 0);
  v_new_cod_amount := COALESCE(v_order.cod_amount, 0);
  v_current_line_items := COALESCE(v_order.line_items, '[]'::JSONB);
  v_updated_line_items := v_current_line_items;

  -- ================================================================
  -- STEP 4: Handle upsell if provided
  -- ================================================================
  IF p_upsell_product_id IS NOT NULL THEN
    -- Validate product exists
    SELECT id, name, price, image_url, sku INTO v_product
    FROM products
    WHERE id = p_upsell_product_id AND store_id = p_store_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND: Upsell product % not found', p_upsell_product_id
        USING ERRCODE = 'P0004';
    END IF;

    -- Calculate upsell total
    v_upsell_total := COALESCE(v_product.price, 0) * COALESCE(p_upsell_quantity, 1);

    -- Check if product already exists in order_line_items
    SELECT id, quantity, total_price INTO v_existing_line_item
    FROM order_line_items
    WHERE order_id = p_order_id AND product_id = p_upsell_product_id;

    IF FOUND THEN
      -- Update existing line item quantity
      UPDATE order_line_items
      SET
        quantity = COALESCE(v_existing_line_item.quantity, 0) + COALESCE(p_upsell_quantity, 1),
        total_price = COALESCE(v_product.price, 0) * (COALESCE(v_existing_line_item.quantity, 0) + COALESCE(p_upsell_quantity, 1)),
        updated_at = NOW()
      WHERE id = v_existing_line_item.id;
    ELSE
      -- Insert new line item
      INSERT INTO order_line_items (
        order_id, product_id, product_name, quantity, unit_price, total_price,
        image_url, sku, is_upsell, created_at
      ) VALUES (
        p_order_id, v_product.id, v_product.name, COALESCE(p_upsell_quantity, 1),
        COALESCE(v_product.price, 0), v_upsell_total,
        v_product.image_url, v_product.sku, TRUE, NOW()
      );
    END IF;

    -- Update JSONB line_items for inventory trigger compatibility
    -- Check if product already exists in JSONB array
    -- Note: product_id in JSONB can be UUID (local) or string/number (Shopify)
    -- We compare as TEXT to be safe
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_current_line_items) AS elem
      WHERE (elem->>'product_id') = p_upsell_product_id::TEXT
    ) THEN
      -- Update existing item quantity in JSONB
      SELECT jsonb_agg(
        CASE
          WHEN (elem->>'product_id') = p_upsell_product_id::TEXT THEN
            jsonb_set(elem, '{quantity}', to_jsonb(COALESCE((elem->>'quantity')::INTEGER, 0) + COALESCE(p_upsell_quantity, 1)))
          ELSE elem
        END
      ) INTO v_updated_line_items
      FROM jsonb_array_elements(v_current_line_items) AS elem;
    ELSE
      -- Add new item to JSONB array
      v_updated_line_items := v_current_line_items || jsonb_build_array(jsonb_build_object(
        'product_id', p_upsell_product_id,
        'product_name', v_product.name,
        'quantity', COALESCE(p_upsell_quantity, 1),
        'price', COALESCE(v_product.price, 0),
        'sku', v_product.sku,
        'is_upsell', TRUE
      ));
    END IF;

    -- Update order total
    v_new_total_price := v_new_total_price + v_upsell_total;

    -- Update COD amount based on payment type
    IF v_is_paid_online THEN
      -- For paid orders, only the upsell amount needs to be collected
      v_new_cod_amount := v_new_cod_amount + v_upsell_total;
    ELSIF v_is_cod_order THEN
      -- For COD orders, full new total needs to be collected
      v_new_cod_amount := v_new_total_price;
    END IF;

    v_upsell_applied := TRUE;
  END IF;

  -- ================================================================
  -- STEP 5: Handle discount if provided (applied AFTER upsell)
  -- ================================================================
  IF p_discount_amount IS NOT NULL AND p_discount_amount > 0 THEN
    -- Cap discount at total price
    v_effective_discount := LEAST(p_discount_amount, v_new_total_price);
    v_new_total_price := GREATEST(0, v_new_total_price - v_effective_discount);

    -- Update COD amount for COD orders (but not for already paid orders)
    IF NOT v_is_paid_online AND v_is_cod_order THEN
      v_new_cod_amount := v_new_total_price;
    END IF;

    v_discount_applied := TRUE;
  END IF;

  -- ================================================================
  -- STEP 6: Update order with all changes atomically
  -- ================================================================
  UPDATE orders SET
    sleeves_status = 'confirmed',
    confirmed_at = NOW(),
    confirmed_by = p_confirmed_by,
    confirmation_method = 'dashboard',
    courier_id = p_courier_id,
    upsell_added = v_upsell_applied,
    customer_address = COALESCE(p_address, customer_address),
    latitude = COALESCE(p_latitude, latitude),
    longitude = COALESCE(p_longitude, longitude),
    google_maps_link = COALESCE(p_google_maps_link, google_maps_link),
    delivery_zone = COALESCE(p_delivery_zone, delivery_zone),
    shipping_cost = COALESCE(p_shipping_cost, shipping_cost),
    total_price = v_new_total_price,
    cod_amount = CASE
      WHEN v_is_cod_order OR v_is_paid_online THEN v_new_cod_amount
      ELSE cod_amount
    END,
    total_discounts = CASE
      WHEN v_discount_applied THEN v_effective_discount
      ELSE total_discounts
    END,
    line_items = v_updated_line_items,
    updated_at = NOW()
  WHERE id = p_order_id;

  -- ================================================================
  -- STEP 7: Return updated order data
  -- ================================================================
  SELECT json_build_object(
    'success', TRUE,
    'order', row_to_json(o),
    'upsell_applied', v_upsell_applied,
    'upsell_total', v_upsell_total,
    'discount_applied', v_discount_applied,
    'discount_amount', v_effective_discount,
    'new_total_price', v_new_total_price,
    'new_cod_amount', v_new_cod_amount,
    'carrier_name', v_carrier.name
  ) INTO v_result
  FROM orders o WHERE o.id = p_order_id;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION confirm_order_atomic IS
'Atomically confirms an order with all related operations in a single transaction.
Operations included:
- Order status update to confirmed
- Carrier assignment
- Address/location update
- Upsell product addition (if provided)
- Discount application (if provided)
- COD amount recalculation

Returns JSON with:
- success: boolean
- order: full order object
- upsell_applied: boolean
- discount_applied: boolean
- new_total_price: decimal
- new_cod_amount: decimal
- carrier_name: string

Error codes:
- P0001: ORDER_NOT_FOUND
- P0002: INVALID_STATUS (not pending)
- P0003: CARRIER_NOT_FOUND
- P0004: PRODUCT_NOT_FOUND (upsell product)';


-- ================================================================
-- PERMISSIONS
-- ================================================================
-- Grant execute to all roles that need access via Supabase RPC

GRANT EXECUTE ON FUNCTION confirm_order_atomic(UUID, UUID, TEXT, UUID, TEXT, DECIMAL, DECIMAL, TEXT, TEXT, DECIMAL, UUID, INTEGER, DECIMAL) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_order_atomic(UUID, UUID, TEXT, UUID, TEXT, DECIMAL, DECIMAL, TEXT, TEXT, DECIMAL, UUID, INTEGER, DECIMAL) TO service_role;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';


-- ================================================================
-- Migration complete
-- ================================================================
