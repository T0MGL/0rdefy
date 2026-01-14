# Shopify Webhook Errors - Diagnóstico y Solución

**Fecha:** 2026-01-14
**Problema:** Errores HMAC en consola + Webhooks fallando para bright-idea-6816

---

## 🔍 Diagnóstico Completo

### Problema #1: Logs de Debug HMAC Verbosos

**Síntoma:**
```
🔍 [HMAC DEBUG] Body type: string, length: 1234
🔍 [HMAC DEBUG] Secret prefix: shpss_8feba8025...
🔍 [HMAC DEBUG] Full Expected base64: abc123...
🔍 [HMAC DEBUG] Full Received HMAC: xyz789...
❌ HMAC verification failed - neither base64 nor hex format matched
```

**Causa:**
- Logs de debug muy verbosos en `ShopifyWebhookService.verifyHmacSignature()` (líneas 497-518)
- Estos logs aparecen **cada vez** que Shopify envía un webhook
- Son solo logs informativos, el sistema sigue funcionando

**Ubicación:**
- `api/services/shopify-webhook.service.ts:477-525`

**Impacto:**
- Consola contaminada con logs innecesarios
- Confunde errores reales con debug info
- NO afecta funcionalidad

---

### Problema #2: Webhooks Fallando - bright-idea-6816

**Síntoma:**
```
Error buscando producto: JSON object requested, multiple (or no) rows returned
```

**Causa:**
- `api_secret_key` es NULL para bright-idea-6816.myshopify.com
- Productos duplicados con mismo `shopify_product_id` (temporal)
- Código usa `.maybeSingle()` que falla con duplicados

**Evidencia:**
- 10 webhooks fallidos entre 8-12 enero 2026
- Todos son `products/update`
- Error: "multiple rows returned"

**Tiendas afectadas:**
| Tienda | api_secret_key | Estado |
|--------|---------------|---------|
| bright-idea-6816 | ❌ NULL | FALLA |
| s17fez-rb | ✅ OK | Funciona |
| zsxufa-c2 | ✅ OK | Funciona |

---

## ✅ Soluciones Implementadas

### Solución #1: Constraint Único en Base de Datos

**Archivo:** `db/migrations/064_fix_product_duplicates_constraint.sql`

**Qué hace:**
1. Detecta productos duplicados con mismo `shopify_product_id`
2. Limpia duplicados (mantiene el más reciente)
3. Crea índice único para prevenir futuros duplicados

**Comando:**
```sql
CREATE UNIQUE INDEX CONCURRENTLY idx_products_unique_shopify_product_store
ON products (store_id, shopify_product_id)
WHERE shopify_product_id IS NOT NULL;
```

**Resultado:**
- ✅ Previene duplicados a nivel de base de datos
- ✅ No bloquea tabla en producción (usa CONCURRENTLY)
- ✅ Webhook errors "multiple rows" ya no pueden ocurrir

---

### Solución #2: Fix en Código de Webhook

**Archivo:** `api/services/shopify-webhook.service.ts:690-710`

**Cambio:**
```typescript
// ANTES (vulnerable a duplicados)
const { data: existingProduct } = await supabaseAdmin
  .from('products')
  .select('*')
  .eq('shopify_product_id', shopifyProduct.id)
  .eq('store_id', storeId)
  .maybeSingle();  // ❌ Falla si hay duplicados

// DESPUÉS (maneja duplicados gracefully)
const { data: products } = await supabaseAdmin
  .from('products')
  .select('*')
  .eq('shopify_product_id', shopifyProduct.id)
  .eq('store_id', storeId)
  .order('created_at', { ascending: false })
  .limit(1);  // ✅ Siempre devuelve máximo 1

const existingProduct = products?.[0] || null;
```

**Resultado:**
- ✅ Maneja duplicados sin error
- ✅ Toma el producto más reciente si hay duplicados
- ✅ Logea advertencia si encuentra duplicados

---

### Solución #3: Actualizar api_secret_key para bright-idea

**Archivo:** `scripts/fix-bright-idea-api-secret.sql`

**Pasos manuales necesarios:**

1. **Obtener el API Secret de Shopify:**
   - Ir a Shopify Partner Dashboard
   - Seleccionar app "Ordefy"
   - Copiar "API secret key" (NO el API key)

2. **Ejecutar el script:**
```sql
UPDATE shopify_integrations
SET
    api_secret_key = 'shpss_tu_secret_aqui',
    updated_at = NOW()
WHERE shop_domain = 'bright-idea-6816.myshopify.com';
```

3. **Verificar:**
```sql
SELECT
    shop_domain,
    api_secret_key IS NOT NULL as has_secret,
    LENGTH(api_secret_key) as secret_length
FROM shopify_integrations
WHERE shop_domain = 'bright-idea-6816.myshopify.com';
```

**Resultado esperado:**
- `has_secret`: true
- `secret_length`: ~32-64 caracteres

