-- ============================================================
-- Migration 184: Settlement Extras (manual flete lines)
--
-- WHY
--   Real-world reconciliations include flete the courier charges that does
--   NOT come from system orders. Example (Mike Vargas / Solenne, audited
--   2026-05-13): Mike does urban deliveries AND drops parcels off at other
--   couriers ("Lucero del Interior", transportadora "TSI") who finish the
--   route in departamentos lejanos. He charges 25k each transfer. Today
--   those 50k disappear from the cierre because the system only knows
--   about per-order fees. Net receivable comes out 50k high.
--
-- WHAT
--   1. NEW table `settlement_extra_charges`: one row per manual line the
--      admin adds during reconciliation. Hard-linked to daily_settlements
--      via FK with ON DELETE CASCADE.
--   2. NEW column `daily_settlements.total_extra_charges` as a
--      pre-aggregated total. Lets the UI render totals without a join.
--   3. UPDATE function `process_reconciliation_by_carrier` to accept a new
--      `p_extra_charges JSONB DEFAULT '[]'` parameter. The function inserts
--      each extra row into settlement_extra_charges, sums the extras into
--      total_carrier_fees, and recomputes net_receivable. Whole body of the
--      existing v1 function is preserved verbatim apart from the extras
--      handling and the new RETURNS column.
--
-- INVARIANTS
--   * extras.amount >= 0 (CHECK) and description is non-empty trimmed.
--   * extras.settlement_id always points at a live row (FK CASCADE both
--     ways: deleting settlement deletes its extras).
--   * total_extra_charges on daily_settlements equals
--     SUM(amount) over its extras (maintained by the RPC). Never NULL.
--   * total_carrier_fees on the settlement row INCLUDES extras after RPC
--     completes. UI and reports do NOT need to add extras separately.
--   * net_receivable = total_cod_collected - total_carrier_fees -
--                      failed_attempt_fee. Same formula as v1, but
--                      total_carrier_fees now contains extras.
--
-- ROLLBACK (manual): at the bottom of this file.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) Table + indexes
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS settlement_extra_charges (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id UUID NOT NULL REFERENCES daily_settlements(id) ON DELETE CASCADE,
  store_id     UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  carrier_id   UUID NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  description  TEXT NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 200),
  amount       NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settlement_extra_charges_settlement_id
  ON settlement_extra_charges(settlement_id);

CREATE INDEX IF NOT EXISTS idx_settlement_extra_charges_store_carrier
  ON settlement_extra_charges(store_id, carrier_id, created_at);

COMMENT ON TABLE settlement_extra_charges IS
  'Manual flete lines the admin adds during reconciliation. Used for relay '
  'deliveries to other couriers (e.g. Lucero, TSI) and other operational '
  'services the carrier charges that are NOT system orders. Each row sums '
  'into the parent settlement total_carrier_fees.';

-- ------------------------------------------------------------
-- 2) daily_settlements.total_extra_charges
-- ------------------------------------------------------------

ALTER TABLE daily_settlements
  ADD COLUMN IF NOT EXISTS total_extra_charges NUMERIC(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN daily_settlements.total_extra_charges IS
  'Pre-aggregated sum of settlement_extra_charges.amount for this settlement. '
  'Already INCLUDED inside total_carrier_fees. Kept denormalized for cheap '
  'reads in lists and PDFs.';

-- ------------------------------------------------------------
-- 3) process_reconciliation_by_carrier (with extras)
--
-- The v1 (6-arg) function is dropped and replaced with a v2 (7-arg)
-- function. Body preserved verbatim from production except:
--   * new DECLARE block for extras totals
--   * after the INSERT INTO daily_settlements: loop extras and insert
--     rows into settlement_extra_charges
--   * if any extras were inserted: UPDATE the settlement row to fold
--     them into total_carrier_fees and recompute net_receivable
--   * RETURNS adds total_extra_charges column
-- ------------------------------------------------------------

DROP FUNCTION IF EXISTS process_reconciliation_by_carrier(UUID, UUID, UUID, NUMERIC, TEXT, JSONB);

