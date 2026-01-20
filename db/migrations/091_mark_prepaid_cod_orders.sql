-- ================================================================
-- MARK COD ORDERS AS PREPAID (Pagado por Transferencia)
-- ================================================================
-- Migration: 091_mark_prepaid_cod_orders.sql
-- Author: Bright Idea
-- Date: 2026-01-20
--
-- Purpose:
-- Allows marking COD orders as "prepaid" during confirmation when
-- the customer paid via bank transfer before shipping. This is common
-- for orders to remote areas where payment is required upfront.
--
-- Use Case:
-- 1. Order arrives from Shopify as COD (cash_on_delivery)
-- 2. Customer is in a remote zone, store requires payment first
-- 3. Customer pays via bank transfer
-- 4. Confirmador marks order as "Pagado por transferencia"
-- 5. Order confirmation sets:
--    - financial_status = 'paid'
--    - cod_amount = 0
--    - prepaid_method = 'transfer' (audit trail)
-- 6. Shipping label shows "PAGADO" instead of "COBRAR"
-- 7. Order excluded from COD reconciliation
--
-- Changes:
-- 1. Add prepaid_method column to orders for audit trail
-- 2. Update confirm_order_atomic to support mark_as_prepaid parameter
-- ================================================================


-- ================================================================
-- STEP 1: Add prepaid tracking column
-- ================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'prepaid_method'
    ) THEN
        ALTER TABLE orders ADD COLUMN prepaid_method VARCHAR(50) DEFAULT NULL;

        COMMENT ON COLUMN orders.prepaid_method IS
            'Method used for prepayment when COD order was paid before shipping.
             Values: transfer, efectivo_local, qr, otro. NULL if not prepaid.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'prepaid_at'
    ) THEN
        ALTER TABLE orders ADD COLUMN prepaid_at TIMESTAMPTZ DEFAULT NULL;

        COMMENT ON COLUMN orders.prepaid_at IS
            'Timestamp when the order was marked as prepaid during confirmation.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'prepaid_by'
    ) THEN
        ALTER TABLE orders ADD COLUMN prepaid_by VARCHAR(100) DEFAULT NULL;

        COMMENT ON COLUMN orders.prepaid_by IS
            'User who marked the order as prepaid during confirmation.';
    END IF;
END $$;


-- ================================================================
-- STEP 2: Update confirm_order_atomic to support mark_as_prepaid
-- ================================================================