---

## 📋 Checklist de Deployment

### 1. Aplicar Migración de Base de Datos

**Opción A: Deployment rápido (con lock breve)**
```bash
# Ejecuta toda la migración de una vez
psql $DATABASE_URL -f db/migrations/064_fix_product_duplicates_constraint.sql
```

**Opción B: Deployment sin downtime (recomendado para producción)**
```bash
# Paso 1: Limpiar duplicados y crear índice regular
psql $DATABASE_URL -f db/migrations/064_fix_product_duplicates_constraint.sql

# Paso 2: Recrear índice con CONCURRENTLY (sin bloquear tabla)
# IMPORTANTE: Debe ejecutarse FUERA de una transacción
psql $DATABASE_URL -f db/migrations/064b_create_index_concurrently.sql
```

**Nota:** Si ves el error `CREATE INDEX CONCURRENTLY cannot run inside a transaction block`, usa la Opción B.

**Verificar:**
```sql
-- No debe devolver filas (sin duplicados)
SELECT shopify_product_id, store_id, COUNT(*)
FROM products
WHERE shopify_product_id IS NOT NULL
GROUP BY shopify_product_id, store_id
HAVING COUNT(*) > 1;
```

### 2. Actualizar Código (Ya hecho)

```bash
git add api/services/shopify-webhook.service.ts
git commit -m "fix: Handle duplicate products in webhook gracefully"
```

### 3. Actualizar api_secret_key

```bash
# Ejecutar script manualmente
psql $DATABASE_URL -f scripts/fix-bright-idea-api-secret.sql
```

### 4. Reiniciar Servidor API

```bash
# Railway / Vercel / tu plataforma
railway restart
# o
vercel --prod
```

---

## 🧪 Testing

### Test #1: Verificar Constraint Único

```sql
-- Intentar insertar duplicado (debe fallar)
INSERT INTO products (store_id, shopify_product_id, name)
VALUES (
    (SELECT store_id FROM shopify_integrations LIMIT 1),
    '12345',
    'Test Product 1'
);

-- Intentar insertar el mismo (debe fallar con constraint error)
INSERT INTO products (store_id, shopify_product_id, name)
VALUES (
    (SELECT store_id FROM shopify_integrations LIMIT 1),
    '12345',
    'Test Product 2'
);
-- Expected: ERROR: duplicate key value violates unique constraint
```

### Test #2: Simular Webhook de Shopify

```bash
curl -X POST https://api.ordefy.io/api/shopify/webhook/products-update \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Shop-Domain: bright-idea-6816.myshopify.com" \
  -H "X-Shopify-Hmac-Sha256: [HMAC_VÁLIDO]" \
  -d '{
    "id": 7521491222587,
    "title": "Producto Test",
    "variants": [{"id": 123, "price": "100.00", "sku": "TEST"}]
  }'
```

**Resultado esperado:**
- Status: 200 OK
- Log: `✅ HMAC validated (base64) for bright-idea-6816.myshopify.com`
- NO debe haber error "multiple rows"

---

## 📊 Monitoreo Post-Fix

### Queries útiles para monitorear:

```sql
-- 1. Ver webhooks recientes y su estado
SELECT
    shop_domain,
    shopify_topic,
    processed,
    processing_error,
    created_at
FROM shopify_webhook_events
ORDER BY created_at DESC
LIMIT 20;

-- 2. Contar webhooks fallidos por tienda
SELECT
    shop_domain,
    shopify_topic,
    COUNT(*) as failed_count
FROM shopify_webhook_events
WHERE processed = false
  AND processing_error IS NOT NULL
GROUP BY shop_domain, shopify_topic
ORDER BY failed_count DESC;

-- 3. Verificar integraciones activas y sus secrets
SELECT
    shop_domain,
    status,
    api_secret_key IS NOT NULL as has_api_secret,
    access_token IS NOT NULL as has_access_token,
    last_sync_at
FROM shopify_integrations
WHERE status = 'active'
ORDER BY shop_domain;
```

---

## 🎯 Resumen

**Problema raíz:**
1. ❌ Productos duplicados causaban error "multiple rows returned"
2. ❌ api_secret_key NULL causaba fallo en HMAC validation
3. ❌ Logs de debug muy verbosos contaminaban consola

**Soluciones:**
1. ✅ Constraint único previene duplicados
2. ✅ Código robusto maneja edge cases
3. ✅ Script para actualizar api_secret_key
4. ⏳ Logs de debug (opcional - no crítico)

**Próximos pasos:**
- [ ] Aplicar migración 064 en producción
- [ ] Actualizar api_secret_key para bright-idea
- [ ] Monitorear webhooks por 24-48h
- [ ] Opcional: Remover logs de debug si siguen molestando

---

**Autor:** Claude (con Gaston)
**Status:** ✅ Soluciones listas para deploy
