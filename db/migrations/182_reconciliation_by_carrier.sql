-- ============================================================
-- Migration 182: Reconciliation grouped by Carrier (not Date+Carrier)
--
-- WHY
--   The previous model (Migration 100) groups pending reconciliations by
--   (store_id, delivered_at::date, carrier_id). In operations the courier
--   does NOT rendir per-day, it rinde the WHOLE backlog (all delivered and
--   not-yet-reconciled orders) when it comes by, regardless of when each
--   one was delivered. The fecha de entrega is metadata, not a grouping
--   axis for settlement. Forcing one settlement per day per carrier means
--   the admin opens 5 different rows for the same courier to do what is
--   logically a single rendicion.
--
-- WHAT
--   1. ALTER daily_settlements: add min_delivery_date + max_delivery_date.
--      Backfill legacy rows with settlement_date (single-day legacy
--      settlements collapse to a one-day range).
--   2. New partial index on (store_id, courier_id, reconciled_at) for the
--      common "delivered + unreconciled" filter (carrier-scoped, no date).
--   3. New view v_pending_reconciliation_by_carrier aggregating by
--      (store_id, carrier_id) with oldest/newest delivery date + days
--      since oldest, so the UI can show urgency.
--   4. New function get_pending_reconciliation_orders_by_carrier returning
--      ALL pending orders of a carrier (no date filter), oldest first.
--   5. New function process_reconciliation_by_carrier replacing the
--      delivery-date variant. Same business logic for fees, COD detection,
--      failed-attempt-fee, advisory locking; persists min/max delivery
--      range on the settlement row. settlement_code uses CURRENT_DATE (day
--      of rendicion), not delivery_date.
--   6. Comments mark Migration-100 elements as DEPRECATED (kept alive for
--      backward compatibility with legacy code paths and any external
--      script that still hits them, but not used by the new UI flow).
--
-- INVARIANTS
--   * orders.reconciled_at IS NULL <=> order is pending reconciliation.
--   * Once an order is in a settlement, reconciled_at = NOW() in that
--     transaction, NEVER nulled by another path.
--   * Only one settlement per (store_id, carrier_id) can be created
--     simultaneously (advisory lock).
--   * Settlement row always has at least one delivered order
--     (process_reconciliation_by_carrier raises if v_total_orders=0).
--
-- ROLLBACK (manual, at the bottom of this file).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) daily_settlements columns + backfill
-- ------------------------------------------------------------

ALTER TABLE daily_settlements
  ADD COLUMN IF NOT EXISTS min_delivery_date DATE,
  ADD COLUMN IF NOT EXISTS max_delivery_date DATE;

-- Backfill legacy rows: collapse to single-day range using settlement_date.
-- Idempotent: only touches rows that don't have it set yet.
UPDATE daily_settlements
   SET min_delivery_date = settlement_date,
       max_delivery_date = settlement_date
 WHERE min_delivery_date IS NULL
    OR max_delivery_date IS NULL;

COMMENT ON COLUMN daily_settlements.min_delivery_date IS
  'Earliest delivered_at::date among orders included in this settlement. '
  'For legacy single-day settlements (pre Migration 182) equals settlement_date.';

COMMENT ON COLUMN daily_settlements.max_delivery_date IS
  'Latest delivered_at::date among orders included in this settlement. '
  'For legacy single-day settlements (pre Migration 182) equals settlement_date.';

-- ------------------------------------------------------------
-- 2) Index for carrier-scoped pending lookup
-- ------------------------------------------------------------

-- Partial index: only pending (delivered + unreconciled) rows. Cheaper than
-- a full index since reconciled rows dominate the table over time.
CREATE INDEX IF NOT EXISTS idx_orders_pending_reconciliation_carrier
  ON orders (store_id, courier_id, reconciled_at)
  WHERE sleeves_status = 'delivered'
    AND reconciled_at IS NULL
    AND delivered_at IS NOT NULL;

-- ------------------------------------------------------------
-- 3) View: pending reconciliation grouped by carrier
-- ------------------------------------------------------------

DROP VIEW IF EXISTS v_pending_reconciliation_by_carrier;

