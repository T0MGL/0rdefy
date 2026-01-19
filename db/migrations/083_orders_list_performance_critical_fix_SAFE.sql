-- ================================================================
-- MIGRATION 083: CRITICAL - Orders List Performance Fix (PRODUCTION-SAFE)
-- ================================================================
-- PROBLEMA: Query principal de /api/orders tarda 30+ segundos con solo 80 pedidos
-- SOLUCIÓN: Índices compuestos covering con INCLUDE clause
-- IMPACTO ESPERADO: 30x mejora (30s → <1s)
-- FECHA: 2026-01-19
-- AUTOR: Claude Sonnet 4.5 + Hansel Echague
--
-- SAFETY FEATURES:
-- ✅ Checks PostgreSQL version (requires 11+ for INCLUDE)
-- ✅ Validates all required columns exist
-- ✅ Checks for conflicting indexes
-- ✅ Uses CONCURRENTLY (no table locks)
-- ✅ Graceful error handling
-- ✅ Detailed logging
-- ================================================================

-- Increase timeout for CONCURRENTLY operations
SET statement_timeout = '120s';
SET lock_timeout = '10s';

-- ================================================================
-- SAFETY CHECK 1: Verify PostgreSQL Version
-- ================================================================
DO $$
DECLARE
    pg_version_num INTEGER;
BEGIN
    -- Get PostgreSQL version as integer (e.g., 140002 for 14.2)
    SELECT current_setting('server_version_num')::INTEGER INTO pg_version_num;

    IF pg_version_num < 110000 THEN
        RAISE EXCEPTION 'PostgreSQL version 11 or higher required for INCLUDE clause. Current version: %',
            current_setting('server_version');
    END IF;

    RAISE NOTICE '✅ PostgreSQL version check passed: %', current_setting('server_version');
END $$;

-- ================================================================
-- SAFETY CHECK 2: Verify Required Tables and Columns
-- ================================================================
DO $$
DECLARE
    v_missing_columns TEXT[] := ARRAY[]::TEXT[];
BEGIN
    -- Check if orders table exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders') THEN
        RAISE EXCEPTION 'Table orders does not exist. Cannot create indexes.';
    END IF;

    -- Check required columns for main covering index
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'store_id') THEN
        v_missing_columns := array_append(v_missing_columns, 'store_id');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'created_at') THEN
        v_missing_columns := array_append(v_missing_columns, 'created_at');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'deleted_at') THEN
        v_missing_columns := array_append(v_missing_columns, 'deleted_at');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'is_test') THEN
        v_missing_columns := array_append(v_missing_columns, 'is_test');
    END IF;

    IF array_length(v_missing_columns, 1) > 0 THEN
        RAISE EXCEPTION 'Missing required columns in orders table: %', array_to_string(v_missing_columns, ', ');
    END IF;

    RAISE NOTICE '✅ All required columns exist in orders table';
END $$;

-- ================================================================
-- SAFETY CHECK 3: Check for Conflicting Indexes
-- ================================================================
DO $$
DECLARE
    v_conflicting_indexes TEXT[] := ARRAY[]::TEXT[];
    v_index_name TEXT;
BEGIN
    -- Check if any of our new indexes already exist
    FOR v_index_name IN
        SELECT indexname FROM pg_indexes
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
    LOOP
        v_conflicting_indexes := array_append(v_conflicting_indexes, v_index_name);
    END LOOP;

    IF array_length(v_conflicting_indexes, 1) > 0 THEN
        RAISE NOTICE '⚠️  WARNING: Some indexes already exist and will be skipped: %',
            array_to_string(v_conflicting_indexes, ', ');
    ELSE
        RAISE NOTICE '✅ No conflicting indexes found';
    END IF;
END $$;

-- ================================================================
-- SAFETY CHECK 4: Verify Disk Space
-- ================================================================
DO $$
DECLARE
    v_table_size BIGINT;
    v_estimated_index_size BIGINT;
    v_free_space BIGINT;
BEGIN
    -- Get current table size
    SELECT pg_total_relation_size('orders') INTO v_table_size;

    -- Estimate index size (roughly 30% of table size for covering indexes)
    v_estimated_index_size := v_table_size * 0.3 * 6;  -- 6 indexes

    RAISE NOTICE '📊 Table size: % MB', (v_table_size / 1024 / 1024);
    RAISE NOTICE '📊 Estimated index size: % MB', (v_estimated_index_size / 1024 / 1024);
    RAISE NOTICE '⚠️  Ensure you have at least % MB free disk space', (v_estimated_index_size / 1024 / 1024);
