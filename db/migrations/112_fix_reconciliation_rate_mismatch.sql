-- ============================================================================
-- MIGRATION 112: Fix Reconciliation Rate Mismatch (PRODUCTION-READY)
-- ============================================================================
--
-- BUG: Amount mismatch between reconciliation summary and payment step
--
-- Problem:
--   The frontend calculates carrier fees using BOTH rate systems:
--     1. carrier_coverage (city-based rates, migration 090) - checked FIRST
--     2. carrier_zones (zone-based rates, legacy) - fallback
--
--   The backend RPC process_delivery_reconciliation (migration 100) ONLY uses
--   carrier_zones. It never checks carrier_coverage.
--
--   Result: The "Resumen Financiero" shows one NETO A RECIBIR, but after
--   confirming, the backend calculates a different net_receivable using
--   different rates. The payment step then shows the wrong amount.
--
-- Fix:
--   Update the RPC to check carrier_coverage FIRST (by shipping_city),
--   then fall back to carrier_zones (by delivery_zone),
--   then fall back to any carrier_zones rate for the carrier.
--   This matches the frontend's rate lookup logic exactly.
--
-- SAFETY:
--   - Idempotent (CREATE OR REPLACE)
--   - Transaction wrapped for atomicity
--   - Backward compatible (carrier_coverage table check with EXISTS)
--   - No data modification to existing settlements
--   - Includes data fix query for LIQ-23012026-002
--
-- ROLLBACK: Re-run migration 100 to restore original RPC
--
-- Date: 2026-01-26
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Update RPC to use carrier_coverage (city-based rates) first
-- ============================================================================

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
  v_has_coverage_table BOOLEAN := FALSE;
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

  -- Check if carrier_coverage table exists (migration 090)
  SELECT EXISTS(
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'carrier_coverage'
  ) INTO v_has_coverage_table;

  -- Acquire advisory lock to prevent concurrent reconciliations for same store/date/carrier
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

  -- Check if any orders are already reconciled
  SELECT COUNT(*) INTO v_already_reconciled
  FROM orders o
  WHERE o.id IN (SELECT (jsonb_array_elements(p_orders)->>'order_id')::UUID)
    AND o.store_id = p_store_id
    AND o.reconciled_at IS NOT NULL;

  IF v_already_reconciled > 0 THEN
    RAISE EXCEPTION 'Some orders are already reconciled (count: %)', v_already_reconciled;
  END IF;

  -- Validate all orders exist and belong to this store
  SELECT COUNT(*) INTO v_already_reconciled
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

    -- Get order details with row lock
    SELECT * INTO v_order_record
    FROM orders
    WHERE id = v_order_id
      AND store_id = p_store_id
      AND reconciled_at IS NULL
    FOR UPDATE NOWAIT;

    IF v_order_record IS NULL THEN
      CONTINUE;
    END IF;

    v_total_orders := v_total_orders + 1;

    -- ================================================================
    -- RATE LOOKUP: city-based coverage FIRST, then zone-based fallback
    -- This matches the frontend logic exactly (migration 112 fix)
    -- ================================================================
    v_zone_rate := NULL;

    -- Priority 1: City-based coverage (carrier_coverage table, migration 090)
    IF v_has_coverage_table AND v_order_record.shipping_city IS NOT NULL
       AND TRIM(v_order_record.shipping_city) != '' THEN
      SELECT rate INTO v_zone_rate
      FROM carrier_coverage
      WHERE carrier_id = p_carrier_id
        AND LOWER(TRIM(city)) = LOWER(TRIM(v_order_record.shipping_city))
        AND is_active = TRUE
      LIMIT 1;
    END IF;

    -- Priority 2: Zone-based rate (carrier_zones table, legacy)
    IF v_zone_rate IS NULL AND v_order_record.delivery_zone IS NOT NULL THEN
      SELECT COALESCE(rate, 0) INTO v_zone_rate
      FROM carrier_zones
      WHERE carrier_id = p_carrier_id
        AND store_id = p_store_id
        AND LOWER(zone_name) = LOWER(v_order_record.delivery_zone)
      LIMIT 1;
    END IF;

    -- Priority 3: Any rate for this carrier (fallback)
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

      -- Mark order as reconciled
      UPDATE orders
      SET reconciled_at = NOW()
      WHERE id = v_order_id;
    ELSE
      v_total_not_delivered := v_total_not_delivered + 1;
      v_failed_attempt_fee := v_failed_attempt_fee + (v_zone_rate * v_failed_fee_percent / 100);

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
    -- COD delivered count
    (SELECT COUNT(*) FROM jsonb_array_elements(p_orders) o
      WHERE (o->>'delivered')::BOOLEAN = TRUE
      AND EXISTS (
        SELECT 1 FROM orders ord
        WHERE ord.id = (o->>'order_id')::UUID
          AND ord.store_id = p_store_id
          AND LOWER(COALESCE(ord.payment_method, '')) IN ('cod', 'cash', 'contra_entrega', 'efectivo', 'contra entrega')
      ))::INT,
    -- Prepaid delivered count
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

