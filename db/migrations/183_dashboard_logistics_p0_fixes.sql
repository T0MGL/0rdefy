-- ================================================================
-- Migration 183: Dashboard Logistics P0 Fixes
-- ================================================================
-- Fixes 3 P0 bugs surfaced by the dashboard logistics audit:
--
-- P0-1a: Backfill payment_status='collected' on orders that were
--        reconciled before the reconciliation flow updated this flag.
--        Affects Solenne (~103) and NOCTE (~55) COD orders that are
--        reconciled + delivered/settled but stuck in payment_status='pending'.
--        Uses the canonical is_order_cod() helper so cash/cod/efectivo/
--        cash_on_delivery variants are all covered. prepaid_method-flipped
--        orders are excluded (they are no longer COD).
--
-- P0-1b: Patch process_delivery_reconciliation (mig 100) and
--        process_reconciliation_by_carrier (mig 182) so they SET
--        payment_status='collected' atomically when a COD order is
--        reconciled as delivered. Prevents the stuck-pending pattern
--        from re-occurring.
--
-- Notes:
-- - Idempotent: backfill WHERE clause already excludes already-collected
--   rows; functions are CREATE OR REPLACE.
-- - Excludes deleted_at IS NOT NULL.
-- - Does NOT touch prepaid orders or failed deliveries.
-- - Runs in a single transaction; full rollback on any failure.
-- ================================================================

BEGIN;

-- ================================================================
-- P0-1a: Backfill payment_status='collected' for reconciled COD
-- terminal orders that are stuck in payment_status='pending'.
-- ================================================================
DO $$
DECLARE
  v_affected INT;
BEGIN
  UPDATE orders
  SET payment_status = 'collected',
      updated_at = NOW()
  WHERE reconciled_at IS NOT NULL
    AND sleeves_status IN ('delivered', 'settled')
    AND is_order_cod(payment_method, prepaid_method) = true
    AND (payment_status IS NULL OR payment_status NOT IN ('collected', 'paid'))
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RAISE NOTICE '[Migration 183] Backfilled payment_status on % orders', v_affected;
END $$;

