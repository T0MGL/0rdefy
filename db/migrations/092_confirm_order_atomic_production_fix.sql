-- ================================================================
-- CONFIRM ORDER ATOMIC - PRODUCTION FIX
-- ================================================================
-- Migration: 092_confirm_order_atomic_production_fix.sql
-- Author: Bright Idea
-- Date: 2026-01-20
--
-- Purpose:
-- Fix critical bugs in confirm_order_atomic function:
-- 1. Discount logic bug with prepaid orders
-- 2. Negative/zero upsell quantity validation
-- 3. NULL handling for empty JSONB arrays
-- 4. Improved financial status tracking
-- 5. Better error messages
--
-- This migration supersedes 091_mark_prepaid_cod_orders.sql
-- ================================================================


-- ================================================================
-- STEP 1: Ensure columns exist (idempotent)
-- ================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'prepaid_method'
    ) THEN
        ALTER TABLE orders ADD COLUMN prepaid_method VARCHAR(50) DEFAULT NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'prepaid_at'
    ) THEN
        ALTER TABLE orders ADD COLUMN prepaid_at TIMESTAMPTZ DEFAULT NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'prepaid_by'
    ) THEN
        ALTER TABLE orders ADD COLUMN prepaid_by VARCHAR(100) DEFAULT NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'is_pickup'
    ) THEN
        ALTER TABLE orders ADD COLUMN is_pickup BOOLEAN DEFAULT FALSE;
    END IF;
END $$;


-- ================================================================
-- STEP 2: Drop ALL existing signatures to avoid conflicts
-- ================================================================

-- 13-param version (089)
DROP FUNCTION IF EXISTS confirm_order_atomic(UUID, UUID, TEXT, UUID, TEXT, DECIMAL, DECIMAL, TEXT, TEXT, DECIMAL, UUID, INTEGER, DECIMAL);

-- 15-param version (091)
DROP FUNCTION IF EXISTS confirm_order_atomic(UUID, UUID, TEXT, UUID, TEXT, DECIMAL, DECIMAL, TEXT, TEXT, DECIMAL, UUID, INTEGER, DECIMAL, BOOLEAN, TEXT);


