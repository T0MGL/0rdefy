-- ============================================================
-- Migration 105: Fix Reconciliation City Display
--
-- Bug: The get_pending_reconciliation_orders function was
-- prioritizing delivery_zone (zone codes like "CENTRAL") over
-- shipping_city (actual city names like "Luque", "Fernando de la Mora")
--
-- Fix: Reverse the COALESCE order to show actual city names first
-- ============================================================

-- Update the function to prioritize shipping_city over delivery_zone
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

-- Add comment documenting the fix
COMMENT ON FUNCTION get_pending_reconciliation_orders(UUID, UUID, DATE) IS
'Returns orders pending reconciliation for a specific date and carrier.
Fixed in migration 105: Now shows actual city name (shipping_city) instead of zone code (delivery_zone).';
