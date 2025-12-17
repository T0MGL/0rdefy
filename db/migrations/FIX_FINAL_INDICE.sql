-- ================================================================
-- FIX FINAL - Eliminar índice viejo que causa conflicto
-- ================================================================
-- Problema: Existen DOS índices UNIQUE sobre shopify_order_id:
--   1. orders_shopify_order_id_key (VIEJO - solo shopify_order_id)
--   2. idx_orders_shopify_store_unique (NUEVO - shopify_order_id, store_id)
--
-- El código usa ON CONFLICT (shopify_order_id, store_id) pero PostgreSQL
-- encuentra primero el índice viejo y falla.
-- ================================================================

-- Eliminar índice VIEJO (solo shopify_order_id)
DROP INDEX IF EXISTS orders_shopify_order_id_key;

-- Eliminar también el índice simple si existe (redundante)
DROP INDEX IF EXISTS idx_orders_shopify_id;

-- Verificar que solo queda el índice compuesto correcto
SELECT
    '✅ Índices UNIQUE sobre shopify_order_id después del fix:' as info;

SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'orders'
AND indexdef LIKE '%UNIQUE%'
AND indexdef LIKE '%shopify_order_id%'
ORDER BY indexname;

-- Debe retornar SOLO:
-- idx_orders_shopify_store_unique | CREATE UNIQUE INDEX ... ON (shopify_order_id, store_id)
