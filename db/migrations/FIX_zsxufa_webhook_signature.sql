-- ================================================================
-- FIX: Update webhook_signature for zsxufa-c2.myshopify.com
-- ================================================================
--
-- PROBLEMA IDENTIFICADO:
-- El campo webhook_signature contiene el Client Secret (shpss_xxx, 38 chars)
-- en lugar del Webhook Signing Secret (64 chars hex) que Shopify usa
-- para firmar los webhooks.
--
-- CAUSA RAÍZ:
-- Para Custom Apps creadas desde el Dev Dashboard de Shopify (2025-2026),
-- el Client Secret (usado para OAuth) es DIFERENTE del Webhook Signing Secret.
--
-- El código actual guarda el Client Secret como webhook_signature,
-- pero Shopify usa el "Webhook Signing Secret" (que está en otra ubicación)
-- para firmar todos los webhooks entrantes.
--
-- INSTRUCCIONES PARA OBTENER EL WEBHOOK SIGNING SECRET:
--
-- OPCIÓN A - Desde Shopify Admin (Recomendado):
-- 1. Ve a https://admin.shopify.com/store/zsxufa-c2/settings/notifications
-- 2. Scroll hasta el final de la página
-- 3. En la sección "Webhooks", verás "Signing secret"
-- 4. Copia ese valor (64 caracteres hexadecimales como: 4dfa8b2c9e...)
-- 5. Reemplaza 'SIGNING_SECRET_AQUI' con ese valor
--
-- OPCIÓN B - Desde Dev Dashboard (si creaste webhooks via API):
-- 1. Ve a https://partners.shopify.com/
-- 2. Apps > Tu App > Webhooks
-- 3. Busca el "Signing secret" para webhooks
--
-- IMPORTANTE:
-- - El Signing Secret tiene formato: 64 caracteres hex (a-f, 0-9)
-- - NO usar el Client Secret (shpss_xxx) ni Access Token (shpat_xxx)
-- - La tienda s17fez-rb funciona porque tiene el signing secret correcto
--
-- ================================================================

-- Verificar estado actual
SELECT
    shop_domain,
    is_custom_app,
    LENGTH(webhook_signature) as webhook_sig_length,
    LEFT(webhook_signature, 8) || '...' as webhook_sig_preview,
    LENGTH(api_secret_key) as api_key_length,
    LEFT(api_secret_key, 8) || '...' as api_key_preview,
    CASE
        WHEN LENGTH(webhook_signature) = 64 THEN '✅ Correcto (64 chars)'
        WHEN webhook_signature LIKE 'shps%' THEN '❌ Es Client Secret, no Signing Secret'
        ELSE '⚠️ Verificar formato'
    END as diagnostic
FROM shopify_integrations
WHERE shop_domain = 'zsxufa-c2.myshopify.com';

-- Comparar con tienda que funciona
SELECT
    shop_domain,
    LENGTH(webhook_signature) as webhook_sig_length,
    LEFT(webhook_signature, 8) || '...' as preview,
    'FUNCIONA ✅' as status
FROM shopify_integrations
WHERE shop_domain = 's17fez-rb.myshopify.com';

-- ================================================================
-- EJECUTAR DESPUÉS DE OBTENER EL SIGNING SECRET:
-- ================================================================

-- DESCOMENTA Y REEMPLAZA 'SIGNING_SECRET_AQUI' CON EL VALOR REAL:

-- UPDATE shopify_integrations
-- SET webhook_signature = 'SIGNING_SECRET_AQUI'
-- WHERE shop_domain = 'zsxufa-c2.myshopify.com';

-- Verificar el cambio
-- SELECT
--     shop_domain,
--     LENGTH(webhook_signature) as new_length,
--     LEFT(webhook_signature, 8) || '...' as new_preview,
--     CASE WHEN LENGTH(webhook_signature) = 64 THEN '✅' ELSE '❌' END as valid
-- FROM shopify_integrations
-- WHERE shop_domain = 'zsxufa-c2.myshopify.com';
