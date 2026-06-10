-- ============================================================================
-- Migration 204: process_reconciliation_by_carrier_v2, drop the order-level flag
-- ============================================================================
-- FORWARD-ONLY. SHADOW. v2 is still not wired (the live mig 200 function is
-- untouched), so this CREATE OR REPLACE is safe.
--
-- WHY
--   Migration 203 v2 had ZONE d: it set orders.has_amount_discrepancy = true on
--   every delivered-COD order of a settlement when collected != expected. That
--   was wrong on two counts:
--
--   1. has_amount_discrepancy is a PER-ORDER delivery signal. It is set at
--      delivery confirmation when a courier collects an amount that differs from
--      that single order's total, and the UI renders it per order with a
--      "Cobro: <amount_collected>" badge (Orders.tsx, OrderQuickView.tsx).
--      Overloading it with a settlement-level meaning would flag orders that had
--      no per-order delivery discrepancy.
--
--   2. It is redundant. The settlement-level discrepancy already lives in two
--      GENERATED columns on daily_settlements:
--        difference         = collected_cash - expected_cash
--        discrepancy_amount = total_cod_collected - COALESCE(total_cod_expected, total_cod_collected)
--      Persisting total_cod_expected (ZONE a, kept) makes discrepancy_amount
--      correct automatically. No order writes are needed for settlement-level
--      visibility. The settlement UI already reads collected - total_cod_expected.
--
--   This migration ships v2 without ZONE d. Zones a (persist total_cod_expected),
--   b (resolve_cod_expected), and c (settlement_orders junction) are kept. The
--   discrepancy becomes visible through the generated columns, the per-order flag
--   is left to mean only what it already means.
--
-- Zero behavior today: v2 is still shadow. No live function touched.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.process_reconciliation_by_carrier_v2(
  p_store_id uuid,
  p_user_id uuid,
  p_carrier_id uuid,
  p_total_amount_collected numeric,
  p_discrepancy_notes text DEFAULT NULL::text,
  p_orders jsonb DEFAULT '[]'::jsonb,
  p_extra_charges jsonb DEFAULT '[]'::jsonb
)
 RETURNS TABLE(settlement_id uuid, settlement_code text, settlement_date date, min_delivery_date date, max_delivery_date date, total_orders integer, total_delivered integer, total_not_delivered integer, total_cod_expected numeric, total_cod_collected numeric, total_carrier_fees numeric, total_extra_charges numeric, failed_attempt_fee numeric, net_receivable numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_settlement_id UUID; v_settlement_code TEXT; v_settlement_date DATE := CURRENT_DATE;
  v_carrier_name TEXT; v_failed_fee_percent NUMERIC;
  v_total_orders INT := 0; v_total_delivered INT := 0; v_total_not_delivered INT := 0;
  v_total_cod_expected NUMERIC := 0; v_total_cod_delivered INT := 0; v_total_prepaid_delivered INT := 0;
  v_total_carrier_fees NUMERIC := 0; v_failed_attempt_fee NUMERIC := 0; v_net_receivable NUMERIC := 0;
  v_min_delivery_date DATE; v_max_delivery_date DATE;
  v_order JSONB; v_order_id UUID; v_order_record RECORD; v_zone_rate NUMERIC;
  v_lock_key BIGINT; v_already_reconciled INT := 0; v_processed_ids UUID[] := ARRAY[]::UUID[];
  v_resolved_cod NUMERIC; v_min_cov_rate NUMERIC;
  v_extra JSONB; v_extra_description TEXT; v_extra_amount NUMERIC; v_total_extra_charges NUMERIC := 0;
  -- ZONE c: accumulate delivered-COD resolved amount per order for the junction.
  v_cod_order_ids UUID[] := ARRAY[]::UUID[];
  v_cod_order_amounts NUMERIC[] := ARRAY[]::NUMERIC[];
  v_i INT;
BEGIN
  IF p_store_id IS NULL THEN RAISE EXCEPTION 'store_id is required'; END IF;
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user_id is required'; END IF;
  IF p_carrier_id IS NULL THEN RAISE EXCEPTION 'carrier_id is required'; END IF;
  IF p_total_amount_collected IS NULL OR p_total_amount_collected < 0 THEN
    RAISE EXCEPTION 'total_amount_collected must be non-negative'; END IF;
  IF jsonb_typeof(p_extra_charges) IS NOT NULL AND jsonb_typeof(p_extra_charges) <> 'array' THEN
    RAISE EXCEPTION 'p_extra_charges must be a JSON array'; END IF;
  IF p_extra_charges IS NOT NULL AND jsonb_array_length(p_extra_charges) > 50 THEN
    RAISE EXCEPTION 'Too many extra charges (max 50 per settlement)'; END IF;

  v_lock_key := hashtext(p_store_id::text || p_carrier_id::text || 'reconciliation_by_carrier');
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT name, failed_attempt_fee_percent INTO v_carrier_name, v_failed_fee_percent
  FROM carriers WHERE id = p_carrier_id FOR SHARE;
  IF v_carrier_name IS NULL THEN RAISE EXCEPTION 'Carrier not found: %', p_carrier_id; END IF;
  v_failed_fee_percent := COALESCE(v_failed_fee_percent, 50);

  SELECT MIN(rate) INTO v_min_cov_rate FROM carrier_coverage
  WHERE carrier_id = p_carrier_id AND store_id = p_store_id AND is_active = true AND rate > 0;
  v_min_cov_rate := COALESCE(v_min_cov_rate, 0);

  SELECT COUNT(*) INTO v_already_reconciled FROM orders o
  WHERE o.id IN (SELECT (jsonb_array_elements(p_orders)->>'order_id')::UUID)
    AND o.store_id = p_store_id AND o.reconciled_at IS NOT NULL;
  IF v_already_reconciled > 0 THEN
    RAISE EXCEPTION 'Some orders are already reconciled (count: %)', v_already_reconciled; END IF;

  SELECT COUNT(*) INTO v_already_reconciled
  FROM (SELECT (jsonb_array_elements(p_orders)->>'order_id')::UUID AS order_id) submitted
  WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = submitted.order_id AND o.store_id = p_store_id);
  IF v_already_reconciled > 0 THEN
    RAISE EXCEPTION 'Some order IDs are invalid or belong to another store (count: %)', v_already_reconciled; END IF;

  SELECT 'LIQ-' || TO_CHAR(v_settlement_date,'DDMMYYYY') || '-' ||
    LPAD((COALESCE(MAX(CASE WHEN ds.settlement_code LIKE 'LIQ-'||TO_CHAR(v_settlement_date,'DDMMYYYY')||'-%'
      THEN NULLIF(SPLIT_PART(ds.settlement_code,'-',3),'')::INT ELSE 0 END),0)+1)::TEXT,3,'0')
  INTO v_settlement_code FROM daily_settlements ds WHERE ds.store_id = p_store_id;

  FOR v_order IN SELECT * FROM jsonb_array_elements(p_orders) LOOP
    v_order_id := (v_order->>'order_id')::UUID;
    SELECT * INTO v_order_record FROM orders
    WHERE id = v_order_id AND store_id = p_store_id AND reconciled_at IS NULL FOR UPDATE NOWAIT;
    IF v_order_record IS NULL THEN CONTINUE; END IF;
    v_total_orders := v_total_orders + 1;
    v_processed_ids := v_processed_ids || v_order_id;

    SELECT cc.rate INTO v_zone_rate FROM carrier_coverage cc
    WHERE cc.carrier_id = p_carrier_id AND cc.store_id = p_store_id AND cc.is_active = true AND cc.rate > 0
      AND normalize_location_text(trim(cc.city)) = normalize_location_text(trim(COALESCE(v_order_record.shipping_city_normalized, v_order_record.shipping_city, '')))
    LIMIT 1;
    IF v_zone_rate IS NULL THEN
      SELECT cc.rate INTO v_zone_rate FROM carrier_coverage cc
      WHERE cc.carrier_id = p_carrier_id AND cc.store_id = p_store_id AND cc.is_active = true AND cc.rate > 0
        AND normalize_location_text(trim(cc.city)) = normalize_location_text(trim(COALESCE(v_order_record.delivery_zone, '')))
      LIMIT 1;
    END IF;
    v_zone_rate := COALESCE(v_zone_rate, v_min_cov_rate, 0);

    -- ZONE b: centralized COD resolution (was inline CASE in mig 200).
    v_resolved_cod := resolve_cod_expected(v_order_record.cod_amount, v_order_record.total_price);

    IF (v_order->>'delivered')::BOOLEAN THEN
      v_total_delivered := v_total_delivered + 1;
      v_total_carrier_fees := v_total_carrier_fees + v_zone_rate;
      IF v_order_record.prepaid_method IS NULL AND is_cod_payment_method(v_order_record.payment_method) THEN
        v_total_cod_expected := v_total_cod_expected + v_resolved_cod;
        v_total_cod_delivered := v_total_cod_delivered + 1;
        -- ZONE c: queue delivered-COD order for the junction write.
        v_cod_order_ids := v_cod_order_ids || v_order_id;
        v_cod_order_amounts := v_cod_order_amounts || v_resolved_cod;
      ELSE
        v_total_prepaid_delivered := v_total_prepaid_delivered + 1;
      END IF;
      UPDATE orders SET reconciled_at = NOW() WHERE id = v_order_id;
    ELSE
      v_total_not_delivered := v_total_not_delivered + 1;
      v_failed_attempt_fee := v_failed_attempt_fee + (v_zone_rate * v_failed_fee_percent / 100);
      UPDATE orders SET reconciled_at = NOW() WHERE id = v_order_id;
    END IF;
  END LOOP;

  IF v_total_orders = 0 THEN RAISE EXCEPTION 'No valid orders to process'; END IF;

  SELECT MIN(o.delivered_at::date), MAX(o.delivered_at::date)
  INTO v_min_delivery_date, v_max_delivery_date FROM orders o WHERE o.id = ANY(v_processed_ids);

  IF p_extra_charges IS NOT NULL AND jsonb_array_length(p_extra_charges) > 0 THEN
    FOR v_extra IN SELECT * FROM jsonb_array_elements(p_extra_charges) LOOP
      v_extra_description := btrim(COALESCE(v_extra->>'description',''));
      v_extra_amount := COALESCE((v_extra->>'amount')::NUMERIC,0);
      IF length(v_extra_description)=0 OR length(v_extra_description)>200 THEN
        RAISE EXCEPTION 'Extra charge description must be 1-200 chars (got %)', length(v_extra_description); END IF;
      IF v_extra_amount < 0 THEN RAISE EXCEPTION 'Extra charge amount must be >= 0 (got %)', v_extra_amount; END IF;
      v_total_extra_charges := v_total_extra_charges + v_extra_amount;
    END LOOP;
  END IF;

  v_total_carrier_fees := v_total_carrier_fees + v_total_extra_charges;
  v_net_receivable := p_total_amount_collected - v_total_carrier_fees - v_failed_attempt_fee;

  -- ZONE a: persist total_cod_expected so the generated columns
  -- difference and discrepancy_amount compute the settlement discrepancy
  -- correctly. mig 200 omitted it, leaving total_cod_expected at 0.
  INSERT INTO daily_settlements (
    id, store_id, carrier_id, settlement_code, settlement_date, min_delivery_date, max_delivery_date,
    total_dispatched, total_delivered, total_not_delivered, total_cod_delivered, total_prepaid_delivered,
    total_cod_expected,
    total_cod_collected, total_carrier_fees, total_extra_charges, failed_attempt_fee, net_receivable,
    balance_due, status, notes, created_by, created_at, updated_at, expected_cash, collected_cash
  ) VALUES (
    gen_random_uuid(), p_store_id, p_carrier_id, v_settlement_code, v_settlement_date,
    v_min_delivery_date, v_max_delivery_date, v_total_orders, v_total_delivered, v_total_not_delivered,
    v_total_cod_delivered, v_total_prepaid_delivered,
    v_total_cod_expected,
    p_total_amount_collected, v_total_carrier_fees,
    v_total_extra_charges, v_failed_attempt_fee, v_net_receivable, v_net_receivable, 'pending',
    p_discrepancy_notes, p_user_id, NOW(), NOW(), v_total_cod_expected, p_total_amount_collected
  ) RETURNING id INTO v_settlement_id;

  -- ZONE c: write the junction for delivered COD only. amount is NOT NULL,
  -- UNIQUE(settlement_id, order_id). ON CONFLICT DO NOTHING for idempotency.
  IF array_length(v_cod_order_ids, 1) IS NOT NULL THEN
    FOR v_i IN 1 .. array_length(v_cod_order_ids, 1) LOOP
      INSERT INTO settlement_orders (settlement_id, order_id, amount)
      VALUES (v_settlement_id, v_cod_order_ids[v_i], v_cod_order_amounts[v_i])
      -- ON CONSTRAINT (not column inference): the RETURNS TABLE output column
      -- settlement_id would otherwise be ambiguous against the table column.
      ON CONFLICT ON CONSTRAINT unique_settlement_order DO NOTHING;
    END LOOP;
  END IF;

  IF p_extra_charges IS NOT NULL AND jsonb_array_length(p_extra_charges) > 0 THEN
    FOR v_extra IN SELECT * FROM jsonb_array_elements(p_extra_charges) LOOP
      INSERT INTO settlement_extra_charges (settlement_id, store_id, carrier_id, description, amount, created_by)
      VALUES (v_settlement_id, p_store_id, p_carrier_id, btrim(v_extra->>'description'),
              COALESCE((v_extra->>'amount')::NUMERIC,0), p_user_id);
    END LOOP;
  END IF;

  RETURN QUERY SELECT v_settlement_id, v_settlement_code, v_settlement_date, v_min_delivery_date,
    v_max_delivery_date, v_total_orders, v_total_delivered, v_total_not_delivered, v_total_cod_expected,
    p_total_amount_collected, v_total_carrier_fees, v_total_extra_charges, v_failed_attempt_fee, v_net_receivable;
END;
$function$;

COMMENT ON FUNCTION public.process_reconciliation_by_carrier_v2(uuid, uuid, uuid, numeric, text, jsonb, jsonb) IS
  'Shadow v2 of process_reconciliation_by_carrier (mig 200). Persists total_cod_expected (zone a) so the generated columns difference and discrepancy_amount surface the settlement discrepancy, resolves COD via resolve_cod_expected (zone b), and writes the settlement_orders junction for delivered COD (zone c). Does NOT touch the per-order has_amount_discrepancy flag. Not wired until the rename swap.';

COMMIT;

-- ============================================================================
-- ROLLBACK (documented, NOT run): restore the migration 203 body of v2 that
-- carried ZONE d, available in db/migrations/203_reconciliation_by_carrier_v2_discrepancy_net.sql.
-- ============================================================================
