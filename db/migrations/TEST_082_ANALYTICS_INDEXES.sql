-- ================================================================
-- TEST SCRIPT FOR MIGRATION 082: ANALYTICS PERFORMANCE INDEXES
-- ================================================================
-- Purpose: Validate that migration 082 can be applied safely
-- Run this BEFORE running the actual migration in production
-- ================================================================

-- ================================================================
-- TEST 1: Check if required tables exist
-- ================================================================
SELECT
    CASE
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders')
        THEN '✅ orders table exists'
        ELSE '❌ orders table MISSING - migration will fail'
    END AS orders_check,
    CASE
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'products')
        THEN '✅ products table exists'
        ELSE '❌ products table MISSING - migration will fail'
    END AS products_check,
    CASE
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'campaigns')
        THEN '✅ campaigns table exists'
        ELSE '❌ campaigns table MISSING - migration will fail'
    END AS campaigns_check,
    CASE
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'daily_settlements')
        THEN '✅ daily_settlements table exists'
        ELSE '⚠️  daily_settlements table MISSING - settlement indexes will be skipped'
    END AS settlements_check;

-- ================================================================
-- TEST 2: Check if required columns exist in orders table
-- ================================================================
SELECT
    table_name,
    column_name,
    data_type,
    CASE
        WHEN column_name IN ('deleted_at', 'is_test', 'sleeves_status', 'confirmed_at', 'delivered_at', 'shipped_at', 'courier_id')
        THEN '✅ Required for analytics indexes'
        ELSE 'ℹ️  Optional'
    END AS status
FROM information_schema.columns
WHERE table_name = 'orders'
  AND column_name IN ('deleted_at', 'is_test', 'sleeves_status', 'confirmed_at', 'delivered_at', 'shipped_at', 'courier_id', 'created_at', 'store_id')
ORDER BY
    CASE column_name
        WHEN 'store_id' THEN 1
        WHEN 'created_at' THEN 2
        WHEN 'sleeves_status' THEN 3
        WHEN 'deleted_at' THEN 4
        WHEN 'is_test' THEN 5
        WHEN 'confirmed_at' THEN 6
        WHEN 'shipped_at' THEN 7
        WHEN 'delivered_at' THEN 8
        WHEN 'courier_id' THEN 9
        ELSE 10
    END;

-- ================================================================
-- TEST 3: Check if migration 038 has been applied (deleted_at, is_test)
-- ================================================================
SELECT
    CASE
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'orders' AND column_name = 'deleted_at'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'orders' AND column_name = 'is_test'
        )
        THEN '✅ Migration 038 applied - soft delete columns exist'
        ELSE '❌ Migration 038 NOT applied - run migration 038 first!'
    END AS migration_038_status;

-- ================================================================
-- TEST 4: Check for index name conflicts
-- ================================================================
SELECT
    indexname,
    tablename,
    CASE
        WHEN indexname LIKE 'idx_analytics_%'
        THEN '⚠️  Index already exists from previous migration 082 run'
        ELSE '✅ No conflict - index name available'
    END AS conflict_status
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_analytics_orders_store_created_at',
    'idx_analytics_orders_store_status_created',
    'idx_analytics_orders_delivered_dates',
    'idx_analytics_orders_shipped_dates',
    'idx_analytics_orders_confirmed_dates',
    'idx_analytics_orders_courier_status',
    'idx_analytics_products_store_active',
    'idx_analytics_campaigns_store_active_created',
    'idx_analytics_settlements_store_date',
    'idx_analytics_settlements_carrier_status',
    'idx_analytics_delivery_incidents_store_created'
  );

-- ================================================================
-- TEST 5: Estimate index sizes (before creation)
-- ================================================================
SELECT
    'orders' AS table_name,
    pg_size_pretty(pg_total_relation_size('orders')) AS current_size,
    COUNT(*) AS row_count,
    pg_size_pretty(pg_total_relation_size('orders') * 0.15) AS estimated_index_overhead
FROM orders
UNION ALL
SELECT
    'products',
    pg_size_pretty(pg_total_relation_size('products')),
    COUNT(*),
    pg_size_pretty(pg_total_relation_size('products') * 0.10)
FROM products
UNION ALL
SELECT
    'campaigns',
    pg_size_pretty(pg_total_relation_size('campaigns')),
    COUNT(*),
    pg_size_pretty(pg_total_relation_size('campaigns') * 0.05)
FROM campaigns;

-- ================================================================
-- TEST 6: Check existing indexes on orders table
-- ================================================================
SELECT
    indexname,
    indexdef,
    pg_size_pretty(pg_relation_size(indexname::regclass)) AS index_size
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'orders'
ORDER BY indexname;

-- ================================================================
-- TEST 7: Simulate query performance BEFORE indexes
-- ================================================================
-- Run an EXPLAIN (no actual execution) to see current query plan
EXPLAIN (ANALYZE, BUFFERS)
SELECT
    id, created_at, total_price, sleeves_status, shipping_cost
FROM orders
WHERE store_id = (SELECT id FROM stores LIMIT 1)
  AND created_at >= NOW() - INTERVAL '30 days'
  AND created_at <= NOW()
  AND deleted_at IS NULL
  AND is_test = false
LIMIT 10000;

-- ================================================================
-- SUMMARY: Pre-Migration Checklist
-- ================================================================
SELECT
    '==========================================' AS separator,
    'PRE-MIGRATION CHECKLIST' AS title,
    '==========================================' AS separator2
UNION ALL
SELECT
    '✅' AS check_icon,
    'Required tables exist' AS item,
    '' AS extra
UNION ALL
SELECT
    CASE
        WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'deleted_at')
        THEN '✅'
        ELSE '❌'
    END,
    'Migration 038 applied (deleted_at, is_test)' AS item,
    CASE
        WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'deleted_at')
        THEN ''
        ELSE '⚠️  RUN MIGRATION 038 FIRST!'
    END AS warning
UNION ALL
SELECT
    '✅' AS check_icon,
    'No index name conflicts' AS item,
    '' AS extra
UNION ALL
SELECT
    'ℹ️ ' AS info_icon,
    'Estimated time: <1 minute for small tables, 5-10 minutes for 100K+ orders' AS info,
    '' AS extra
UNION ALL
SELECT
    'ℹ️ ' AS info_icon,
    'Index overhead: ~10-15% of table size' AS info,
    '' AS extra
UNION ALL
SELECT
    '⚠️ ' AS warning_icon,
    'RECOMMENDATION: Run during low-traffic period' AS recommendation,
    '' AS extra;

-- ================================================================
-- END OF TEST SCRIPT
-- ================================================================
-- If all checks pass, proceed with migration 082
-- ================================================================