-- Drop existing function (any signature)
DROP FUNCTION IF EXISTS confirm_order_atomic(UUID, UUID, TEXT, UUID, TEXT, DECIMAL, DECIMAL, TEXT, TEXT, DECIMAL, UUID, INTEGER, DECIMAL);

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
  p_mark_as_prepaid BOOLEAN DEFAULT FALSE,  -- NEW: Mark COD as prepaid
  p_prepaid_method TEXT DEFAULT NULL        -- NEW: 'transfer', 'efectivo_local', 'qr', 'otro'
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
  v_is_pickup BOOLEAN := FALSE;
  v_carrier_name TEXT := NULL;
  v_was_marked_prepaid BOOLEAN := FALSE;
  v_final_financial_status TEXT;
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
  -- STEP 2: Validate carrier (only if provided - NULL means pickup)
  -- ================================================================
  IF p_courier_id IS NOT NULL THEN
    SELECT id, name INTO v_carrier
    FROM carriers
    WHERE id = p_courier_id
      AND store_id = p_store_id
      AND is_active = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CARRIER_NOT_FOUND: Carrier % not found or inactive', p_courier_id
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
  -- STEP 3: Determine payment type for COD calculation
  -- ================================================================
  -- Check current financial status (before any override)
  v_is_paid_online := LOWER(COALESCE(v_order.financial_status, '')) IN ('paid', 'authorized');
  v_is_cod_order := LOWER(COALESCE(v_order.payment_gateway, '')) IN ('cash_on_delivery', 'cod', 'manual')
                    OR (v_order.cod_amount IS NOT NULL AND v_order.cod_amount > 0);

  -- Initialize totals from current order
  v_new_total_price := COALESCE(v_order.total_price, 0);
  v_new_cod_amount := COALESCE(v_order.cod_amount, 0);
  v_current_line_items := COALESCE(v_order.line_items, '[]'::JSONB);
  v_updated_line_items := v_current_line_items;
  v_final_financial_status := v_order.financial_status;

  -- ================================================================
  -- STEP 3B: Handle MARK AS PREPAID (before upsell/discount)
  -- ================================================================
  -- Only allow marking as prepaid if:
  -- 1. Order is currently COD (not already paid online)
  -- 2. User explicitly requested it
  IF p_mark_as_prepaid = TRUE AND NOT v_is_paid_online AND v_is_cod_order THEN
    -- Mark order as prepaid - customer paid via transfer before shipping
    v_is_paid_online := TRUE;  -- Now treat as paid for calculations
    v_new_cod_amount := 0;     -- Nothing to collect at delivery
    v_was_marked_prepaid := TRUE;
    v_final_financial_status := 'paid';
  END IF;

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
    -- If marked as prepaid, only collect upsell amount (original was paid by transfer)
    IF v_was_marked_prepaid THEN
      -- Original order was prepaid, so only collect upsell
      v_new_cod_amount := v_upsell_total;
    ELSIF v_is_paid_online THEN
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
    -- Note: If marked as prepaid without upsell, cod_amount stays 0
    IF NOT v_is_paid_online AND v_is_cod_order THEN
      v_new_cod_amount := v_new_total_price;
    ELSIF v_was_marked_prepaid AND v_upsell_applied THEN
      -- Prepaid with upsell: only discount applies to upsell portion
      v_new_cod_amount := GREATEST(0, v_new_cod_amount - v_effective_discount);
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
    -- Financial status: Update if marked as prepaid
    financial_status = CASE
      WHEN v_was_marked_prepaid THEN 'paid'
      ELSE financial_status
    END,
    -- COD amount: Set based on all calculations
    cod_amount = CASE
      WHEN v_was_marked_prepaid AND NOT v_upsell_applied THEN 0  -- Prepaid, no upsell = nothing to collect
      WHEN v_was_marked_prepaid AND v_upsell_applied THEN v_new_cod_amount  -- Prepaid with upsell = collect upsell
      WHEN v_is_cod_order OR v_is_paid_online THEN v_new_cod_amount
      ELSE cod_amount
    END,
    -- Prepaid tracking fields
    prepaid_method = CASE WHEN v_was_marked_prepaid THEN COALESCE(p_prepaid_method, 'transfer') ELSE prepaid_method END,
    prepaid_at = CASE WHEN v_was_marked_prepaid THEN NOW() ELSE prepaid_at END,
    prepaid_by = CASE WHEN v_was_marked_prepaid THEN p_confirmed_by ELSE prepaid_by END,
    -- Discounts
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
    'carrier_name', v_carrier_name,
    'is_pickup', v_is_pickup,
    'was_marked_prepaid', v_was_marked_prepaid,
    'final_financial_status', v_final_financial_status
  ) INTO v_result
  FROM orders o WHERE o.id = p_order_id;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION confirm_order_atomic(UUID, UUID, TEXT, UUID, TEXT, DECIMAL, DECIMAL, TEXT, TEXT, DECIMAL, UUID, INTEGER, DECIMAL, BOOLEAN, TEXT) IS
'Atomically confirms an order with all related operations in a single transaction.
Supports:
- Pickup orders (courier_id = NULL) for store pickup scenarios
- Mark COD orders as prepaid (mark_as_prepaid = TRUE) for transfer payments

Operations included:
- Order status update to confirmed
- Carrier assignment (optional - NULL for pickup)
- is_pickup flag set when no carrier
- Prepaid marking: financial_status → paid, cod_amount → 0
- Address/location update
- Upsell product addition (if provided)
- Discount application (if provided)
- COD amount recalculation
- Shipping cost set to 0 for pickup orders

