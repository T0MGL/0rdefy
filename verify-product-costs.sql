-- ================================================================
-- VERIFICATION: Check if products have costs configured
-- ================================================================
-- Purpose: Diagnose why analytics may show $0 in product costs
-- ================================================================

-- 1. Total products in database
SELECT
    COUNT(*) as total_products,
    COUNT(*) FILTER (WHERE cost IS NOT NULL AND cost > 0) as products_with_cost,
    COUNT(*) FILTER (WHERE cost IS NULL OR cost = 0) as products_without_cost,
    ROUND(AVG(cost), 2) as avg_product_cost,
    ROUND(MIN(cost), 2) as min_cost,
    ROUND(MAX(cost), 2) as max_cost
FROM products;

-- 2. Sample products without costs
SELECT
    id,
    name,
    sku,
    price,
    cost,
    stock,
    shopify_product_id
FROM products
WHERE cost IS NULL OR cost = 0
LIMIT 10;

-- 3. Check recent orders and their product costs calculation
SELECT
    o.id as order_id,
    o.shopify_order_number,
    o.total_price as order_revenue,
    o.sleeves_status,
    COALESCE(
        (SELECT SUM(p.cost * (li->>'quantity')::int)
         FROM jsonb_array_elements(o.line_items) AS li
         LEFT JOIN products p ON p.shopify_product_id = (li->>'product_id')::text
         WHERE p.id IS NOT NULL
        ), 0
    ) as calculated_product_cost
FROM orders o
WHERE o.created_at >= NOW() - INTERVAL '7 days'
ORDER BY o.created_at DESC
LIMIT 10;

-- 4. Check order_line_items table (if migration 024 was applied)
SELECT
    COUNT(*) as total_line_items,
    COUNT(*) FILTER (WHERE product_id IS NOT NULL) as line_items_with_product_mapping,
    COUNT(*) FILTER (WHERE product_id IS NULL) as line_items_without_mapping
FROM order_line_items
WHERE order_id IN (
    SELECT id FROM orders WHERE created_at >= NOW() - INTERVAL '7 days'
);

-- 5. Products in recent orders that don't have costs
SELECT DISTINCT
    li->>'product_id' as shopify_product_id,
    li->>'title' as product_name,
    p.id as local_product_id,
    p.cost as product_cost,
    COUNT(*) OVER (PARTITION BY li->>'product_id') as times_ordered
FROM orders o,
     jsonb_array_elements(o.line_items) AS li
LEFT JOIN products p ON p.shopify_product_id = (li->>'product_id')::text
WHERE o.created_at >= NOW() - INTERVAL '30 days'
  AND (p.cost IS NULL OR p.cost = 0)
ORDER BY times_ordered DESC
LIMIT 20;
