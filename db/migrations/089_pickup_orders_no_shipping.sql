-- ================================================================
-- PICKUP ORDERS (NO SHIPPING / RETIRO EN LOCAL)
-- ================================================================
-- Migration: 089_pickup_orders_no_shipping.sql
-- Author: Bright Idea
-- Date: 2026-01-20
--
-- Purpose:
-- Enables confirming orders without a carrier for scenarios like:
-- - Customer picks up at store (retiro en local)
-- - Personal delivery by store owner
-- - No shipping needed
--
-- Changes:
-- 1. Updated confirm_order_atomic to accept NULL courier_id
-- 2. Added is_pickup flag to orders table for filtering
-- 3. Updated dispatch session validation to exclude pickup orders
-- 4. Added pickup-related helper functions
-- ================================================================


-- ================================================================
-- STEP 1: Add is_pickup column to orders
-- ================================================================
-- This flag indicates the order doesn't require shipping

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'is_pickup'
    ) THEN
        ALTER TABLE orders ADD COLUMN is_pickup BOOLEAN DEFAULT FALSE;

        COMMENT ON COLUMN orders.is_pickup IS
            'True if order is for store pickup (no courier/shipping required)';
    END IF;
END $$;

-- Set is_pickup = true for existing confirmed orders without a carrier
UPDATE orders
SET is_pickup = TRUE
WHERE courier_id IS NULL
  AND sleeves_status NOT IN ('pending', 'cancelled')
  AND is_pickup IS NOT TRUE;


-- ================================================================
-- STEP 2: Create index for pickup orders filtering
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_orders_is_pickup
ON orders(store_id, is_pickup)
WHERE is_pickup = TRUE;


-- ================================================================
-- STEP 3: Update confirm_order_atomic to support NULL courier_id
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
  v_is_pickup BOOLEAN := FALSE;
  v_carrier_name TEXT := NULL;
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
      v_new_cod_amount := v_new_cod_amount + v_upsell_total;
    ELSIF v_is_cod_order THEN
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
    'carrier_name', v_carrier_name,
    'is_pickup', v_is_pickup
  ) INTO v_result
  FROM orders o WHERE o.id = p_order_id;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION confirm_order_atomic(UUID, UUID, TEXT, UUID, TEXT, DECIMAL, DECIMAL, TEXT, TEXT, DECIMAL, UUID, INTEGER, DECIMAL) IS
'Atomically confirms an order with all related operations in a single transaction.
Now supports pickup orders (courier_id = NULL) for store pickup scenarios.

Operations included:
- Order status update to confirmed
- Carrier assignment (optional - NULL for pickup)
- is_pickup flag set when no carrier
- Address/location update
- Upsell product addition (if provided)
- Discount application (if provided)
- COD amount recalculation
- Shipping cost set to 0 for pickup orders

Returns JSON with:
- success: boolean
- order: full order object
- upsell_applied: boolean
- discount_applied: boolean
- new_total_price: decimal
- new_cod_amount: decimal
- carrier_name: string (NULL for pickup)
- is_pickup: boolean

Error codes:
- P0001: ORDER_NOT_FOUND
- P0002: INVALID_STATUS (not pending)
- P0003: CARRIER_NOT_FOUND (only if courier_id provided)
- P0004: PRODUCT_NOT_FOUND (upsell product)';


-- ================================================================
-- STEP 4: Grant permissions
-- ================================================================

GRANT EXECUTE ON FUNCTION confirm_order_atomic(UUID, UUID, TEXT, UUID, TEXT, DECIMAL, DECIMAL, TEXT, TEXT, DECIMAL, UUID, INTEGER, DECIMAL) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_order_atomic(UUID, UUID, TEXT, UUID, TEXT, DECIMAL, DECIMAL, TEXT, TEXT, DECIMAL, UUID, INTEGER, DECIMAL) TO service_role;


-- ================================================================
-- STEP 5: Update dispatch session validation to exclude pickup orders
-- ================================================================