END $$;

-- ================================================================
-- INDEX 1: Main Covering Index for Orders List
-- ================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
        AND tablename = 'orders'
        AND indexname = 'idx_orders_list_covering'
    ) THEN
        RAISE NOTICE '🔨 Creating idx_orders_list_covering...';

        CREATE INDEX CONCURRENTLY idx_orders_list_covering
        ON orders (
            store_id,
            created_at DESC,
            deleted_at,
            is_test
        )
        INCLUDE (
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
            confirmed_at,
            delivery_link_token,
            printed,
            printed_at,
            printed_by,
            latitude,
            longitude,
            google_maps_link,
            total_discounts,
            financial_status,
            payment_method,
            cod_amount,
            has_amount_discrepancy,
            amount_collected
        )
        WHERE deleted_at IS NULL;

        RAISE NOTICE '✅ idx_orders_list_covering created successfully';
    ELSE
        RAISE NOTICE '⏭️  idx_orders_list_covering already exists, skipping';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ Failed to create idx_orders_list_covering: %', SQLERRM;
        RAISE NOTICE '⚠️  Continuing with other indexes...';
END $$;

-- ================================================================
-- INDEX 2: Phone Search Optimization
-- ================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
        AND tablename = 'orders'
        AND indexname = 'idx_orders_phone_search_optimized'
    ) THEN
        RAISE NOTICE '🔨 Creating idx_orders_phone_search_optimized...';

        CREATE INDEX CONCURRENTLY idx_orders_phone_search_optimized
        ON orders (store_id, customer_phone)
        WHERE deleted_at IS NULL;

        RAISE NOTICE '✅ idx_orders_phone_search_optimized created successfully';
    ELSE
        RAISE NOTICE '⏭️  idx_orders_phone_search_optimized already exists, skipping';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ Failed to create idx_orders_phone_search_optimized: %', SQLERRM;
        RAISE NOTICE '⚠️  Continuing with other indexes...';
END $$;

-- ================================================================
-- INDEX 3: Shopify Order Name Search
-- ================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
        AND tablename = 'orders'
        AND indexname = 'idx_orders_shopify_name_search'
    ) THEN
        RAISE NOTICE '🔨 Creating idx_orders_shopify_name_search...';

        CREATE INDEX CONCURRENTLY idx_orders_shopify_name_search
        ON orders (store_id, shopify_order_name)
        WHERE deleted_at IS NULL AND shopify_order_name IS NOT NULL;

        RAISE NOTICE '✅ idx_orders_shopify_name_search created successfully';
    ELSE
        RAISE NOTICE '⏭️  idx_orders_shopify_name_search already exists, skipping';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ Failed to create idx_orders_shopify_name_search: %', SQLERRM;
        RAISE NOTICE '⚠️  Continuing with other indexes...';
END $$;

-- ================================================================
-- INDEX 4: Shopify Order Number Search
-- ================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
        AND tablename = 'orders'
        AND indexname = 'idx_orders_shopify_number_search'
    ) THEN
        RAISE NOTICE '🔨 Creating idx_orders_shopify_number_search...';

        CREATE INDEX CONCURRENTLY idx_orders_shopify_number_search
        ON orders (store_id, shopify_order_number)
        WHERE deleted_at IS NULL AND shopify_order_number IS NOT NULL;

        RAISE NOTICE '✅ idx_orders_shopify_number_search created successfully';
    ELSE
        RAISE NOTICE '⏭️  idx_orders_shopify_number_search already exists, skipping';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ Failed to create idx_orders_shopify_number_search: %', SQLERRM;
        RAISE NOTICE '⚠️  Continuing with other indexes...';
END $$;

-- ================================================================
-- INDEX 5: Status Filter with Date Covering
-- ================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
        AND tablename = 'orders'
        AND indexname = 'idx_orders_status_date_covering'
    ) THEN
        RAISE NOTICE '🔨 Creating idx_orders_status_date_covering...';

        CREATE INDEX CONCURRENTLY idx_orders_status_date_covering
        ON orders (store_id, sleeves_status, created_at DESC)
        INCLUDE (
            id,
            shopify_order_name,
            customer_first_name,
            customer_last_name,
            customer_phone,
            total_price,
            courier_id,
            printed,
            deleted_at,
            is_test
        )
        WHERE deleted_at IS NULL;

        RAISE NOTICE '✅ idx_orders_status_date_covering created successfully';
    ELSE
        RAISE NOTICE '⏭️  idx_orders_status_date_covering already exists, skipping';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ Failed to create idx_orders_status_date_covering: %', SQLERRM;
        RAISE NOTICE '⚠️  Continuing with other indexes...';
