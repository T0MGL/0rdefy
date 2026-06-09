-- Migration 202: Align v_pending_reconciliation_by_carrier with the body running in production
--
-- WHY
--   The view was hot-patched directly in production during a NOCTE incident: the
--   original body (Migration 182) resolved the per-order COD amount with
--   COALESCE(o.cod_amount, o.total_price, 0). When an order carried cod_amount = 0
--   (a real, valid value for orders whose COD was captured as zero on the wire),
--   COALESCE treats 0 as present and stops, so the view reported zero pending COD
--   for that order. That hid live COD debt from the "Pendientes de Conciliar"
--   surface. The in-prod fix switched the amount resolution to an explicit
--   CASE WHEN cod_amount > 0 THEN cod_amount ELSE total_price branch, and the COD
--   classification to is_cod_payment_method(payment_method) + prepaid_method IS NULL
--   (the same predicate the settlement RPC uses since Migration 200).
--
--   The repo still held the Migration 182 version with the COALESCE branch. Any
--   re-apply of the repo against prod (rebuild, fresh environment, replay) would
--   silently reintroduce the bug. This migration formalizes the corrected body in
--   the repo so the repo and prod converge on one correct definition.
--
--   This change is zero-behavior in production: prod already runs exactly this
--   body. Its only effect is to make the repo match what is deployed, so a future
--   replay is a functional no-op instead of a regression.
--
-- SAFETY
--   CREATE OR REPLACE VIEW (not DROP + CREATE): re-applying is safe and idempotent.
--   No other view or function depends on this view via SQL (the Node services read
--   it through the Supabase client, not through a dependent SQL object), so no
--   DROP CASCADE is needed and column shape is preserved.
--
--   Column shape is byte-equivalent to the deployed view: same 11 columns, same
--   order, same names, same COD classification, same amount resolution, same WHERE
--   filters, same GROUP BY.

CREATE OR REPLACE VIEW public.v_pending_reconciliation_by_carrier AS
SELECT
  o.store_id,
  o.courier_id AS carrier_id,
  c.name AS carrier_name,
  COALESCE(c.failed_attempt_fee_percent, 50::numeric) AS failed_attempt_fee_percent,
  count(*) AS total_orders,
  sum(
    CASE
      WHEN is_cod_payment_method(o.payment_method::text) AND o.prepaid_method IS NULL THEN
        CASE
          WHEN COALESCE(o.cod_amount, 0::numeric) > 0::numeric THEN o.cod_amount
          ELSE COALESCE(o.total_price, 0::numeric)
        END
      ELSE 0::numeric
    END
  ) AS total_cod,
  count(*) FILTER (
    WHERE NOT is_cod_payment_method(o.payment_method::text) OR o.prepaid_method IS NOT NULL
  ) AS total_prepaid,
  min(o.delivered_at::date) AS oldest_delivery_date,
  max(o.delivered_at::date) AS newest_delivery_date,
  CURRENT_DATE - min(o.delivered_at::date) AS days_oldest
FROM orders o
  JOIN carriers c ON c.id = o.courier_id
WHERE o.sleeves_status::text = 'delivered'::text
  AND o.reconciled_at IS NULL
  AND o.delivered_at IS NOT NULL
  AND o.courier_id IS NOT NULL
GROUP BY o.store_id, o.courier_id, c.name, c.failed_attempt_fee_percent;

-- ============================================================
-- ROLLBACK (manual, documented only, do NOT execute)
-- ============================================================
-- Prior repo body (Migration 182). This is the version that reintroduces the
-- cod_amount = 0 bug via COALESCE, kept here only as a record of what was there
-- before, in case a revert is ever needed:
--
-- CREATE OR REPLACE VIEW public.v_pending_reconciliation_by_carrier AS
-- SELECT
--   o.store_id,
--   o.courier_id                                                AS carrier_id,
--   c.name                                                      AS carrier_name,
--   COALESCE(c.failed_attempt_fee_percent, 50)                  AS failed_attempt_fee_percent,
--   COUNT(*)                                                    AS total_orders,
--   SUM(CASE
--         WHEN LOWER(COALESCE(o.payment_method, '')) IN ('cod','cash','contra_entrega','efectivo','contra entrega')
--           AND o.prepaid_method IS NULL
--         THEN COALESCE(o.cod_amount, o.total_price, 0)
--         ELSE 0
--       END)                                                    AS total_cod,
--   COUNT(*) FILTER (
--     WHERE LOWER(COALESCE(o.payment_method, '')) NOT IN ('cod','cash','contra_entrega','efectivo','contra entrega')
--        OR o.prepaid_method IS NOT NULL
--   )                                                           AS total_prepaid,
--   MIN(o.delivered_at::date)                                   AS oldest_delivery_date,
--   MAX(o.delivered_at::date)                                   AS newest_delivery_date,
--   (CURRENT_DATE - MIN(o.delivered_at::date))::INT             AS days_oldest
-- FROM orders o
-- JOIN carriers c ON c.id = o.courier_id
-- WHERE o.sleeves_status   = 'delivered'
--   AND o.reconciled_at    IS NULL
--   AND o.delivered_at     IS NOT NULL
--   AND o.courier_id       IS NOT NULL
-- GROUP BY o.store_id, o.courier_id, c.name, c.failed_attempt_fee_percent;
-- ============================================================
