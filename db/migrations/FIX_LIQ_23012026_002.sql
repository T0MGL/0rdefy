-- ============================================================================
-- FIX: Recalculate LIQ-23012026-002 with correct carrier rates
-- ============================================================================
-- This script recalculates the settlement using city-based coverage rates
-- (carrier_coverage) instead of zone-based rates (carrier_zones).
--
-- Run STEP 1 first to inspect, then STEP 2 to apply the fix.
-- ============================================================================

-- ============================================================================
-- STEP 1: INSPECT - View current settlement and recalculate correct values
-- ============================================================================

-- 1a. Current settlement data
SELECT
  ds.id,
  ds.settlement_code,
  ds.settlement_date,
  ds.carrier_id,
  c.name as carrier_name,
  ds.total_dispatched,
  ds.total_delivered,
  ds.total_not_delivered,
  ds.total_cod_collected,
  ds.total_carrier_fees as STORED_carrier_fees,
  ds.failed_attempt_fee as STORED_failed_fee,
  ds.net_receivable as STORED_net_receivable,
  ds.balance_due as STORED_balance_due,
  ds.status,
  c.failed_attempt_fee_percent
FROM daily_settlements ds
JOIN carriers c ON c.id = ds.carrier_id
WHERE ds.settlement_code = 'LIQ-23012026-002';

-- 1b. Find the orders that were reconciled for this settlement
-- (matched by carrier + date + store + reconciled_at near settlement creation)
WITH settlement AS (
  SELECT * FROM daily_settlements WHERE settlement_code = 'LIQ-23012026-002'
),
reconciled_orders AS (
  SELECT o.id, o.shipping_city, o.delivery_zone, o.payment_method, o.total_price,
         o.reconciled_at, o.delivered_at
  FROM orders o, settlement s
  WHERE o.store_id = s.store_id
    AND o.courier_id = s.carrier_id
    AND o.delivered_at::date = s.settlement_date
    AND o.reconciled_at IS NOT NULL
    -- Match orders reconciled around the settlement creation time (within 5 min)
    AND o.reconciled_at BETWEEN s.created_at - interval '5 minutes' AND s.created_at + interval '5 minutes'
)
SELECT
  ro.id,
  ro.shipping_city,
  ro.delivery_zone,
  ro.payment_method,
  ro.total_price,
  COALESCE(
    (SELECT cc.rate FROM carrier_coverage cc, settlement s
     WHERE cc.carrier_id = s.carrier_id
       AND LOWER(TRIM(cc.city)) = LOWER(TRIM(ro.shipping_city))
       AND cc.is_active = TRUE LIMIT 1),
    (SELECT cz.rate FROM carrier_zones cz, settlement s
     WHERE cz.carrier_id = s.carrier_id
       AND cz.store_id = s.store_id
       AND LOWER(cz.zone_name) = LOWER(ro.delivery_zone) LIMIT 1),
    (SELECT cz.rate FROM carrier_zones cz, settlement s
     WHERE cz.carrier_id = s.carrier_id
       AND cz.store_id = s.store_id LIMIT 1),
    0
  ) as correct_rate,
  LOWER(COALESCE(ro.payment_method, '')) IN ('cod', 'cash', 'contra_entrega', 'efectivo', 'contra entrega') as is_cod
FROM reconciled_orders ro;

