-- ================================================================
-- VERIFICACIÓN PRE-MIGRACIÓN (VERSIÓN SIMPLE)
-- ================================================================
-- Ejecutar ANTES de la migración para ver el estado actual
-- ================================================================

-- 1. Verificar si existe columna id en shopify_webhook_idempotency
SELECT
    CASE
        WHEN EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'shopify_webhook_idempotency'
            AND column_name = 'id'
        ) THEN '✅ Columna id EXISTE'
        ELSE '❌ Columna id NO EXISTE (será creada)'
    END as webhook_idempotency_check;

-- 2. Verificar si existe índice UNIQUE en orders
SELECT
    CASE
        WHEN EXISTS (
            SELECT 1
            FROM pg_indexes
            WHERE tablename = 'orders'
            AND indexname = 'idx_orders_shopify_store_unique'
        ) THEN '✅ Índice UNIQUE EXISTE'
        ELSE '❌ Índice UNIQUE NO EXISTE (será creado)'
    END as orders_index_check;

-- 3. Contar duplicados
SELECT
    COUNT(*) as grupos_duplicados,
    CASE
        WHEN COUNT(*) > 0 THEN '⚠️ HAY DUPLICADOS - ejecutar CLEANUP primero'
        ELSE '✅ Sin duplicados - OK para migrar'
    END as duplicados_status
FROM (
    SELECT shopify_order_id, store_id
    FROM orders
    WHERE shopify_order_id IS NOT NULL
    GROUP BY shopify_order_id, store_id
    HAVING COUNT(*) > 1
) duplicates;

-- 4. Mostrar duplicados (si existen)
SELECT
    shopify_order_id,
    store_id,
    COUNT(*) as cantidad_duplicados
FROM orders
WHERE shopify_order_id IS NOT NULL
GROUP BY shopify_order_id, store_id
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC
LIMIT 20;