-- ================================================================
-- STEP 3: Create production-ready function
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
  v_original_is_paid_online BOOLEAN := FALSE;  -- Original payment status
  v_is_paid_online BOOLEAN := FALSE;           -- Effective status (after prepaid)
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

  -- Validate upsell quantity if product provided
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

  IF v_order.sleeves_status != 'pending' THEN
    RAISE EXCEPTION 'INVALID_STATUS: Order is already % (expected pending)', v_order.sleeves_status
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
    -- No carrier = pickup order (retiro en local)
    v_is_pickup := TRUE;
    v_carrier_name := NULL;
  END IF;

  -- ================================================================
  -- STEP 4: Determine payment type for COD calculation
  -- ================================================================
  -- Track ORIGINAL status separately from effective status
  v_original_is_paid_online := LOWER(COALESCE(v_order.financial_status, '')) IN ('paid', 'authorized');
  v_is_paid_online := v_original_is_paid_online;

  v_is_cod_order := LOWER(COALESCE(v_order.payment_gateway, '')) IN ('cash_on_delivery', 'cod', 'manual')
                    OR (v_order.cod_amount IS NOT NULL AND v_order.cod_amount > 0);

  -- Initialize totals from current order
  v_new_total_price := COALESCE(v_order.total_price, 0);
  v_new_cod_amount := COALESCE(v_order.cod_amount, 0);
  v_final_financial_status := COALESCE(v_order.financial_status, 'pending');

  -- Handle line_items - ensure never NULL
  v_current_line_items := COALESCE(v_order.line_items, '[]'::JSONB);
  IF v_current_line_items IS NULL OR jsonb_typeof(v_current_line_items) != 'array' THEN
    v_current_line_items := '[]'::JSONB;
  END IF;
  v_updated_line_items := v_current_line_items;

  -- ================================================================
  -- STEP 5: Handle MARK AS PREPAID (before upsell/discount)
  -- ================================================================
  -- Only allow marking as prepaid if:
  -- 1. Order is currently COD (not already paid online)
  -- 2. User explicitly requested it
  IF p_mark_as_prepaid = TRUE AND NOT v_original_is_paid_online AND v_is_cod_order THEN
    -- Mark order as prepaid - customer paid via transfer before shipping
    v_is_paid_online := TRUE;  -- Now treat as paid for calculations
    v_new_cod_amount := 0;     -- Nothing to collect at delivery (reset)
    v_was_marked_prepaid := TRUE;
    v_final_financial_status := 'paid';
  END IF;

  -- ================================================================
  -- STEP 6: Handle upsell if provided
  -- ================================================================
  IF p_upsell_product_id IS NOT NULL THEN
    -- Validate product exists in same store
    SELECT id, name, price, image_url, sku INTO v_product
    FROM products
    WHERE id = p_upsell_product_id AND store_id = p_store_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND: Upsell product % not found in store %', p_upsell_product_id, p_store_id
        USING ERRCODE = 'P0004';
    END IF;

    -- Validate product has a price
    IF COALESCE(v_product.price, 0) <= 0 THEN
      RAISE EXCEPTION 'INVALID_PRODUCT: Upsell product % has invalid price', p_upsell_product_id
        USING ERRCODE = 'P0005';
    END IF;

    -- Calculate upsell total
    v_upsell_total := COALESCE(v_product.price, 0) * v_effective_upsell_qty;

    -- Check if product already exists in order_line_items
    SELECT id, quantity, total_price INTO v_existing_line_item
    FROM order_line_items
    WHERE order_id = p_order_id AND product_id = p_upsell_product_id;

    IF FOUND THEN
      -- Update existing line item quantity
      UPDATE order_line_items
      SET
        quantity = COALESCE(v_existing_line_item.quantity, 0) + v_effective_upsell_qty,
        total_price = COALESCE(v_product.price, 0) * (COALESCE(v_existing_line_item.quantity, 0) + v_effective_upsell_qty),
        updated_at = NOW()
      WHERE id = v_existing_line_item.id;
    ELSE
      -- Insert new line item
      INSERT INTO order_line_items (
        order_id, product_id, product_name, quantity, unit_price, total_price,
        image_url, sku, is_upsell, created_at
      ) VALUES (
        p_order_id, v_product.id, v_product.name, v_effective_upsell_qty,
        COALESCE(v_product.price, 0), v_upsell_total,
        v_product.image_url, v_product.sku, TRUE, NOW()
      );
    END IF;

    -- Update JSONB line_items for inventory trigger compatibility
    -- Check if product already exists in JSONB array
    IF jsonb_array_length(v_current_line_items) > 0 AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_current_line_items) AS elem
      WHERE (elem->>'product_id') = p_upsell_product_id::TEXT
    ) THEN
      -- Update existing item quantity in JSONB
      SELECT COALESCE(jsonb_agg(
        CASE
          WHEN (elem->>'product_id') = p_upsell_product_id::TEXT THEN
            jsonb_set(elem, '{quantity}', to_jsonb(COALESCE((elem->>'quantity')::INTEGER, 0) + v_effective_upsell_qty))
          ELSE elem
        END
      ), '[]'::JSONB) INTO v_updated_line_items
      FROM jsonb_array_elements(v_current_line_items) AS elem;
    ELSE
      -- Add new item to JSONB array
      v_updated_line_items := v_current_line_items || jsonb_build_array(jsonb_build_object(
        'product_id', p_upsell_product_id,
        'product_name', v_product.name,
        'quantity', v_effective_upsell_qty,
        'price', COALESCE(v_product.price, 0),
        'sku', v_product.sku,
        'is_upsell', TRUE
      ));
    END IF;

    -- Ensure v_updated_line_items is never NULL
    v_updated_line_items := COALESCE(v_updated_line_items, v_current_line_items, '[]'::JSONB);

    -- Update order total
    v_new_total_price := v_new_total_price + v_upsell_total;

    -- Update COD amount based on payment type
    IF v_was_marked_prepaid THEN
      -- Original order was prepaid via transfer, so only collect upsell amount
      v_new_cod_amount := v_upsell_total;
    ELSIF v_original_is_paid_online THEN
      -- For orders ORIGINALLY paid online, only the upsell needs COD
      v_new_cod_amount := COALESCE(v_new_cod_amount, 0) + v_upsell_total;
    ELSIF v_is_cod_order THEN
      -- For COD orders, full new total needs to be collected
      v_new_cod_amount := v_new_total_price;
    END IF;

    v_upsell_applied := TRUE;
  END IF;

  -- ================================================================
  -- STEP 7: Handle discount if provided (applied AFTER upsell)
  -- ================================================================
  IF p_discount_amount IS NOT NULL AND p_discount_amount > 0 THEN
    -- Cap discount at total price (can't go negative)
    v_effective_discount := LEAST(p_discount_amount, v_new_total_price);
    v_new_total_price := GREATEST(0, v_new_total_price - v_effective_discount);

    -- Update COD amount based on order type
    IF v_was_marked_prepaid THEN
      -- Prepaid order: discount applies to upsell portion only (if any)
      IF v_upsell_applied THEN
        v_new_cod_amount := GREATEST(0, v_new_cod_amount - v_effective_discount);
      END IF;
      -- If no upsell, COD stays at 0 (nothing to discount)
    ELSIF v_original_is_paid_online THEN
      -- Originally paid online: discount applies to upsell portion only
      IF v_upsell_applied THEN
        v_new_cod_amount := GREATEST(0, v_new_cod_amount - v_effective_discount);
      END IF;
    ELSIF v_is_cod_order THEN
      -- COD order: discount reduces total COD amount
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
    courier_id = p_courier_id,  -- Can be NULL for pickup
    is_pickup = v_is_pickup,
    upsell_added = v_upsell_applied,
    customer_address = COALESCE(p_address, customer_address),
    latitude = COALESCE(p_latitude, latitude),
    longitude = COALESCE(p_longitude, longitude),
    google_maps_link = COALESCE(p_google_maps_link, google_maps_link),
    delivery_zone = CASE WHEN v_is_pickup THEN NULL ELSE COALESCE(p_delivery_zone, delivery_zone) END,
    shipping_cost = CASE WHEN v_is_pickup THEN 0 ELSE COALESCE(p_shipping_cost, shipping_cost) END,
    total_price = v_new_total_price,
    -- Financial status: Update ONLY if marked as prepaid
    financial_status = CASE
      WHEN v_was_marked_prepaid THEN 'paid'
      ELSE financial_status  -- Keep original
    END,
    -- COD amount: Set based on all calculations
    cod_amount = v_new_cod_amount,
    -- Prepaid tracking fields (only set if marked as prepaid)
    prepaid_method = CASE WHEN v_was_marked_prepaid THEN COALESCE(p_prepaid_method, 'transfer') ELSE prepaid_method END,
    prepaid_at = CASE WHEN v_was_marked_prepaid THEN NOW() ELSE prepaid_at END,
    prepaid_by = CASE WHEN v_was_marked_prepaid THEN p_confirmed_by ELSE prepaid_by END,
    -- Discounts (cumulative if already had discounts)
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
$$ LANGUAGE plpgsql;


-- ================================================================
-- STEP 4: Add comprehensive comment
-- ================================================================

COMMENT ON FUNCTION confirm_order_atomic(UUID, UUID, TEXT, UUID, TEXT, DECIMAL, DECIMAL, TEXT, TEXT, DECIMAL, UUID, INTEGER, DECIMAL, BOOLEAN, TEXT) IS
'Atomically confirms an order with all related operations in a single transaction.

FEATURES:
- Pickup orders (courier_id = NULL) for store pickup scenarios
- Mark COD orders as prepaid (mark_as_prepaid = TRUE) for transfer payments
- Upsell product addition with automatic totals calculation
- Discount application (capped at total price)
- COD amount recalculation based on payment type

OPERATIONS (atomic):
1. Order status update to confirmed
2. Carrier assignment (optional - NULL for pickup)
3. is_pickup flag set when no carrier
4. Prepaid marking: financial_status → paid, cod_amount → 0
5. Address/location update
6. Upsell product addition to order_line_items AND JSONB
7. Discount application
8. COD amount recalculation
9. Shipping cost set to 0 for pickup orders

COD CALCULATION LOGIC:
- COD order (no upsell, no prepaid): cod_amount = total_price
- COD order + upsell: cod_amount = total_price (includes upsell)
- COD order + discount: cod_amount = total_price - discount
- Prepaid order (no upsell): cod_amount = 0
- Prepaid order + upsell: cod_amount = upsell_total
- Prepaid order + upsell + discount: cod_amount = upsell_total - discount (min 0)
- Originally paid online + upsell: cod_amount = upsell_total

RETURNS JSON:
{
  "success": boolean,
  "order": full order object,
  "upsell_applied": boolean,
  "upsell_total": decimal,
  "discount_applied": boolean,
  "discount_amount": decimal,
  "new_total_price": decimal,
  "new_cod_amount": decimal,
  "carrier_name": string | null,
  "is_pickup": boolean,
  "was_marked_prepaid": boolean,
  "final_financial_status": string
}

ERROR CODES:
- P0001: ORDER_NOT_FOUND - Order does not exist in store
- P0002: INVALID_STATUS - Order is not pending
- P0003: CARRIER_NOT_FOUND - Carrier inactive or wrong store
- P0004: PRODUCT_NOT_FOUND - Upsell product not in store
- P0005: INVALID_PRODUCT - Upsell product has invalid price';


-- ================================================================
-- STEP 5: Grant permissions
-- ================================================================

GRANT EXECUTE ON FUNCTION confirm_order_atomic(UUID, UUID, TEXT, UUID, TEXT, DECIMAL, DECIMAL, TEXT, TEXT, DECIMAL, UUID, INTEGER, DECIMAL, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_order_atomic(UUID, UUID, TEXT, UUID, TEXT, DECIMAL, DECIMAL, TEXT, TEXT, DECIMAL, UUID, INTEGER, DECIMAL, BOOLEAN, TEXT) TO service_role;


-- ================================================================
-- STEP 6: Indexes (idempotent)
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_orders_prepaid
ON orders(store_id, prepaid_method)
WHERE prepaid_method IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_is_pickup
ON orders(store_id, is_pickup)
WHERE is_pickup = TRUE;

CREATE INDEX IF NOT EXISTS idx_orders_pending_confirmation
ON orders(store_id, sleeves_status)
WHERE sleeves_status = 'pending';


-- ================================================================
-- STEP 7: Notify PostgREST to reload schema
-- ================================================================

NOTIFY pgrst, 'reload schema';


-- ================================================================
-- STEP 8: Migration verification
-- ================================================================

DO $$
DECLARE
  v_function_exists BOOLEAN;
  v_param_count INTEGER;
BEGIN
  -- Verify function exists with correct signature (15 params)
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE p.proname = 'confirm_order_atomic'
    AND n.nspname = 'public'
    AND p.pronargs = 15
  ) INTO v_function_exists;

  IF NOT v_function_exists THEN
    RAISE EXCEPTION 'Migration failed: confirm_order_atomic function with 15 params not created';
  END IF;

  -- Count total signatures (should be exactly 1)
  SELECT COUNT(*) INTO v_param_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE p.proname = 'confirm_order_atomic'
  AND n.nspname = 'public';

  IF v_param_count != 1 THEN
    RAISE WARNING 'Multiple confirm_order_atomic signatures exist (%), expected 1', v_param_count;
  END IF;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration 092_confirm_order_atomic_production_fix';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ confirm_order_atomic function (15 params): OK';
  RAISE NOTICE '✅ Permissions granted: OK';
  RAISE NOTICE '✅ Indexes created: OK';
  RAISE NOTICE '========================================';
END $$;