-- 1c. Calculate the correct totals
WITH settlement AS (
  SELECT * FROM daily_settlements WHERE settlement_code = 'LIQ-23012026-002'
),
reconciled_orders AS (
  SELECT o.*
  FROM orders o, settlement s
  WHERE o.store_id = s.store_id
    AND o.courier_id = s.carrier_id
    AND o.delivered_at::date = s.settlement_date
    AND o.reconciled_at IS NOT NULL
    AND o.reconciled_at BETWEEN s.created_at - interval '5 minutes' AND s.created_at + interval '5 minutes'
),
order_rates AS (
  SELECT
    ro.id,
    COALESCE(
      (SELECT cc.rate FROM carrier_coverage cc, settlement s
       WHERE cc.carrier_id = s.carrier_id
         AND LOWER(TRIM(cc.city)) = LOWER(TRIM(ro.shipping_city))
         AND cc.is_active = TRUE LIMIT 1),
      (SELECT cz.rate FROM carrier_zones cz, settlement s
       WHERE cz.carrier_id = s.carrier_id
         AND cz.store_id = s.store_id
         AND LOWER(cz.zone_name) = LOWER(ro.delivery_zone) LIMIT 1),
      (SELECT cz.rate FROM carrier_zones cz, settlement s
       WHERE cz.carrier_id = s.carrier_id
         AND cz.store_id = s.store_id LIMIT 1),
      0
    ) as correct_rate
  FROM reconciled_orders ro
)
SELECT
  s.settlement_code,
  s.total_cod_collected,
  -- Correct carrier fees (all orders are delivered in this settlement)
  SUM(orr.correct_rate) as CORRECT_carrier_fees,
  s.total_carrier_fees as STORED_carrier_fees,
  -- Correct net receivable
  s.total_cod_collected - SUM(orr.correct_rate) as CORRECT_net_receivable,
  s.net_receivable as STORED_net_receivable,
  -- Difference
  (s.total_cod_collected - SUM(orr.correct_rate)) - s.net_receivable as DIFFERENCE
FROM settlement s, order_rates orr
GROUP BY s.settlement_code, s.total_cod_collected, s.total_carrier_fees, s.net_receivable;


-- ============================================================================
-- STEP 2: APPLY FIX - Update the settlement with correct values
-- ============================================================================
-- IMPORTANT: Run STEP 1 first to verify the correct values.
-- Then uncomment and run the UPDATE below.
-- ============================================================================

/*
WITH settlement AS (
  SELECT * FROM daily_settlements WHERE settlement_code = 'LIQ-23012026-002'
),
reconciled_orders AS (
  SELECT o.*
  FROM orders o, settlement s
  WHERE o.store_id = s.store_id
    AND o.courier_id = s.carrier_id
    AND o.delivered_at::date = s.settlement_date
    AND o.reconciled_at IS NOT NULL
    AND o.reconciled_at BETWEEN s.created_at - interval '5 minutes' AND s.created_at + interval '5 minutes'
),
order_rates AS (
  SELECT
    ro.id,
    COALESCE(
      (SELECT cc.rate FROM carrier_coverage cc, settlement s
       WHERE cc.carrier_id = s.carrier_id
         AND LOWER(TRIM(cc.city)) = LOWER(TRIM(ro.shipping_city))
         AND cc.is_active = TRUE LIMIT 1),
      (SELECT cz.rate FROM carrier_zones cz, settlement s
       WHERE cz.carrier_id = s.carrier_id
         AND cz.store_id = s.store_id
         AND LOWER(cz.zone_name) = LOWER(ro.delivery_zone) LIMIT 1),
      (SELECT cz.rate FROM carrier_zones cz, settlement s
       WHERE cz.carrier_id = s.carrier_id
         AND cz.store_id = s.store_id LIMIT 1),
      0
    ) as correct_rate
  FROM reconciled_orders ro
),
correct_totals AS (
  SELECT
    SUM(orr.correct_rate) as correct_carrier_fees
  FROM order_rates orr
)
UPDATE daily_settlements ds
SET
  total_carrier_fees = ct.correct_carrier_fees,
  net_receivable = ds.total_cod_collected - ct.correct_carrier_fees - ds.failed_attempt_fee,
  -- balance_due = corrected_net_receivable - amount_already_paid
  -- (keeps actual payment, adjusts remaining balance)
  balance_due = (ds.total_cod_collected - ct.correct_carrier_fees - ds.failed_attempt_fee) - COALESCE(ds.amount_paid, 0),
  -- If balance is now 0 or negative, mark as paid; otherwise revert to pending
  status = CASE
    WHEN COALESCE(ds.amount_paid, 0) >= (ds.total_cod_collected - ct.correct_carrier_fees - ds.failed_attempt_fee)
    THEN 'paid'
    ELSE 'pending'
  END,
  notes = COALESCE(ds.notes || E'\n', '') || '[CORRECCION migration 112] Tarifas recalculadas con carrier_coverage (city-based rates)',
  updated_at = NOW()
FROM correct_totals ct
WHERE ds.settlement_code = 'LIQ-23012026-002';
*/
