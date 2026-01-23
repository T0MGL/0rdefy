-- ============================================================
-- Migration 100: Delivery-Based Reconciliation System
--
-- Purpose: Enable reconciliation grouped by DELIVERY DATE instead
-- of dispatch date. This provides a clearer workflow where users
-- can see all delivered orders for a specific date and reconcile
-- them together.
--
-- Key changes:
-- 1. Index for efficient queries by delivered_at
-- 2. View for pending reconciliation grouped by delivery date
-- 3. Function to get orders for a specific date/carrier
-- 4. RPC for atomic reconciliation processing
-- ============================================================

-- 1. Index for efficient delivery date queries
-- This index covers the most common query pattern: finding delivered
-- orders that haven't been reconciled yet
CREATE INDEX IF NOT EXISTS idx_orders_pending_reconciliation
ON orders(store_id, courier_id, (delivered_at::date))
WHERE sleeves_status = 'delivered' AND reconciled_at IS NULL AND delivered_at IS NOT NULL;

-- 2. View for pending reconciliation grouped by date and carrier
-- This replaces the complex service-side grouping with a simple view
CREATE OR REPLACE VIEW v_pending_reconciliation AS
SELECT
  o.store_id,
  (o.delivered_at::date) as delivery_date,
  o.courier_id as carrier_id,
  c.name as carrier_name,
  COALESCE(c.failed_attempt_fee_percent, 50) as failed_attempt_fee_percent,
  COUNT(*) as total_orders,
  SUM(CASE
    WHEN LOWER(COALESCE(o.payment_method, '')) IN ('cod', 'cash', 'contra_entrega', 'efectivo', 'contra entrega')
    THEN COALESCE(o.total_price, 0)
    ELSE 0
  END) as total_cod,
  COUNT(*) FILTER (
    WHERE LOWER(COALESCE(o.payment_method, '')) NOT IN ('cod', 'cash', 'contra_entrega', 'efectivo', 'contra entrega')
  ) as total_prepaid
FROM orders o
JOIN carriers c ON c.id = o.courier_id
WHERE o.sleeves_status = 'delivered'
  AND o.reconciled_at IS NULL
  AND o.delivered_at IS NOT NULL
  AND o.courier_id IS NOT NULL
GROUP BY o.store_id, (o.delivered_at::date), o.courier_id, c.name, c.failed_attempt_fee_percent;

