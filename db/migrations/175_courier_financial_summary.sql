-- ================================================================
-- Migration 175: Courier Financial Summary (Phase 3 of Courier Portal)
-- ================================================================
-- Created: 2026-05-08
-- Author: Bright Idea
--
-- DEPENDENCIES:
--   - Migration 077: carriers.failed_attempt_fee_percent
--   - Migration 100: orders.reconciled_at (delivery-based reconciliation)
--   - Migration 174: courier_operators (this migration is the data layer
--                    behind the portal endpoints from Phase 1)
--
-- PURPOSE:
--   Single-query backing for GET /api/portal/financial-summary. The
--   portal needs four numbers in O(1) regardless of order volume:
--     1. In-transit COD pending to collect
--     2. In-transit shipping fees pending
--     3. Delivered-unsettled COD collected to remit
--     4. Delivered-unsettled shipping fees to receive
--   Plus failed-attempt fees, computed via a separate function because
--   it requires an aggregation across delivery_attempts that does not
--   compose cleanly with the orders-level GROUP BY.
--
--   Also adds two columns the orders table was missing for the courier
--   incident flow (incident_description / incident_reported_at), and
--   the supporting index for the financial summary.
--
-- DESIGN NOTES:
--   - We use sleeves_status as the source of truth for fulfillment
--     stage (matches the rest of the codebase, including the stock
--     trigger and reconciliation views).
--   - "In transit" = ready_to_ship + shipped + in_transit. We do NOT
--     include 'out_for_delivery' because that status is unused in
--     production (per check-constraint audit) and would distort counts
--     if a future codepath starts emitting it.
--   - "Delivered unsettled" = sleeves_status='delivered' AND
--     reconciled_at IS NULL. Once reconciled_at is stamped (Migration
--     100 flow), the order leaves the courier balance.
--   - COD detection in SQL must mirror api/utils/payment.ts. We treat
--     payment_method as COD when it is one of the COD strings OR empty
--     OR NULL (legacy default). prepaid_method NOT NULL means the order
--     was paid online before delivery and the courier collected nothing.
--   - shipping_cost is read directly from orders. If a row has it NULL
--     (legacy or pre-dispatch), it contributes 0 to the totals. The
--     application layer can backfill via calculate_shipping_cost() at
--     order-detail render time without affecting the summary numbers.
--   - The view is intentionally NOT a materialized view: courier-side
--     freshness matters and the index below makes the query trivial.
--
-- VERIFICATION SQL:
--   -- Per (store, carrier) totals
--   SELECT * FROM v_courier_financial_summary
--    WHERE store_id = :store AND carrier_id = :carrier;
--   -- Failed attempt fees
--   SELECT get_courier_failed_attempt_fees(:store, :carrier);
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='orders') THEN
    RAISE EXCEPTION 'Missing dependency: orders table not found.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='carriers') THEN
    RAISE EXCEPTION 'Missing dependency: carriers table not found.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='delivery_attempts') THEN
    RAISE EXCEPTION 'Missing dependency: delivery_attempts table not found.';
  END IF;
END $$;

-- ----------------------------------------------------------------
-- 1. Incident columns on orders (used by POST /api/portal/orders/:id/report-incident)
-- ----------------------------------------------------------------
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS incident_description TEXT;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS incident_reported_at TIMESTAMPTZ;

COMMENT ON COLUMN orders.incident_description IS
  'Free-text description of an active delivery incident. Set by courier portal report-incident; cleared when admin resolves.';
COMMENT ON COLUMN orders.incident_reported_at IS
  'When the active incident was reported. NULL when has_active_incident=false.';

-- ----------------------------------------------------------------
-- 2. Index supporting v_courier_financial_summary
-- ----------------------------------------------------------------
-- Partial index: only orders with a courier assigned matter for the
-- summary, and we always filter by deleted_at IS NULL. The composite
-- ordering matches the WHERE + GROUP BY of the view.
CREATE INDEX IF NOT EXISTS idx_orders_courier_summary
  ON orders(store_id, courier_id, sleeves_status, reconciled_at)
  WHERE courier_id IS NOT NULL AND deleted_at IS NULL;

-- ----------------------------------------------------------------
-- 3. v_courier_financial_summary
-- ----------------------------------------------------------------
DROP VIEW IF EXISTS v_courier_financial_summary;