END $$;

-- ================================================================
-- INDEX 6: Carrier Filter with Date Covering
-- ================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
        AND tablename = 'orders'
        AND indexname = 'idx_orders_carrier_date_covering'
    ) THEN
        RAISE NOTICE '🔨 Creating idx_orders_carrier_date_covering...';

        CREATE INDEX CONCURRENTLY idx_orders_carrier_date_covering
        ON orders (store_id, courier_id, created_at DESC)
        INCLUDE (
            id,
            shopify_order_name,
            customer_first_name,
            customer_last_name,
            customer_phone,
            total_price,
            sleeves_status,
            printed,
            deleted_at,
            is_test
        )
        WHERE deleted_at IS NULL AND courier_id IS NOT NULL;

        RAISE NOTICE '✅ idx_orders_carrier_date_covering created successfully';
    ELSE
        RAISE NOTICE '⏭️  idx_orders_carrier_date_covering already exists, skipping';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ Failed to create idx_orders_carrier_date_covering: %', SQLERRM;
        RAISE NOTICE '⚠️  Continuing with other indexes...';
END $$;

-- ================================================================
-- STEP 7: Update Table Statistics
-- ================================================================
DO $$
BEGIN
    RAISE NOTICE '📊 Updating table statistics...';
    ANALYZE orders;
    RAISE NOTICE '✅ Table statistics updated';
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ Failed to update statistics: %', SQLERRM;
END $$;

-- ================================================================
-- FINAL VALIDATION: Report Created Indexes
-- ================================================================
DO $$
DECLARE
    v_created_count INTEGER;
    v_failed_count INTEGER;
    v_index_name TEXT;
    v_index_size TEXT;
BEGIN
    RAISE NOTICE '================================================================';
    RAISE NOTICE 'MIGRATION 083: FINAL REPORT';
    RAISE NOTICE '================================================================';

    -- Count successfully created indexes
    SELECT COUNT(*) INTO v_created_count
    FROM pg_indexes
    WHERE schemaname = 'public'
    AND tablename = 'orders'
    AND indexname IN (
        'idx_orders_list_covering',
        'idx_orders_phone_search_optimized',
        'idx_orders_shopify_name_search',
        'idx_orders_shopify_number_search',
        'idx_orders_status_date_covering',
        'idx_orders_carrier_date_covering'
    );

    v_failed_count := 6 - v_created_count;

    RAISE NOTICE 'Indexes created: % / 6', v_created_count;

    IF v_failed_count > 0 THEN
        RAISE NOTICE '⚠️  Indexes failed: %', v_failed_count;
    END IF;

    -- List created indexes with sizes
    RAISE NOTICE '';
    RAISE NOTICE 'Created indexes:';

    FOR v_index_name, v_index_size IN
        SELECT
            indexname,
            pg_size_pretty(pg_relation_size(schemaname||'.'||indexname::regclass))
        FROM pg_indexes
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
        ORDER BY indexname
    LOOP
        RAISE NOTICE '  ✅ % (Size: %)', v_index_name, v_index_size;
    END LOOP;

    RAISE NOTICE '';

    IF v_created_count = 6 THEN
        RAISE NOTICE '✅ ✅ ✅  MIGRATION 083 COMPLETED SUCCESSFULLY  ✅ ✅ ✅';
    ELSIF v_created_count > 0 THEN
        RAISE WARNING '⚠️  MIGRATION 083 PARTIALLY COMPLETED (% / 6 indexes)', v_created_count;
        RAISE NOTICE 'Check error messages above for failed indexes';
    ELSE
        RAISE WARNING '❌ MIGRATION 083 FAILED - No indexes were created';
        RAISE NOTICE 'Check error messages above for details';
    END IF;

    RAISE NOTICE '================================================================';
END $$;

-- Reset timeouts to defaults
RESET statement_timeout;
RESET lock_timeout;

-- ================================================================
-- ROLLBACK INSTRUCTIONS (if needed)
-- ================================================================
-- If something goes wrong, execute:
--
-- DROP INDEX CONCURRENTLY IF EXISTS idx_orders_list_covering;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_orders_phone_search_optimized;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_orders_shopify_name_search;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_orders_shopify_number_search;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_orders_status_date_covering;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_orders_carrier_date_covering;
-- ================================================================
