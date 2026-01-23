-- ================================================================
-- ALLOW CONFIRM FROM CONTACTED STATUS
-- ================================================================
-- Migration: 104_allow_confirm_from_contacted.sql
-- Author: Bright Idea
-- Date: 2026-01-23
--
-- PRODUCTION-READY: Fully idempotent, can be run multiple times safely
--
-- CRITICAL FIX:
-- Orders in "contacted" status could not be confirmed because the
-- confirm_order_atomic function only accepted "pending" status.
--
-- The "contacted" status is an intermediate step:
--   pending → contacted (WhatsApp sent) → confirmed (customer responded)
--
-- This fix allows confirming orders from BOTH statuses.
--
-- DEPENDENCIES:
-- - Migration 092: confirm_order_atomic function (15 params)
-- ================================================================

BEGIN;

-- ================================================================
-- SAFETY CHECK: Verify dependencies exist
-- ================================================================

DO $$
BEGIN
    -- Check orders table exists with sleeves_status column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders'
        AND column_name = 'sleeves_status'
    ) THEN
        RAISE EXCEPTION 'DEPENDENCY ERROR: orders.sleeves_status column not found.';
    END IF;

    -- Check carriers table exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'carriers'
    ) THEN
        RAISE EXCEPTION 'DEPENDENCY ERROR: carriers table not found.';
    END IF;

    -- Check order_line_items table exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'order_line_items'
    ) THEN
        RAISE EXCEPTION 'DEPENDENCY ERROR: order_line_items table not found.';
    END IF;

    RAISE NOTICE 'OK: All dependencies verified';
END $$;


-- ================================================================
-- STEP 1: Drop existing function signature (idempotent)
-- ================================================================

DROP FUNCTION IF EXISTS confirm_order_atomic(UUID, UUID, TEXT, UUID, TEXT, DECIMAL, DECIMAL, TEXT, TEXT, DECIMAL, UUID, INTEGER, DECIMAL, BOOLEAN, TEXT);


-- ================================================================
-- STEP 2: Create updated function allowing pending OR contacted
-- ================================================================

CREATE OR REPLACE FUNCTION confirm_order_atomic(
  p_order_id UUID,
  p_store_id UUID,
  p_confirmed_by TEXT,
  p_courier_id UUID,              -- Can be NULL for pickup orders
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

  -- ================================================================
  -- FIX (Migration 104): Allow both 'pending' AND 'contacted'
  -- The 'contacted' status means WhatsApp was sent, awaiting response.
  -- Once customer responds, the order should be confirmable.
  -- ================================================================
  IF v_order.sleeves_status NOT IN ('pending', 'contacted') THEN
    RAISE EXCEPTION 'INVALID_STATUS: Order is already % (expected pending or contacted)', v_order.sleeves_status
      USING ERRCODE = 'P0002';
  END IF;

  -- ================================================================
  -- STEP 3: Validate carrier (only if provided - NULL means pickup)
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

  v_current_line_items := COALESCE(v_order.line_items, '[]'::JSONB);
  IF v_current_line_items IS NULL OR jsonb_typeof(v_current_line_items) != 'array' THEN
    v_current_line_items := '[]'::JSONB;
  END IF;
  v_updated_line_items := v_current_line_items;

  -- ================================================================
  -- STEP 5: Handle MARK AS PREPAID (before upsell/discount)
  -- ================================================================
  IF p_mark_as_prepaid = TRUE AND NOT v_original_is_paid_online AND v_is_cod_order THEN
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


-- ================================================================
-- STEP 3: Add comprehensive comment
-- ================================================================

COMMENT ON FUNCTION confirm_order_atomic(UUID, UUID, TEXT, UUID, TEXT, DECIMAL, DECIMAL, TEXT, TEXT, DECIMAL, UUID, INTEGER, DECIMAL, BOOLEAN, TEXT) IS
'Atomically confirms an order with all related operations in a single transaction.

CRITICAL FIX (Migration 104):
- Now accepts both "pending" AND "contacted" status for confirmation
- "contacted" = WhatsApp message sent, customer responded, ready to confirm
- Flow: pending -> contacted -> confirmed (or pending -> confirmed directly)

VALID SOURCE STATUSES:
- pending: Order not yet contacted
- contacted: WhatsApp sent, customer responded, ready to confirm

ERROR CODES:
- P0001: ORDER_NOT_FOUND - Order does not exist in store
- P0002: INVALID_STATUS - Order is not pending or contacted
- P0003: CARRIER_NOT_FOUND - Carrier inactive or wrong store
- P0004: PRODUCT_NOT_FOUND - Upsell product not in store
- P0005: INVALID_PRODUCT - Upsell product has invalid price';


-- ================================================================
-- STEP 4: Grant permissions (idempotent)
-- ================================================================

GRANT EXECUTE ON FUNCTION confirm_order_atomic(UUID, UUID, TEXT, UUID, TEXT, DECIMAL, DECIMAL, TEXT, TEXT, DECIMAL, UUID, INTEGER, DECIMAL, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_order_atomic(UUID, UUID, TEXT, UUID, TEXT, DECIMAL, DECIMAL, TEXT, TEXT, DECIMAL, UUID, INTEGER, DECIMAL, BOOLEAN, TEXT) TO service_role;


-- ================================================================
-- STEP 5: Notify PostgREST to reload schema
-- ================================================================

NOTIFY pgrst, 'reload schema';


-- ================================================================
-- VERIFICATION
-- ================================================================

DO $$
DECLARE
  v_function_exists BOOLEAN;
  v_param_count INTEGER;
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration 104 - Allow Confirm from Contacted';
  RAISE NOTICE '========================================';

  -- Verify function exists with correct signature (15 params)
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE p.proname = 'confirm_order_atomic'
    AND n.nspname = 'public'
    AND p.pronargs = 15
  ) INTO v_function_exists;

  IF NOT v_function_exists THEN
    RAISE EXCEPTION 'FAILED: confirm_order_atomic function with 15 params not created';
  END IF;

  RAISE NOTICE 'OK: confirm_order_atomic function (15 params) created';

  -- Count total signatures (should be exactly 1)
  SELECT COUNT(*) INTO v_param_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE p.proname = 'confirm_order_atomic'
  AND n.nspname = 'public';

  IF v_param_count = 1 THEN
    RAISE NOTICE 'OK: Single function signature exists';
  ELSE
    RAISE WARNING 'WARN: Multiple signatures exist (%), expected 1', v_param_count;
  END IF;

  -- Verify the function source contains the fix
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE p.proname = 'confirm_order_atomic'
    AND n.nspname = 'public'
    AND prosrc LIKE '%pending%contacted%'
  ) THEN
    RAISE NOTICE 'OK: Function contains pending/contacted check';
  ELSE
    RAISE WARNING 'WARN: Function may not contain the fix';
  END IF;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration 104 Complete!';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'FIX: Orders in "contacted" status can now be confirmed';
  RAISE NOTICE '';
  RAISE NOTICE 'Valid status flow:';
  RAISE NOTICE '  pending -> contacted -> confirmed';
  RAISE NOTICE '  pending -> confirmed (direct)';
  RAISE NOTICE '';
  RAISE NOTICE 'This migration is IDEMPOTENT - safe to run multiple times';
  RAISE NOTICE '========================================';
END $$;

COMMIT;
