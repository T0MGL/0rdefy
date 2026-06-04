-- Migration 200: Fix process_reconciliation_by_carrier fee source + ambiguous column
--
-- CONTEXT
-- The deployed process_reconciliation_by_carrier (Migration 184 lineage) had two
-- defects that made the "Pendientes de Conciliar" close-by-courier flow throw on
-- every call in production:
--
--   1. carrier_zones reference: the per-order fee lookup did
--        SELECT rate FROM carrier_zones WHERE ...
--      but carrier_zones does NOT exist in this database (the platform moved to
--      carrier_coverage, city-based rates, in Migration 090). The RPC aborted with
--      relation "carrier_zones" does not exist before any settlement row was
--      written. Net effect: backlogs never closed through the UI.
--
--   2. Ambiguous "settlement_code": the LIQ code generator referenced the bare
--      column settlement_code which collides with the RETURNS TABLE OUT column of
--      the same name (error 42702). Qualified to daily_settlements.settlement_code.
--
-- FIX
-- Fee resolution now mirrors the Node service (getPendingReconciliationOrdersByCarrier):
--   city match -> zone match -> minimum active coverage rate fallback,
-- all via normalize_location_text() (same accent-strip as the TS normalizeCityText).
-- COD classification is unchanged: prepaid_method IS NULL AND is_cod_payment_method().
--
-- Everything else (advisory lock, row locking, code generation, extra charges,
-- net_receivable = collected - fees - failed_fee, settlement insert) is identical
-- to the prior deployed body.
--
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.process_reconciliation_by_carrier(
  p_store_id uuid, p_user_id uuid, p_carrier_id uuid,
  p_total_amount_collected numeric, p_discrepancy_notes text DEFAULT NULL::text,
  p_orders jsonb DEFAULT '[]'::jsonb, p_extra_charges jsonb DEFAULT '[]'::jsonb)
 RETURNS TABLE(settlement_id uuid, settlement_code text, settlement_date date, min_delivery_date date, max_delivery_date date, total_orders integer, total_delivered integer, total_not_delivered integer, total_cod_expected numeric, total_cod_collected numeric, total_carrier_fees numeric, total_extra_charges numeric, failed_attempt_fee numeric, net_receivable numeric)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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

  -- Deterministic minimum active coverage rate (fee fallback, mirrors Node service).
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

  -- LIQ-DDMMYYYY-NNN. Qualify settlement_code to daily_settlements to avoid the
  -- ambiguity with the RETURNS TABLE OUT column of the same name.
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

    -- Fee from carrier_coverage: city match -> zone match -> min coverage rate.
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

    v_resolved_cod := CASE WHEN COALESCE(v_order_record.cod_amount,0) > 0 THEN v_order_record.cod_amount
                          ELSE COALESCE(v_order_record.total_price,0) END;

    IF (v_order->>'delivered')::BOOLEAN THEN
      v_total_delivered := v_total_delivered + 1;
      v_total_carrier_fees := v_total_carrier_fees + v_zone_rate;
      IF v_order_record.prepaid_method IS NULL AND is_cod_payment_method(v_order_record.payment_method) THEN
        v_total_cod_expected := v_total_cod_expected + v_resolved_cod;
        v_total_cod_delivered := v_total_cod_delivered + 1;
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

  INSERT INTO daily_settlements (
    id, store_id, carrier_id, settlement_code, settlement_date, min_delivery_date, max_delivery_date,
    total_dispatched, total_delivered, total_not_delivered, total_cod_delivered, total_prepaid_delivered,
    total_cod_collected, total_carrier_fees, total_extra_charges, failed_attempt_fee, net_receivable,
    balance_due, status, notes, created_by, created_at, updated_at, expected_cash, collected_cash
  ) VALUES (
    gen_random_uuid(), p_store_id, p_carrier_id, v_settlement_code, v_settlement_date,
    v_min_delivery_date, v_max_delivery_date, v_total_orders, v_total_delivered, v_total_not_delivered,
    v_total_cod_delivered, v_total_prepaid_delivered, p_total_amount_collected, v_total_carrier_fees,
    v_total_extra_charges, v_failed_attempt_fee, v_net_receivable, v_net_receivable, 'pending',
    p_discrepancy_notes, p_user_id, NOW(), NOW(), v_total_cod_expected, p_total_amount_collected
  ) RETURNING id INTO v_settlement_id;

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

COMMENT ON FUNCTION public.process_reconciliation_by_carrier(uuid,uuid,uuid,numeric,text,jsonb,jsonb) IS
  'Atomic close-by-courier reconciliation. Fee source: carrier_coverage (city -> '
  'zone -> min active rate), NOT carrier_zones (removed). COD via is_cod_payment_method. '
  'net_receivable = collected - carrier_fees - failed_attempt_fee. Migration 200.';
