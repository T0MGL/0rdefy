-- ================================================================
-- MIGRATION 144: Fix delivery page showing NO COBRAR for COD orders
-- ================================================================
-- Date: 2026-03-30
--
-- BUG: Courier delivery page shows "SIN COBRO / NO COBRAR" for orders
--      that must be collected (COD). The shipping label correctly shows
--      "COBRAR Gs. 229,000" because it has a fallback to total_price,
--      but the delivery page only checks cod_amount.
--
-- ROOT CAUSE: Shopify orders/updated webhook does a full UPSERT that
--      overwrites locally-managed payment fields (cod_amount,
--      financial_status). When Shopify reports financial_status='paid',
--      the UPSERT sets cod_amount=0, breaking the delivery page.
--
-- FIX: Add safety net in confirm_order_atomic: if order is COD (not paid,
--      not prepaid) and cod_amount is 0/NULL, set it to total_price.
--      This ensures cod_amount is always correct after confirmation,
--      regardless of what happens to the DB afterwards.
--
-- COMPANION FIXES (in code, same commit):
--   1. shopify-webhook.service.ts: orders/updated webhook no longer
--      overwrites payment fields for locally-confirmed orders
--   2. orders.ts: delivery token endpoint falls back to total_price
--      when cod_amount is 0 and order is not explicitly paid
--
-- Based on: migration 142 (exact live function, 15 params)
-- IDEMPOTENT: CREATE OR REPLACE, safe to run multiple times
-- ================================================================

BEGIN;

-- Drop existing signature to avoid conflicts
DROP FUNCTION IF EXISTS confirm_order_atomic(UUID, UUID, TEXT, UUID, TEXT, DECIMAL, DECIMAL, TEXT, TEXT, DECIMAL, UUID, INTEGER, DECIMAL, BOOLEAN, TEXT);

