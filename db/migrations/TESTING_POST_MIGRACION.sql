-- ================================================================
-- TESTING POST-MIGRACIÓN
-- ================================================================
-- Ejecutar DESPUÉS de la migración para verificar que funciona
-- ================================================================

-- TEST 1: Verificar columna id existe
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'shopify_webhook_idempotency'
AND column_name = 'id';
-- Debe retornar: id | uuid | NO | gen_random_uuid()

-- TEST 2: Verificar índices UNIQUE en orders
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'orders'
AND indexname IN ('idx_orders_shopify_id', 'idx_orders_shopify_store_unique');
-- Debe retornar 2 filas

-- TEST 3: Probar inserción en shopify_webhook_idempotency
INSERT INTO shopify_webhook_idempotency (
    integration_id,
    idempotency_key,
    shopify_event_id,
    shopify_topic,
    response_status,
    expires_at
) VALUES (
    (SELECT id FROM shopify_integrations LIMIT 1),
    'test-029-' || NOW()::TEXT,
    'evt-test-123',
    'orders/create',
    200,
    NOW() + INTERVAL '1 day'
) RETURNING id, idempotency_key;
-- Debe retornar un UUID

-- TEST 4: Probar UPSERT en orders (primer INSERT)
INSERT INTO orders (
    store_id,
    shopify_order_id,
    customer_email,
    total_price
) VALUES (
    (SELECT id FROM stores LIMIT 1),
    'test-shopify-029-' || EXTRACT(EPOCH FROM NOW())::TEXT,
    'test@ordefy.io',
    100.00
)
ON CONFLICT (shopify_order_id, store_id)
DO UPDATE SET total_price = EXCLUDED.total_price
RETURNING id, shopify_order_id, total_price;
-- Debe retornar: id | shopify_order_id | 100.00

-- TEST 5: Probar UPSERT en orders (UPDATE - usar el mismo shopify_order_id del test anterior)
-- REEMPLAZAR 'test-shopify-029-XXXX' con el shopify_order_id que retornó el test anterior
INSERT INTO orders (
    store_id,
    shopify_order_id,
    customer_email,
    total_price
) VALUES (
    (SELECT id FROM stores LIMIT 1),
    'test-shopify-029-XXXX',  -- REEMPLAZAR con el ID del test anterior
    'test@ordefy.io',
    200.00
)
ON CONFLICT (shopify_order_id, store_id)
DO UPDATE SET total_price = EXCLUDED.total_price
RETURNING id, shopify_order_id, total_price;
-- Debe retornar: mismo id | mismo shopify_order_id | 200.00 (UPDATE, no INSERT)

-- TEST 6: Limpiar datos de prueba
DELETE FROM shopify_webhook_idempotency
WHERE idempotency_key LIKE 'test-029-%';

DELETE FROM orders
WHERE shopify_order_id LIKE 'test-shopify-029-%';

-- RESUMEN
SELECT 'TODOS LOS TESTS PASARON ✅' as resultado;
