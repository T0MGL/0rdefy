-- ============================================================
-- Migration 159: Fix Settlement COD Calculation
--
-- PRODUCTION-READY - CRITICAL FIX
-- Date: 2026-04-13
--
-- PROBLEM: Conciliacion mostraba "COD esperado" inflado y diferencias
-- gigantes negativas (ej: courier cobra 49.000 Gs, sistema espera
-- 457.000 Gs, diferencia -408.000 Gs). Tres bugs encadenados:
--
-- BUG #1: is_order_cod() SQL no incluye 'cash_on_delivery'
--   Shopify usa exactamente ese string como payment_method para
--   ordenes COD. La funcion solo reconocia 'cod', 'cash', 'efectivo',
--   etc. Resultado: TODAS las ordenes COD de Shopify se trataban
--   como prepago en la conciliacion. La logica en api/utils/payment.ts
--   (TypeScript) ya incluye 'cash_on_delivery' (linea 14), pero la
--   funcion SQL quedo desincronizada.
--
-- BUG #2: v_pending_reconciliation usa total_price en vez de cod_amount
--   El campo correcto es cod_amount (lo que el courier debe cobrar al
--   cliente). cod_amount = 0 es SEMANTICO: indica que la orden ya fue
--   pagada online (Shopify webhook setea cod_amount = 0 cuando
--   financial_status = 'paid' o 'authorized'). Solo se debe caer a
--   total_price cuando cod_amount es NULL (ordenes pre-migration 019).
--
-- BUG #3: get_pending_reconciliation_orders RPC retorna total_price como cod_amount
--   Misma raiz que Bug #2: la RPC que alimenta el detalle de
--   conciliacion calcula cod_amount = total_price en vez de leer el
--   campo real. Hace que el preview en pantalla no coincida con
--   ningun valor real de la BD.
--
-- FIX:
-- 1. Recrea is_order_cod() incluyendo 'cash_on_delivery'
-- 2. Drop + recreate v_pending_reconciliation usando
--    COALESCE(o.cod_amount, o.total_price, 0)
--    (NO usar NULLIF: 0 es semantico, no missing)
-- 3. Drop + recreate get_pending_reconciliation_orders con misma logica
--
-- DEPENDENCIES:
-- - Migration 115 (is_order_cod, v_pending_reconciliation, RPC)
-- - Migration 119 (refuerza is_order_cod, mismo bug)
--
-- IDEMPOTENT: Safe to run multiple times
-- ROLLBACK: All CREATE OR REPLACE / DROP+CREATE
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Fix is_order_cod() - add cash_on_delivery
-- ============================================================
CREATE OR REPLACE FUNCTION is_order_cod(
  p_payment_method TEXT,
  p_prepaid_method TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  -- Order is COD only if:
  -- 1. prepaid_method is NULL (not marked as prepaid)
  -- 2. payment_method is a COD type (or empty, which defaults to COD)
  --
  -- 'cash_on_delivery' added in migration 159 - it is the literal value
  -- Shopify sends and is already used by api/utils/payment.ts
  SELECT p_prepaid_method IS NULL
    AND LOWER(COALESCE(p_payment_method, '')) IN (
      'cod',
      'cash',
      'cash_on_delivery',
      'contra_entrega',
      'contra entrega',
      'efectivo',
      ''
    );
$$;

COMMENT ON FUNCTION is_order_cod(TEXT, TEXT) IS
'Determines if an order should be treated as COD.
Returns FALSE if prepaid_method is set, even if payment_method is efectivo.
Migration 159: includes cash_on_delivery (Shopify default COD gateway).';


-- ============================================================
-- 2. Rebuild v_pending_reconciliation with cod_amount
-- ============================================================
DROP VIEW IF EXISTS v_pending_reconciliation CASCADE;

CREATE VIEW v_pending_reconciliation AS
SELECT
  o.store_id,
  (o.delivered_at::date) as delivery_date,
  o.courier_id as carrier_id,
  c.name as carrier_name,
  COALESCE(c.failed_attempt_fee_percent, 50) as failed_attempt_fee_percent,
  COUNT(*) as total_orders,
  -- COD total: actual cash courier collects from customer.
  -- cod_amount = 0 is SEMANTIC (paid online via Shopify), not missing data.
  -- Only fall back to total_price when cod_amount IS NULL (pre-migration 019 orders).
  SUM(CASE WHEN is_order_cod(o.payment_method, o.prepaid_method)
      THEN COALESCE(o.cod_amount, o.total_price, 0) ELSE 0 END) as total_cod,
  -- Prepaid count: inverse of COD
  COUNT(*) FILTER (WHERE NOT is_order_cod(o.payment_method, o.prepaid_method)) as total_prepaid
FROM orders o
JOIN carriers c ON c.id = o.courier_id
WHERE o.sleeves_status = 'delivered'
  AND o.reconciled_at IS NULL
  AND o.delivered_at IS NOT NULL
  AND o.courier_id IS NOT NULL
GROUP BY o.store_id, (o.delivered_at::date), o.courier_id, c.name, c.failed_attempt_fee_percent;

COMMENT ON VIEW v_pending_reconciliation IS
'Groups delivered orders pending reconciliation by date and carrier.
Migration 159: total_cod uses cod_amount with fallback to total_price.';


-- ============================================================
-- 3. Rebuild get_pending_reconciliation_orders RPC
-- ============================================================
DROP FUNCTION IF EXISTS get_pending_reconciliation_orders(UUID, UUID, DATE);

CREATE OR REPLACE FUNCTION get_pending_reconciliation_orders(
  p_store_id UUID,
  p_carrier_id UUID,
  p_delivery_date DATE
)
RETURNS TABLE (
  id UUID,
  display_order_number TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  customer_address TEXT,
  customer_city TEXT,
  total_price NUMERIC,
  cod_amount NUMERIC,
  payment_method TEXT,
  prepaid_method TEXT,
  is_cod BOOLEAN,
  delivered_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    COALESCE(
      o.shopify_order_name,
      CASE WHEN o.shopify_order_number IS NOT NULL
        THEN '#' || o.shopify_order_number::text
        ELSE NULL
      END,
      '#' || UPPER(RIGHT(o.id::text, 4))
    ) as display_order_number,
    TRIM(COALESCE(o.customer_first_name, '') || ' ' || COALESCE(o.customer_last_name, '')) as customer_name,
    COALESCE(o.customer_phone, '') as customer_phone,
    CASE
      WHEN o.shipping_address IS NULL THEN ''
      WHEN pg_typeof(o.shipping_address) = 'jsonb'::regtype
        THEN COALESCE(o.shipping_address->>'address1', '')
      ELSE COALESCE(o.shipping_address::text, '')
    END as customer_address,
    COALESCE(o.shipping_city, o.delivery_zone, '') as customer_city,
    COALESCE(o.total_price, 0) as total_price,
    -- cod_amount is the actual cash courier collects.
    -- 0 is SEMANTIC (paid online), only fallback to total_price when NULL.
    CASE WHEN is_order_cod(o.payment_method, o.prepaid_method)
      THEN COALESCE(o.cod_amount, o.total_price, 0) ELSE 0 END as cod_amount,
    COALESCE(o.payment_method, '') as payment_method,
    o.prepaid_method as prepaid_method,
    is_order_cod(o.payment_method, o.prepaid_method) as is_cod,
    o.delivered_at
  FROM orders o
  WHERE o.store_id = p_store_id
    AND o.courier_id = p_carrier_id
    AND (o.delivered_at::date) = p_delivery_date
    AND o.sleeves_status = 'delivered'
    AND o.reconciled_at IS NULL
  ORDER BY o.delivered_at ASC;
END;
$$;

COMMENT ON FUNCTION get_pending_reconciliation_orders(UUID, UUID, DATE) IS
'Returns delivered orders for reconciliation.
Migration 159: cod_amount uses authoritative cod_amount column with total_price fallback.';

GRANT EXECUTE ON FUNCTION get_pending_reconciliation_orders(UUID, UUID, DATE) TO authenticated;
GRANT SELECT ON v_pending_reconciliation TO authenticated;


-- ============================================================
-- 4. Verification
-- ============================================================
DO $$
BEGIN
  -- Verify is_order_cod recognizes cash_on_delivery
  IF NOT is_order_cod('cash_on_delivery', NULL) THEN
    RAISE EXCEPTION 'Migration 159 FAILED: is_order_cod does not recognize cash_on_delivery';
  END IF;

  -- Verify prepaid_method still overrides
  IF is_order_cod('cash_on_delivery', 'transferencia') THEN
    RAISE EXCEPTION 'Migration 159 FAILED: prepaid_method override broken';
  END IF;

  -- Verify view exists
  IF NOT EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_pending_reconciliation') THEN
    RAISE EXCEPTION 'Migration 159 FAILED: v_pending_reconciliation view missing';
  END IF;

  -- Verify function signature
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'get_pending_reconciliation_orders'
  ) THEN
    RAISE EXCEPTION 'Migration 159 FAILED: get_pending_reconciliation_orders missing';
  END IF;

  RAISE NOTICE 'Migration 159 VERIFIED: COD calculation fixed for settlement reconciliation';
END $$;

COMMIT;

-- ============================================================
-- Post-migration verification (run manually)
-- ============================================================
-- SELECT is_order_cod('cash_on_delivery', NULL);          -- TRUE  (was FALSE before)
-- SELECT is_order_cod('cash_on_delivery', 'transferencia'); -- FALSE
-- SELECT is_order_cod('efectivo', NULL);                   -- TRUE
-- SELECT is_order_cod('tarjeta', NULL);                    -- FALSE
-- SELECT is_order_cod(NULL, NULL);                         -- TRUE (default)
--
-- After applying, check pending reconciliation totals:
-- SELECT carrier_name, delivery_date, total_orders, total_cod, total_prepaid
-- FROM v_pending_reconciliation
-- WHERE store_id = '<your_store_id>'
-- ORDER BY delivery_date DESC;
