-- ================================================================
-- ORDEFY METRICS AUDIT SUITE
-- Complete validation of all metrics and analytics
-- ================================================================
-- Run this monthly to ensure data integrity
-- Estimated execution time: 30-60 seconds
-- ================================================================

-- First, set your store ID
-- \set store_id 'YOUR_STORE_UUID_HERE'

-- ================================================================
-- 1. OVERVIEW: Order Statistics
-- ================================================================
-- Shows order counts by status, test/deleted exclusions
-- ================================================================

EXPLAIN ANALYZE
SELECT
  'OVERVIEW: Order Statistics' as section,
  COUNT(*) as total_orders,
  COUNT(CASE WHEN deleted_at IS NULL AND is_test = false THEN 1 END) as valid_orders,
  COUNT(CASE WHEN sleeves_status = 'delivered' THEN 1 END) as delivered,
  COUNT(CASE WHEN sleeves_status = 'shipped' THEN 1 END) as shipped,
  COUNT(CASE WHEN sleeves_status = 'ready_to_ship' THEN 1 END) as ready_to_ship,
  COUNT(CASE WHEN sleeves_status = 'in_preparation' THEN 1 END) as in_preparation,
  COUNT(CASE WHEN sleeves_status = 'confirmed' THEN 1 END) as confirmed,
  COUNT(CASE WHEN sleeves_status = 'pending' THEN 1 END) as pending,
  COUNT(CASE WHEN sleeves_status = 'cancelled' THEN 1 END) as cancelled,
  COUNT(CASE WHEN sleeves_status = 'returned' THEN 1 END) as returned,
  COUNT(CASE WHEN sleeves_status = 'delivery_failed' THEN 1 END) as delivery_failed,
  COUNT(CASE WHEN is_test = true THEN 1 END) as test_orders,
  COUNT(CASE WHEN deleted_at IS NOT NULL THEN 1 END) as deleted_orders,
  MIN(created_at) as oldest_order,
  MAX(created_at) as newest_order
FROM orders
WHERE store_id = '8eba0b17-0f7b-4e16-861c-cf99199a5c26'  -- Replace with store_id
AND DATE(created_at) >= DATE(NOW() - INTERVAL '90 days');

-- ================================================================
-- 2. CRITICAL: Null/Invalid Values in Cost Fields
-- ================================================================
-- ⚠️ CRITICAL: Any results mean data integrity issues
-- ================================================================

SELECT
  'CRITICAL: Null Values' as section,
  'NULL shipping_cost' as issue,
  COUNT(*) as count,
  COUNT(CASE WHEN sleeves_status = 'delivered' THEN 1 END) as affecting_delivered
FROM orders
WHERE store_id = '8eba0b17-0f7b-4e16-861c-cf99199a5c26'
AND shipping_cost IS NULL
AND sleeves_status IN ('ready_to_ship', 'shipped', 'delivered', 'returned', 'delivery_failed')

UNION ALL

SELECT
  'CRITICAL: Null Values',
  'Orders without line_items (but have total_price)',
  COUNT(*),
  COUNT(CASE WHEN sleeves_status = 'delivered' THEN 1 END)
FROM orders
WHERE store_id = '8eba0b17-0f7b-4e16-861c-cf99199a5c26'
AND (line_items IS NULL OR json_array_length(line_items) = 0)
AND total_price > 0
AND sleeves_status IN ('delivered', 'shipped', 'ready_to_ship')

UNION ALL

SELECT
  'CRITICAL: Null Values',
  'Products with NULL cost (should default to 0)',
  COUNT(*),
  0
FROM products
WHERE store_id = '8eba0b17-0f7b-4e16-861c-cf99199a5c26'
AND cost IS NULL
AND created_at >= DATE(NOW() - INTERVAL '30 days')

UNION ALL

SELECT
  'CRITICAL: Null Values',
  'Line items with NULL quantity',
  COUNT(*),
  0
FROM order_line_items oli
JOIN orders o ON oli.order_id = o.id
WHERE o.store_id = '8eba0b17-0f7b-4e16-861c-cf99199a5c26'
AND oli.quantity IS NULL;

-- ================================================================
-- 3. COST CALCULATION: Verify Product Costs
-- ================================================================
-- Samples orders and recalculates their costs
-- Compare with API calculations
-- ================================================================

