-- ================================================================
-- DIAGNÓSTICO COMPLETO - Por qué falla el UPSERT
-- ================================================================

-- 1. Ver TODOS los índices de orders
SELECT
    'ÍNDICES EN ORDERS:' as seccion,
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'orders'
ORDER BY indexname;

-- 2. Verificar específicamente el índice compuesto
SELECT
    'ÍNDICE COMPUESTO (idx_orders_shopify_store_unique):' as seccion,
    CASE
        WHEN EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE tablename = 'orders'
            AND indexname = 'idx_orders_shopify_store_unique'
        ) THEN '✅ EXISTE'
        ELSE '❌ NO EXISTE'
    END as estado;

-- 3. Buscar duplicados que impedirían crear el índice UNIQUE
SELECT
    'DUPLICADOS EN ORDERS:' as seccion,
    shopify_order_id,
    store_id,
    COUNT(*) as cantidad,
    ARRAY_AGG(id ORDER BY created_at DESC) as order_ids
FROM orders
WHERE shopify_order_id IS NOT NULL
GROUP BY shopify_order_id, store_id
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC
LIMIT 10;

-- 4. Contar total de duplicados
SELECT
    'TOTAL DUPLICADOS:' as seccion,
    COUNT(*) as grupos_duplicados
FROM (
    SELECT shopify_order_id, store_id
    FROM orders
    WHERE shopify_order_id IS NOT NULL
    GROUP BY shopify_order_id, store_id
    HAVING COUNT(*) > 1
) dup;

-- 5. Ver constraints existentes en orders
SELECT
    'CONSTRAINTS EN ORDERS:' as seccion,
    conname as constraint_name,
    contype as constraint_type
FROM pg_constraint
WHERE conrelid = 'orders'::regclass
ORDER BY conname;
