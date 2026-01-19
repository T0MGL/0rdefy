-- ================================================================
-- MIGRATION 083: CRITICAL - Orders List Performance Fix
-- ================================================================
-- PROBLEMA: Query principal de /api/orders tarda 30+ segundos con solo 80 pedidos
-- CAUSA RAÍZ:
--   1. Query usa SELECT * (60+ columnas) + triple JOIN anidado
--   2. Falta índice compuesto optimizado para query principal
--   3. COUNT(*) escanea tabla completa
-- SOLUCIÓN: Índice compuesto covering con INCLUDE clause
-- IMPACTO ESPERADO: 30x mejora (30s → <1s)
-- FECHA: 2026-01-19
-- AUTOR: Claude Sonnet 4.5 + Hansel Echague
-- ================================================================

-- SAFETY: Use CONCURRENTLY to avoid locking production table
-- This allows the migration to run without blocking reads/writes
SET statement_timeout = '60s';

-- ================================================================
-- PASO 1: Índice Compuesto Covering para Lista de Pedidos
-- ================================================================
-- Este índice optimiza el query más común:
-- SELECT ... FROM orders WHERE store_id = X ORDER BY created_at DESC LIMIT 50
--
-- INCLUDE clause (PostgreSQL 11+) permite Index-Only Scan:
-- - PostgreSQL puede resolver el query SOLO leyendo el índice
-- - No necesita hacer lookup a la tabla orders
-- - 10-100x más rápido que un Index Scan regular
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_list_covering
ON orders (
    store_id,           -- WHERE store_id = X
    created_at DESC,    -- ORDER BY created_at DESC
    deleted_at,         -- WHERE deleted_at IS NULL (filtro soft-delete)
    is_test             -- WHERE is_test = false (filtro pedidos test)
)
INCLUDE (
    -- Campos que se muestran en la lista (evita leer tabla)
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
WHERE deleted_at IS NULL;  -- Partial index (solo pedidos activos)

-- ================================================================
-- PASO 2: Índice para Búsqueda por Teléfono (Search Bar)
-- ================================================================
-- Optimiza: WHERE store_id = X AND customer_phone LIKE '%123%'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_phone_search_optimized
ON orders (store_id, customer_phone)
WHERE deleted_at IS NULL;

-- ================================================================
-- PASO 3: Índice para Búsqueda por Shopify Order Name (Search Bar)
-- ================================================================
-- Optimiza: WHERE store_id = X AND shopify_order_name LIKE '#1001%'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_shopify_name_search
ON orders (store_id, shopify_order_name)
WHERE deleted_at IS NULL AND shopify_order_name IS NOT NULL;

-- ================================================================
-- PASO 4: Índice para Búsqueda por Shopify Order Number (Search Bar)
-- ================================================================
-- Optimiza: WHERE store_id = X AND shopify_order_number = 1001
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_shopify_number_search
ON orders (store_id, shopify_order_number)
WHERE deleted_at IS NULL AND shopify_order_number IS NOT NULL;

-- ================================================================
-- PASO 5: Índice para Filtro por Estado + Fecha (Filter Chips)
-- ================================================================
-- Optimiza: WHERE store_id = X AND sleeves_status = 'pending' ORDER BY created_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_status_date_covering
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

-- ================================================================
-- PASO 6: Índice para Filtro por Carrier + Fecha (Carrier Dropdown)
-- ================================================================
-- Optimiza: WHERE store_id = X AND courier_id = Y ORDER BY created_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_carrier_date_covering
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

-- ================================================================
-- PASO 7: Actualizar Estadísticas de la Tabla
-- ================================================================
-- Esto ayuda al query planner a elegir el mejor índice
ANALYZE orders;

-- ================================================================
-- PASO 8: Verificar que los Índices se Crearon Correctamente
-- ================================================================
DO $$
DECLARE
    idx_count INTEGER;
BEGIN
    -- Contar índices creados
    SELECT COUNT(*) INTO idx_count
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

    IF idx_count = 6 THEN
        RAISE NOTICE '✅ Migration 083: All 6 indexes created successfully';
    ELSE
        RAISE WARNING '⚠️ Migration 083: Only % of 6 indexes were created', idx_count;
    END IF;
END $$;

-- ================================================================
-- NOTAS TÉCNICAS
-- ================================================================
-- 1. CONCURRENTLY: Permite crear índices sin bloquear writes
--    - Tarda más tiempo pero no afecta producción
--    - Si falla, reintenta manualmente sin CONCURRENTLY
--
-- 2. INCLUDE clause (PostgreSQL 11+):
--    - Permite Index-Only Scan (no lee tabla)
--    - 10-100x más rápido que Index Scan regular
--    - Tamaño de índice más grande pero worth it
--
-- 3. Partial Index (WHERE deleted_at IS NULL):
--    - Índice más pequeño (excluye deleted orders)
--    - Más rápido de escanear
--    - Mejor para cache
--
-- 4. ¿Por qué tantos índices?
--    - Cada query pattern necesita su propio índice
--    - PostgreSQL elige el mejor automáticamente
--    - Disk space es barato, latencia es cara
--
-- 5. ¿Cuánto espacio ocupan estos índices?
--    - ~50-100MB por cada 10,000 pedidos
--    - Para 2000 pedidos = ~10-20MB total
--    - Acceptable tradeoff para 30x speedup
--
-- ================================================================
-- ROLLBACK INSTRUCTIONS
-- ================================================================
-- Si algo sale mal, ejecutar:
-- DROP INDEX CONCURRENTLY IF EXISTS idx_orders_list_covering;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_orders_phone_search_optimized;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_orders_shopify_name_search;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_orders_shopify_number_search;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_orders_status_date_covering;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_orders_carrier_date_covering;
-- ================================================================