CREATE VIEW v_pending_reconciliation_by_carrier AS
SELECT
  o.store_id,
  o.courier_id                                                AS carrier_id,
  c.name                                                      AS carrier_name,
  COALESCE(c.failed_attempt_fee_percent, 50)                  AS failed_attempt_fee_percent,
  COUNT(*)                                                    AS total_orders,
  SUM(CASE
        WHEN LOWER(COALESCE(o.payment_method, '')) IN ('cod','cash','contra_entrega','efectivo','contra entrega')
          AND o.prepaid_method IS NULL
        THEN COALESCE(o.cod_amount, o.total_price, 0)
        ELSE 0
      END)                                                    AS total_cod,
  COUNT(*) FILTER (
    WHERE LOWER(COALESCE(o.payment_method, '')) NOT IN ('cod','cash','contra_entrega','efectivo','contra entrega')
       OR o.prepaid_method IS NOT NULL
  )                                                           AS total_prepaid,
  MIN(o.delivered_at::date)                                   AS oldest_delivery_date,
  MAX(o.delivered_at::date)                                   AS newest_delivery_date,
  (CURRENT_DATE - MIN(o.delivered_at::date))::INT             AS days_oldest
FROM orders o
JOIN carriers c ON c.id = o.courier_id
WHERE o.sleeves_status   = 'delivered'
  AND o.reconciled_at    IS NULL
  AND o.delivered_at     IS NOT NULL
  AND o.courier_id       IS NOT NULL
GROUP BY o.store_id, o.courier_id, c.name, c.failed_attempt_fee_percent;

COMMENT ON VIEW v_pending_reconciliation_by_carrier IS
  'Pending reconciliation aggregated by (store_id, carrier_id). One row per '
  'carrier with non-zero backlog. Includes oldest/newest delivery dates and '
  'days since oldest so the UI can sort by urgency. Replaces the by-date '
  'grouping of v_pending_reconciliation (which is now DEPRECATED but kept '
  'for back-compat).';