-- ================================================================
-- P0-1b.1: Patch process_delivery_reconciliation (from mig 100)
-- Add payment_status='collected' to the delivered+COD UPDATE branch.
-- ================================================================
CREATE OR REPLACE FUNCTION public.process_delivery_reconciliation(
  p_store_id uuid,
  p_user_id uuid,
  p_carrier_id uuid,
  p_delivery_date date,
  p_total_amount_collected numeric,
  p_discrepancy_notes text DEFAULT NULL::text,
  p_orders jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE(
  settlement_id uuid,
  settlement_code text,
  total_orders integer,
  total_delivered integer,
  total_not_delivered integer,
  total_cod_expected numeric,
  total_cod_collected numeric,
  total_carrier_fees numeric,
  failed_attempt_fee numeric,
  net_receivable numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
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
  v_rate NUMERIC;
  v_lock_key BIGINT;
  v_already_reconciled INT;
  v_is_cod BOOLEAN;
BEGIN
  IF p_store_id IS NULL THEN RAISE EXCEPTION 'store_id is required'; END IF;
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user_id is required'; END IF;
  IF p_carrier_id IS NULL THEN RAISE EXCEPTION 'carrier_id is required'; END IF;
  IF p_delivery_date IS NULL THEN RAISE EXCEPTION 'delivery_date is required'; END IF;
  IF p_total_amount_collected IS NULL OR p_total_amount_collected < 0 THEN
    RAISE EXCEPTION 'total_amount_collected must be non-negative';
  END IF;
  IF jsonb_array_length(p_orders) = 0 THEN
    RAISE EXCEPTION 'orders array cannot be empty';
  END IF;

  v_lock_key := hashtext(p_store_id::text || p_carrier_id::text || p_delivery_date::text);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT name, COALESCE(failed_attempt_fee_percent, 50)
  INTO v_carrier_name, v_failed_fee_percent
  FROM carriers
  WHERE id = p_carrier_id;

  IF v_carrier_name IS NULL THEN
    RAISE EXCEPTION 'Carrier not found: %', p_carrier_id;
  END IF;

  SELECT COUNT(*) INTO v_already_reconciled
  FROM orders o
  WHERE o.id IN (SELECT (jsonb_array_elements(p_orders)->>'order_id')::UUID)
    AND o.store_id = p_store_id
    AND o.reconciled_at IS NOT NULL;

  IF v_already_reconciled > 0 THEN
    RAISE EXCEPTION 'Some orders are already reconciled (count: %)', v_already_reconciled;
  END IF;

  SELECT COUNT(*) INTO v_already_reconciled
  FROM (SELECT (jsonb_array_elements(p_orders)->>'order_id')::UUID AS order_id) submitted
  WHERE NOT EXISTS (
    SELECT 1 FROM orders o WHERE o.id = submitted.order_id AND o.store_id = p_store_id
  );

  IF v_already_reconciled > 0 THEN
    RAISE EXCEPTION 'Invalid order IDs (count: %)', v_already_reconciled;
  END IF;

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

  FOR v_order IN SELECT * FROM jsonb_array_elements(p_orders)
  LOOP
    v_order_id := (v_order->>'order_id')::UUID;

    SELECT * INTO v_order_record
    FROM orders
    WHERE id = v_order_id AND store_id = p_store_id AND reconciled_at IS NULL
    FOR UPDATE NOWAIT;

    IF v_order_record IS NULL THEN
      CONTINUE;
    END IF;

    v_total_orders := v_total_orders + 1;

    v_rate := get_carrier_fee_for_order(
      p_carrier_id,
      v_order_record.delivery_zone,
      COALESCE(v_order_record.shipping_city_normalized, v_order_record.shipping_city)
    );
    v_rate := COALESCE(v_rate, 0);

    v_is_cod := is_order_cod(v_order_record.payment_method, v_order_record.prepaid_method);

    IF (v_order->>'delivered')::BOOLEAN THEN
      v_total_delivered := v_total_delivered + 1;
      v_total_carrier_fees := v_total_carrier_fees + v_rate;

      IF v_is_cod THEN
        v_total_cod_expected := v_total_cod_expected + COALESCE(v_order_record.total_price, 0);
        -- P0-1b: mark COD as collected when reconciled as delivered.
        -- Cash is in courier hands. Settlement payout step transitions to 'paid' later.
        UPDATE orders
           SET reconciled_at = NOW(),
               payment_status = 'collected'
         WHERE id = v_order_id;
      ELSE
        -- Prepaid: do not touch payment_status; reconciliation only marks shipped fee.
        UPDATE orders SET reconciled_at = NOW() WHERE id = v_order_id;
      END IF;
    ELSE
      v_total_not_delivered := v_total_not_delivered + 1;
      v_failed_attempt_fee := v_failed_attempt_fee + (v_rate * v_failed_fee_percent / 100);
      -- Not delivered: cash was NOT collected; payment_status stays unchanged.
      UPDATE orders SET reconciled_at = NOW() WHERE id = v_order_id;
    END IF;
  END LOOP;

  IF v_total_orders = 0 THEN
    RAISE EXCEPTION 'No valid orders to process';
  END IF;

  v_net_receivable := p_total_amount_collected - v_total_carrier_fees - v_failed_attempt_fee;

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
    (SELECT COUNT(*) FROM jsonb_array_elements(p_orders) o
      WHERE (o->>'delivered')::BOOLEAN = TRUE
      AND EXISTS (SELECT 1 FROM orders ord WHERE ord.id = (o->>'order_id')::UUID
        AND ord.store_id = p_store_id AND is_order_cod(ord.payment_method, ord.prepaid_method)))::INT,
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
$function$;

-- ================================================================
-- P0-1b.2: Patch process_reconciliation_by_carrier (from mig 182)
-- Add payment_status='collected' to the delivered+COD UPDATE branch.
-- ================================================================
CREATE OR REPLACE FUNCTION public.process_reconciliation_by_carrier(
  p_store_id uuid,
  p_user_id uuid,
  p_carrier_id uuid,
  p_total_amount_collected numeric,
  p_discrepancy_notes text DEFAULT NULL::text,
  p_orders jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE(
  settlement_id uuid,
  settlement_code text,
  settlement_date date,
  min_delivery_date date,
  max_delivery_date date,
  total_orders integer,
  total_delivered integer,
  total_not_delivered integer,
  total_cod_expected numeric,
  total_cod_collected numeric,
  total_carrier_fees numeric,
  failed_attempt_fee numeric,
  net_receivable numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_settlement_id      UUID;
  v_settlement_code    TEXT;
  v_settlement_date    DATE := CURRENT_DATE;
  v_carrier_name       TEXT;
  v_failed_fee_percent NUMERIC;
  v_total_orders       INT     := 0;
  v_total_delivered    INT     := 0;
  v_total_not_delivered INT    := 0;
  v_total_cod_expected NUMERIC := 0;
  v_total_cod_delivered INT    := 0;
  v_total_prepaid_delivered INT := 0;
  v_total_carrier_fees NUMERIC := 0;
  v_failed_attempt_fee NUMERIC := 0;
  v_net_receivable     NUMERIC := 0;
  v_min_delivery_date  DATE;
  v_max_delivery_date  DATE;
  v_order              JSONB;
  v_order_id           UUID;
  v_order_record       RECORD;
  v_zone_rate          NUMERIC;
  v_lock_key           BIGINT;
  v_already_reconciled INT     := 0;
  v_processed_ids      UUID[]  := ARRAY[]::UUID[];
  v_is_cod             BOOLEAN;
BEGIN
  IF p_store_id   IS NULL THEN RAISE EXCEPTION 'store_id is required';   END IF;
  IF p_user_id    IS NULL THEN RAISE EXCEPTION 'user_id is required';    END IF;
  IF p_carrier_id IS NULL THEN RAISE EXCEPTION 'carrier_id is required'; END IF;
  IF p_total_amount_collected IS NULL OR p_total_amount_collected < 0 THEN
    RAISE EXCEPTION 'total_amount_collected must be non-negative';
  END IF;

  v_lock_key := hashtext(p_store_id::text || p_carrier_id::text || 'reconciliation_by_carrier');
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT name, failed_attempt_fee_percent
    INTO v_carrier_name, v_failed_fee_percent
  FROM carriers
  WHERE id = p_carrier_id
  FOR SHARE;

  IF v_carrier_name IS NULL THEN
    RAISE EXCEPTION 'Carrier not found: %', p_carrier_id;
  END IF;
  v_failed_fee_percent := COALESCE(v_failed_fee_percent, 50);

  SELECT COUNT(*) INTO v_already_reconciled
  FROM orders o
  WHERE o.id IN (SELECT (jsonb_array_elements(p_orders)->>'order_id')::UUID)
    AND o.store_id = p_store_id
    AND o.reconciled_at IS NOT NULL;

  IF v_already_reconciled > 0 THEN
    RAISE EXCEPTION 'Some orders are already reconciled (count: %)', v_already_reconciled;
  END IF;

  SELECT COUNT(*) INTO v_already_reconciled
  FROM (
    SELECT (jsonb_array_elements(p_orders)->>'order_id')::UUID AS order_id
  ) submitted
  WHERE NOT EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = submitted.order_id
      AND o.store_id = p_store_id
  );

  IF v_already_reconciled > 0 THEN
    RAISE EXCEPTION 'Some order IDs are invalid or belong to another store (count: %)', v_already_reconciled;
  END IF;

  SELECT 'LIQ-' || TO_CHAR(v_settlement_date, 'DDMMYYYY') || '-' ||
         LPAD(
           (COALESCE(MAX(
             CASE
               WHEN settlement_code LIKE 'LIQ-' || TO_CHAR(v_settlement_date, 'DDMMYYYY') || '-%'
                 THEN NULLIF(SPLIT_PART(settlement_code, '-', 3), '')::INT
               ELSE 0
             END
           ), 0) + 1)::TEXT,
           3, '0'
         )
    INTO v_settlement_code
  FROM daily_settlements
  WHERE store_id = p_store_id;

  FOR v_order IN SELECT * FROM jsonb_array_elements(p_orders)
  LOOP
    v_order_id := (v_order->>'order_id')::UUID;

    SELECT *
      INTO v_order_record
    FROM orders
    WHERE id = v_order_id
      AND store_id = p_store_id
      AND reconciled_at IS NULL
    FOR UPDATE NOWAIT;

    IF v_order_record IS NULL THEN
      CONTINUE;
    END IF;

    v_total_orders  := v_total_orders + 1;
    v_processed_ids := v_processed_ids || v_order_id;

    SELECT COALESCE(rate, 0) INTO v_zone_rate
    FROM carrier_zones
    WHERE carrier_id = p_carrier_id
      AND store_id   = p_store_id
      AND zone_name  = COALESCE(v_order_record.delivery_zone, 'default')
    LIMIT 1;

    IF v_zone_rate IS NULL THEN
      SELECT COALESCE(rate, 0) INTO v_zone_rate
      FROM carrier_zones
      WHERE carrier_id = p_carrier_id
        AND store_id   = p_store_id
      LIMIT 1;
    END IF;

    v_zone_rate := COALESCE(v_zone_rate, 0);

    -- Use canonical is_order_cod() helper so cash/cod/efectivo/cash_on_delivery
    -- variants are all treated consistently (instead of the inline LOWER IN list
    -- the previous version used, which missed 'cash_on_delivery' literal).
    v_is_cod := is_order_cod(v_order_record.payment_method, v_order_record.prepaid_method);

    IF (v_order->>'delivered')::BOOLEAN THEN
      v_total_delivered    := v_total_delivered + 1;
      v_total_carrier_fees := v_total_carrier_fees + v_zone_rate;

      IF v_is_cod THEN
        v_total_cod_expected   := v_total_cod_expected + COALESCE(v_order_record.cod_amount, v_order_record.total_price, 0);
        v_total_cod_delivered  := v_total_cod_delivered + 1;

        -- P0-1b: mark COD as collected when reconciled as delivered.
        UPDATE orders
           SET reconciled_at = NOW(),
               payment_status = 'collected'
         WHERE id = v_order_id;
      ELSE
        v_total_prepaid_delivered := v_total_prepaid_delivered + 1;
        -- Prepaid: do not touch payment_status; was already collected pre-shipping.
        UPDATE orders
           SET reconciled_at = NOW()
         WHERE id = v_order_id;
      END IF;
    ELSE
      v_total_not_delivered := v_total_not_delivered + 1;
      v_failed_attempt_fee  := v_failed_attempt_fee + (v_zone_rate * v_failed_fee_percent / 100);

      -- Not delivered: cash was NOT collected; payment_status stays as-is.
      UPDATE orders
         SET reconciled_at = NOW()
       WHERE id = v_order_id;
    END IF;
  END LOOP;

  IF v_total_orders = 0 THEN
    RAISE EXCEPTION 'No valid orders to process';
  END IF;

  SELECT MIN(o.delivered_at::date), MAX(o.delivered_at::date)
    INTO v_min_delivery_date, v_max_delivery_date
  FROM orders o
  WHERE o.id = ANY(v_processed_ids);

  v_net_receivable := p_total_amount_collected - v_total_carrier_fees - v_failed_attempt_fee;

  INSERT INTO daily_settlements (
    id,
    store_id,
    carrier_id,
    settlement_code,
    settlement_date,
    min_delivery_date,
    max_delivery_date,
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
    updated_at,
    expected_cash,
    collected_cash
  ) VALUES (
    gen_random_uuid(),
    p_store_id,
    p_carrier_id,
    v_settlement_code,
    v_settlement_date,
    v_min_delivery_date,
    v_max_delivery_date,
    v_total_orders,
    v_total_delivered,
    v_total_not_delivered,
    v_total_cod_delivered,
    v_total_prepaid_delivered,
    p_total_amount_collected,
    v_total_carrier_fees,
    v_failed_attempt_fee,
    v_net_receivable,
    v_net_receivable,
    'pending',
    p_discrepancy_notes,
    p_user_id,
    NOW(),
    NOW(),
    v_total_cod_expected,
    p_total_amount_collected
  )
  RETURNING id INTO v_settlement_id;

  RETURN QUERY SELECT
    v_settlement_id,
    v_settlement_code,
    v_settlement_date,
    v_min_delivery_date,
    v_max_delivery_date,
    v_total_orders,
    v_total_delivered,
    v_total_not_delivered,
    v_total_cod_expected,
    p_total_amount_collected,
    v_total_carrier_fees,
    v_failed_attempt_fee,
    v_net_receivable;
END;
$function$;

COMMIT;
