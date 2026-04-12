-- ============================================================================
-- MIGRATION 148c: sleeves_status legacy cleanup
-- ============================================================================
-- Date: 2026-04-09 (authored)
-- Apply: ONLY after 24h stable in production with the runtime code fully
--        migrated to src/lib/order-status-helpers.ts and the code sweep
--        (FASE 2) completed.
-- Depends on: 148a + 148b + FASE 2 code sweep
-- Plan: iterative-whistling-flute
--
-- ADVERTENCIA / WARNING:
--   Este archivo DROPEA la columna orders.sleeves_status. Una vez aplicado,
--   ningun codigo puede referenciar sleeves_status. Antes de aplicar:
--     1. Migration 148b aplicada y estable en produccion por al menos 24h.
--     2. Runtime code (api/* y src/*) migrado a src/lib/order-status-helpers.ts
--        via el code sweep de FASE 2.
--     3. scripts/audit_sleeves_status.ts devuelve exit 0 (cero refs en
--        codigo runtime TypeScript / TSX).
--     4. Cualquier view, index, function, o trigger que referencie
--        sleeves_status ya fue auditada y migrada.
--     5. Supabase PITR snapshot confirmado para rollback de emergencia.
--
-- Purpose:
--   1. Backfill final: para rows donde orders.status IS NULL pero
--      sleeves_status IS NOT NULL, mapear el valor legacy al enum actual.
--      Mapeo:
--        - 'contacted' o 'awaiting_carrier' -> 'pending' (nunca existieron
--          en el enum, siempre fueron VARCHAR legacy intermedios)
--        - 'shipped' -> 'in_transit' (shipped nunca fue enum value)
--        - 'incident' -> 'delivered' (incidents se trackean en
--          delivery_incidents, el estado del pedido vuelve a delivered)
--        - cualquier otro valor que sea enum valido se castea directo.
--   2. Invariante: cero rows con status IS NULL post-backfill.
--   3. DROP de la columna sleeves_status.
--   4. DROP de indexes legacy que apuntaban a sleeves_status.
--   5. DROP del view legacy v_dispatch_session_details (migration 045) que
--      referenciaba carrier_fee y sleeves_status, ya reemplazado por
--      v_dispatch_session_detail (148b).
--
-- Rollback:
--   BEGIN;
--     ALTER TABLE orders
--       ADD COLUMN sleeves_status VARCHAR(50);
--     UPDATE orders
--     SET sleeves_status = status::text
--     WHERE sleeves_status IS NULL;
--     CREATE INDEX idx_orders_legacy_sleeves_status
--       ON orders(store_id, sleeves_status, created_at DESC);
--     -- Views y functions rollback: revertir a 148b.
--   COMMIT;
--
--   Tiempo estimado de rollback: 2 min para 100k rows.
--
-- Safety:
--   Wrapped in BEGIN / COMMIT. Verification RAISE EXCEPTION aborta el COMMIT
--   si la invariante post-backfill no se cumple.
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1. Final backfill: sleeves_status -> status
-- ============================================================================
-- Para rows que nunca fueron tocadas por migration 017 (backfill parcial)
-- ni por el codigo runtime dual-write de FASE 2. Ejecutado en chunks para
-- evitar long locks en produccion.

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
      RAISE EXCEPTION 'final backfill: exceeded max_iterations=%, aborting', v_max_iterations;
    END IF;

    WITH candidates AS (
      SELECT id
      FROM orders
      WHERE status IS NULL
        AND sleeves_status IS NOT NULL
      LIMIT v_chunk_size
      FOR UPDATE SKIP LOCKED
    )
    UPDATE orders o
    SET status = (
      CASE o.sleeves_status
        WHEN 'pending' THEN 'pending'::order_status
        WHEN 'contacted' THEN 'pending'::order_status
        WHEN 'awaiting_carrier' THEN 'pending'::order_status
        WHEN 'confirmed' THEN 'confirmed'::order_status
        WHEN 'in_preparation' THEN 'in_preparation'::order_status
        WHEN 'ready_to_ship' THEN 'ready_to_ship'::order_status
        WHEN 'shipped' THEN 'in_transit'::order_status
        WHEN 'in_transit' THEN 'in_transit'::order_status
        WHEN 'delivered' THEN 'delivered'::order_status
        WHEN 'incident' THEN 'delivered'::order_status
        WHEN 'settled' THEN 'settled'::order_status
        WHEN 'cancelled' THEN 'cancelled'::order_status
        WHEN 'rejected' THEN 'rejected'::order_status
        WHEN 'returned' THEN 'returned'::order_status
        ELSE 'pending'::order_status
      END
    )
    FROM candidates
    WHERE o.id = candidates.id
      AND o.status IS NULL;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    v_total := v_total + v_updated;

    EXIT WHEN v_updated = 0;
    RAISE NOTICE 'final backfill sleeves_status -> status: iter=% updated=% total=%', v_iterations, v_updated, v_total;
  END LOOP;

  RAISE NOTICE 'Migration 148c backfill: migrated % rows', v_total;
END $$;

-- ============================================================================
-- SECTION 2. Invariant: zero rows with status IS NULL
-- ============================================================================

DO $$
DECLARE
  v_null_count INT;
BEGIN
  SELECT COUNT(*) INTO v_null_count
  FROM orders
  WHERE status IS NULL;

  IF v_null_count > 0 THEN
    RAISE EXCEPTION
      'ABORT 148c: % orders still have status IS NULL after backfill. Investigate before dropping sleeves_status. Query: SELECT id, sleeves_status FROM orders WHERE status IS NULL LIMIT 50;',
      v_null_count;
  END IF;

  RAISE NOTICE 'OK: zero orders with status IS NULL';
END $$;

-- ============================================================================
-- SECTION 3. Drop legacy indexes and views that reference sleeves_status
-- ============================================================================

-- From migration 000_MASTER_MIGRATION.sql
DROP INDEX IF EXISTS idx_orders_status;  -- (recreated below against status enum)
DROP INDEX IF EXISTS idx_orders_incident_status;

-- From migration 100_delivery_based_reconciliation.sql
DROP INDEX IF EXISTS idx_orders_pending_reconciliation;

-- Legacy view from migration 045 that references carrier_fee and
-- sleeves_status. Replaced by v_dispatch_session_detail (148b).
DROP VIEW IF EXISTS v_dispatch_session_details;

-- Legacy view from migration 016 that references sleeves_status.
-- Rebuilt below against the enum.
DROP VIEW IF EXISTS pending_carrier_settlements_summary;

-- ============================================================================
-- SECTION 4. Drop column sleeves_status
-- ============================================================================

ALTER TABLE orders DROP COLUMN IF EXISTS sleeves_status;

-- ============================================================================
-- SECTION 5. Recreate essential indexes against the enum column
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_orders_status
  ON orders (store_id, status, created_at DESC);

-- Rebuild pending_reconciliation index without sleeves_status filter.
CREATE INDEX IF NOT EXISTS idx_orders_pending_reconciliation
  ON orders (store_id, courier_id, (delivered_at::date))
  WHERE status = 'delivered'::order_status
    AND reconciled_at IS NULL
    AND delivered_at IS NOT NULL;

-- ============================================================================
-- SECTION 6. Rebuild pending_carrier_settlements_summary without sleeves_status
-- ============================================================================

CREATE OR REPLACE VIEW pending_carrier_settlements_summary AS
SELECT
  c.id AS carrier_id,
  c.name AS carrier_name,
  c.carrier_type,
  c.store_id,
  COUNT(DISTINCT o.id) AS pending_orders_count,
  COALESCE(SUM(COALESCE(o.amount_collected, o.total_price)), 0) AS total_cod_pending,
  COALESCE(SUM(o.shipping_cost), 0) AS total_shipping_cost_pending,
  COALESCE(SUM(COALESCE(o.amount_collected, o.total_price)) - SUM(o.shipping_cost), 0) AS net_receivable_pending,
  MIN(o.delivered_at)::date AS oldest_delivery_date,
  MAX(o.delivered_at)::date AS newest_delivery_date
FROM carriers c
INNER JOIN orders o ON o.courier_id = c.id
WHERE o.status = 'delivered'::order_status
  AND o.carrier_settlement_id IS NULL
  AND c.carrier_type = 'external'
  AND c.is_active = TRUE
GROUP BY c.id, c.name, c.carrier_type, c.store_id
HAVING COUNT(o.id) > 0
ORDER BY oldest_delivery_date ASC;

COMMENT ON VIEW pending_carrier_settlements_summary IS
'Shows external carriers with delivered orders pending settlement. Migration 148c replaces sleeves_status filter with enum.';

GRANT SELECT ON pending_carrier_settlements_summary TO authenticated;

-- ============================================================================
-- SECTION 7. Rebuild create_carrier_settlement WHERE clause without legacy OR
-- ============================================================================

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
    AND status = 'delivered'::order_status
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

  UPDATE orders
  SET carrier_settlement_id = v_settlement_id,
      payment_status = 'collected'
  WHERE store_id = p_store_id
    AND courier_id = p_carrier_id
    AND status = 'delivered'::order_status
    AND delivered_at >= p_period_start
    AND delivered_at < (p_period_end + INTERVAL '1 day')
    AND carrier_settlement_id IS NULL;

  RETURN v_settlement_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_carrier_settlement(UUID, UUID, DATE, DATE, UUID) TO authenticated;

-- ============================================================================
-- SECTION 8. Rebuild v_pending_reconciliation without legacy OR
-- ============================================================================

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
WHERE o.status = 'delivered'::order_status
  AND o.settled_at IS NULL
  AND o.reconciled_at IS NULL
  AND o.delivered_at IS NOT NULL
  AND o.courier_id IS NOT NULL
GROUP BY o.store_id, (o.delivered_at::date), o.courier_id, c.name, c.failed_attempt_fee_percent;

GRANT SELECT ON v_pending_reconciliation TO authenticated;

-- ============================================================================
-- SECTION 9. Verification
-- ============================================================================

DO $$
DECLARE
  v_col_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'orders'
      AND column_name = 'sleeves_status'
  ) INTO v_col_exists;

  IF v_col_exists THEN
    RAISE EXCEPTION 'ABORT: orders.sleeves_status still exists after DROP';
  END IF;

  RAISE NOTICE '============================================';
  RAISE NOTICE '  MIGRATION 148c VERIFICATION';
  RAISE NOTICE '============================================';
  RAISE NOTICE 'OK: sleeves_status column dropped';
  RAISE NOTICE 'OK: zero orders with status IS NULL';
  RAISE NOTICE 'OK: indexes and views rebuilt against enum';
  RAISE NOTICE '============================================';
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