-- 3. Function to get orders for a specific delivery date and carrier
CREATE OR REPLACE FUNCTION get_pending_reconciliation_orders(
  p_store_id UUID,
  p_carrier_id UUID,
  p_delivery_date DATE
)
RETURNS TABLE (
  id UUID,
  display_order_number TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  customer_address TEXT,
  customer_city TEXT,
  total_price NUMERIC,
  cod_amount NUMERIC,
  payment_method TEXT,
  is_cod BOOLEAN,
  delivered_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    -- Unified display order number: always #XXXX format
    COALESCE(
      o.shopify_order_name,
      CASE WHEN o.shopify_order_number IS NOT NULL
        THEN '#' || o.shopify_order_number::text
        ELSE NULL
      END,
      '#' || UPPER(RIGHT(o.id::text, 4))
    ) as display_order_number,
    TRIM(COALESCE(o.customer_first_name, '') || ' ' || COALESCE(o.customer_last_name, '')) as customer_name,
    COALESCE(o.customer_phone, '') as customer_phone,
    CASE
      WHEN o.shipping_address IS NULL THEN ''
      WHEN jsonb_typeof(o.shipping_address::jsonb) = 'object' THEN COALESCE(o.shipping_address::jsonb->>'address1', '')
      ELSE COALESCE(o.shipping_address::text, '')
    END as customer_address,
    COALESCE(o.delivery_zone, o.shipping_city, '') as customer_city,
    COALESCE(o.total_price, 0) as total_price,
    CASE
      WHEN LOWER(COALESCE(o.payment_method, '')) IN ('cod', 'cash', 'contra_entrega', 'efectivo', 'contra entrega')
      THEN COALESCE(o.total_price, 0)
      ELSE 0
    END as cod_amount,
    COALESCE(o.payment_method, '') as payment_method,
    LOWER(COALESCE(o.payment_method, '')) IN ('cod', 'cash', 'contra_entrega', 'efectivo', 'contra entrega') as is_cod,
    o.delivered_at
  FROM orders o
  WHERE o.store_id = p_store_id
    AND o.courier_id = p_carrier_id
    AND (o.delivered_at::date) = p_delivery_date
    AND o.sleeves_status = 'delivered'
    AND o.reconciled_at IS NULL
  ORDER BY o.delivered_at ASC;
END;
$$;

-- 4. Function to process delivery-based reconciliation atomically
-- Uses advisory lock to prevent race conditions and validates orders aren't already reconciled
CREATE OR REPLACE FUNCTION process_delivery_reconciliation(
  p_store_id UUID,
  p_user_id UUID,
  p_carrier_id UUID,
  p_delivery_date DATE,
  p_total_amount_collected NUMERIC,
  p_discrepancy_notes TEXT DEFAULT NULL,
  p_orders JSONB DEFAULT '[]'::jsonb
)
RETURNS TABLE (
  settlement_id UUID,
  settlement_code TEXT,
  total_orders INT,
  total_delivered INT,
  total_not_delivered INT,
  total_cod_expected NUMERIC,
  total_cod_collected NUMERIC,
  total_carrier_fees NUMERIC,
  failed_attempt_fee NUMERIC,
  net_receivable NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_settlement_id UUID;
  v_settlement_code TEXT;
  v_carrier_name TEXT;
  v_carrier_fee_rate NUMERIC;
  v_failed_fee_percent NUMERIC;
  v_total_orders INT := 0;
  v_total_delivered INT := 0;
  v_total_not_delivered INT := 0;
  v_total_cod_expected NUMERIC := 0;
  v_total_carrier_fees NUMERIC := 0;
  v_failed_attempt_fee NUMERIC := 0;
  v_net_receivable NUMERIC := 0;
  v_order JSONB;
  v_order_id UUID;
  v_order_record RECORD;
  v_zone_rate NUMERIC;
  v_lock_key BIGINT;
  v_already_reconciled INT := 0;
BEGIN
  -- Input validation
  IF p_store_id IS NULL THEN
    RAISE EXCEPTION 'store_id is required';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required';
  END IF;
  IF p_carrier_id IS NULL THEN
    RAISE EXCEPTION 'carrier_id is required';
  END IF;
  IF p_delivery_date IS NULL THEN
    RAISE EXCEPTION 'delivery_date is required';
  END IF;
  IF p_total_amount_collected IS NULL OR p_total_amount_collected < 0 THEN
    RAISE EXCEPTION 'total_amount_collected must be non-negative';
  END IF;

  -- Acquire advisory lock to prevent concurrent reconciliations for same store/date/carrier
  -- Using hash of store_id + carrier_id + date as lock key
  v_lock_key := hashtext(p_store_id::text || p_carrier_id::text || p_delivery_date::text);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Get carrier info with lock
  SELECT name, failed_attempt_fee_percent
  INTO v_carrier_name, v_failed_fee_percent
  FROM carriers
  WHERE id = p_carrier_id
  FOR SHARE;

  IF v_carrier_name IS NULL THEN
    RAISE EXCEPTION 'Carrier not found: %', p_carrier_id;
  END IF;

  v_failed_fee_percent := COALESCE(v_failed_fee_percent, 50);

  -- Check if any orders are already reconciled (CRITICAL: filter by store_id for security)
  SELECT COUNT(*) INTO v_already_reconciled
  FROM orders o
  WHERE o.id IN (SELECT (jsonb_array_elements(p_orders)->>'order_id')::UUID)
    AND o.store_id = p_store_id  -- Security: only check orders from this store
    AND o.reconciled_at IS NOT NULL;

  IF v_already_reconciled > 0 THEN
    RAISE EXCEPTION 'Some orders are already reconciled (count: %)', v_already_reconciled;
  END IF;

  -- Validate all orders exist and belong to this store
  SELECT COUNT(*) INTO v_already_reconciled  -- Reuse variable for validation count
  FROM (
    SELECT (jsonb_array_elements(p_orders)->>'order_id')::UUID as order_id
  ) submitted
  WHERE NOT EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = submitted.order_id
      AND o.store_id = p_store_id
  );

  IF v_already_reconciled > 0 THEN
    RAISE EXCEPTION 'Some order IDs are invalid or belong to another store (count: %)', v_already_reconciled;
  END IF;

  -- Generate settlement code with advisory lock protection
  SELECT 'LIQ-' || TO_CHAR(p_delivery_date, 'DDMMYYYY') || '-' ||
         LPAD((COALESCE(MAX(
           CASE
             WHEN settlement_code LIKE 'LIQ-' || TO_CHAR(p_delivery_date, 'DDMMYYYY') || '-%'
             THEN NULLIF(SPLIT_PART(settlement_code, '-', 3), '')::INT
             ELSE 0
           END
         ), 0) + 1)::TEXT, 3, '0')
  INTO v_settlement_code
  FROM daily_settlements
  WHERE store_id = p_store_id;

  -- Process each order
  FOR v_order IN SELECT * FROM jsonb_array_elements(p_orders)
  LOOP
    v_order_id := (v_order->>'order_id')::UUID;

    -- Get order details with row lock to prevent concurrent updates
    SELECT * INTO v_order_record
    FROM orders
    WHERE id = v_order_id
      AND store_id = p_store_id
      AND reconciled_at IS NULL -- Double-check not reconciled
    FOR UPDATE NOWAIT; -- Fail fast if locked

    IF v_order_record IS NULL THEN
      -- Order not found, already reconciled, or locked - skip
      CONTINUE;
    END IF;

    v_total_orders := v_total_orders + 1;

    -- Get zone rate for this order
    SELECT COALESCE(rate, 0) INTO v_zone_rate
    FROM carrier_zones
    WHERE carrier_id = p_carrier_id
      AND store_id = p_store_id
      AND zone_name = COALESCE(v_order_record.delivery_zone, 'default')
    LIMIT 1;

    -- If no zone rate found, try default or use 0
    IF v_zone_rate IS NULL THEN
      SELECT COALESCE(rate, 0) INTO v_zone_rate
      FROM carrier_zones
      WHERE carrier_id = p_carrier_id
        AND store_id = p_store_id
      LIMIT 1;
    END IF;

    v_zone_rate := COALESCE(v_zone_rate, 0);

    IF (v_order->>'delivered')::BOOLEAN THEN
      v_total_delivered := v_total_delivered + 1;
      v_total_carrier_fees := v_total_carrier_fees + v_zone_rate;

      -- Calculate COD expected
      IF LOWER(COALESCE(v_order_record.payment_method, '')) IN ('cod', 'cash', 'contra_entrega', 'efectivo', 'contra entrega') THEN
        v_total_cod_expected := v_total_cod_expected + COALESCE(v_order_record.total_price, 0);
      END IF;

      -- Mark order as reconciled (keep delivered status)
      UPDATE orders
      SET reconciled_at = NOW()
      WHERE id = v_order_id;
    ELSE
      v_total_not_delivered := v_total_not_delivered + 1;
      -- Failed attempt fee
      v_failed_attempt_fee := v_failed_attempt_fee + (v_zone_rate * v_failed_fee_percent / 100);

      -- Update order: mark as failed delivery but reconciled
      -- Note: We don't change sleeves_status to 'cancelled' - that's a business decision
      -- Instead we just mark it as reconciled with not delivered result
      UPDATE orders
      SET reconciled_at = NOW()
      WHERE id = v_order_id;
    END IF;
  END LOOP;

  -- Validate we processed at least one order
  IF v_total_orders = 0 THEN
    RAISE EXCEPTION 'No valid orders to process';
  END IF;

  -- Calculate net receivable
  v_net_receivable := p_total_amount_collected - v_total_carrier_fees - v_failed_attempt_fee;

  -- Create settlement record
  INSERT INTO daily_settlements (
    id,
    store_id,
    carrier_id,
    settlement_code,
    settlement_date,
    total_dispatched,
    total_delivered,
    total_not_delivered,
    total_cod_delivered,
    total_prepaid_delivered,
    total_cod_collected,
    total_carrier_fees,
    failed_attempt_fee,
    net_receivable,
    balance_due,
    status,
    notes,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    p_store_id,
    p_carrier_id,
    v_settlement_code,
    p_delivery_date,
    v_total_orders,
    v_total_delivered,
    v_total_not_delivered,
    -- COD delivered count: count of delivered orders with COD payment
    (SELECT COUNT(*) FROM jsonb_array_elements(p_orders) o
      WHERE (o->>'delivered')::BOOLEAN = TRUE
      AND EXISTS (
        SELECT 1 FROM orders ord
        WHERE ord.id = (o->>'order_id')::UUID
          AND ord.store_id = p_store_id
          AND LOWER(COALESCE(ord.payment_method, '')) IN ('cod', 'cash', 'contra_entrega', 'efectivo', 'contra entrega')
      ))::INT,
    -- Prepaid delivered count: delivered orders WITHOUT COD payment
    (SELECT COUNT(*) FROM jsonb_array_elements(p_orders) o
      WHERE (o->>'delivered')::BOOLEAN = TRUE
      AND EXISTS (
        SELECT 1 FROM orders ord
        WHERE ord.id = (o->>'order_id')::UUID
          AND ord.store_id = p_store_id
          AND LOWER(COALESCE(ord.payment_method, '')) NOT IN ('cod', 'cash', 'contra_entrega', 'efectivo', 'contra entrega')
      ))::INT,
    p_total_amount_collected,
    v_total_carrier_fees,
    v_failed_attempt_fee,
    v_net_receivable,
    v_net_receivable,
    'pending',
    p_discrepancy_notes,
    p_user_id,
    NOW(),
    NOW()
  )
  RETURNING id INTO v_settlement_id;

  -- Return results
  RETURN QUERY SELECT
    v_settlement_id,
    v_settlement_code,
    v_total_orders,
    v_total_delivered,
    v_total_not_delivered,
    v_total_cod_expected,
    p_total_amount_collected,
    v_total_carrier_fees,
    v_failed_attempt_fee,
    v_net_receivable;
END;
$$;

-- 5. Helper function to get display order number consistently
CREATE OR REPLACE FUNCTION get_display_order_number(
  p_shopify_order_name TEXT,
  p_shopify_order_number BIGINT,
  p_order_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- Priority 1: Shopify order name (#1315 format)
  IF p_shopify_order_name IS NOT NULL AND p_shopify_order_name != '' THEN
    RETURN p_shopify_order_name;
  END IF;

  -- Priority 2: Shopify order number as #XXXX
  IF p_shopify_order_number IS NOT NULL THEN
    RETURN '#' || p_shopify_order_number::TEXT;
  END IF;

  -- Priority 3: Last 4 chars of UUID as #XXXX
  RETURN '#' || UPPER(RIGHT(p_order_id::TEXT, 4));
END;
$$;

-- Add comment for documentation
COMMENT ON VIEW v_pending_reconciliation IS
'Groups delivered orders that have not been reconciled, by delivery date and carrier.
Used for the simplified reconciliation workflow.';

COMMENT ON FUNCTION get_pending_reconciliation_orders IS
'Returns all delivered orders for a specific date and carrier that need reconciliation.';

COMMENT ON FUNCTION process_delivery_reconciliation IS
'Atomically processes reconciliation for a group of delivered orders, creating a settlement record.';

COMMENT ON FUNCTION get_display_order_number IS
'Returns a consistent display order number in #XXXX format, preferring Shopify names over UUIDs.';
