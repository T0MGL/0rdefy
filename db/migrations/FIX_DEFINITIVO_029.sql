-- ================================================================
-- FIX DEFINITIVO 029 - Resolver error de UPSERT
-- ================================================================
-- Este SQL resuelve el error:
-- "there is no unique or exclusion constraint matching the ON CONFLICT"
-- ================================================================

-- PASO 1: Eliminar duplicados si existen
-- (Conserva el pedido más reciente de cada grupo)
DELETE FROM orders
WHERE id IN (
    SELECT id
    FROM (
        SELECT
            id,
            ROW_NUMBER() OVER (
                PARTITION BY shopify_order_id, store_id
                ORDER BY created_at DESC
            ) as row_num
        FROM orders
        WHERE shopify_order_id IS NOT NULL
    ) ranked
    WHERE row_num > 1
);

-- PASO 2: Eliminar índice si existe (para recrearlo correctamente)
DROP INDEX IF EXISTS idx_orders_shopify_store_unique;

-- PASO 3: Crear el índice UNIQUE compuesto
-- Este es CRÍTICO para que funcionen los UPSERTS de Shopify
CREATE UNIQUE INDEX idx_orders_shopify_store_unique
ON orders(shopify_order_id, store_id)
WHERE shopify_order_id IS NOT NULL;

-- PASO 4: Verificación
SELECT
    CASE
        WHEN EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE tablename = 'orders'
            AND indexname = 'idx_orders_shopify_store_unique'
        ) THEN '✅ Índice UNIQUE creado exitosamente'
        ELSE '❌ ERROR: Índice NO fue creado'
    END as resultado;

-- PASO 5: Verificar que no quedan duplicados
SELECT
    CASE
        WHEN COUNT(*) = 0 THEN '✅ Sin duplicados'
        ELSE '❌ Aún hay ' || COUNT(*) || ' grupos duplicados'
    END as duplicados_check
FROM (
    SELECT shopify_order_id, store_id
    FROM orders
    WHERE shopify_order_id IS NOT NULL
    GROUP BY shopify_order_id, store_id
    HAVING COUNT(*) > 1
) dup;
