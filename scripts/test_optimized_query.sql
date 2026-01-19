-- ================================================================
-- TEST: Optimized Orders Query (Migration 083)
-- ================================================================
-- Purpose: Validate that the optimized query returns correct data
-- Run this BEFORE and AFTER migration 083 to compare results
-- ================================================================

\timing on
\x off

-- ================================================================
-- TEST 1: Basic Query (Main List View)
-- ================================================================
\echo '=================================================='
\echo 'TEST 1: Basic Orders List Query'
\echo '=================================================='
\echo ''

-- Get a sample store_id
\echo 'Getting sample store_id...'
SELECT id as store_id FROM stores LIMIT 1 \gset

\echo 'Testing with store_id:' :store_id
\echo ''

-- ORIGINAL QUERY (for comparison)
\echo '--- ORIGINAL QUERY (SELECT *) ---'
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT *
FROM orders
WHERE store_id = :'store_id'
AND deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 50;

\echo ''
\echo '--- OPTIMIZED QUERY (SELECT explicit) ---'
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT
    id,
    shopify_order_id,
    shopify_order_name,
    shopify_order_number,
    payment_gateway,
    customer_first_name,
    customer_last_name,
    customer_phone,
    customer_address,
    total_price,
    sleeves_status,
    payment_status,
    courier_id,
    created_at,
    confirmed_at,
    delivery_link_token,
    latitude,
    longitude,
    google_maps_link,
    printed,
    printed_at,
    printed_by,
    deleted_at,
    deleted_by,
    deletion_type,
    is_test,
    rejection_reason,
    confirmation_method,
    cod_amount,
    amount_collected,
    has_amount_discrepancy,
    financial_status,
    payment_method,
    total_discounts,
    neighborhood,
    city,
    address_reference
FROM orders
WHERE store_id = :'store_id'
AND deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 50;

-- ================================================================
-- TEST 2: Data Consistency Check
-- ================================================================
\echo ''
\echo '=================================================='
\echo 'TEST 2: Data Consistency (BEFORE vs AFTER)'
\echo '=================================================='
\echo ''

-- Count total orders
\echo '--- Total orders count ---'
SELECT COUNT(*) as total_orders
FROM orders
WHERE store_id = :'store_id';

-- Count active orders
\echo '--- Active orders count ---'
SELECT COUNT(*) as active_orders
FROM orders
WHERE store_id = :'store_id'
AND deleted_at IS NULL;

-- Count by status
\echo '--- Orders by status ---'
SELECT sleeves_status, COUNT(*) as count
FROM orders
WHERE store_id = :'store_id'
AND deleted_at IS NULL
GROUP BY sleeves_status
ORDER BY count DESC;

-- ================================================================
-- TEST 3: Search Queries
-- ================================================================
\echo ''
\echo '=================================================='
\echo 'TEST 3: Search Query Performance'
\echo '=================================================='
\echo ''

-- Get sample phone number
SELECT customer_phone FROM orders WHERE store_id = :'store_id' AND customer_phone IS NOT NULL LIMIT 1 \gset

\echo '--- Phone search ---'
\echo 'Searching for phone:' :customer_phone
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, customer_phone, created_at
FROM orders
WHERE store_id = :'store_id'
AND customer_phone = :'customer_phone'
AND deleted_at IS NULL
LIMIT 10;

-- Get sample shopify order name
SELECT shopify_order_name FROM orders WHERE store_id = :'store_id' AND shopify_order_name IS NOT NULL LIMIT 1 \gset

\echo ''
\echo '--- Shopify order name search ---'
\echo 'Searching for order:' :shopify_order_name
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, shopify_order_name, created_at
FROM orders
WHERE store_id = :'store_id'
AND shopify_order_name = :'shopify_order_name'
AND deleted_at IS NULL
LIMIT 10;

-- ================================================================
-- TEST 4: Filter Queries
-- ================================================================
\echo ''
\echo '=================================================='
\echo 'TEST 4: Filter Query Performance'
\echo '=================================================='
\echo ''

\echo '--- Status filter (pending) ---'
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, sleeves_status, created_at
FROM orders
WHERE store_id = :'store_id'
AND sleeves_status = 'pending'
AND deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 50;

\echo ''
\echo '--- Carrier filter ---'
-- Get sample courier_id
SELECT courier_id FROM orders WHERE store_id = :'store_id' AND courier_id IS NOT NULL LIMIT 1 \gset

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, courier_id, created_at
FROM orders
WHERE store_id = :'store_id'
AND courier_id = :'courier_id'
AND deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 50;

-- ================================================================
-- TEST 5: Index Usage Validation (POST-MIGRATION ONLY)
-- ================================================================
\echo ''
\echo '=================================================='
\echo 'TEST 5: Index Usage Check'
\echo '=================================================='
\echo ''

\echo '--- Check which indexes exist ---'
SELECT
    indexname,
    indexdef,
    pg_size_pretty(pg_relation_size(schemaname||'.'||indexname::regclass)) as size
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename = 'orders'
AND indexname LIKE 'idx_orders_%'
ORDER BY indexname;

\echo ''
\echo '--- Check if new indexes are being used ---'
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan as index_scans,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
AND tablename = 'orders'
AND indexname IN (
    'idx_orders_list_covering',
    'idx_orders_phone_search_optimized',
    'idx_orders_shopify_name_search',
    'idx_orders_shopify_number_search',
    'idx_orders_status_date_covering',
    'idx_orders_carrier_date_covering'
)
ORDER BY indexname;

-- ================================================================
-- TEST 6: COUNT Performance (exact vs estimated)
-- ================================================================
\echo ''
\echo '=================================================='
\echo 'TEST 6: COUNT Performance'
\echo '=================================================='
\echo ''

\echo '--- COUNT(*) exact (slow) ---'
EXPLAIN (ANALYZE, BUFFERS)
SELECT COUNT(*) FROM orders WHERE store_id = :'store_id' AND deleted_at IS NULL;

\echo ''
\echo '--- COUNT(*) estimated (fast) ---'
SELECT reltuples::BIGINT AS estimated_count
FROM pg_class
WHERE relname = 'orders';

-- ================================================================
-- SUMMARY
-- ================================================================
\echo ''
\echo '=================================================='
\echo 'TEST SUMMARY'
\echo '=================================================='
\echo ''
\echo 'If you see "Index Only Scan using idx_orders_list_covering"'
\echo 'in the EXPLAIN output above, the optimization is working!'
\echo ''
\echo 'Expected improvements after migration 083:'
\echo '  - Query time: 25,000ms → <100ms (250x faster)'
\echo '  - Buffers read: 5,000+ → <20 (250x less I/O)'
\echo '  - Index scans: Should use new covering indexes'
\echo ''
\echo 'If indexes are NOT being used:'
\echo '  1. Run: ANALYZE orders;'
\echo '  2. Check table has >100 rows (small tables use seq scan)'
\echo '  3. Run: SET enable_seqscan = OFF; and retry query'
\echo ''
\echo '=================================================='