WITH product_costs AS (
  SELECT
    oli.order_id,
    SUM(
      (COALESCE(p.cost, 0) +
       COALESCE(p.packaging_cost, 0) +
       COALESCE(p.additional_costs, 0)) *
      COALESCE(oli.quantity, 1)
    ) as calculated_product_cost
  FROM order_line_items oli
  LEFT JOIN products p ON oli.product_id = p.id
  GROUP BY oli.order_id
)
SELECT
  'COST: Product Costs' as section,
  o.id as order_id,
  o.sleeves_status,
  o.total_price,
  COALESCE(pc.calculated_product_cost, 0) as product_costs,
  COALESCE(o.shipping_cost, 0) as shipping_cost,
  COALESCE(sc.confirmation_fee, 0) as confirmation_fee,
  (COALESCE(pc.calculated_product_cost, 0) +
   COALESCE(o.shipping_cost, 0) +
   COALESCE(sc.confirmation_fee, 0)) as total_costs,
  (o.total_price - COALESCE(pc.calculated_product_cost, 0)) as gross_profit,
  ROUND(
    ((o.total_price - COALESCE(pc.calculated_product_cost, 0)) / NULLIF(o.total_price, 0) * 100),
    1
  ) as gross_margin_pct,
  (o.total_price - (COALESCE(pc.calculated_product_cost, 0) +
                    COALESCE(o.shipping_cost, 0) +
                    COALESCE(sc.confirmation_fee, 0))) as net_profit,
  ROUND(
    ((o.total_price - (COALESCE(pc.calculated_product_cost, 0) +
                       COALESCE(o.shipping_cost, 0) +
                       COALESCE(sc.confirmation_fee, 0))) / NULLIF(o.total_price, 0) * 100),
    1
  ) as net_margin_pct,
  CASE
    WHEN o.total_price = 0 THEN 'ERROR: Zero revenue'
    WHEN COALESCE(pc.calculated_product_cost, 0) > o.total_price THEN 'ERROR: Costs > Revenue'
    WHEN (o.total_price - COALESCE(pc.calculated_product_cost, 0)) < 0 THEN 'ERROR: Negative gross profit'
    WHEN ((o.total_price - COALESCE(pc.calculated_product_cost, 0)) / NULLIF(o.total_price, 0) * 100) > 95 THEN 'WARNING: Unusually high margin'
    WHEN ((o.total_price - (COALESCE(pc.calculated_product_cost, 0) +
                            COALESCE(o.shipping_cost, 0) +
                            COALESCE(sc.confirmation_fee, 0))) / NULLIF(o.total_price, 0) * 100) < -50 THEN 'WARNING: Huge loss'
    ELSE 'OK'
  END as validation_status
FROM orders o
LEFT JOIN product_costs pc ON o.id = pc.order_id
LEFT JOIN store_config sc ON o.store_id = sc.store_id
WHERE o.store_id = '8eba0b17-0f7b-4e16-861c-cf99199a5c26'
AND o.deleted_at IS NULL
AND o.is_test = false
AND o.sleeves_status = 'delivered'
AND DATE(o.created_at) >= DATE(NOW() - INTERVAL '30 days')
ORDER BY net_margin_pct ASC
LIMIT 20;

-- ================================================================
-- 4. REVENUE VALIDATION: Real vs Projected
-- ================================================================
-- Validates that real revenue ≤ projected revenue
-- ================================================================

WITH revenue_summary AS (
  SELECT
    SUM(CASE WHEN deleted_at IS NULL AND is_test = false THEN total_price ELSE 0 END) as projected_revenue,
    SUM(CASE WHEN sleeves_status = 'delivered' THEN total_price ELSE 0 END) as real_revenue,
    COUNT(CASE WHEN deleted_at IS NULL AND is_test = false THEN 1 END) as projected_orders,
    COUNT(CASE WHEN sleeves_status = 'delivered' THEN 1 END) as delivered_orders
  FROM orders
  WHERE store_id = '8eba0b17-0f7b-4e16-861c-cf99199a5c26'
  AND DATE(created_at) >= DATE(NOW() - INTERVAL '30 days')
)
SELECT
  'REVENUE: Real vs Projected' as section,
  projected_revenue::INT,
  real_revenue::INT,
  (projected_revenue - real_revenue)::INT as pending_revenue,
  projected_orders,
  delivered_orders,
  (projected_orders - delivered_orders) as pending_orders,
  ROUND((real_revenue / NULLIF(projected_revenue, 0) * 100), 1) as realization_pct,
  CASE
    WHEN real_revenue > projected_revenue THEN 'ERROR: Real > Projected'
    WHEN real_revenue = 0 AND projected_revenue > 0 THEN 'WARNING: No deliveries yet'
    WHEN (real_revenue / NULLIF(projected_revenue, 0)) < 0.50 THEN 'WARNING: Low realization rate'
    ELSE 'OK'
  END as validation_status
