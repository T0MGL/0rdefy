-- ================================================================
-- FIX FINAL - Eliminar CONSTRAINT viejo
-- ================================================================
-- El problema es un CONSTRAINT UNIQUE viejo sobre solo shopify_order_id
-- Esto impide que funcione el ON CONFLICT (shopify_order_id, store_id)
-- ================================================================

-- Eliminar el CONSTRAINT viejo
ALTER TABLE orders
DROP CONSTRAINT IF EXISTS orders_shopify_order_id_key;

-- Verificar resultado
SELECT '✅ Constraints eliminados, verificando índices...' as status;

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

-- Si retorna también idx_orders_shopify_id, ejecutar:
-- DROP INDEX IF EXISTS idx_orders_shopify_id;