-- Helper function to check if order is eligible for dispatch
CREATE OR REPLACE FUNCTION is_order_dispatchable(p_order_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_order RECORD;
BEGIN
  SELECT
    sleeves_status,
    is_pickup,
    courier_id
  INTO v_order
  FROM orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Order must be ready_to_ship, have a carrier, and NOT be pickup
  RETURN v_order.sleeves_status = 'ready_to_ship'
    AND v_order.courier_id IS NOT NULL
    AND COALESCE(v_order.is_pickup, FALSE) = FALSE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION is_order_dispatchable(UUID) IS
'Checks if an order is eligible for dispatch sessions.
Returns FALSE for pickup orders (no shipping needed).';

GRANT EXECUTE ON FUNCTION is_order_dispatchable(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION is_order_dispatchable(UUID) TO service_role;


-- ================================================================
-- STEP 6: Update prevent_duplicate_dispatch to also block pickup orders
-- ================================================================
-- The existing trigger function prevent_duplicate_dispatch() needs to be
-- updated to also check for pickup orders (is_pickup = true or courier_id IS NULL)

CREATE OR REPLACE FUNCTION prevent_duplicate_dispatch()
RETURNS TRIGGER AS $$
DECLARE
  v_existing_session UUID;
  v_order RECORD;
BEGIN
  -- Get order details including pickup status
  SELECT id, is_pickup, courier_id INTO v_order
  FROM orders
  WHERE id = NEW.order_id;

  -- Block pickup orders from dispatch sessions (no shipping needed)
  IF COALESCE(v_order.is_pickup, FALSE) = TRUE THEN
    RAISE EXCEPTION 'PICKUP_ORDER: Order % is a pickup order (retiro en local) and cannot be added to dispatch sessions', NEW.order_id
      USING ERRCODE = 'P0010';
  END IF;

  -- Block orders without carrier (implies pickup or error)
  IF v_order.courier_id IS NULL THEN
    RAISE EXCEPTION 'NO_CARRIER: Order % has no carrier assigned and cannot be dispatched', NEW.order_id
      USING ERRCODE = 'P0011';
  END IF;

  -- Check if order is already in an active dispatch session
  SELECT ds.id INTO v_existing_session
  FROM dispatch_session_orders dso
  JOIN dispatch_sessions ds ON ds.id = dso.dispatch_session_id
  WHERE dso.order_id = NEW.order_id
    AND ds.status NOT IN ('cancelled', 'settled');

  IF FOUND THEN
    RAISE EXCEPTION 'ORDER_IN_ACTIVE_SESSION: Order % is already in active dispatch session %', NEW.order_id, v_existing_session
      USING ERRCODE = 'P0005';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION prevent_duplicate_dispatch() IS
'Trigger function that prevents:
1. Adding orders to multiple active dispatch sessions
2. Adding pickup orders (is_pickup = true) to dispatch sessions
3. Adding orders without assigned carrier to dispatch sessions';


-- ================================================================
-- STEP 7: View for pickup orders analytics
-- ================================================================

CREATE OR REPLACE VIEW v_pickup_orders_summary AS
SELECT
  store_id,
  DATE_TRUNC('day', confirmed_at) AS date,
  COUNT(*) AS total_pickups,
  SUM(total_price) AS total_revenue,
  SUM(cod_amount) AS total_cod_collected
FROM orders
WHERE is_pickup = TRUE
  AND sleeves_status NOT IN ('pending', 'cancelled')
GROUP BY store_id, DATE_TRUNC('day', confirmed_at)
ORDER BY date DESC;

COMMENT ON VIEW v_pickup_orders_summary IS
'Daily summary of pickup orders (retiro en local) per store.
Useful for understanding what percentage of orders are store pickups.';


-- ================================================================
-- STEP 8: Notify PostgREST to reload schema
-- ================================================================

NOTIFY pgrst, 'reload schema';


-- ================================================================
-- Migration verification
-- ================================================================

DO $$
DECLARE
  v_column_exists BOOLEAN;
  v_function_exists BOOLEAN;
  v_view_exists BOOLEAN;
BEGIN
  -- Verify column exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'is_pickup'
  ) INTO v_column_exists;

  -- Verify function exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'confirm_order_atomic'
  ) INTO v_function_exists;

  -- Verify view exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views WHERE table_name = 'v_pickup_orders_summary'
  ) INTO v_view_exists;

  IF NOT v_column_exists THEN
    RAISE EXCEPTION 'Migration failed: is_pickup column not created';
  END IF;

  IF NOT v_function_exists THEN
    RAISE EXCEPTION 'Migration failed: confirm_order_atomic function not created';
  END IF;

  IF NOT v_view_exists THEN
    RAISE EXCEPTION 'Migration failed: v_pickup_orders_summary view not created';
  END IF;

  RAISE NOTICE 'Migration 089_pickup_orders_no_shipping completed successfully';
  RAISE NOTICE '- is_pickup column: OK';
  RAISE NOTICE '- confirm_order_atomic function: OK';
  RAISE NOTICE '- v_pickup_orders_summary view: OK';
END $$;
