-- Migration 171: Fix get_product_sales to use exclusion list and account for units_per_pack
--
-- Problem:
--   The previous version filtered orders.sleeves_status IN ('confirmed','shipped','delivered'),
--   which excludes legitimate active statuses (pending, contacted, in_preparation, ready_to_ship)
--   and undercounts product sales severely. It also ignored units_per_pack on bundle line items,
--   so a "Pareja" pack (units_per_pack = 2) counted as 1 unit instead of 2.
--
-- Fix:
--   1. Exclude only terminal-negative statuses (cancelled, rejected, returned).
--   2. Multiply quantity by COALESCE(units_per_pack, 1) so bundle sales are reflected in total units sold.
--
-- Verified baseline (NOCTE store, PDRN product): old result = 32, expected ~116.

BEGIN;

CREATE OR REPLACE FUNCTION get_product_sales(p_store_id UUID, p_product_ids UUID[])
RETURNS TABLE(product_id UUID, total_sold BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT
        oli.product_id,
        SUM(oli.quantity * COALESCE(oli.units_per_pack, 1))::BIGINT AS total_sold
    FROM order_line_items oli
    INNER JOIN orders o ON o.id = oli.order_id
    WHERE o.store_id = p_store_id
      AND o.sleeves_status NOT IN ('cancelled', 'rejected', 'returned')
      AND oli.product_id = ANY(p_product_ids)
    GROUP BY oli.product_id;
$$;

GRANT EXECUTE ON FUNCTION get_product_sales(UUID, UUID[]) TO authenticated;

COMMIT;