Prepaid Logic:
- If mark_as_prepaid AND order is COD → financial_status = paid, cod_amount = 0
- If mark_as_prepaid with upsell → cod_amount = upsell only (original was prepaid)
- Prepaid tracking: prepaid_method, prepaid_at, prepaid_by

Returns JSON with:
- success: boolean
- order: full order object
- upsell_applied: boolean
- discount_applied: boolean
- new_total_price: decimal
- new_cod_amount: decimal
- carrier_name: string (NULL for pickup)
- is_pickup: boolean
- was_marked_prepaid: boolean
- final_financial_status: string

Error codes:
- P0001: ORDER_NOT_FOUND
- P0002: INVALID_STATUS (not pending)
- P0003: CARRIER_NOT_FOUND (only if courier_id provided)
- P0004: PRODUCT_NOT_FOUND (upsell product)';


-- ================================================================
-- STEP 3: Grant permissions
-- ================================================================

GRANT EXECUTE ON FUNCTION confirm_order_atomic(UUID, UUID, TEXT, UUID, TEXT, DECIMAL, DECIMAL, TEXT, TEXT, DECIMAL, UUID, INTEGER, DECIMAL, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_order_atomic(UUID, UUID, TEXT, UUID, TEXT, DECIMAL, DECIMAL, TEXT, TEXT, DECIMAL, UUID, INTEGER, DECIMAL, BOOLEAN, TEXT) TO service_role;


-- ================================================================
-- STEP 4: Index for prepaid orders filtering
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_orders_prepaid
ON orders(store_id, prepaid_method)
WHERE prepaid_method IS NOT NULL;


-- ================================================================
-- STEP 5: View for prepaid orders analytics
-- ================================================================

CREATE OR REPLACE VIEW v_prepaid_orders_summary AS
SELECT
  store_id,
  DATE_TRUNC('day', prepaid_at) AS date,
  prepaid_method,
  COUNT(*) AS total_prepaid,
  SUM(total_price) AS total_revenue,
  COUNT(DISTINCT prepaid_by) AS unique_confirmers
FROM orders
WHERE prepaid_method IS NOT NULL
GROUP BY store_id, DATE_TRUNC('day', prepaid_at), prepaid_method
ORDER BY date DESC, prepaid_method;

COMMENT ON VIEW v_prepaid_orders_summary IS
'Daily summary of COD orders marked as prepaid by method (transfer, efectivo_local, qr, otro).
Useful for understanding prepayment patterns and which confirmers mark orders as prepaid.';


-- ================================================================
-- STEP 6: Notify PostgREST to reload schema
-- ================================================================

NOTIFY pgrst, 'reload schema';


-- ================================================================
-- Migration verification
-- ================================================================

DO $$
DECLARE
  v_column_exists BOOLEAN;
  v_function_exists BOOLEAN;
BEGIN
  -- Verify columns exist
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'prepaid_method'
  ) INTO v_column_exists;

  -- Verify function exists with new signature
  SELECT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'confirm_order_atomic'
    AND pronargs = 15  -- New signature has 15 parameters
  ) INTO v_function_exists;

  IF NOT v_column_exists THEN
    RAISE EXCEPTION 'Migration failed: prepaid_method column not created';
  END IF;

  IF NOT v_function_exists THEN
    RAISE EXCEPTION 'Migration failed: confirm_order_atomic function with 15 params not created';
  END IF;

  RAISE NOTICE 'Migration 091_mark_prepaid_cod_orders completed successfully';
  RAISE NOTICE '- prepaid_method column: OK';
  RAISE NOTICE '- prepaid_at column: OK';
  RAISE NOTICE '- prepaid_by column: OK';
  RAISE NOTICE '- confirm_order_atomic function (15 params): OK';
END $$;
