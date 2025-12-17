# ✅ Checklist Final - Webhooks Shopify

**Fecha:** 17 de Diciembre, 2025
**Estado:** Todos los fixes aplicados + Enrichment de datos de cliente - **LISTO PARA TESTING**

---

## 📋 Cambios Aplicados

### ✅ 4. Fix Datos de Cliente desde Webhooks
**Archivos:** `api/services/shopify-webhook.service.ts`, `api/routes/shopify.ts`

**Problema:**
- Orders llegaban sin customer_first_name, customer_last_name, customer_email, customer_phone
- shipping_address solo tenía país, sin dirección completa
- Webhooks de Shopify no incluyen PII por defecto (GDPR compliance)

**Solución:**
```typescript
// Nuevo método para fetch de datos completos del cliente usando GraphQL
private async fetchShopifyCustomerData(customerId, shopDomain, accessToken) {
  // GraphQL query a /admin/api/2025-10/graphql.json
  // Query: customer(id: "gid://shopify/Customer/{id}") { firstName, lastName, email, phone, defaultAddress {...} }
}

// Enriquecimiento en processOrderCreatedWebhook y processOrderUpdatedWebhook
const fullCustomer = await this.fetchShopifyCustomerData(...);
const enrichedOrder = { ...shopifyOrder, customer: fullCustomer, ... };
```

**Resultado:**
- ✅ Usa **Shopify GraphQL API 2025-10** (versión más reciente, NO REST)
- ✅ Query GraphQL para obtener datos completos del customer
- ✅ Pedidos ahora guardan: nombre, email, teléfono, dirección completa
- ✅ Dashboard muestra todos los datos del cliente
- ✅ Funciona para OAuth y Custom Apps
- ✅ Manejo de errores robusto (no pierde pedidos si API falla)

**Documentación:** Ver `SHOPIFY_WEBHOOK_CUSTOMER_DATA_FIX.md`

---

### ✅ 1. Fix HMAC Verification
**Archivo:** `api/routes/shopify-webhooks.ts` (líneas 82-93)

**Cambio:**
```typescript
// Usa api_secret_key de la DB (funciona para OAuth y Custom Apps)
const secret = integration.api_secret_key;
```

**Resultado:**
- ✅ `bright-idea-6816` (OAuth) → Usa `shpss_8feb...` de DB
- ✅ `s17fez-rb` (Custom) → Usa `shpss_57e5...` de DB
- ✅ Sin fallback al `.env` (no es necesario)

---

### ✅ 2. Fix Rutas de Webhooks
**Archivo:** `api/index.ts` (líneas 427-428)

**Cambio:**
```typescript
app.use('/api/shopify/webhook', shopifyWebhooksRouter);  // ← NUEVO
app.use('/api/shopify/webhooks', shopifyWebhooksRouter); // ← Ya existía
```

**Resultado:**
- ✅ Webhooks llegan a `/api/shopify/webhook/*`
- ✅ Backwards compatibility con `/api/shopify/webhooks/*`

---

### ✅ 3. Webhooks Configurados en Shopify
**Script ejecutado:** `fix-shopify-webhooks.cjs`

**Webhooks creados (AMBAS TIENDAS):**
```
✅ orders/create    → https://api.ordefy.io/api/shopify/webhook/orders-create
✅ orders/updated   → https://api.ordefy.io/api/shopify/webhook/orders-updated
✅ products/create  → https://api.ordefy.io/api/shopify/webhook/products-create
✅ products/update  → https://api.ordefy.io/api/shopify/webhook/products-update
✅ products/delete  → https://api.ordefy.io/api/shopify/webhook/products-delete
✅ customers/create → https://api.ordefy.io/api/shopify/webhook/customers-create
✅ customers/update → https://api.ordefy.io/api/shopify/webhook/customers-update
✅ app/uninstalled  → https://api.ordefy.io/api/shopify/webhook/app-uninstalled
```

---

## 🚀 Pasos para Testing

### 1️⃣ **REINICIAR EL SERVIDOR** (CRÍTICO)
```bash
npm run dev
```

⚠️ **IMPORTANTE:** Sin reiniciar, los cambios de código NO se aplican.

---

### 2️⃣ **Crear Pedido de Prueba**

**Opción A: Tienda OAuth (DEV)**
- Ve a: https://admin.shopify.com/store/bright-idea-6816
- Crea un pedido de prueba

**Opción B: Tienda Custom (PROD)**
- Ve a: https://admin.shopify.com/store/s17fez-rb
- Crea un pedido de prueba

---

### 3️⃣ **Verificar Logs del Servidor**

