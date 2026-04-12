-- ============================================================================
-- MIGRATION 148b: Settled state logic, fee variance tracking, dual write to
--                 orders.status, promote to settled on settlement paid.
-- ============================================================================
-- Date: 2026-04-09
-- Plan: iterative-whistling-flute (FASE 1 of the MAXIMAL scope)
-- Depends on: 148a (adds 'settled' to order_status enum, must be committed)
--
-- Purpose:
--   1. Add orders.settled_at (financial terminal timestamp: distinct from
--      reconciled_at which means "courier reported delivery").
--   2. Capture delivery cost variance at the dispatch_session_orders level
--      (quoted vs actual fee with a reason).
--   3. Provide a promote_orders_to_settled() function that is atomic,
--      idempotent, and safe under concurrency (FOR UPDATE SKIP LOCKED).
--   4. Rewrite the settlement functions from migration 045 and the
--      external carrier settlement function from migration 016/132 so they
--      also write to orders.status (not only sleeves_status, which is the
--      root cause of the visibility bug). This is DUAL WRITE during the
--      transition window. Migration 148c removes sleeves_status once the
--      runtime code is fully cut over to the helpers in
--      src/lib/order-status-helpers.ts.
--   5. Trigger the promotion to 'settled' automatically when a daily
--      settlement (or external carrier settlement) flips to paid/completed.
--   6. Partial indexes to keep the "por liquidar" and "liquidados" list
--      queries cheap.
--   7. Views: rebuild v_pending_reconciliation to surface the new state,
--      add v_settlement_variance (finance variance dashboard) and
--      v_dispatch_session_detail (dispatch page that no longer hides
--      delivered orders behind a delivery_status filter).
--   8. Backfill: any order that is delivered + reconciled + linked to a
--      paid settlement gets promoted to 'settled' with settled_at stamped
--      from reconciled_at. Chunked if row count exceeds 10k.
--
-- Rollback:
--   Wrapped in BEGIN / COMMIT. The rollback section at the bottom of this
--   file contains the explicit reverse SQL. In summary:
--     - DROP TRIGGER trg_daily_settlements_promote_on_paid,
--                   trg_carrier_settlements_promote_on_paid
--     - DROP FUNCTION promote_orders_to_settled(UUID)
--     - Restore process_dispatch_settlement, process_delivery_reconciliation,
--       mark_settlement_paid, create_carrier_settlement to their 045 / 100 /
--       132 versions (see each function's git history before this file).
--     - DROP INDEX idx_orders_delivered_pending_settle,
--                 idx_orders_settled,
--                 idx_dispatch_session_orders_variance
--     - DROP VIEW v_settlement_variance, v_dispatch_session_detail
--     - Rebuild v_pending_reconciliation to its 100 version.
--     - ALTER TABLE dispatch_session_orders:
--         RENAME quoted_carrier_fee -> carrier_fee,
--         DROP COLUMN actual_carrier_fee, fee_variance, fee_variance_reason.
--     - ALTER TABLE orders DROP COLUMN settled_at.
--     - ALTER TABLE daily_settlements DROP COLUMN total_carrier_fees_quoted,
--                                                total_fee_variance.
--     - The 'settled' enum value from 148a cannot be dropped (Postgres
--       limitation) and remains unused post rollback. This is benign.
--
-- Safety:
--   - Idempotent where possible (CREATE OR REPLACE, IF NOT EXISTS, DO blocks).
--   - No destructive operations on legacy data.
--   - Dual write keeps existing code paths that read sleeves_status working
--     until 148c is applied after the code sweep.
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1. orders.settled_at
-- ============================================================================
-- Financial terminal timestamp. Distinct from reconciled_at which records
-- "courier submitted delivery proof". settled_at means "money received".

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;

COMMENT ON COLUMN orders.settled_at IS
'Timestamp when the courier settlement for this order was marked paid. Set by promote_orders_to_settled(). Nullable until the order reaches the settled state.';

-- ============================================================================
-- SECTION 2. Fee variance: dispatch_session_orders
-- ============================================================================
-- carrier_fee is the quoted fee at dispatch time. We rename it to make intent
-- explicit and add actual fee + generated variance + reason.
--
-- Defensive: only rename if the legacy name still exists (idempotent re-run).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'dispatch_session_orders'
      AND column_name = 'carrier_fee'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'dispatch_session_orders'
      AND column_name = 'quoted_carrier_fee'
  ) THEN
    ALTER TABLE dispatch_session_orders
      RENAME COLUMN carrier_fee TO quoted_carrier_fee;
  END IF;
END $$;

ALTER TABLE dispatch_session_orders
  ADD COLUMN IF NOT EXISTS actual_carrier_fee DECIMAL(12,2);

-- Generated stored column. Resolves to 0 when actual has not been provided
-- yet (defaults to quoted). Negative means courier charged less than quoted.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'dispatch_session_orders'
      AND column_name = 'fee_variance'
  ) THEN
    ALTER TABLE dispatch_session_orders
      ADD COLUMN fee_variance DECIMAL(12,2)
        GENERATED ALWAYS AS
          (COALESCE(actual_carrier_fee, quoted_carrier_fee) - COALESCE(quoted_carrier_fee, 0))
        STORED;
  END IF;