-- ------------------------------------------------------------
-- 4) Function: list pending orders for a carrier (all dates)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_pending_reconciliation_orders_by_carrier(
  p_store_id   UUID,
  p_carrier_id UUID
)
RETURNS TABLE (
  id                    UUID,
  display_order_number  TEXT,
  customer_name         TEXT,
  customer_phone        TEXT,
  customer_address      TEXT,
  customer_city         TEXT,
  total_price           NUMERIC,
  cod_amount            NUMERIC,
  payment_method        TEXT,
  prepaid_method        TEXT,
  is_cod                BOOLEAN,
  delivered_at          TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_store_id   IS NULL THEN RAISE EXCEPTION 'store_id is required';   END IF;
  IF p_carrier_id IS NULL THEN RAISE EXCEPTION 'carrier_id is required'; END IF;

  RETURN QUERY
  SELECT
    o.id,
    -- Canonical display number: shopify_order_name -> #shopify_order_number -> #UUID4.
    -- Cast each branch explicitly to TEXT to match RETURNS TABLE declarations
    -- (column types are VARCHAR on the source table, RETURNS expects TEXT).
    (COALESCE(
      o.shopify_order_name,
      CASE
        WHEN o.shopify_order_number IS NOT NULL AND o.shopify_order_number::text <> ''
          THEN '#' || o.shopify_order_number::text
        ELSE NULL
      END,
      '#' || UPPER(RIGHT(o.id::text, 4))
    ))::TEXT                                                                                AS display_order_number,
    (TRIM(COALESCE(o.customer_first_name, '') || ' ' || COALESCE(o.customer_last_name, '')))::TEXT
                                                                                            AS customer_name,
    (COALESCE(o.customer_phone, ''))::TEXT                                                  AS customer_phone,
    (CASE
      WHEN o.shipping_address IS NULL THEN ''
      WHEN jsonb_typeof(o.shipping_address::jsonb) = 'object'
        THEN COALESCE(o.shipping_address::jsonb->>'address1', '')
      ELSE COALESCE(o.shipping_address::text, '')
    END)::TEXT                                                                              AS customer_address,
    (COALESCE(o.shipping_city, o.delivery_zone, ''))::TEXT                                  AS customer_city,
    COALESCE(o.total_price, 0)                                                              AS total_price,
    CASE
      WHEN o.prepaid_method IS NULL
       AND LOWER(COALESCE(o.payment_method, '')) IN ('cod','cash','contra_entrega','efectivo','contra entrega')
        THEN COALESCE(o.cod_amount, o.total_price, 0)
      ELSE 0
    END                                                                                     AS cod_amount,
    (COALESCE(o.payment_method, ''))::TEXT                                                  AS payment_method,
    (o.prepaid_method)::TEXT                                                                AS prepaid_method,
    (
      o.prepaid_method IS NULL
      AND LOWER(COALESCE(o.payment_method, '')) IN ('cod','cash','contra_entrega','efectivo','contra entrega')
    )                                                                                       AS is_cod,
    o.delivered_at::timestamptz                                                             AS delivered_at
  FROM orders o
  WHERE o.store_id        = p_store_id
    AND o.courier_id      = p_carrier_id
    AND o.sleeves_status  = 'delivered'
    AND o.reconciled_at   IS NULL
    AND o.delivered_at    IS NOT NULL
  ORDER BY o.delivered_at ASC;  -- oldest first: those urge to settle
END;
$$;

COMMENT ON FUNCTION get_pending_reconciliation_orders_by_carrier(UUID, UUID) IS
  'Returns ALL delivered + unreconciled orders for a carrier (no date filter), '
  'sorted by delivered_at ASC so the oldest backlog comes first. Includes '
  'delivered_at as a display column so the UI can show fecha de entrega per row.';

-- ------------------------------------------------------------
-- 5) Function: process reconciliation by carrier (atomic, locked)
-- ------------------------------------------------------------
--
-- Adapted from process_delivery_reconciliation (Migration 100) with these
-- specific deltas:
--   * No p_delivery_date parameter.
--   * Advisory lock key = hashtext(store_id || carrier_id || 'reconciliation_by_carrier').
--     Only one rendicion per (store, carrier) can run at a time, regardless of date.
--   * Settlement code uses CURRENT_DATE (LIQ-DDMMYYYY-NNN) -> the day of rendicion.
--   * Settlement row stores settlement_date = CURRENT_DATE,
--     min_delivery_date = MIN(delivered_at::date) of the actually processed orders,
--     max_delivery_date = MAX(delivered_at::date) of those orders.
--   * If all submitted orders are already reconciled / not found / locked,
--     raises 'No valid orders to process'.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION process_reconciliation_by_carrier(
  p_store_id               UUID,
  p_user_id                UUID,
  p_carrier_id             UUID,
  p_total_amount_collected NUMERIC,
  p_discrepancy_notes      TEXT       DEFAULT NULL,
  p_orders                 JSONB      DEFAULT '[]'::jsonb
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
  failed_attempt_fee   NUMERIC,
  net_receivable       NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
BEGIN
  -- ---- input validation ----
  IF p_store_id   IS NULL THEN RAISE EXCEPTION 'store_id is required';   END IF;
  IF p_user_id    IS NULL THEN RAISE EXCEPTION 'user_id is required';    END IF;
  IF p_carrier_id IS NULL THEN RAISE EXCEPTION 'carrier_id is required'; END IF;
  IF p_total_amount_collected IS NULL OR p_total_amount_collected < 0 THEN
    RAISE EXCEPTION 'total_amount_collected must be non-negative';
  END IF;

  -- ---- advisory lock: per (store, carrier) ----
  -- No date in the key: only ONE rendicion per carrier at a time.
  v_lock_key := hashtext(p_store_id::text || p_carrier_id::text || 'reconciliation_by_carrier');
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- ---- carrier lookup ----
  SELECT name, failed_attempt_fee_percent
    INTO v_carrier_name, v_failed_fee_percent
  FROM carriers
  WHERE id = p_carrier_id
  FOR SHARE;

  IF v_carrier_name IS NULL THEN
    RAISE EXCEPTION 'Carrier not found: %', p_carrier_id;
  END IF;
  v_failed_fee_percent := COALESCE(v_failed_fee_percent, 50);

  -- ---- pre-flight: detect orders already reconciled (security: scope to store) ----
  SELECT COUNT(*) INTO v_already_reconciled
  FROM orders o
  WHERE o.id IN (SELECT (jsonb_array_elements(p_orders)->>'order_id')::UUID)
    AND o.store_id = p_store_id
    AND o.reconciled_at IS NOT NULL;

  IF v_already_reconciled > 0 THEN
    RAISE EXCEPTION 'Some orders are already reconciled (count: %)', v_already_reconciled;
  END IF;

  -- ---- pre-flight: validate all submitted IDs exist and belong to this store ----
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

  -- ---- settlement code generation: LIQ-DDMMYYYY-NNN based on CURRENT_DATE ----
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

  -- ---- per-order processing ----
  FOR v_order IN SELECT * FROM jsonb_array_elements(p_orders)
  LOOP
    v_order_id := (v_order->>'order_id')::UUID;

    -- Row-lock the order to prevent concurrent updates.
    SELECT *
      INTO v_order_record
    FROM orders
    WHERE id = v_order_id
      AND store_id = p_store_id
      AND reconciled_at IS NULL
    FOR UPDATE NOWAIT;

    IF v_order_record IS NULL THEN
      -- Either not found, already reconciled, or locked: skip silently.
      CONTINUE;
    END IF;

    v_total_orders  := v_total_orders + 1;
    v_processed_ids := v_processed_ids || v_order_id;

    -- Zone rate lookup (idem Migration 100). Single source of truth would be
    -- carrier_coverage city-based, but RPC mirrors original behavior for
    -- back-compat. The Node service does the richer lookup on its side.
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

    IF (v_order->>'delivered')::BOOLEAN THEN
      v_total_delivered    := v_total_delivered + 1;
      v_total_carrier_fees := v_total_carrier_fees + v_zone_rate;

      IF v_order_record.prepaid_method IS NULL
         AND LOWER(COALESCE(v_order_record.payment_method, '')) IN ('cod','cash','contra_entrega','efectivo','contra entrega')
      THEN
        v_total_cod_expected   := v_total_cod_expected + COALESCE(v_order_record.cod_amount, v_order_record.total_price, 0);
        v_total_cod_delivered  := v_total_cod_delivered + 1;
      ELSE
        v_total_prepaid_delivered := v_total_prepaid_delivered + 1;
      END IF;

      UPDATE orders
         SET reconciled_at = NOW()
       WHERE id = v_order_id;
    ELSE
      v_total_not_delivered := v_total_not_delivered + 1;
      v_failed_attempt_fee  := v_failed_attempt_fee + (v_zone_rate * v_failed_fee_percent / 100);

      UPDATE orders
         SET reconciled_at = NOW()
       WHERE id = v_order_id;
    END IF;
  END LOOP;

  -- ---- guard: at least one processed order required ----
  IF v_total_orders = 0 THEN
    RAISE EXCEPTION 'No valid orders to process';
  END IF;

  -- ---- compute delivery range from the actually processed orders ----
  SELECT MIN(o.delivered_at::date), MAX(o.delivered_at::date)
    INTO v_min_delivery_date, v_max_delivery_date
  FROM orders o
  WHERE o.id = ANY(v_processed_ids);

  -- ---- net receivable ----
  v_net_receivable := p_total_amount_collected - v_total_carrier_fees - v_failed_attempt_fee;

  -- ---- persist settlement row ----
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

  -- ---- return computed totals ----
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
$$;

COMMENT ON FUNCTION process_reconciliation_by_carrier(UUID, UUID, UUID, NUMERIC, TEXT, JSONB) IS
  'Atomically reconciles ALL the carrier delivered+unreconciled orders the caller passes, '
  'with NO date filter. Acquires pg_advisory_xact_lock per (store, carrier). Generates '
  'LIQ-DDMMYYYY-NNN code based on CURRENT_DATE. Persists min_delivery_date and '
  'max_delivery_date computed from the orders actually marked reconciled.';

-- ------------------------------------------------------------
-- 6) Grants
-- ------------------------------------------------------------

