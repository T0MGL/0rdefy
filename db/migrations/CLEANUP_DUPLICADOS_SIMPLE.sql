-- ================================================================
-- LIMPIEZA DE DUPLICADOS (VERSIÓN SIMPLE)
-- ================================================================
-- SOLO ejecutar si VERIFICACION_SIMPLE.sql detectó duplicados
-- Este script elimina duplicados conservando el más reciente
-- ================================================================

-- PASO 1: Ver los duplicados antes de eliminar
SELECT
    shopify_order_id,
    store_id,
    COUNT(*) as total_duplicados,
    MIN(created_at) as primer_pedido,
    MAX(created_at) as ultimo_pedido
FROM orders
WHERE shopify_order_id IS NOT NULL
GROUP BY shopify_order_id, store_id
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;

-- PASO 2: Eliminar duplicados (conservar el más reciente)
-- ADVERTENCIA: Esta operación ELIMINARÁ datos. Hacer backup antes.

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

-- PASO 3: Verificar que no quedan duplicados
SELECT
    COUNT(*) as duplicados_restantes
FROM (
    SELECT shopify_order_id, store_id
    FROM orders
    WHERE shopify_order_id IS NOT NULL
    GROUP BY shopify_order_id, store_id
    HAVING COUNT(*) > 1
) remaining;

-- Si duplicados_restantes = 0, entonces OK para continuar con migración