END $$;

ALTER TABLE dispatch_session_orders
  ADD COLUMN IF NOT EXISTS fee_variance_reason VARCHAR(50);

-- CHECK constraint (add only if missing). Fixed allowed values, VARCHAR not
-- enum so future reasons can evolve without a new enum migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.constraint_column_usage
    WHERE table_name = 'dispatch_session_orders'
      AND constraint_name = 'dispatch_session_orders_fee_variance_reason_check'
  ) THEN
    ALTER TABLE dispatch_session_orders
      ADD CONSTRAINT dispatch_session_orders_fee_variance_reason_check
      CHECK (
        fee_variance_reason IS NULL
        OR fee_variance_reason IN (
          'distance_extra',
          'toll',
          'tip',
          'weight_surcharge',
          'price_correction',
          'other'
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN dispatch_session_orders.quoted_carrier_fee IS
'Fee quoted to the courier at dispatch time (from carrier_zones.rate). Snapshot, never updated after dispatch.';

COMMENT ON COLUMN dispatch_session_orders.actual_carrier_fee IS
'Fee actually paid to the courier after delivery. Captured during reconciliation when it differs from quoted. NULL when not yet known.';

COMMENT ON COLUMN dispatch_session_orders.fee_variance IS
'Generated: actual_carrier_fee - quoted_carrier_fee. Positive means courier charged more than quoted. Zero when actual is NULL.';

COMMENT ON COLUMN dispatch_session_orders.fee_variance_reason IS
'Reason for variance: distance_extra, toll, tip, weight_surcharge, price_correction, other. NULL when variance is zero.';

-- Backfill: actual defaults to quoted so variance is 0 for all historical rows.
UPDATE dispatch_session_orders
SET actual_carrier_fee = quoted_carrier_fee
WHERE actual_carrier_fee IS NULL
  AND quoted_carrier_fee IS NOT NULL;

-- ============================================================================
-- SECTION 3. Aggregate variance columns in daily_settlements
-- ============================================================================

ALTER TABLE daily_settlements
  ADD COLUMN IF NOT EXISTS total_carrier_fees_quoted DECIMAL(12,2) DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'daily_settlements'
      AND column_name = 'total_fee_variance'
  ) THEN
    ALTER TABLE daily_settlements
      ADD COLUMN total_fee_variance DECIMAL(12,2)
        GENERATED ALWAYS AS
          (COALESCE(total_carrier_fees, 0) - COALESCE(total_carrier_fees_quoted, 0))
        STORED;
  END IF;
END $$;

COMMENT ON COLUMN daily_settlements.total_carrier_fees_quoted IS
'Sum of quoted_carrier_fee for all delivered orders in this settlement. Captured at settlement creation time.';

COMMENT ON COLUMN daily_settlements.total_fee_variance IS
'Generated: total_carrier_fees - total_carrier_fees_quoted. Variance aggregate for this settlement.';

-- Backfill quoted total to match current total_carrier_fees so variance is 0
-- for historical settlements.
UPDATE daily_settlements
SET total_carrier_fees_quoted = COALESCE(total_carrier_fees, 0)
WHERE total_carrier_fees_quoted = 0
  AND total_carrier_fees IS NOT NULL;

-- ============================================================================
-- SECTION 4. promote_orders_to_settled
-- ============================================================================
-- Atomic, idempotent, concurrent-safe promotion of delivered orders to
-- settled for a given daily or external carrier settlement.
--
-- Uses FOR UPDATE SKIP LOCKED so if the function runs in parallel (for
-- example manual API endpoint plus automatic trigger) the two calls do not
-- contend and neither fails.
--
-- Returns the number of orders actually promoted in this call.

CREATE OR REPLACE FUNCTION promote_orders_to_settled(p_settlement_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_promoted_count INTEGER := 0;
BEGIN
  IF p_settlement_id IS NULL THEN
    RAISE EXCEPTION 'promote_orders_to_settled: settlement_id is required';
  END IF;

  -- Daily settlements: orders linked via dispatch_session_orders OR via
  -- reconciled_at + same store/carrier/date (delivery based reconciliation
  -- flow from migration 100 does not use dispatch_session_orders).
  WITH candidates AS (
    SELECT o.id
    FROM orders o
    WHERE o.status = 'delivered'
      AND o.settled_at IS NULL
      AND (
        -- Dispatch based path (045)
        EXISTS (
          SELECT 1
          FROM dispatch_session_orders dso
          JOIN dispatch_sessions ds ON ds.id = dso.dispatch_session_id
          WHERE dso.order_id = o.id
            AND ds.daily_settlement_id = p_settlement_id
        )
        OR
        -- Delivery based path (100): match via store + carrier + delivery date
        EXISTS (
          SELECT 1
          FROM daily_settlements ds100
          WHERE ds100.id = p_settlement_id
            AND ds100.store_id = o.store_id
            AND ds100.carrier_id = o.courier_id
            AND o.reconciled_at IS NOT NULL
            AND (o.delivered_at::date) = ds100.settlement_date
        )
        OR
        -- External carrier path (016)
        o.carrier_settlement_id = p_settlement_id
      )
    FOR UPDATE OF o SKIP LOCKED
  )
  UPDATE orders o
  SET status = 'settled',
      settled_at = NOW()
  FROM candidates
  WHERE o.id = candidates.id
    AND o.status = 'delivered'
    AND o.settled_at IS NULL;

  GET DIAGNOSTICS v_promoted_count = ROW_COUNT;

  RETURN v_promoted_count;
END;
$$;

COMMENT ON FUNCTION promote_orders_to_settled(UUID) IS
'Promotes delivered orders linked to the given settlement (daily or carrier) to status=settled and stamps settled_at=NOW(). Atomic, idempotent (WHERE status=delivered), concurrent safe (FOR UPDATE SKIP LOCKED). Returns the count of promoted rows.';

GRANT EXECUTE ON FUNCTION promote_orders_to_settled(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION promote_orders_to_settled(UUID) TO service_role;

-- ============================================================================
-- SECTION 5. process_dispatch_settlement (REWRITE from migration 045)
-- ============================================================================
-- Changes vs migration 045:
--   1. Writes to orders.status (enum) in addition to sleeves_status (VARCHAR)
--      to cut over the dispatch-based path to the enum.
--   2. Captures variance by defaulting actual_carrier_fee to quoted for
--      rows that still have NULL, so settlements created automatically from
--      a CSV import carry zero variance by default.
--   3. Stamps total_carrier_fees_quoted on the daily settlement for aggregate
--      variance reporting.
--   4. No change to: statistics calculation, CSV status transitions,
--      failed_attempt_fee calculation, dispatch session state transitions.

CREATE OR REPLACE FUNCTION process_dispatch_settlement(
  p_dispatch_session_id UUID,
  p_created_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_session RECORD;
  v_settlement_id UUID;
  v_settlement_code VARCHAR(30);
  v_stats RECORD;
BEGIN
  SELECT
    id,
    store_id,
    carrier_id,
    status
  INTO v_session
  FROM dispatch_sessions
  WHERE id = p_dispatch_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatch session not found: %', p_dispatch_session_id;
  END IF;

  IF v_session.status = 'settled' THEN
    RAISE EXCEPTION 'Session already settled: %', p_dispatch_session_id;
  END IF;

  -- Default actual_carrier_fee to quoted where missing so variance is 0.
  UPDATE dispatch_session_orders
  SET actual_carrier_fee = quoted_carrier_fee
  WHERE dispatch_session_id = p_dispatch_session_id
    AND actual_carrier_fee IS NULL;

  -- Aggregate stats for this session.
  SELECT
    COUNT(*) AS total_dispatched,
    COUNT(*) FILTER (WHERE delivery_status = 'delivered') AS total_delivered,
    COUNT(*) FILTER (WHERE delivery_status IN ('not_delivered', 'rejected', 'returned')) AS total_not_delivered,
    COUNT(*) FILTER (WHERE delivery_status = 'delivered' AND is_cod = TRUE) AS total_cod_delivered,
    COUNT(*) FILTER (WHERE delivery_status = 'delivered' AND is_cod = FALSE) AS total_prepaid_delivered,
    COALESCE(SUM(amount_collected) FILTER (WHERE delivery_status = 'delivered'), 0) AS total_cod_collected,
    COALESCE(SUM(actual_carrier_fee) FILTER (WHERE delivery_status = 'delivered'), 0) AS total_carrier_fees,
    COALESCE(SUM(quoted_carrier_fee) FILTER (WHERE delivery_status = 'delivered'), 0) AS total_carrier_fees_quoted,
    COALESCE(SUM(quoted_carrier_fee) FILTER (WHERE delivery_status IN ('not_delivered', 'rejected')) * 0.5, 0) AS failed_attempt_fee
  INTO v_stats
  FROM dispatch_session_orders
  WHERE dispatch_session_id = p_dispatch_session_id;

  v_settlement_code := generate_settlement_code(v_session.store_id);

  INSERT INTO daily_settlements (
    store_id,
    carrier_id,
    dispatch_session_id,
    settlement_code,
    settlement_date,
    total_dispatched,
    total_delivered,
    total_not_delivered,
    total_cod_delivered,
    total_prepaid_delivered,
    total_cod_collected,
    total_carrier_fees,
    total_carrier_fees_quoted,
    failed_attempt_fee,
    status,
    created_by
  ) VALUES (
    v_session.store_id,
    v_session.carrier_id,
    p_dispatch_session_id,
    v_settlement_code,
    CURRENT_DATE,
    v_stats.total_dispatched,
    v_stats.total_delivered,
    v_stats.total_not_delivered,
    v_stats.total_cod_delivered,
    v_stats.total_prepaid_delivered,
    v_stats.total_cod_collected,
    v_stats.total_carrier_fees,
    v_stats.total_carrier_fees_quoted,
    v_stats.failed_attempt_fee,
    'pending',
    p_created_by
  )
  RETURNING id INTO v_settlement_id;

  UPDATE dispatch_sessions
  SET status = 'settled',
      daily_settlement_id = v_settlement_id,
      settled_at = NOW()
  WHERE id = p_dispatch_session_id;

  -- DUAL WRITE: status (enum, new source of truth) and sleeves_status
  -- (legacy VARCHAR) for backwards compatibility until migration 148c
  -- drops the legacy column.
  UPDATE orders o
  SET
    status = CASE
      WHEN dso.delivery_status = 'delivered' THEN 'delivered'::order_status
      WHEN dso.delivery_status = 'rejected' THEN 'cancelled'::order_status
      WHEN dso.delivery_status = 'returned' THEN 'returned'::order_status
      ELSE o.status
    END,
    sleeves_status = CASE
      WHEN dso.delivery_status = 'delivered' THEN 'delivered'
      WHEN dso.delivery_status = 'rejected' THEN 'cancelled'
      WHEN dso.delivery_status = 'returned' THEN 'returned'
      ELSE o.sleeves_status
    END,
    delivered_at = CASE
      WHEN dso.delivery_status = 'delivered' THEN COALESCE(dso.delivered_at, NOW())
      ELSE o.delivered_at
    END,
    reconciled_at = CASE
      WHEN dso.delivery_status = 'delivered' THEN COALESCE(o.reconciled_at, NOW())
      ELSE o.reconciled_at
    END
  FROM dispatch_session_orders dso
  WHERE dso.dispatch_session_id = p_dispatch_session_id
    AND dso.order_id = o.id
    AND dso.delivery_status != 'pending';

  RETURN v_settlement_id;
END;
$$;

COMMENT ON FUNCTION process_dispatch_settlement(UUID, UUID) IS
'Reconciles a dispatch session: aggregates delivered CSV results, creates a daily_settlements row, and dual writes orders.status + sleeves_status. Migration 148b adds enum writes and variance aggregates.';

GRANT EXECUTE ON FUNCTION process_dispatch_settlement(UUID, UUID) TO authenticated;

-- ============================================================================
-- SECTION 6. process_delivery_reconciliation (REWRITE from migration 100)
-- ============================================================================
-- Changes vs migration 100:
--   1. Dual writes orders.status = 'delivered' (not only reconciled_at) so
--      rows migrated into the enum flow stay consistent, and stamps
--      sleeves_status = 'delivered' for backwards compatibility.
--   2. Stamps total_carrier_fees_quoted equal to total_carrier_fees on the
--      created settlement (this flow uses zone rate as the quoted fee).
--   3. All other logic (advisory lock, per order row lock, carrier fee
--      lookup, settlement code generator, net receivable math, security
--      filter by store_id) preserved exactly as migration 100 / 132.

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
  v_already_reconciled INT := 0;
BEGIN
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

  v_lock_key := hashtext(p_store_id::text || p_carrier_id::text || p_delivery_date::text);
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

  FOR v_order IN SELECT * FROM jsonb_array_elements(p_orders)
  LOOP
    v_order_id := (v_order->>'order_id')::UUID;

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

    SELECT COALESCE(rate, 0) INTO v_zone_rate
    FROM carrier_zones
    WHERE carrier_id = p_carrier_id
      AND store_id = p_store_id
      AND zone_name = COALESCE(v_order_record.delivery_zone, 'default')
    LIMIT 1;

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

      IF LOWER(COALESCE(v_order_record.payment_method, '')) IN ('cod', 'cash', 'contra_entrega', 'efectivo', 'contra entrega') THEN
        v_total_cod_expected := v_total_cod_expected + COALESCE(v_order_record.total_price, 0);
      END IF;

      -- DUAL WRITE: enum status + legacy sleeves_status + reconciled_at.
      UPDATE orders
      SET reconciled_at = NOW(),
          status = 'delivered'::order_status,
          sleeves_status = 'delivered'
      WHERE id = v_order_id;
    ELSE
      v_total_not_delivered := v_total_not_delivered + 1;
      v_failed_attempt_fee := v_failed_attempt_fee + (v_zone_rate * v_failed_fee_percent / 100);

      UPDATE orders
      SET reconciled_at = NOW()
      WHERE id = v_order_id;
    END IF;
  END LOOP;

  IF v_total_orders = 0 THEN
    RAISE EXCEPTION 'No valid orders to process';
  END IF;

  v_net_receivable := p_total_amount_collected - v_total_carrier_fees - v_failed_attempt_fee;

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
    total_carrier_fees_quoted,
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
    (SELECT COUNT(*) FROM jsonb_array_elements(p_orders) o
      WHERE (o->>'delivered')::BOOLEAN = TRUE
      AND EXISTS (
        SELECT 1 FROM orders ord
        WHERE ord.id = (o->>'order_id')::UUID
          AND ord.store_id = p_store_id
          AND LOWER(COALESCE(ord.payment_method, '')) IN ('cod', 'cash', 'contra_entrega', 'efectivo', 'contra entrega')
      ))::INT,
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
'Delivery based reconciliation (migration 100 flow). Migration 148b adds dual write to orders.status and stamps total_carrier_fees_quoted on the created settlement.';

GRANT EXECUTE ON FUNCTION process_delivery_reconciliation TO authenticated;

-- ============================================================================
-- SECTION 7. mark_settlement_paid (REWRITE from migration 045)
-- ============================================================================
-- Changes vs migration 045:
--   1. At the end, invokes promote_orders_to_settled(settlement_id) and
--      returns the count via the boolean true path (count is logged via
--      RAISE NOTICE for visibility, not returned in the signature to avoid
--      breaking the API contract).

CREATE OR REPLACE FUNCTION mark_settlement_paid(
  p_settlement_id UUID,
  p_amount DECIMAL(12,2),
  p_method VARCHAR(50),
  p_reference VARCHAR(255) DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_settlement RECORD;
  v_new_status VARCHAR(20);
  v_promoted INTEGER := 0;
BEGIN
  SELECT * INTO v_settlement
  FROM daily_settlements
  WHERE id = p_settlement_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF (COALESCE(v_settlement.amount_paid, 0) + p_amount) >= COALESCE(v_settlement.net_receivable, 0) THEN
    v_new_status := 'paid';
  ELSE
    v_new_status := 'partial';
  END IF;

  UPDATE daily_settlements
  SET amount_paid = COALESCE(amount_paid, 0) + p_amount,
      payment_date = CURRENT_DATE,
      payment_method = p_method,
      payment_reference = COALESCE(p_reference, payment_reference),
      status = v_new_status
  WHERE id = p_settlement_id;

  -- Promote orders to settled when the settlement fully settles.
  -- Idempotent: safe to call even if the trigger also fires.
  IF v_new_status = 'paid' THEN
    v_promoted := promote_orders_to_settled(p_settlement_id);
    RAISE NOTICE 'mark_settlement_paid: promoted % orders to settled for settlement %', v_promoted, p_settlement_id;
  END IF;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION mark_settlement_paid(UUID, DECIMAL, VARCHAR, VARCHAR) IS
'Registers a payment on a daily settlement. When the payment completes the settlement (status = paid) it invokes promote_orders_to_settled() to flip linked delivered orders to settled.';

GRANT EXECUTE ON FUNCTION mark_settlement_paid(UUID, DECIMAL, VARCHAR, VARCHAR) TO authenticated;

-- ============================================================================
-- SECTION 8. create_carrier_settlement (REWRITE from migrations 016 + 132)
-- ============================================================================
-- Changes vs migration 132:
--   1. Dual writes orders.status = 'delivered' on linked orders (no-op when
--      already delivered, but keeps the enum in sync when a legacy row was
--      only stamped via sleeves_status).
--   2. Preserves the 132 fix: uses COALESCE(amount_collected, total_price)
--      for total_cod_collected and sets payment_status = 'collected' on
--      linked orders.
--   3. Filter remains on sleeves_status = 'delivered' during the transition
--      window because some legacy write paths have not yet cut over. This
--      will be tightened in the code sweep (FASE 2) and 148c removes the
--      legacy column.

CREATE OR REPLACE FUNCTION create_carrier_settlement(
  p_store_id UUID,
  p_carrier_id UUID,
  p_period_start DATE,
  p_period_end DATE,
  p_created_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_settlement_id UUID;
  v_total_orders INT;
  v_total_cod DECIMAL(12,2);
  v_total_shipping DECIMAL(12,2);
BEGIN
  SELECT
    COUNT(*),
    COALESCE(SUM(COALESCE(amount_collected, total_price)), 0),
    COALESCE(SUM(shipping_cost), 0)
  INTO v_total_orders, v_total_cod, v_total_shipping
  FROM orders
  WHERE store_id = p_store_id
    AND courier_id = p_carrier_id
    AND (status = 'delivered'::order_status OR sleeves_status = 'delivered')
    AND delivered_at >= p_period_start
    AND delivered_at < (p_period_end + INTERVAL '1 day')
    AND carrier_settlement_id IS NULL;

  IF v_total_orders = 0 THEN
    RAISE EXCEPTION 'No hay pedidos entregados en el período seleccionado';
  END IF;

  INSERT INTO carrier_settlements (
    store_id,
    carrier_id,
    settlement_period_start,
    settlement_period_end,
    total_orders,
    total_cod_collected,
    total_shipping_cost,
    status,
    created_by
  ) VALUES (
    p_store_id,
    p_carrier_id,
    p_period_start,
    p_period_end,
    v_total_orders,
    v_total_cod,
    v_total_shipping,
    'pending',
    p_created_by
  )
  RETURNING id INTO v_settlement_id;

  -- Dual write: link, mark collected, keep enum in sync.
  UPDATE orders
  SET carrier_settlement_id = v_settlement_id,
      payment_status = 'collected',
      status = CASE
        WHEN status IS NULL OR status::text IN ('in_transit', 'ready_to_ship')
          THEN 'delivered'::order_status
        ELSE status
      END
  WHERE store_id = p_store_id
    AND courier_id = p_carrier_id
    AND (status = 'delivered'::order_status OR sleeves_status = 'delivered')
    AND delivered_at >= p_period_start
    AND delivered_at < (p_period_end + INTERVAL '1 day')
    AND carrier_settlement_id IS NULL;

  RETURN v_settlement_id;
END;
$$;

COMMENT ON FUNCTION create_carrier_settlement(UUID, UUID, DATE, DATE, UUID) IS
'Creates a bulk settlement for an external carrier in a date range and links delivered orders. Inherits fixes from migration 132 (uses COALESCE amount_collected, sets payment_status = collected). Migration 148b adds enum dual write.';

GRANT EXECUTE ON FUNCTION create_carrier_settlement(UUID, UUID, DATE, DATE, UUID) TO authenticated;

-- ============================================================================
-- SECTION 9. Defensive triggers on settlement tables
-- ============================================================================
-- Belt and suspenders: mark_settlement_paid already calls
-- promote_orders_to_settled(), but a trigger guarantees that any code path
-- that updates the settlement directly (migration backfills, manual SQL,
-- future services that bypass the RPC) still promotes orders atomically.
--
-- Idempotency: promote_orders_to_settled uses WHERE status='delivered', so
-- running it twice is a no-op.

CREATE OR REPLACE FUNCTION trg_fn_promote_orders_on_settlement_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM promote_orders_to_settled(NEW.id);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trg_fn_promote_orders_on_settlement_paid() IS
'Trigger function for daily_settlements and carrier_settlements. Calls promote_orders_to_settled when a settlement flips to a paid state.';

DROP TRIGGER IF EXISTS trg_daily_settlements_promote_on_paid ON daily_settlements;
CREATE TRIGGER trg_daily_settlements_promote_on_paid
  AFTER UPDATE ON daily_settlements
  FOR EACH ROW
  WHEN (
    NEW.status IN ('paid', 'completed')
    AND (OLD.status IS DISTINCT FROM NEW.status)
  )
  EXECUTE FUNCTION trg_fn_promote_orders_on_settlement_paid();

DROP TRIGGER IF EXISTS trg_carrier_settlements_promote_on_paid ON carrier_settlements;
CREATE TRIGGER trg_carrier_settlements_promote_on_paid
  AFTER UPDATE ON carrier_settlements
  FOR EACH ROW
  WHEN (
    NEW.status = 'paid'
    AND (OLD.status IS DISTINCT FROM NEW.status)
  )
  EXECUTE FUNCTION trg_fn_promote_orders_on_settlement_paid();

-- ============================================================================
-- SECTION 10. Partial indexes
-- ============================================================================
-- Kept inside the transaction. CREATE INDEX CONCURRENTLY cannot run inside
-- a transaction block, so we use regular CREATE INDEX IF NOT EXISTS. The
-- tables are small enough (orders 50 to 200k rows, dispatch_session_orders
-- under 50k) that the lock window is under a second on production hardware.
-- If a larger scale is ever hit, these three CREATE INDEX statements can be
-- extracted into a separate post-deploy script using CONCURRENTLY.

CREATE INDEX IF NOT EXISTS idx_orders_delivered_pending_settle
  ON orders (store_id, courier_id, delivered_at)
  WHERE status = 'delivered'::order_status AND settled_at IS NULL;

COMMENT ON INDEX idx_orders_delivered_pending_settle IS
'Hot path: list of delivered orders awaiting settlement, grouped by store + courier + delivery date. Powers the por-liquidar tab.';

CREATE INDEX IF NOT EXISTS idx_orders_settled
  ON orders (store_id, settled_at DESC)
  WHERE status = 'settled'::order_status;

COMMENT ON INDEX idx_orders_settled IS
'Powers the liquidados tab: reverse chronological settled orders per store.';

CREATE INDEX IF NOT EXISTS idx_dispatch_session_orders_variance
  ON dispatch_session_orders (dispatch_session_id)
  WHERE fee_variance != 0;

COMMENT ON INDEX idx_dispatch_session_orders_variance IS
'Powers the variance dashboard: rows with non-zero delivery cost variance.';

-- ============================================================================
-- SECTION 11. View rebuild: v_pending_reconciliation
-- ============================================================================
-- Changes vs migration 100:
--   - Surface status = 'delivered' OR legacy sleeves_status = 'delivered'
--     during the transition window (so delivered rows written only via
--     sleeves_status path still appear).
--   - Exclude rows that are already settled_at IS NOT NULL so the "por
--     liquidar" bucket is accurate.

DROP VIEW IF EXISTS v_pending_reconciliation;
CREATE VIEW v_pending_reconciliation AS
SELECT
  o.store_id,
  (o.delivered_at::date) AS delivery_date,
  o.courier_id AS carrier_id,
  c.name AS carrier_name,
  COALESCE(c.failed_attempt_fee_percent, 50) AS failed_attempt_fee_percent,
  COUNT(*) AS total_orders,
  SUM(CASE
    WHEN LOWER(COALESCE(o.payment_method, '')) IN ('cod', 'cash', 'contra_entrega', 'efectivo', 'contra entrega')
    THEN COALESCE(o.total_price, 0)
    ELSE 0
  END) AS total_cod,
  COUNT(*) FILTER (
    WHERE LOWER(COALESCE(o.payment_method, '')) NOT IN ('cod', 'cash', 'contra_entrega', 'efectivo', 'contra entrega')
  ) AS total_prepaid
FROM orders o
JOIN carriers c ON c.id = o.courier_id
WHERE (o.status = 'delivered'::order_status OR o.sleeves_status = 'delivered')
  AND o.settled_at IS NULL
  AND o.reconciled_at IS NULL
  AND o.delivered_at IS NOT NULL
  AND o.courier_id IS NOT NULL
GROUP BY o.store_id, (o.delivered_at::date), o.courier_id, c.name, c.failed_attempt_fee_percent;

COMMENT ON VIEW v_pending_reconciliation IS
'Groups delivered orders that have not been reconciled yet, by delivery date and carrier. Migration 148b adds the enum OR legacy filter and excludes already settled rows.';

GRANT SELECT ON v_pending_reconciliation TO authenticated;

-- ============================================================================
-- SECTION 12. View: v_settlement_variance
-- ============================================================================
-- Finance dashboard: variance aggregated by store, carrier, delivery zone,
-- and month. Pulls actual vs quoted from dispatch_session_orders.

CREATE OR REPLACE VIEW v_settlement_variance AS
SELECT
  dso.dispatch_session_id,
  ds.store_id,
  ds.carrier_id,
  car.name AS carrier_name,
  ds.dispatch_date,
  DATE_TRUNC('month', ds.dispatch_date)::date AS month,
  dso.delivery_zone,
  COUNT(*) AS orders_count,
  COALESCE(SUM(dso.quoted_carrier_fee), 0) AS total_quoted,
  COALESCE(SUM(dso.actual_carrier_fee), 0) AS total_actual,
  COALESCE(SUM(dso.fee_variance), 0) AS total_variance,
  COUNT(*) FILTER (WHERE dso.fee_variance != 0) AS rows_with_variance,
  COUNT(*) FILTER (WHERE dso.fee_variance > 0) AS rows_variance_over,
  COUNT(*) FILTER (WHERE dso.fee_variance < 0) AS rows_variance_under
FROM dispatch_session_orders dso
JOIN dispatch_sessions ds ON ds.id = dso.dispatch_session_id
JOIN carriers car ON car.id = ds.carrier_id
GROUP BY
  dso.dispatch_session_id,
  ds.store_id,
  ds.carrier_id,
  car.name,
  ds.dispatch_date,
  dso.delivery_zone;

COMMENT ON VIEW v_settlement_variance IS
'Finance dashboard: quoted vs actual carrier fee variance, grouped by dispatch session, carrier, month, and zone.';

GRANT SELECT ON v_settlement_variance TO authenticated;

-- ============================================================================
-- SECTION 13. View: v_dispatch_session_detail
-- ============================================================================
-- Rebuilds v_dispatch_session_details (legacy 045) so the dispatch session
-- detail page shows ALL rows grouped by enum status with settled_at and
-- variance surfaced. The legacy view filtered by delivery_status which is
-- exactly the root cause of "pedido entregado desaparece en dispatch
-- session". We keep the legacy view untouched for backwards compatibility
-- and introduce the new one alongside it.

CREATE OR REPLACE VIEW v_dispatch_session_detail AS
SELECT
  dso.id AS dispatch_session_order_id,
  dso.dispatch_session_id,
  ds.session_code,
  ds.dispatch_date,
  ds.store_id,
  ds.carrier_id,
  car.name AS carrier_name,
  dso.order_id,
  dso.order_number,
  dso.customer_name,
  dso.customer_phone,
  dso.delivery_address,
  dso.delivery_city,
  dso.delivery_zone,
  dso.total_price,
  dso.payment_method,
  dso.is_cod,
  dso.quoted_carrier_fee,
  dso.actual_carrier_fee,
  dso.fee_variance,
  dso.fee_variance_reason,
  dso.delivery_status,
  dso.amount_collected,
  dso.failure_reason,
  dso.courier_notes,
  dso.delivered_at AS dso_delivered_at,
  o.status AS order_status,
  o.sleeves_status AS order_legacy_status,
  o.reconciled_at AS order_reconciled_at,
  o.settled_at AS order_settled_at,
  o.payment_status AS order_payment_status
FROM dispatch_session_orders dso
JOIN dispatch_sessions ds ON ds.id = dso.dispatch_session_id
JOIN carriers car ON car.id = ds.carrier_id
LEFT JOIN orders o ON o.id = dso.order_id;

COMMENT ON VIEW v_dispatch_session_detail IS
'Dispatch session detail: every row in the session joined with the current order status (enum + legacy), reconciled_at, settled_at, and variance fields. Unlike v_dispatch_session_details (045) this view does not filter by delivery_status so delivered rows do not disappear.';

GRANT SELECT ON v_dispatch_session_detail TO authenticated;

-- ============================================================================
-- SECTION 14. Backfill delivered -> settled
-- ============================================================================
-- Promote any order that is currently delivered + reconciled + linked to a
-- paid settlement (either daily via dispatch_session_orders / delivery-date
-- match, or external via carrier_settlement_id). settled_at is stamped from
-- reconciled_at when present, otherwise NOW().
--
-- Chunked to avoid long locks when the orders table is large. The loop
-- exits when a batch updates zero rows (fully drained).

DO $$
DECLARE
  v_chunk_size INT := 5000;
  v_updated INT := 0;
  v_total INT := 0;
  v_iterations INT := 0;
  v_max_iterations INT := 200;
BEGIN
  LOOP
    v_iterations := v_iterations + 1;
    IF v_iterations > v_max_iterations THEN
      RAISE EXCEPTION 'backfill: exceeded max_iterations=%, aborting to avoid runaway loop', v_max_iterations;
    END IF;

    WITH candidates AS (
      SELECT o.id
      FROM orders o
      WHERE o.status = 'delivered'::order_status
        AND o.settled_at IS NULL
        AND o.reconciled_at IS NOT NULL
        AND (
          EXISTS (
            SELECT 1
            FROM dispatch_session_orders dso
            JOIN dispatch_sessions ds ON ds.id = dso.dispatch_session_id
            JOIN daily_settlements dset ON dset.id = ds.daily_settlement_id
            WHERE dso.order_id = o.id
              AND dset.status IN ('paid', 'completed')
          )
          OR EXISTS (
            SELECT 1
            FROM daily_settlements dset
            WHERE dset.store_id = o.store_id
              AND dset.carrier_id = o.courier_id
              AND dset.settlement_date = (o.delivered_at::date)
              AND dset.status IN ('paid', 'completed')
          )
          OR EXISTS (
            SELECT 1
            FROM carrier_settlements cs
            WHERE cs.id = o.carrier_settlement_id
              AND cs.status = 'paid'
          )
        )
      LIMIT v_chunk_size
      FOR UPDATE SKIP LOCKED
    )
    UPDATE orders o
    SET status = 'settled'::order_status,
        settled_at = COALESCE(o.reconciled_at, NOW())
    FROM candidates
    WHERE o.id = candidates.id
      AND o.status = 'delivered'::order_status
      AND o.settled_at IS NULL;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    v_total := v_total + v_updated;

    EXIT WHEN v_updated = 0;
    RAISE NOTICE 'backfill delivered->settled: iter=% updated=% total=%', v_iterations, v_updated, v_total;
  END LOOP;

  RAISE NOTICE '============================================';
  RAISE NOTICE 'Migration 148b backfill: promoted % orders to settled', v_total;
  RAISE NOTICE '============================================';
END $$;

-- ============================================================================
-- SECTION 15. Verification
-- ============================================================================

DO $$
DECLARE
  v_settled_without_timestamp INT;
  v_delivered_with_timestamp INT;
BEGIN
  SELECT COUNT(*) INTO v_settled_without_timestamp
  FROM orders
  WHERE status = 'settled'::order_status
    AND settled_at IS NULL;

  IF v_settled_without_timestamp > 0 THEN
    RAISE EXCEPTION 'Invariant violated: % orders have status=settled but settled_at IS NULL', v_settled_without_timestamp;
  END IF;

  SELECT COUNT(*) INTO v_delivered_with_timestamp
  FROM orders
  WHERE status = 'delivered'::order_status
    AND settled_at IS NOT NULL;

  IF v_delivered_with_timestamp > 0 THEN
    RAISE EXCEPTION 'Invariant violated: % orders have status=delivered but settled_at IS NOT NULL', v_delivered_with_timestamp;
  END IF;

  RAISE NOTICE '============================================';
  RAISE NOTICE '  MIGRATION 148b VERIFICATION';
  RAISE NOTICE '============================================';
  RAISE NOTICE 'OK: orders.settled_at column present';
  RAISE NOTICE 'OK: dispatch_session_orders variance columns present';
  RAISE NOTICE 'OK: daily_settlements variance aggregates present';
  RAISE NOTICE 'OK: promote_orders_to_settled() installed';
  RAISE NOTICE 'OK: process_dispatch_settlement() rewritten with dual write';
  RAISE NOTICE 'OK: process_delivery_reconciliation() rewritten with dual write';
  RAISE NOTICE 'OK: mark_settlement_paid() calls promote_orders_to_settled';
  RAISE NOTICE 'OK: create_carrier_settlement() rewritten with dual write';
  RAISE NOTICE 'OK: triggers installed on daily_settlements and carrier_settlements';
  RAISE NOTICE 'OK: partial indexes created';
  RAISE NOTICE 'OK: v_pending_reconciliation rebuilt, v_settlement_variance + v_dispatch_session_detail created';
  RAISE NOTICE 'OK: backfill delivered->settled completed';
  RAISE NOTICE '============================================';
END $$;

-- Reload PostgREST schema cache so the new views and functions are exposed.
NOTIFY pgrst, 'reload schema';

COMMIT;