CREATE OR REPLACE FUNCTION process_reconciliation_by_carrier(
  p_store_id               UUID,
  p_user_id                UUID,
  p_carrier_id             UUID,
  p_total_amount_collected NUMERIC,
  p_discrepancy_notes      TEXT  DEFAULT NULL,
  p_orders                 JSONB DEFAULT '[]'::jsonb,
  p_extra_charges          JSONB DEFAULT '[]'::jsonb
)
RETURNS TABLE (
  settlement_id        UUID,
  settlement_code      TEXT,
  settlement_date      DATE,
  min_delivery_date    DATE,
  max_delivery_date    DATE,
  total_orders         INT,
  total_delivered      INT,
  total_not_delivered  INT,
  total_cod_expected   NUMERIC,
  total_cod_collected  NUMERIC,
  total_carrier_fees   NUMERIC,
  total_extra_charges  NUMERIC,
  failed_attempt_fee   NUMERIC,
  net_receivable       NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $function$
DECLARE
  v_settlement_id UUID;
  v_settlement_code TEXT;
  v_settlement_date DATE := CURRENT_DATE;
  v_carrier_name TEXT;
  v_failed_fee_percent NUMERIC;
  v_total_orders INT := 0;
  v_total_delivered INT := 0;
  v_total_not_delivered INT := 0;
  v_total_cod_expected NUMERIC := 0;
  v_total_cod_delivered INT := 0;
  v_total_prepaid_delivered INT := 0;
  v_total_carrier_fees NUMERIC := 0;
  v_failed_attempt_fee NUMERIC := 0;
  v_net_receivable NUMERIC := 0;
  v_min_delivery_date DATE;
  v_max_delivery_date DATE;
  v_order JSONB;
  v_order_id UUID;
  v_order_record RECORD;
  v_zone_rate NUMERIC;
  v_lock_key BIGINT;
  v_already_reconciled INT := 0;
  v_processed_ids UUID[] := ARRAY[]::UUID[];
  v_resolved_cod NUMERIC;
  -- Extras
  v_extra JSONB;
  v_extra_description TEXT;
  v_extra_amount NUMERIC;
  v_total_extra_charges NUMERIC := 0;
BEGIN
  IF p_store_id IS NULL THEN RAISE EXCEPTION 'store_id is required'; END IF;
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user_id is required'; END IF;
  IF p_carrier_id IS NULL THEN RAISE EXCEPTION 'carrier_id is required'; END IF;
  IF p_total_amount_collected IS NULL OR p_total_amount_collected < 0 THEN
    RAISE EXCEPTION 'total_amount_collected must be non-negative';
  END IF;

  -- Defensive bound on extras count to prevent abuse.
  IF jsonb_typeof(p_extra_charges) IS NOT NULL
     AND jsonb_typeof(p_extra_charges) <> 'array' THEN
    RAISE EXCEPTION 'p_extra_charges must be a JSON array';
  END IF;
  IF p_extra_charges IS NOT NULL AND jsonb_array_length(p_extra_charges) > 50 THEN
    RAISE EXCEPTION 'Too many extra charges (max 50 per settlement)';
  END IF;

  v_lock_key := hashtext(p_store_id::text || p_carrier_id::text || 'reconciliation_by_carrier');
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT name, failed_attempt_fee_percent INTO v_carrier_name, v_failed_fee_percent
  FROM carriers WHERE id = p_carrier_id FOR SHARE;

  IF v_carrier_name IS NULL THEN RAISE EXCEPTION 'Carrier not found: %', p_carrier_id; END IF;
  v_failed_fee_percent := COALESCE(v_failed_fee_percent, 50);

  SELECT COUNT(*) INTO v_already_reconciled
  FROM orders o
  WHERE o.id IN (SELECT (jsonb_array_elements(p_orders)->>'order_id')::UUID)
    AND o.store_id = p_store_id AND o.reconciled_at IS NOT NULL;

  IF v_already_reconciled > 0 THEN
    RAISE EXCEPTION 'Some orders are already reconciled (count: %)', v_already_reconciled;
  END IF;

  SELECT COUNT(*) INTO v_already_reconciled
  FROM (SELECT (jsonb_array_elements(p_orders)->>'order_id')::UUID AS order_id) submitted
  WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = submitted.order_id AND o.store_id = p_store_id);

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
      ), 0) + 1)::TEXT, 3, '0'
    )
  INTO v_settlement_code FROM daily_settlements WHERE store_id = p_store_id;

  FOR v_order IN SELECT * FROM jsonb_array_elements(p_orders) LOOP
    v_order_id := (v_order->>'order_id')::UUID;
    SELECT * INTO v_order_record FROM orders
    WHERE id = v_order_id AND store_id = p_store_id AND reconciled_at IS NULL
    FOR UPDATE NOWAIT;
    IF v_order_record IS NULL THEN CONTINUE; END IF;
    v_total_orders := v_total_orders + 1;
    v_processed_ids := v_processed_ids || v_order_id;

    SELECT COALESCE(rate, 0) INTO v_zone_rate FROM carrier_zones
    WHERE carrier_id = p_carrier_id AND store_id = p_store_id
      AND zone_name = COALESCE(v_order_record.delivery_zone, 'default') LIMIT 1;

    IF v_zone_rate IS NULL THEN
      SELECT COALESCE(rate, 0) INTO v_zone_rate FROM carrier_zones
      WHERE carrier_id = p_carrier_id AND store_id = p_store_id LIMIT 1;
    END IF;
    v_zone_rate := COALESCE(v_zone_rate, 0);

    v_resolved_cod := CASE
      WHEN COALESCE(v_order_record.cod_amount, 0) > 0 THEN v_order_record.cod_amount
      ELSE COALESCE(v_order_record.total_price, 0)
    END;

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
  INTO v_min_delivery_date, v_max_delivery_date
  FROM orders o WHERE o.id = ANY(v_processed_ids);

  -- Tally extras BEFORE inserting the settlement row so the persisted
  -- total_carrier_fees already includes them. Extras themselves are
  -- inserted AFTER the settlement so the FK has a target.
  IF p_extra_charges IS NOT NULL AND jsonb_array_length(p_extra_charges) > 0 THEN
    FOR v_extra IN SELECT * FROM jsonb_array_elements(p_extra_charges) LOOP
      v_extra_description := btrim(COALESCE(v_extra->>'description', ''));
      v_extra_amount := COALESCE((v_extra->>'amount')::NUMERIC, 0);

      IF length(v_extra_description) = 0 OR length(v_extra_description) > 200 THEN
        RAISE EXCEPTION 'Extra charge description must be 1-200 chars (got %)', length(v_extra_description);
      END IF;
      IF v_extra_amount < 0 THEN
        RAISE EXCEPTION 'Extra charge amount must be >= 0 (got %)', v_extra_amount;
      END IF;

      v_total_extra_charges := v_total_extra_charges + v_extra_amount;
    END LOOP;
  END IF;

  v_total_carrier_fees := v_total_carrier_fees + v_total_extra_charges;
  v_net_receivable := p_total_amount_collected - v_total_carrier_fees - v_failed_attempt_fee;

  INSERT INTO daily_settlements (
    id, store_id, carrier_id, settlement_code, settlement_date,
    min_delivery_date, max_delivery_date, total_dispatched, total_delivered,
    total_not_delivered, total_cod_delivered, total_prepaid_delivered,
    total_cod_collected, total_carrier_fees, total_extra_charges,
    failed_attempt_fee, net_receivable, balance_due, status, notes,
    created_by, created_at, updated_at, expected_cash, collected_cash
  ) VALUES (
    gen_random_uuid(), p_store_id, p_carrier_id, v_settlement_code, v_settlement_date,
    v_min_delivery_date, v_max_delivery_date, v_total_orders, v_total_delivered,
    v_total_not_delivered, v_total_cod_delivered, v_total_prepaid_delivered,
    p_total_amount_collected, v_total_carrier_fees, v_total_extra_charges,
    v_failed_attempt_fee, v_net_receivable, v_net_receivable, 'pending',
    p_discrepancy_notes, p_user_id, NOW(), NOW(), v_total_cod_expected,
    p_total_amount_collected
  ) RETURNING id INTO v_settlement_id;

  -- Insert extra charge rows now that the settlement exists.
  IF p_extra_charges IS NOT NULL AND jsonb_array_length(p_extra_charges) > 0 THEN
    FOR v_extra IN SELECT * FROM jsonb_array_elements(p_extra_charges) LOOP
      INSERT INTO settlement_extra_charges (
        settlement_id, store_id, carrier_id, description, amount, created_by
      ) VALUES (
        v_settlement_id,
        p_store_id,
        p_carrier_id,
        btrim(v_extra->>'description'),
        COALESCE((v_extra->>'amount')::NUMERIC, 0),
        p_user_id
      );
    END LOOP;
  END IF;

  RETURN QUERY SELECT
    v_settlement_id, v_settlement_code, v_settlement_date,
    v_min_delivery_date, v_max_delivery_date, v_total_orders,
    v_total_delivered, v_total_not_delivered, v_total_cod_expected,
    p_total_amount_collected, v_total_carrier_fees, v_total_extra_charges,
    v_failed_attempt_fee, v_net_receivable;
END;
$function$;

GRANT EXECUTE ON FUNCTION process_reconciliation_by_carrier(UUID, UUID, UUID, NUMERIC, TEXT, JSONB, JSONB)
  TO authenticated, service_role;

COMMENT ON FUNCTION process_reconciliation_by_carrier(UUID, UUID, UUID, NUMERIC, TEXT, JSONB, JSONB) IS
  'Reconcile all pending orders of a carrier in one shot. Accepts extras '
  '(manual flete lines) that get persisted to settlement_extra_charges and '
  'folded into total_carrier_fees. See Migration 184 for the extras model.';

COMMIT;

-- ============================================================
-- ROLLBACK (manual)
-- ============================================================
-- BEGIN;
--   DROP FUNCTION IF EXISTS process_reconciliation_by_carrier(UUID, UUID, UUID, NUMERIC, TEXT, JSONB, JSONB);
--
--   -- Restore v1 signature (paste the pre-184 function body if you keep one).
--
--   ALTER TABLE daily_settlements DROP COLUMN IF EXISTS total_extra_charges;
--   DROP TABLE IF EXISTS settlement_extra_charges;
-- COMMIT;