FROM revenue_summary;

-- ================================================================
-- 5. SHIPPING COSTS: Carrier Analysis
-- ================================================================
-- Breakdown by carrier, identifies outliers
-- ================================================================

WITH carrier_costs AS (
  SELECT
    o.carrier_id,
    ca.name as carrier_name,
    COUNT(*) as orders_count,
    COUNT(CASE WHEN o.sleeves_status = 'delivered' THEN 1 END) as delivered,
    SUM(COALESCE(o.shipping_cost, 0)) as total_shipping_cost,
    SUM(CASE WHEN o.sleeves_status = 'delivered' THEN COALESCE(o.shipping_cost, 0) ELSE 0 END) as delivered_shipping_cost,
    ROUND(AVG(COALESCE(o.shipping_cost, 0)), 0) as avg_shipping_cost,
    MIN(COALESCE(o.shipping_cost, 0)) as min_shipping_cost,
    MAX(COALESCE(o.shipping_cost, 0)) as max_shipping_cost,
    ROUND(AVG(CASE WHEN o.sleeves_status = 'delivered' THEN COALESCE(o.shipping_cost, 0) ELSE NULL END), 0) as avg_delivered_shipping
  FROM orders o
  LEFT JOIN carriers ca ON o.carrier_id = ca.id
  WHERE o.store_id = '8eba0b17-0f7b-4e16-861c-cf99199a5c26'
  AND o.deleted_at IS NULL
  AND o.is_test = false
  AND DATE(o.created_at) >= DATE(NOW() - INTERVAL '30 days')
  GROUP BY o.carrier_id, ca.name
)
SELECT
  'SHIPPING: Carrier Costs' as section,
  carrier_name,
  orders_count,
  delivered,
  total_shipping_cost::INT,
  delivered_shipping_cost::INT,
  avg_shipping_cost::INT,
  min_shipping_cost::INT,
  max_shipping_cost::INT,
  CASE
    WHEN max_shipping_cost > avg_shipping_cost * 3 THEN 'WARNING: High variance'
    WHEN avg_shipped_cost IS NULL THEN 'WARNING: No deliveries'
    ELSE 'OK'
  END as validation_status
FROM carrier_costs
ORDER BY total_shipping_cost DESC;

-- ================================================================
-- 6. DELIVERY RATE: Status Breakdown
-- ================================================================
-- Calculates actual delivery rate with proper statuses
-- ================================================================

WITH delivery_analysis AS (
  SELECT
    COUNT(*) as total_orders,
    COUNT(CASE WHEN sleeves_status IN ('ready_to_ship', 'shipped', 'delivered',
                                       'returned', 'delivery_failed', 'cancelled') AND
                     (sleeves_status != 'cancelled' OR shipped_at IS NOT NULL) THEN 1 END) as dispatched,
    COUNT(CASE WHEN sleeves_status = 'delivered' THEN 1 END) as delivered,
    COUNT(CASE WHEN sleeves_status = 'returned' THEN 1 END) as returned,
    COUNT(CASE WHEN sleeves_status = 'delivery_failed' THEN 1 END) as failed,
    COUNT(CASE WHEN sleeves_status = 'cancelled' AND shipped_at IS NOT NULL THEN 1 END) as cancelled_after_ship,
    COUNT(CASE WHEN sleeves_status = 'shipped' THEN 1 END) as in_transit
  FROM orders
  WHERE store_id = '8eba0b17-0f7b-4e16-861c-cf99199a5c26'
  AND deleted_at IS NULL
  AND is_test = false
  AND DATE(created_at) >= DATE(NOW() - INTERVAL '30 days')
)
SELECT
  'DELIVERY: Rate Analysis' as section,
  total_orders,
  dispatched,
  delivered,
  in_transit,
  returned,
  failed,
  cancelled_after_ship,
  ROUND((delivered::NUMERIC / NULLIF(dispatched, 0) * 100), 1) as delivery_rate_pct,
  CASE
    WHEN (delivered::NUMERIC / NULLIF(dispatched, 0)) < 0.70 THEN 'CRITICAL: Low delivery rate'
    WHEN (delivered::NUMERIC / NULLIF(dispatched, 0)) < 0.85 THEN 'WARNING: Below target'
    WHEN (delivered::NUMERIC / NULLIF(dispatched, 0)) > 0.98 THEN 'WARNING: Suspiciously high'
    ELSE 'OK'
  END as validation_status
