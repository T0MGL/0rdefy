-- ============================================================
-- Migration 105: Fix Reconciliation City Display
-- ============================================================
--
-- ISSUE: The get_pending_reconciliation_orders function was
-- prioritizing delivery_zone (zone codes like "CENTRAL") over
-- shipping_city (actual city names like "Luque", "Fernando de la Mora")
--
-- ROOT CAUSE: Line 91 in migration 100 had:
--   COALESCE(o.delivery_zone, o.shipping_city, '') as customer_city
--
-- FIX: Reverse the COALESCE order to show actual city names first:
--   COALESCE(o.shipping_city, o.delivery_zone, '') as customer_city
--
-- IMPACT: Display-only change. No business logic affected.
-- ROLLBACK: See commented rollback section at end of file.
-- ============================================================

-- ============================================================
-- PRE-FLIGHT CHECK: Verify columns exist
-- ============================================================
DO $$
BEGIN
  -- Verify shipping_city column exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'shipping_city'
  ) THEN
    RAISE EXCEPTION 'MIGRATION 105 BLOCKED: orders.shipping_city column does not exist. Run migration 094 first.';
  END IF;

  -- Verify delivery_zone column exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'delivery_zone'
  ) THEN
    RAISE EXCEPTION 'MIGRATION 105 BLOCKED: orders.delivery_zone column does not exist.';
  END IF;

  RAISE NOTICE 'Migration 105: Pre-flight checks passed';
END $$;

-- ============================================================
-- MAIN FIX: Update function to prioritize shipping_city
-- ============================================================
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
  is_cod BOOLEAN,
  delivered_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    -- Unified display order number: always #XXXX format
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
      WHEN jsonb_typeof(o.shipping_address::jsonb) = 'object' THEN COALESCE(o.shipping_address::jsonb->>'address1', '')
      ELSE COALESCE(o.shipping_address::text, '')
    END as customer_address,
    -- FIX: Prioritize shipping_city (actual city name) over delivery_zone (zone code)
    COALESCE(o.shipping_city, o.delivery_zone, '') as customer_city,
    COALESCE(o.total_price, 0) as total_price,
    CASE
      WHEN LOWER(COALESCE(o.payment_method, '')) IN ('cod', 'cash', 'contra_entrega', 'efectivo', 'contra entrega')
      THEN COALESCE(o.total_price, 0)
      ELSE 0
    END as cod_amount,
    COALESCE(o.payment_method, '') as payment_method,
    LOWER(COALESCE(o.payment_method, '')) IN ('cod', 'cash', 'contra_entrega', 'efectivo', 'contra entrega') as is_cod,
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

-- ============================================================
-- DOCUMENTATION
-- ============================================================
COMMENT ON FUNCTION get_pending_reconciliation_orders(UUID, UUID, DATE) IS
'Returns orders pending reconciliation for a specific date and carrier.

Parameters:
  - p_store_id: Store UUID (required for RLS)
  - p_carrier_id: Carrier/courier UUID
  - p_delivery_date: Date to filter delivered orders

Returns: Table of orders with display info for reconciliation UI.

Fixed in migration 105 (Jan 2026):
  - Now shows actual city name (shipping_city) instead of zone code (delivery_zone)
  - Example: Shows "Luque" instead of "CENTRAL"

Security: SECURITY DEFINER - bypasses RLS, validates store_id internally.';

-- ============================================================
-- POST-MIGRATION VERIFICATION
-- ============================================================
DO $$
DECLARE
  v_function_exists BOOLEAN;
  v_has_shipping_city_priority BOOLEAN;
BEGIN
  -- Verify function exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    AND p.proname = 'get_pending_reconciliation_orders'
  ) INTO v_function_exists;

  IF NOT v_function_exists THEN
    RAISE EXCEPTION 'Migration 105 FAILED: Function was not created';
  END IF;

  -- Verify the fix is in place by checking function source
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    AND p.proname = 'get_pending_reconciliation_orders'
    AND p.prosrc LIKE '%COALESCE(o.shipping_city, o.delivery_zone%'
  ) INTO v_has_shipping_city_priority;

  IF NOT v_has_shipping_city_priority THEN
    RAISE EXCEPTION 'Migration 105 FAILED: Function does not have shipping_city priority fix';
  END IF;

  RAISE NOTICE 'Migration 105: SUCCESS - Function updated with shipping_city priority';
END $$;

-- ============================================================
-- ROLLBACK SCRIPT (Run manually if needed)
-- ============================================================
/*
-- To rollback this migration, run the following to restore original behavior:

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
  is_cod BOOLEAN,
  delivered_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
      WHEN jsonb_typeof(o.shipping_address::jsonb) = 'object' THEN COALESCE(o.shipping_address::jsonb->>'address1', '')
      ELSE COALESCE(o.shipping_address::text, '')
    END as customer_address,
    -- ROLLBACK: Original order (delivery_zone first)
    COALESCE(o.delivery_zone, o.shipping_city, '') as customer_city,
    COALESCE(o.total_price, 0) as total_price,
    CASE
      WHEN LOWER(COALESCE(o.payment_method, '')) IN ('cod', 'cash', 'contra_entrega', 'efectivo', 'contra entrega')
      THEN COALESCE(o.total_price, 0)
      ELSE 0
    END as cod_amount,
    COALESCE(o.payment_method, '') as payment_method,
    LOWER(COALESCE(o.payment_method, '')) IN ('cod', 'cash', 'contra_entrega', 'efectivo', 'contra entrega') as is_cod,
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

RAISE NOTICE 'Migration 105: ROLLED BACK - delivery_zone priority restored';
*/