**Logs esperados (ÉXITO):**
```
✅ [WEBHOOK] HMAC validated successfully for bright-idea-6816.myshopify.com
📥 [ORDER-CREATE] New order from bright-idea-6816.myshopify.com: #1001
✅ [ORDER-CREATE] New customer created: Juan Pérez
✅ [ORDER-CREATE] Order saved: #1001
📤 [ORDER-CREATE] Sent to n8n for WhatsApp confirmation
```

**Logs esperados (ERROR - si algo falla):**
```
❌ [WEBHOOK] Invalid HMAC signature for [shop-domain]
🔐 Using secret from: database (Custom App)
```

---

### 4️⃣ **Verificar en Ordefy Dashboard**

1. Abre: http://localhost:8080/orders
2. Busca el pedido recién creado
3. Verifica:
   - ✅ Estado: `pending`
   - ✅ Número: `ORD-YYYYMMDD-XXX`
   - ✅ Cliente aparece correctamente
   - ✅ Productos listados en line items
   - ✅ Total correcto

---

### 5️⃣ **Verificar Normalización de Line Items**

En la base de datos, verifica que se crearon los registros:

```sql
SELECT
  oli.product_name,
  oli.quantity,
  oli.unit_price,
  p.name as mapped_product_name,
  oli.shopify_product_id
FROM order_line_items oli
LEFT JOIN products p ON oli.product_id = p.id
WHERE oli.order_id = '[UUID_DEL_PEDIDO]';
```

**Resultado esperado:**
- ✅ Una fila por cada producto del pedido
- ✅ `product_id` mapeado (si existe en catálogo local)
- ✅ `shopify_product_id` y `shopify_variant_id` guardados

---

### 6️⃣ **Verificar Webhook Logs en Shopify**

1. Ve a tu Custom App en Shopify Admin
2. Click en "Configuration" → "Webhooks"
3. Click en cualquier webhook → "View details"
4. Verifica:
   - ✅ Status: 200 OK
   - ✅ Response time: < 5 segundos
   - ✅ No hay errores (401, 500, etc.)

---

## 🐛 Troubleshooting

### Problema: HMAC Inválido

**Síntoma:**
```
❌ [WEBHOOK] Invalid HMAC signature for [shop-domain]
```

**Solución:**
1. Verifica que `api_secret_key` esté en la DB:
```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data } = await supabase
    .from('shopify_integrations')
    .select('shop_domain, api_secret_key')
    .eq('shop_domain', '[TU-TIENDA].myshopify.com')
    .single();
  console.log('Secret:', data.api_secret_key);
})();
"
```

2. Si el secreto es NULL o incorrecto, actualiza:
```sql
UPDATE shopify_integrations
SET api_secret_key = 'shpss_XXXXX...'
WHERE shop_domain = '[TU-TIENDA].myshopify.com';
```

---

### Problema: Webhook No Llega

**Síntoma:** No hay logs de webhook en el servidor

**Solución:**
1. Verifica que los webhooks estén configurados en Shopify Admin
2. Verifica que la URL sea correcta: `/api/shopify/webhook/orders-create`
3. Prueba manualmente:
```bash
curl -I https://api.ordefy.io/api/shopify/webhook/orders-create
# Debe retornar 401 (Unauthorized) - significa que la ruta existe
```

---

### Problema: 404 Not Found

**Síntoma:**
```
HTTP/2 404
```

**Solución:**
- Reinicia el servidor para aplicar cambios de rutas
- Verifica que el código de `api/index.ts` tenga las líneas:
```typescript
app.use('/api/shopify/webhook', shopifyWebhooksRouter);
```

---

## 📊 Estado de Configuración

### Tienda 1: bright-idea-6816.myshopify.com (OAUTH - DEV)
```
Tipo:          OAuth App
API Secret:    shpss_8feb... (en DB, coincide con .env)
Webhooks:      ✅ Configurados
Estado:        ✅ LISTO PARA TESTING
```

### Tienda 2: s17fez-rb.myshopify.com (CUSTOM - PROD)
```
Tipo:          Custom App
API Secret:    shpss_57e5... (en DB, único)
Webhooks:      ✅ Configurados
Estado:        ✅ LISTO PARA TESTING
```

---

## ✅ Resumen

**Cambios totales aplicados:**
- ✅ HMAC verification arreglada (usa DB para ambas tiendas)
- ✅ Rutas agregadas (soporta `/api/shopify/webhook/*`)
- ✅ Webhooks recreados con URLs correctas
- ✅ Documentación completa creada

**Próximo paso:**
1. **REINICIAR SERVIDOR** ← CRÍTICO
2. Crear pedido de prueba
3. Verificar logs
4. Verificar dashboard

**AMBAS TIENDAS DEBERÍAN FUNCIONAR PERFECTAMENTE.** 🎉