CREATE OR REPLACE FUNCTION confirm_order_atomic(
  p_order_id UUID,
  p_store_id UUID,
  p_confirmed_by TEXT,
  p_courier_id UUID,
  p_address TEXT DEFAULT NULL,
  p_latitude DECIMAL DEFAULT NULL,
  p_longitude DECIMAL DEFAULT NULL,
  p_google_maps_link TEXT DEFAULT NULL,
  p_delivery_zone TEXT DEFAULT NULL,
  p_shipping_cost DECIMAL DEFAULT NULL,
  p_upsell_product_id UUID DEFAULT NULL,
  p_upsell_quantity INTEGER DEFAULT 1,
  p_discount_amount DECIMAL DEFAULT NULL,
  p_mark_as_prepaid BOOLEAN DEFAULT FALSE,
  p_prepaid_method TEXT DEFAULT NULL
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
  v_original_is_paid_online BOOLEAN := FALSE;
  v_is_paid_online BOOLEAN := FALSE;
  v_is_cod_order BOOLEAN := FALSE;
  v_effective_discount DECIMAL := 0;
  v_result JSON;
  v_upsell_applied BOOLEAN := FALSE;
  v_discount_applied BOOLEAN := FALSE;
  v_is_pickup BOOLEAN := FALSE;
  v_carrier_name TEXT := NULL;
  v_was_marked_prepaid BOOLEAN := FALSE;
  v_final_financial_status TEXT;
  v_effective_upsell_qty INTEGER;
BEGIN
  -- ================================================================
  -- STEP 1: Validate inputs
  -- ================================================================
  IF p_upsell_product_id IS NOT NULL THEN
    v_effective_upsell_qty := GREATEST(1, COALESCE(p_upsell_quantity, 1));
  ELSE
    v_effective_upsell_qty := 1;
  END IF;

  -- ================================================================
  -- STEP 2: Lock and validate order
  -- ================================================================
  SELECT * INTO v_order
  FROM orders
  WHERE id = p_order_id AND store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: Order % not found in store %', p_order_id, p_store_id
      USING ERRCODE = 'P0001';
  END IF;

  -- FIX (Migration 104): Allow both 'pending' AND 'contacted'
  IF v_order.sleeves_status NOT IN ('pending', 'contacted') THEN
    RAISE EXCEPTION 'INVALID_STATUS: Order is already % (expected pending or contacted)', v_order.sleeves_status
      USING ERRCODE = 'P0002';
  END IF;

  -- ================================================================
  -- STEP 3: Validate carrier (only if provided, NULL means pickup)
  -- ================================================================
  IF p_courier_id IS NOT NULL THEN
    SELECT id, name INTO v_carrier
    FROM carriers
    WHERE id = p_courier_id
      AND store_id = p_store_id
      AND is_active = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CARRIER_NOT_FOUND: Carrier % not found or inactive in store %', p_courier_id, p_store_id
        USING ERRCODE = 'P0003';
    END IF;

    v_carrier_name := v_carrier.name;
    v_is_pickup := FALSE;
  ELSE
    v_is_pickup := TRUE;
    v_carrier_name := NULL;
  END IF;

  -- ================================================================
  -- STEP 4: Determine payment type for COD calculation
  -- ================================================================
  v_original_is_paid_online := LOWER(COALESCE(v_order.financial_status, '')) IN ('paid', 'authorized');
  v_is_paid_online := v_original_is_paid_online;

  v_is_cod_order := LOWER(COALESCE(v_order.payment_gateway, '')) IN ('cash_on_delivery', 'cod', 'manual')
                    OR (v_order.cod_amount IS NOT NULL AND v_order.cod_amount > 0);

  v_new_total_price := COALESCE(v_order.total_price, 0);
  v_new_cod_amount := COALESCE(v_order.cod_amount, 0);
  v_final_financial_status := COALESCE(v_order.financial_status, 'pending');

  -- FIX (Migration 144): If order is NOT paid online and cod_amount is 0,
  -- set cod_amount to total_price. This guarantees COD orders always have
  -- the correct collection amount, even if cod_amount was never set
  -- (manual orders) or was corrupted by a Shopify webhook UPSERT.
  IF NOT v_original_is_paid_online AND v_new_cod_amount = 0 AND v_new_total_price > 0 THEN
    v_new_cod_amount := v_new_total_price;
    v_is_cod_order := TRUE;
  END IF;

  v_current_line_items := COALESCE(v_order.line_items, '[]'::JSONB);
  IF v_current_line_items IS NULL OR jsonb_typeof(v_current_line_items) != 'array' THEN
    v_current_line_items := '[]'::JSONB;
  END IF;
  v_updated_line_items := v_current_line_items;

  -- ================================================================
  -- STEP 5: Handle MARK AS PREPAID (before upsell/discount)
  -- ================================================================
  -- FIX (Migration 142): Removed v_is_cod_order condition.
  -- If caller explicitly passes mark_as_prepaid = TRUE, honor it
  -- for ANY unpaid order. Previously this silently skipped orders
  -- where payment_gateway was NULL and cod_amount was 0 (common for
  -- external webhook orders and manually created orders).
  IF p_mark_as_prepaid = TRUE AND NOT v_original_is_paid_online THEN
    v_is_paid_online := TRUE;
    v_new_cod_amount := 0;
    v_was_marked_prepaid := TRUE;
    v_final_financial_status := 'paid';
  END IF;

  -- ================================================================
  -- STEP 6: Handle upsell if provided
  -- ================================================================
  IF p_upsell_product_id IS NOT NULL THEN
    SELECT id, name, price, image_url, sku INTO v_product
    FROM products
    WHERE id = p_upsell_product_id AND store_id = p_store_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND: Upsell product % not found in store %', p_upsell_product_id, p_store_id
        USING ERRCODE = 'P0004';
    END IF;

    IF COALESCE(v_product.price, 0) <= 0 THEN
      RAISE EXCEPTION 'INVALID_PRODUCT: Upsell product % has invalid price', p_upsell_product_id
        USING ERRCODE = 'P0005';
    END IF;

    v_upsell_total := COALESCE(v_product.price, 0) * v_effective_upsell_qty;

    SELECT id, quantity, total_price INTO v_existing_line_item
    FROM order_line_items
    WHERE order_id = p_order_id AND product_id = p_upsell_product_id;

    IF FOUND THEN
      UPDATE order_line_items
      SET
        quantity = COALESCE(v_existing_line_item.quantity, 0) + v_effective_upsell_qty,
        total_price = COALESCE(v_product.price, 0) * (COALESCE(v_existing_line_item.quantity, 0) + v_effective_upsell_qty),
        updated_at = NOW()
      WHERE id = v_existing_line_item.id;
    ELSE
      INSERT INTO order_line_items (
        order_id, product_id, product_name, quantity, unit_price, total_price,
        image_url, sku, is_upsell, created_at
      ) VALUES (
        p_order_id, v_product.id, v_product.name, v_effective_upsell_qty,
        COALESCE(v_product.price, 0), v_upsell_total,
        v_product.image_url, v_product.sku, TRUE, NOW()
      );
    END IF;

    IF jsonb_array_length(v_current_line_items) > 0 AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_current_line_items) AS elem
      WHERE (elem->>'product_id') = p_upsell_product_id::TEXT
    ) THEN
      SELECT COALESCE(jsonb_agg(
        CASE
          WHEN (elem->>'product_id') = p_upsell_product_id::TEXT THEN
            jsonb_set(elem, '{quantity}', to_jsonb(COALESCE((elem->>'quantity')::INTEGER, 0) + v_effective_upsell_qty))
          ELSE elem
        END
      ), '[]'::JSONB) INTO v_updated_line_items
      FROM jsonb_array_elements(v_current_line_items) AS elem;
    ELSE
      v_updated_line_items := v_current_line_items || jsonb_build_array(jsonb_build_object(
        'product_id', p_upsell_product_id,
        'product_name', v_product.name,
        'quantity', v_effective_upsell_qty,
        'price', COALESCE(v_product.price, 0),
        'sku', v_product.sku,
        'is_upsell', TRUE
      ));
    END IF;

    v_updated_line_items := COALESCE(v_updated_line_items, v_current_line_items, '[]'::JSONB);
    v_new_total_price := v_new_total_price + v_upsell_total;

    IF v_was_marked_prepaid THEN
      v_new_cod_amount := v_upsell_total;
    ELSIF v_original_is_paid_online THEN
      v_new_cod_amount := COALESCE(v_new_cod_amount, 0) + v_upsell_total;
    ELSIF v_is_cod_order THEN
      v_new_cod_amount := v_new_total_price;
    END IF;

    v_upsell_applied := TRUE;
  END IF;

  -- ================================================================
  -- STEP 7: Handle discount if provided (applied AFTER upsell)
  -- ================================================================
  IF p_discount_amount IS NOT NULL AND p_discount_amount > 0 THEN
    v_effective_discount := LEAST(p_discount_amount, v_new_total_price);
    v_new_total_price := GREATEST(0, v_new_total_price - v_effective_discount);

    IF v_was_marked_prepaid THEN
      IF v_upsell_applied THEN
        v_new_cod_amount := GREATEST(0, v_new_cod_amount - v_effective_discount);
      END IF;
    ELSIF v_original_is_paid_online THEN
      IF v_upsell_applied THEN
        v_new_cod_amount := GREATEST(0, v_new_cod_amount - v_effective_discount);
      END IF;
    ELSIF v_is_cod_order THEN
      v_new_cod_amount := GREATEST(0, v_new_total_price);
    END IF;

    v_discount_applied := TRUE;
  END IF;

  -- ================================================================
  -- STEP 8: Update order with all changes atomically
  -- ================================================================
  UPDATE orders SET
    sleeves_status = 'confirmed',
    confirmed_at = NOW(),
    confirmed_by = p_confirmed_by,
    confirmation_method = 'dashboard',
    courier_id = p_courier_id,
    is_pickup = v_is_pickup,
    upsell_added = v_upsell_applied,
    customer_address = COALESCE(p_address, customer_address),
    latitude = COALESCE(p_latitude, latitude),
    longitude = COALESCE(p_longitude, longitude),
    google_maps_link = COALESCE(p_google_maps_link, google_maps_link),
    delivery_zone = CASE WHEN v_is_pickup THEN NULL ELSE COALESCE(p_delivery_zone, delivery_zone) END,
    shipping_cost = CASE WHEN v_is_pickup THEN 0 ELSE COALESCE(p_shipping_cost, shipping_cost) END,
    total_price = v_new_total_price,
    financial_status = CASE
      WHEN v_was_marked_prepaid THEN 'paid'
      ELSE financial_status
    END,
    cod_amount = v_new_cod_amount,
    prepaid_method = CASE WHEN v_was_marked_prepaid THEN COALESCE(p_prepaid_method, 'transfer') ELSE prepaid_method END,
    prepaid_at = CASE WHEN v_was_marked_prepaid THEN NOW() ELSE prepaid_at END,
    prepaid_by = CASE WHEN v_was_marked_prepaid THEN p_confirmed_by ELSE prepaid_by END,
    total_discounts = CASE
      WHEN v_discount_applied THEN COALESCE(total_discounts, 0) + v_effective_discount
      ELSE total_discounts
    END,
    line_items = v_updated_line_items,
    updated_at = NOW()
  WHERE id = p_order_id;

  -- ================================================================
  -- STEP 9: Return updated order data
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
    'carrier_name', v_carrier_name,
    'is_pickup', v_is_pickup,
    'was_marked_prepaid', v_was_marked_prepaid,
    'final_financial_status', CASE
      WHEN v_was_marked_prepaid THEN 'paid'
      ELSE v_final_financial_status
    END
  ) INTO v_result
  FROM orders o WHERE o.id = p_order_id;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Permissions
