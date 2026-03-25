-- Migration 140: Replace JS-side customer stats aggregation with SQL function
-- The /api/customers/stats/overview endpoint was fetching up to 50,000 rows
-- and computing COUNT, SUM, AVG in JavaScript. This moves all aggregation
-- to a single SQL query that returns one row.

BEGIN;

CREATE OR REPLACE FUNCTION get_customer_stats(p_store_id UUID)
RETURNS TABLE (
  total_customers BIGINT,
  repeat_customers BIGINT,
  avg_orders_per_customer NUMERIC,
  avg_lifetime_value NUMERIC,
  total_customer_value NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    COUNT(*)::BIGINT AS total_customers,
    COUNT(*) FILTER (WHERE total_orders > 1)::BIGINT AS repeat_customers,
    COALESCE(AVG(total_orders), 0) AS avg_orders_per_customer,
    COALESCE(AVG(total_spent), 0) AS avg_lifetime_value,
    COALESCE(SUM(total_spent), 0) AS total_customer_value
  FROM customers
  WHERE store_id = p_store_id;
$$;

GRANT EXECUTE ON FUNCTION get_customer_stats(UUID) TO authenticated;

COMMIT;