CREATE VIEW v_courier_financial_summary AS
SELECT
  o.store_id,
  o.courier_id AS carrier_id,

  -- IN TRANSIT: orders the courier is currently carrying
  COUNT(*) FILTER (
    WHERE o.sleeves_status IN ('ready_to_ship','shipped','in_transit')
  ) AS in_transit_count,

  -- COD pending = sum of total_price for in-transit orders that are COD.
  -- COD test mirrors api/utils/payment.ts:isOrderCod():
  --   prepaid_method IS NULL  AND payment_method is a COD value (or empty/null).
  COALESCE(SUM(
    CASE
      WHEN o.sleeves_status IN ('ready_to_ship','shipped','in_transit')
       AND o.prepaid_method IS NULL
       AND (
         o.payment_method IS NULL
         OR LOWER(TRIM(o.payment_method)) IN (
           'efectivo','cash','cash_on_delivery',
           'contra entrega','contra_entrega','cod',''
         )
       )
      THEN COALESCE(o.total_price, 0)
      ELSE 0
    END
  ), 0)::numeric AS in_transit_cod_pending,

  -- Shipping fees the courier will earn on currently in-transit orders
  COALESCE(SUM(
    CASE
      WHEN o.sleeves_status IN ('ready_to_ship','shipped','in_transit')
      THEN COALESCE(o.shipping_cost, 0)
      ELSE 0
    END
  ), 0)::numeric AS in_transit_shipping_fees,

  -- DELIVERED UNSETTLED: delivered but not yet reconciled by the store
  COUNT(*) FILTER (
    WHERE o.sleeves_status = 'delivered'
      AND o.reconciled_at IS NULL
  ) AS delivered_unsettled_count,

  -- COD collected and pending remittance to the store. Uses
  -- amount_collected (what the courier actually took), not total_price.
  COALESCE(SUM(
    CASE
      WHEN o.sleeves_status = 'delivered'
       AND o.reconciled_at IS NULL
      THEN COALESCE(o.amount_collected, 0)
      ELSE 0
    END
  ), 0)::numeric AS cod_collected_to_remit,

  -- Shipping fees the store owes the courier on delivered-unsettled orders
  COALESCE(SUM(
    CASE
      WHEN o.sleeves_status = 'delivered'
       AND o.reconciled_at IS NULL
      THEN COALESCE(o.shipping_cost, 0)
      ELSE 0
    END
  ), 0)::numeric AS shipping_fees_to_receive

FROM orders o
WHERE o.courier_id IS NOT NULL
  AND o.deleted_at IS NULL
GROUP BY o.store_id, o.courier_id;

COMMENT ON VIEW v_courier_financial_summary IS
  'Per-(store_id, carrier_id) snapshot of in-transit and delivered-unsettled financials. Backs GET /api/portal/financial-summary. Source of truth for the courier portal balance card.';

GRANT SELECT ON v_courier_financial_summary TO authenticated, service_role;

-- ----------------------------------------------------------------
-- 4. get_courier_failed_attempt_fees
-- ----------------------------------------------------------------
-- Fees the courier owes the store for failed delivery attempts on
-- delivered-unsettled orders (pre-reconciliation only). Computed as
-- failed_attempt_fee_percent of shipping_cost per failed attempt.
--
-- Why a function and not a view column: each delivered order may have
-- multiple delivery_attempts rows, so the per-order aggregate composes
-- with sum-over-orders. Pushing this into the view would either join
-- and risk duplicating the parent-level aggregates, or use a correlated
-- subquery in SELECT, which fights the optimizer.
--
-- SECURITY DEFINER + fixed search_path: portal middleware calls this
-- with carrier_id pinned to req.courierCarrierId, but defense in depth
-- is cheap.
CREATE OR REPLACE FUNCTION get_courier_failed_attempt_fees(
  p_store_id UUID,
  p_carrier_id UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fee_percent NUMERIC;
  v_total NUMERIC;
BEGIN
  IF p_store_id IS NULL OR p_carrier_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(failed_attempt_fee_percent, 50)
    INTO v_fee_percent
  FROM carriers
  WHERE id = p_carrier_id
    AND store_id = p_store_id
  LIMIT 1;

  IF v_fee_percent IS NULL THEN
    RETURN 0;
  END IF;

  -- Sum failed attempts across delivered-unsettled orders only. The
  -- store charges the courier per failed attempt as a percentage of
  -- the shipping_cost of the order the attempt belongs to.
  SELECT COALESCE(SUM(
    COALESCE(o.shipping_cost, 0) * (v_fee_percent / 100.0)
  ), 0)
  INTO v_total
  FROM delivery_attempts da
  JOIN orders o ON o.id = da.order_id
  WHERE da.store_id = p_store_id
    AND da.carrier_id = p_carrier_id
    AND da.status = 'failed'
    AND o.courier_id = p_carrier_id
    AND o.store_id = p_store_id
    AND o.deleted_at IS NULL
    AND o.sleeves_status = 'delivered'
    AND o.reconciled_at IS NULL;

  RETURN v_total;
END;
$$;

COMMENT ON FUNCTION get_courier_failed_attempt_fees(UUID, UUID) IS
  'Sum of failed-attempt fees the courier owes the store for delivered-unsettled orders. Uses carriers.failed_attempt_fee_percent (default 50%).';

GRANT EXECUTE ON FUNCTION get_courier_failed_attempt_fees(UUID, UUID)
  TO authenticated, service_role;

-- ================================================================
-- ROLLBACK (manual)
-- ================================================================
-- DROP FUNCTION IF EXISTS get_courier_failed_attempt_fees(UUID, UUID);
-- DROP VIEW IF EXISTS v_courier_financial_summary;
-- DROP INDEX IF EXISTS idx_orders_courier_summary;
-- ALTER TABLE orders DROP COLUMN IF EXISTS incident_reported_at;
-- ALTER TABLE orders DROP COLUMN IF EXISTS incident_description;