GRANT EXECUTE ON FUNCTION confirm_order_atomic(UUID, UUID, TEXT, UUID, TEXT, DECIMAL, DECIMAL, TEXT, TEXT, DECIMAL, UUID, INTEGER, DECIMAL, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_order_atomic(UUID, UUID, TEXT, UUID, TEXT, DECIMAL, DECIMAL, TEXT, TEXT, DECIMAL, UUID, INTEGER, DECIMAL, BOOLEAN, TEXT) TO service_role;

-- Reload PostgREST schema
NOTIFY pgrst, 'reload schema';

-- ================================================================
-- VERIFICATION
-- ================================================================
DO $$
DECLARE
  v_function_exists BOOLEAN;
  v_has_fix BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE p.proname = 'confirm_order_atomic'
    AND n.nspname = 'public'
    AND p.pronargs = 15
  ) INTO v_function_exists;

  IF NOT v_function_exists THEN
    RAISE EXCEPTION 'FAILED: confirm_order_atomic (15 params) not found';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE p.proname = 'confirm_order_atomic'
    AND n.nspname = 'public'
    AND prosrc LIKE '%Migration 144%'
  ) INTO v_has_fix;

  IF NOT v_has_fix THEN
    RAISE EXCEPTION 'FAILED: Migration 144 fix not found in function body';
  END IF;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration 144 - Fix delivery page COD';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'OK: confirm_order_atomic (15 params)';
  RAISE NOTICE 'OK: COD fallback to total_price added';
  RAISE NOTICE 'OK: Permissions granted';
  RAISE NOTICE '========================================';
END $$;

COMMIT;
