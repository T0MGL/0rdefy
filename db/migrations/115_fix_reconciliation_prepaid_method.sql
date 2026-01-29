-- ============================================================
-- Migration 115: Fix Reconciliation Prepaid Method Detection
--
-- PRODUCTION-READY VERSION
--
-- CRITICAL BUG FIX: The reconciliation system was not checking
-- the prepaid_method field when determining if an order is COD.
--
-- Problem: When a COD order (payment_method = 'efectivo') is later
-- marked as prepaid (prepaid_method = 'transferencia'), the system
-- still treated it as COD and expected the courier to collect money.
--
-- Fix: Add prepaid_method IS NULL check to all COD detection logic
--
-- IDEMPOTENT: Safe to run multiple times
-- ============================================================

-- Wrap in transaction for safety
BEGIN;

-- ============================================================
-- 1. Helper function first (used by views and other functions)
-- ============================================================
CREATE OR REPLACE FUNCTION is_order_cod(
  p_payment_method TEXT,
  p_prepaid_method TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  -- Order is COD only if:
  -- 1. prepaid_method is NULL (not marked as prepaid)
  -- 2. payment_method is a COD type (or empty, which defaults to COD)
  SELECT p_prepaid_method IS NULL
    AND LOWER(COALESCE(p_payment_method, '')) IN ('cod', 'cash', 'contra_entrega', 'efectivo', 'contra entrega', '');
$$;

COMMENT ON FUNCTION is_order_cod(TEXT, TEXT) IS
'Determines if an order should be treated as COD.
Returns FALSE if prepaid_method is set, even if payment_method is efectivo.
Migration 115 - Critical fix for prepaid detection.';


-- ============================================================
-- 2. Fix the pending reconciliation view
-- ============================================================
DROP VIEW IF EXISTS v_pending_reconciliation CASCADE;

CREATE VIEW v_pending_reconciliation AS
SELECT
  o.store_id,
  (o.delivered_at::date) as delivery_date,
  o.courier_id as carrier_id,
  c.name as carrier_name,
  COALESCE(c.failed_attempt_fee_percent, 50) as failed_attempt_fee_percent,
  COUNT(*) as total_orders,
  -- COD total: use helper function for consistency
  SUM(CASE WHEN is_order_cod(o.payment_method, o.prepaid_method)
      THEN COALESCE(o.total_price, 0) ELSE 0 END) as total_cod,
  -- Prepaid count: inverse of COD
  COUNT(*) FILTER (WHERE NOT is_order_cod(o.payment_method, o.prepaid_method)) as total_prepaid
FROM orders o
JOIN carriers c ON c.id = o.courier_id
WHERE o.sleeves_status = 'delivered'
  AND o.reconciled_at IS NULL
  AND o.delivered_at IS NOT NULL
  AND o.courier_id IS NOT NULL
GROUP BY o.store_id, (o.delivered_at::date), o.courier_id, c.name, c.failed_attempt_fee_percent;

COMMENT ON VIEW v_pending_reconciliation IS
'Groups delivered orders pending reconciliation by date and carrier.
Uses is_order_cod() for COD detection (Migration 115).';


-- ============================================================
-- 3. Fix the get_pending_reconciliation_orders function
-- NOTE: Must DROP first because we're adding prepaid_method to return type
-- ============================================================
DROP FUNCTION IF EXISTS get_pending_reconciliation_orders(UUID, UUID, DATE);

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
  prepaid_method TEXT,
  is_cod BOOLEAN,
  delivered_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id,
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
      WHEN pg_typeof(o.shipping_address) = 'jsonb'::regtype
        THEN COALESCE(o.shipping_address->>'address1', '')
      ELSE COALESCE(o.shipping_address::text, '')
    END as customer_address,
    COALESCE(o.shipping_city, o.delivery_zone, '') as customer_city,
    COALESCE(o.total_price, 0) as total_price,
    -- COD amount using helper function
    CASE WHEN is_order_cod(o.payment_method, o.prepaid_method)
      THEN COALESCE(o.total_price, 0) ELSE 0 END as cod_amount,
    COALESCE(o.payment_method, '') as payment_method,
    o.prepaid_method as prepaid_method,
    is_order_cod(o.payment_method, o.prepaid_method) as is_cod,
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

COMMENT ON FUNCTION get_pending_reconciliation_orders(UUID, UUID, DATE) IS
'Returns delivered orders for reconciliation. Uses is_order_cod() (Migration 115).';


-- ============================================================
-- 4. Fix process_delivery_reconciliation function
-- NOTE: DROP first to ensure clean replacement
-- ============================================================
DROP FUNCTION IF EXISTS process_delivery_reconciliation(UUID, UUID, UUID, DATE, NUMERIC, TEXT, JSONB);

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
  v_already_reconciled INT;
  v_is_cod BOOLEAN;
  v_has_coverage_table BOOLEAN;
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
  IF jsonb_array_length(p_orders) = 0 THEN
    RAISE EXCEPTION 'orders array cannot be empty';
  END IF;

  -- Check if carrier_coverage table exists (for backwards compatibility)
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'carrier_coverage'
  ) INTO v_has_coverage_table;

  -- Acquire advisory lock
  v_lock_key := hashtext(p_store_id::text || p_carrier_id::text || p_delivery_date::text);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Get carrier info
  SELECT name, COALESCE(failed_attempt_fee_percent, 50)
  INTO v_carrier_name, v_failed_fee_percent
  FROM carriers
  WHERE id = p_carrier_id;

  IF v_carrier_name IS NULL THEN
    RAISE EXCEPTION 'Carrier not found: %', p_carrier_id;
  END IF;

  -- Check if any orders are already reconciled
  SELECT COUNT(*) INTO v_already_reconciled
  FROM orders o
  WHERE o.id IN (SELECT (jsonb_array_elements(p_orders)->>'order_id')::UUID)
    AND o.store_id = p_store_id
    AND o.reconciled_at IS NOT NULL;

  IF v_already_reconciled > 0 THEN
    RAISE EXCEPTION 'Some orders are already reconciled (count: %)', v_already_reconciled;
  END IF;

  -- Validate all orders exist
  SELECT COUNT(*) INTO v_already_reconciled
  FROM (SELECT (jsonb_array_elements(p_orders)->>'order_id')::UUID as order_id) submitted
  WHERE NOT EXISTS (
    SELECT 1 FROM orders o WHERE o.id = submitted.order_id AND o.store_id = p_store_id
  );

  IF v_already_reconciled > 0 THEN
    RAISE EXCEPTION 'Invalid order IDs (count: %)', v_already_reconciled;
  END IF;

  -- Generate settlement code
  SELECT 'LIQ-' || TO_CHAR(p_delivery_date, 'DDMMYYYY') || '-' ||
         LPAD((COALESCE(MAX(
           CASE WHEN settlement_code ~ ('^LIQ-' || TO_CHAR(p_delivery_date, 'DDMMYYYY') || '-[0-9]+$')
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

    -- Get order with row lock
    SELECT * INTO v_order_record
    FROM orders
    WHERE id = v_order_id AND store_id = p_store_id AND reconciled_at IS NULL
    FOR UPDATE NOWAIT;

    IF v_order_record IS NULL THEN
      CONTINUE;
    END IF;

    v_total_orders := v_total_orders + 1;

    -- Get carrier rate (city coverage -> zone -> default)
    v_zone_rate := NULL;

    -- Try carrier_coverage first (if table exists)
    IF v_has_coverage_table THEN
      EXECUTE format(
        'SELECT rate FROM carrier_coverage WHERE carrier_id = $1 AND is_active = TRUE
         AND LOWER(TRIM(city)) = LOWER(TRIM(COALESCE($2, $3, ''''))) LIMIT 1'
      ) INTO v_zone_rate
      USING p_carrier_id, v_order_record.shipping_city_normalized, v_order_record.shipping_city;
    END IF;

    -- Try carrier_zones if no coverage
    IF v_zone_rate IS NULL THEN
      SELECT rate INTO v_zone_rate
      FROM carrier_zones
      WHERE carrier_id = p_carrier_id AND store_id = p_store_id
        AND LOWER(TRIM(zone_name)) = LOWER(TRIM(COALESCE(v_order_record.delivery_zone, '')))
      LIMIT 1;
    END IF;

    -- Default rate
    IF v_zone_rate IS NULL THEN
      SELECT COALESCE(rate, 0) INTO v_zone_rate
      FROM carrier_zones
      WHERE carrier_id = p_carrier_id AND store_id = p_store_id
      LIMIT 1;
    END IF;

    v_zone_rate := COALESCE(v_zone_rate, 0);

    -- CRITICAL: Use is_order_cod helper for consistent COD detection
    v_is_cod := is_order_cod(v_order_record.payment_method, v_order_record.prepaid_method);

    IF (v_order->>'delivered')::BOOLEAN THEN
      v_total_delivered := v_total_delivered + 1;
      v_total_carrier_fees := v_total_carrier_fees + v_zone_rate;

      IF v_is_cod THEN
        v_total_cod_expected := v_total_cod_expected + COALESCE(v_order_record.total_price, 0);
      END IF;

      UPDATE orders SET reconciled_at = NOW() WHERE id = v_order_id;
    ELSE
      v_total_not_delivered := v_total_not_delivered + 1;
      v_failed_attempt_fee := v_failed_attempt_fee + (v_zone_rate * v_failed_fee_percent / 100);
      UPDATE orders SET reconciled_at = NOW() WHERE id = v_order_id;
    END IF;
  END LOOP;

  IF v_total_orders = 0 THEN
    RAISE EXCEPTION 'No valid orders to process';
  END IF;

  v_net_receivable := p_total_amount_collected - v_total_carrier_fees - v_failed_attempt_fee;

  -- Create settlement
  INSERT INTO daily_settlements (
    id, store_id, carrier_id, settlement_code, settlement_date,
    total_dispatched, total_delivered, total_not_delivered,
    total_cod_delivered, total_prepaid_delivered,
    total_cod_collected, total_carrier_fees, failed_attempt_fee,
    net_receivable, balance_due, status, notes, created_by, created_at, updated_at
  )
  SELECT
    gen_random_uuid(), p_store_id, p_carrier_id, v_settlement_code, p_delivery_date,
    v_total_orders, v_total_delivered, v_total_not_delivered,
    -- COD delivered count
    (SELECT COUNT(*) FROM jsonb_array_elements(p_orders) o
      WHERE (o->>'delivered')::BOOLEAN = TRUE
      AND EXISTS (SELECT 1 FROM orders ord WHERE ord.id = (o->>'order_id')::UUID
        AND ord.store_id = p_store_id AND is_order_cod(ord.payment_method, ord.prepaid_method)))::INT,
    -- Prepaid delivered count
    (SELECT COUNT(*) FROM jsonb_array_elements(p_orders) o
      WHERE (o->>'delivered')::BOOLEAN = TRUE
      AND EXISTS (SELECT 1 FROM orders ord WHERE ord.id = (o->>'order_id')::UUID
        AND ord.store_id = p_store_id AND NOT is_order_cod(ord.payment_method, ord.prepaid_method)))::INT,
    p_total_amount_collected, v_total_carrier_fees, v_failed_attempt_fee,
    v_net_receivable, v_net_receivable, 'pending', p_discrepancy_notes, p_user_id, NOW(), NOW()
  RETURNING id INTO v_settlement_id;

  RETURN QUERY SELECT
    v_settlement_id, v_settlement_code, v_total_orders, v_total_delivered,
    v_total_not_delivered, v_total_cod_expected, p_total_amount_collected,
    v_total_carrier_fees, v_failed_attempt_fee, v_net_receivable;
END;
$$;

COMMENT ON FUNCTION process_delivery_reconciliation IS
'Atomic reconciliation processing. Uses is_order_cod() for COD detection (Migration 115).';


-- ============================================================
-- 5. Debug view for monitoring (optional, safe)
-- ============================================================
DROP VIEW IF EXISTS v_orders_prepaid_status;

CREATE VIEW v_orders_prepaid_status AS
SELECT
  o.id,
  o.store_id,
  COALESCE(o.shopify_order_name, '#' || UPPER(RIGHT(o.id::text, 4))) as order_number,
  o.payment_method,
  o.prepaid_method,
  o.total_price,
  o.sleeves_status,
  o.reconciled_at,
  CASE
    WHEN o.prepaid_method IS NOT NULL THEN 'PREPAID (marked)'
    WHEN is_order_cod(o.payment_method, o.prepaid_method) THEN 'COD'
    ELSE 'PREPAID (payment method)'
  END as effective_payment_type,
  is_order_cod(o.payment_method, o.prepaid_method) as is_cod
FROM orders o
WHERE o.sleeves_status = 'delivered'
  AND o.reconciled_at IS NULL;

COMMENT ON VIEW v_orders_prepaid_status IS
'Debug view for prepaid detection. Migration 115.';


-- ============================================================
-- 6. Verification query (run after commit to verify)
-- ============================================================
DO $$
DECLARE
  v_function_exists BOOLEAN;
  v_view_exists BOOLEAN;
BEGIN
  -- Verify is_order_cod function
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'is_order_cod'
  ) INTO v_function_exists;

  IF NOT v_function_exists THEN
    RAISE EXCEPTION 'Migration 115 FAILED: is_order_cod function not created';
  END IF;

  -- Verify view
  SELECT EXISTS (
    SELECT 1 FROM pg_views WHERE viewname = 'v_pending_reconciliation'
  ) INTO v_view_exists;

  IF NOT v_view_exists THEN
    RAISE EXCEPTION 'Migration 115 FAILED: v_pending_reconciliation view not created';
  END IF;

  RAISE NOTICE 'Migration 115 VERIFIED: All objects created successfully';
END $$;

COMMIT;

-- ============================================================
-- Post-migration verification (run manually to confirm)
-- ============================================================
-- SELECT is_order_cod('efectivo', NULL);           -- Should return TRUE
-- SELECT is_order_cod('efectivo', 'transferencia'); -- Should return FALSE
-- SELECT is_order_cod('tarjeta', NULL);            -- Should return FALSE
-- SELECT is_order_cod(NULL, NULL);                 -- Should return TRUE (default COD)