COMMENT ON FUNCTION process_delivery_reconciliation IS
'Atomically processes reconciliation for delivered orders.
UPDATED in migration 112: Now checks carrier_coverage (city-based) before carrier_zones (zone-based)
to match frontend rate calculation and prevent amount mismatch.';

-- ============================================================================
-- STEP 2: Verification
-- ============================================================================

DO $$
DECLARE
  v_function_has_coverage BOOLEAN;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================';
  RAISE NOTICE '  MIGRATION 112 - VERIFICATION';
  RAISE NOTICE '============================================';

  -- Check function now references carrier_coverage
  SELECT prosrc LIKE '%carrier_coverage%'
  INTO v_function_has_coverage
  FROM pg_proc
  WHERE proname = 'process_delivery_reconciliation';

  IF v_function_has_coverage THEN
    RAISE NOTICE 'OK: process_delivery_reconciliation now checks carrier_coverage';
  ELSE
    RAISE WARNING 'FAIL: Function does NOT reference carrier_coverage';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE 'CHANGES APPLIED:';
  RAISE NOTICE '  1. RPC now checks carrier_coverage (city-based) FIRST';
  RAISE NOTICE '  2. Falls back to carrier_zones (zone-based) if no city match';
  RAISE NOTICE '  3. Frontend and backend now use same rate lookup logic';
  RAISE NOTICE '';
  RAISE NOTICE 'TO FIX EXISTING SETTLEMENTS WITH WRONG AMOUNTS:';
  RAISE NOTICE '  See bottom of this file for manual correction queries.';
  RAISE NOTICE '============================================';
END $$;

COMMIT;

-- ============================================================================
-- MANUAL FIX: Correct existing settlement LIQ-23012026-002
-- ============================================================================
--
-- Run this AFTER the migration to fix the specific settlement.
-- Replace the values with the correct amounts calculated from the frontend.
--
-- To find the correct amounts, query the orders in this settlement:
--
--   SELECT ds.*, ds.net_receivable as stored_net,
--          ds.total_carrier_fees as stored_fees,
--          ds.failed_attempt_fee as stored_failed_fee
--   FROM daily_settlements ds
--   WHERE ds.settlement_code = 'LIQ-23012026-002';
--
-- To recalculate using city-based rates:
--
--   SELECT o.id, o.shipping_city, o.delivery_zone,
--          COALESCE(
--            (SELECT cc.rate FROM carrier_coverage cc
--             WHERE cc.carrier_id = ds.carrier_id
--               AND LOWER(TRIM(cc.city)) = LOWER(TRIM(o.shipping_city))
--               AND cc.is_active = TRUE LIMIT 1),
--            (SELECT cz.rate FROM carrier_zones cz
--             WHERE cz.carrier_id = ds.carrier_id
--               AND cz.store_id = ds.store_id
--               AND LOWER(cz.zone_name) = LOWER(o.delivery_zone) LIMIT 1),
--            (SELECT cz.rate FROM carrier_zones cz
--             WHERE cz.carrier_id = ds.carrier_id
--               AND cz.store_id = ds.store_id LIMIT 1),
--            0
--          ) as correct_rate
--   FROM orders o
--   JOIN daily_settlements ds ON ds.settlement_code = 'LIQ-23012026-002'
--   WHERE o.reconciled_at IS NOT NULL
--     AND o.store_id = ds.store_id
--     AND o.courier_id = ds.carrier_id
--     AND o.delivered_at::date = ds.settlement_date;
--
-- Then update the settlement with corrected values:
--
--   UPDATE daily_settlements
--   SET total_carrier_fees = <correct_total_fees>,
--       failed_attempt_fee = <correct_failed_fees>,
--       net_receivable = total_cod_collected - <correct_total_fees> - <correct_failed_fees>,
--       balance_due = total_cod_collected - <correct_total_fees> - <correct_failed_fees>,
--       notes = COALESCE(notes, '') || E'\n[CORRECCION] Tarifas recalculadas por migration 112'
--   WHERE settlement_code = 'LIQ-23012026-002';
--
-- ============================================================================
-- ROLLBACK INSTRUCTIONS
-- ============================================================================
--
-- To rollback, re-run the original RPC from migration 100:
--   \i db/migrations/100_delivery_based_reconciliation.sql
--
-- ============================================================================
