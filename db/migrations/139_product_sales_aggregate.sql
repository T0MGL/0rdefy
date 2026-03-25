-- Migration 139: Product sales aggregate RPC function
-- Replaces N+1 client-side query that fetched ~10,000 order rows
-- with a single server-side aggregation returning ~50 rows max.
-- Called from GET /api/products to calculate total_sold per product.

BEGIN;

CREATE OR REPLACE FUNCTION get_product_sales(
    p_store_id UUID,
    p_product_ids UUID[]
)
RETURNS TABLE(product_id UUID, total_sold BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT
        oli.product_id,
        SUM(oli.quantity) AS total_sold
    FROM order_line_items oli
    INNER JOIN orders o ON o.id = oli.order_id
    WHERE o.store_id = p_store_id
        AND o.sleeves_status IN ('confirmed', 'shipped', 'delivered')
        AND oli.product_id = ANY(p_product_ids)
    GROUP BY oli.product_id
$$;

GRANT EXECUTE ON FUNCTION get_product_sales(UUID, UUID[]) TO authenticated;

COMMIT;