FROM delivery_analysis;

-- ================================================================
-- 7. MARGIN ANALYSIS: Monthly Trend
-- ================================================================
-- Tracks margin performance over time
-- ================================================================

WITH monthly_costs AS (
  SELECT
    DATE_TRUNC('month', o.created_at)::DATE as month,
    COUNT(*) as orders,
    SUM(CASE WHEN o.sleeves_status = 'delivered' THEN 1 ELSE 0 END) as delivered_orders,
    SUM(o.total_price) as total_revenue,
    SUM(CASE WHEN o.sleeves_status = 'delivered' THEN o.total_price ELSE 0 END) as real_revenue,
    SUM(COALESCE(o.shipping_cost, 0)) as total_shipping,
    SUM(CASE WHEN o.sleeves_status = 'delivered' THEN COALESCE(o.shipping_cost, 0) ELSE 0 END) as real_shipping,
    SUM(
      COALESCE(
        (SELECT SUM((COALESCE(p.cost, 0) +
                    COALESCE(p.packaging_cost, 0) +
                    COALESCE(p.additional_costs, 0)) * COALESCE(oli.quantity, 1))
         FROM order_line_items oli
         LEFT JOIN products p ON oli.product_id = p.id
         WHERE oli.order_id = o.id),
        0
      )
    ) as total_product_costs
  FROM orders o
  WHERE o.store_id = '8eba0b17-0f7b-4e16-861c-cf99199a5c26'
  AND o.deleted_at IS NULL
  AND o.is_test = false
  GROUP BY DATE_TRUNC('month', o.created_at)::DATE
)
SELECT
  'MARGINS: Monthly Trend' as section,
  month,
  orders,
  delivered_orders,
  total_revenue::INT,
  total_product_costs::INT,
  total_shipping::INT,
  ROUND(
    ((total_revenue - total_product_costs) / NULLIF(total_revenue, 0) * 100),
    1
  ) as gross_margin_pct,
  ROUND(
    ((total_revenue - (total_product_costs + total_shipping)) / NULLIF(total_revenue, 0) * 100),
    1
  ) as net_margin_pct,
  CASE
    WHEN net_margin_pct < -10 THEN 'CRITICAL: Large losses'
    WHEN net_margin_pct < 10 THEN 'WARNING: Low margin'
    WHEN gross_margin_pct < net_margin_pct THEN 'ERROR: Logic inverted'
    ELSE 'OK'
  END as validation_status
FROM monthly_costs
ORDER BY month DESC;

-- ================================================================
-- 8. DATA QUALITY: Consistency Checks
-- ================================================================
-- Final comprehensive consistency validation
-- ================================================================

SELECT
  'DATA QUALITY: Consistency' as section,
  CASE
    WHEN COUNT(CASE WHEN sleeves_status = 'shipped' AND shipped_at IS NULL THEN 1 END) > 0
      THEN 'WARNING: Shipped orders without shipped_at'
    WHEN COUNT(CASE WHEN sleeves_status = 'delivered' AND delivered_at IS NULL THEN 1 END) > 0
      THEN 'WARNING: Delivered orders without delivered_at'
    WHEN COUNT(CASE WHEN total_price = 0 AND sleeves_status = 'delivered' THEN 1 END) > 0
      THEN 'WARNING: Delivered orders with zero revenue'
    WHEN COUNT(CASE WHEN total_price < 0 THEN 1 END) > 0
      THEN 'ERROR: Negative revenue orders'
    WHEN COUNT(CASE WHEN shipping_cost < 0 THEN 1 END) > 0
      THEN 'ERROR: Negative shipping costs'
    ELSE 'ALL CHECKS PASSED ✓'
  END as result,
  COUNT(*) as orders_checked
FROM orders
WHERE store_id = '8eba0b17-0f7b-4e16-861c-cf99199a5c26'
AND DATE(created_at) >= DATE(NOW() - INTERVAL '30 days');

-- ================================================================
-- SUMMARY
-- ================================================================

SELECT
  'AUDIT COMPLETE' as result,
  'Run individual sections above for detailed analysis' as next_steps,
  NOW() as executed_at;