GRANT EXECUTE ON FUNCTION get_pending_reconciliation_orders_by_carrier(UUID, UUID)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION process_reconciliation_by_carrier(UUID, UUID, UUID, NUMERIC, TEXT, JSONB)
  TO authenticated, service_role;

GRANT SELECT ON v_pending_reconciliation_by_carrier TO authenticated, service_role;

-- ------------------------------------------------------------
-- 7) Mark Migration-100 surface as DEPRECATED
-- ------------------------------------------------------------

COMMENT ON VIEW v_pending_reconciliation IS
  'DEPRECATED (Migration 182): use v_pending_reconciliation_by_carrier. '
  'Kept for backward compatibility with legacy code paths and external scripts. '
  'Groups by (store_id, delivered_at::date, carrier_id), which forces a per-day '
  'rendicion that does not match operational reality. The new flow is carrier-only.';

COMMENT ON FUNCTION get_pending_reconciliation_orders(UUID, UUID, DATE) IS
  'DEPRECATED (Migration 182): use get_pending_reconciliation_orders_by_carrier. '
  'Kept alive for back-compat. Filters by delivered_at::date = p_delivery_date.';

COMMENT ON FUNCTION process_delivery_reconciliation(UUID, UUID, UUID, DATE, NUMERIC, TEXT, JSONB) IS
  'DEPRECATED (Migration 182): use process_reconciliation_by_carrier. '
  'Kept alive for back-compat. Requires p_delivery_date and locks per (store, carrier, date).';

COMMIT;

-- ============================================================
-- ROLLBACK (manual)
-- ============================================================
-- If you need to undo Migration 182 (no automatic down migration is run):
--
-- BEGIN;
-- DROP FUNCTION IF EXISTS process_reconciliation_by_carrier(UUID, UUID, UUID, NUMERIC, TEXT, JSONB);
-- DROP FUNCTION IF EXISTS get_pending_reconciliation_orders_by_carrier(UUID, UUID);
-- DROP VIEW     IF EXISTS v_pending_reconciliation_by_carrier;
-- DROP INDEX    IF EXISTS idx_orders_pending_reconciliation_carrier;
-- ALTER TABLE daily_settlements
--   DROP COLUMN IF EXISTS min_delivery_date,
--   DROP COLUMN IF EXISTS max_delivery_date;
-- COMMIT;
-- ============================================================
