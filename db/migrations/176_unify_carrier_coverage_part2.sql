-- Migration 176: 174b_unify_carrier_coverage_part2
-- Reconstructed from production DB on 2026-05-08
-- Original applied: 2026-05-08 06:01:40 UTC (version 20260508060140)
-- Part of Sprint B: carrier_zones -> carrier_coverage unification

-- 2g. create_dispatch_session
CREATE OR REPLACE FUNCTION create_dispatch_session(
  p_store_id UUID,
  p_carrier_id UUID,
  p_order_ids UUID[],
  p_created_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_session_id UUID;
  v_session_code VARCHAR(30);
  v_order RECORD;
  v_rate DECIMAL(12,2);
  v_total_cod DECIMAL(12,2) := 0;
  v_total_prepaid INT := 0;
BEGIN
  v_session_code := generate_dispatch_session_code(p_store_id);

  INSERT INTO dispatch_sessions (
    store_id, carrier_id, session_code, dispatch_date,
    total_orders, status, created_by, exported_at
  ) VALUES (
    p_store_id, p_carrier_id, v_session_code, CURRENT_DATE,
    array_length(p_order_ids, 1), 'dispatched', p_created_by, NOW()
  )
  RETURNING id INTO v_session_id;

  FOR v_order IN
    SELECT o.*, c.name AS customer_name_val, c.phone AS customer_phone_val
    FROM orders o
    LEFT JOIN customers c ON o.customer_id = c.id
    WHERE o.id = ANY(p_order_ids)
  LOOP
    v_rate := get_carrier_fee_for_order(
      p_carrier_id,
      v_order.delivery_zone,
      COALESCE(v_order.shipping_city_normalized, v_order.shipping_city)
    );

    INSERT INTO dispatch_session_orders (
      dispatch_session_id, order_id,
      order_number, customer_name, customer_phone,
      delivery_address, delivery_city, delivery_zone,
      total_price, payment_method, is_cod, carrier_fee
    ) VALUES (
      v_session_id, v_order.id,
      v_order.order_number, v_order.customer_name_val, v_order.customer_phone_val,
      CONCAT_WS(', ', v_order.shipping_address, v_order.shipping_reference),
      v_order.shipping_city, COALESCE(v_order.delivery_zone, v_order.shipping_city),
      v_order.total_price,
      COALESCE(v_order.payment_method, 'CONTRA ENTREGA'),
      COALESCE(v_order.payment_method, 'CONTRA ENTREGA') = 'CONTRA ENTREGA',
      COALESCE(v_rate, 0)
    );

    UPDATE orders
    SET sleeves_status = 'shipped',
        courier_id = p_carrier_id,
        shipped_at = NOW()
    WHERE id = v_order.id
      AND sleeves_status IN ('ready_to_ship', 'shipped');

    IF COALESCE(v_order.payment_method, 'CONTRA ENTREGA') = 'CONTRA ENTREGA' THEN
      v_total_cod := v_total_cod + COALESCE(v_order.total_price, 0);
    ELSE
      v_total_prepaid := v_total_prepaid + 1;
    END IF;
  END LOOP;

  UPDATE dispatch_sessions
  SET total_cod_expected = v_total_cod,
      total_prepaid = v_total_prepaid
  WHERE id = v_session_id;

  RETURN v_session_id;
END;
$$;

-- 2h. process_delivery_reconciliation
CREATE OR REPLACE FUNCTION process_delivery_reconciliation(
  p_store_id UUID,
  p_user_id UUID,
  p_carrier_id UUID,
  p_delivery_date DATE,
  p_total_amount_collected NUMERIC,
  p_discrepancy_notes TEXT DEFAULT NULL,
  p_orders JSONB DEFAULT '[]'::JSONB
)
RETURNS TABLE (
  settlement_id UUID,
  settlement_code TEXT,
  total_orders INTEGER,
  total_delivered INTEGER,
  total_not_delivered INTEGER,
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
      END IF;

      UPDATE orders SET reconciled_at = NOW() WHERE id = v_order_id;
    ELSE
      v_total_not_delivered := v_total_not_delivered + 1;
      v_failed_attempt_fee := v_failed_attempt_fee + (v_rate * v_failed_fee_percent / 100);
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
$$;
