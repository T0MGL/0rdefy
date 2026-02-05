-- ============================================================
-- Migration 122: Fix non-deterministic rate fallback in reconciliation RPC
--
-- Date: 2026-02-04
--
-- PROBLEM: In process_delivery_reconciliation(), the Priority 3 fallback
-- (when no city coverage or zone match) uses LIMIT 1 without ORDER BY.
-- PostgreSQL returns an arbitrary row, so carriers with multiple zones
-- (e.g., Asuncion=25000, Interior=45000) get unpredictable rates.
--
-- FIX: Add deterministic ORDER BY with priority:
--   1. Zone named 'default' or 'otros' (common fallback names)
--   2. Zone named 'interior' or 'general' (secondary fallbacks)
--   3. Lowest rate (most conservative for the store)
--
-- SCOPE: Only changes the "Default rate" block (Priority 3).
-- All other logic (input validation, advisory lock, row locking,
-- reconciled_at updates, settlement INSERT) is preserved exactly
-- from Migration 115.
-- ============================================================

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

  -- Acquire advisory lock to prevent concurrent reconciliation of same date/carrier
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

  -- Generate settlement code (regex-based for strict matching)
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

    -- Get order with row lock to prevent concurrent reconciliation
    SELECT * INTO v_order_record
    FROM orders
    WHERE id = v_order_id AND store_id = p_store_id AND reconciled_at IS NULL
    FOR UPDATE NOWAIT;

    IF v_order_record IS NULL THEN
      CONTINUE;
    END IF;

    v_total_orders := v_total_orders + 1;

    -- Get carrier rate (city coverage -> zone -> deterministic default)
    v_zone_rate := NULL;

    -- Priority 1: Try carrier_coverage first (if table exists)
    IF v_has_coverage_table THEN
      EXECUTE format(
        'SELECT rate FROM carrier_coverage WHERE carrier_id = $1 AND is_active = TRUE
         AND LOWER(TRIM(city)) = LOWER(TRIM(COALESCE($2, $3, ''''))) LIMIT 1'
      ) INTO v_zone_rate
      USING p_carrier_id, v_order_record.shipping_city_normalized, v_order_record.shipping_city;
    END IF;

    -- Priority 2: Try carrier_zones by zone name
    IF v_zone_rate IS NULL THEN
      SELECT rate INTO v_zone_rate
      FROM carrier_zones
      WHERE carrier_id = p_carrier_id AND store_id = p_store_id
        AND LOWER(TRIM(zone_name)) = LOWER(TRIM(COALESCE(v_order_record.delivery_zone, '')))
      LIMIT 1;
    END IF;

    -- Priority 3: Deterministic fallback - prefer named defaults, then lowest rate
    -- FIX (Migration 122): Added ORDER BY to prevent non-deterministic rate selection
    IF v_zone_rate IS NULL THEN
      SELECT COALESCE(rate, 0) INTO v_zone_rate
      FROM carrier_zones
      WHERE carrier_id = p_carrier_id AND store_id = p_store_id
      ORDER BY
        CASE LOWER(TRIM(zone_name))
          WHEN 'default' THEN 1
          WHEN 'otros' THEN 2
          WHEN 'interior' THEN 3
          WHEN 'general' THEN 4
          ELSE 5
        END,
        rate ASC NULLS LAST
      LIMIT 1;
    END IF;

    v_zone_rate := COALESCE(v_zone_rate, 0);

    -- CRITICAL: Use is_order_cod helper for consistent COD detection (Migration 115)
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

  -- Create settlement record
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

-- Update documentation comment
COMMENT ON FUNCTION process_delivery_reconciliation IS
  'Atomic reconciliation with deterministic rate fallback (Migration 122, based on 115). '
  'Rate priority: city coverage > zone match > named fallback zones (default/otros/interior/general) > lowest rate. '
  'Includes advisory lock, row-level locking, reconciled_at tracking, COD via is_order_cod().';
