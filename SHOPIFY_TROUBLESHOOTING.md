# Shopify Integration Troubleshooting Guide

## 🔍 Quick Diagnosis

### Check Integration Status

1. **En la UI**: Ve a Integraciones → Panel de Diagnósticos de Shopify
2. **Via API**:
```bash
curl -X GET "https://api.ordefy.io/api/shopify/integration" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Store-ID: YOUR_STORE_ID"
```

### Test Connection Script

Run the test script to verify your Shopify configuration:

```bash
./test-shopify-connection.sh yourstore.myshopify.com
```

If you have an access token:

```bash
./test-shopify-connection.sh yourstore.myshopify.com YOUR_ACCESS_TOKEN
```

---

## 🐛 Common Problems & Solutions

### Problem 1: OAuth Fails with "Invalid HMAC Signature"

**Síntomas**:
- Redirect de Shopify muestra error `invalid_signature`
- Console logs muestran "❌ [SHOPIFY-OAUTH] Invalid HMAC signature"

**Causa**:
- Mismatch entre `SHOPIFY_API_SECRET` en `.env` y el secret de la app en Shopify

**Solución**:
1. Ve a Shopify Partners → Apps → Tu App → Client Credentials
2. Verifica que `SHOPIFY_API_SECRET` en `.env` coincida con el "API secret key"
3. Reinicia el servidor API: `npm run api:dev`

---

### Problem 2: Webhooks No Se Registran (401 Unauthorized)

**Síntomas**:
- Panel de diagnósticos muestra "0 webhooks registrados"
- Console logs muestran "❌ [SHOPIFY-WEBHOOKS] [topic] Registration FAILED" con HTTP 401

**Causa**:
- Access token inválido o expirado
- Credenciales incorrectas en `.env`

**Solución**:
1. Verifica las credenciales en `.env`:
```bash
SHOPIFY_API_KEY=your_api_key_here
SHOPIFY_API_SECRET=shpss_your_api_secret_here
```

2. Verifica que `shopify.app.toml` tenga el mismo `client_id`:
```toml
client_id = "your_api_key_here"
```

3. Re-autoriza la app:
   - Desconecta Shopify en Integraciones
   - Vuelve a conectar con OAuth

4. Registra webhooks manualmente:
   - Click en "Configurar Webhooks" en el panel de diagnósticos

---

### Problem 3: Webhooks No Se Registran (403 Forbidden)

**Síntomas**:
- Console logs muestran "⚠️ PERMISSION ERROR - Missing required scope for topic"

**Causa**:
- Scopes insuficientes en la autorización OAuth

**Solución**:
1. Verifica scopes en `.env`:
```bash
SHOPIFY_SCOPES=read_products,write_products,read_orders,write_orders,read_customers,write_customers
```

2. Verifica scopes en `shopify.app.toml`:
```toml
[access_scopes]
scopes = "read_products, write_products, read_orders, write_orders, read_customers, write_customers"
```

3. Re-instala la app para solicitar nuevos scopes:
   - Desinstala la app desde Shopify Admin → Apps
   - Vuelve a instalar desde Ordefy → Integraciones

---

### Problem 4: Webhooks No Se Registran (422 Already Exists)

**Síntomas**:
- Console logs muestran "⚠️ DUPLICATE ERROR - Webhook already exists for this topic"

**Causa**:
- Webhooks ya existen en Shopify pero no se detectaron en la verificación

**Solución**:
1. **Opción A: Eliminar duplicados manualmente**
   - Ve a Shopify Admin → Settings → Notifications
   - Elimina webhooks duplicados de Ordefy
   - Click en "Configurar Webhooks" en panel de diagnósticos

2. **Opción B: Eliminar todos los webhooks via API**
```bash
curl -X DELETE "https://api.ordefy.io/api/shopify/webhooks/remove-all" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Store-ID: YOUR_STORE_ID"
```
   - Luego click en "Configurar Webhooks"

---

### Problem 5: Productos/Clientes NO Se Sincronizan Después de OAuth

**Síntomas**:
- OAuth exitoso pero no aparecen productos/clientes
- Panel de sincronización muestra "0 trabajos"

**Causa**:
- La sincronización inicial no se inició automáticamente
- Error en el proceso de importación

**Solución**:
1. Verifica que la integración esté activa:
```bash
curl -X GET "https://api.ordefy.io/api/shopify/integration" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Store-ID: YOUR_STORE_ID"
```

2. Inicia sincronización manual:
   - Click en "Sincronizar Productos y Clientes" en panel de sincronización

3. Verifica estado de importación:
```bash
curl -X GET "https://api.ordefy.io/api/shopify/import-status/INTEGRATION_ID" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Store-ID: YOUR_STORE_ID"
```

4. Revisa logs del servidor:
```bash
tail -f logs/api.log | grep SHOPIFY-IMPORT
```

---

### Problem 6: App No Carga en Shopify Admin (Embedded Mode)

**Síntomas**:
- Blank screen al abrir la app desde Shopify Admin
- Error de CORS en console del navegador

**Causa**:
- `embedded = true` en `shopify.app.toml` pero App Bridge no está implementado

**Solución**:
Ya corregido en este commit. El `shopify.app.toml` ahora tiene `embedded = false` ya que no usamos App Bridge.

Si quieres habilitar embedded mode en el futuro, necesitas implementar App Bridge:

1. Instalar @shopify/app-bridge-react:
```bash
npm install @shopify/app-bridge @shopify/app-bridge-react
```

2. Configurar App Bridge en `src/App.tsx`:
```typescript
import { AppProvider } from '@shopify/app-bridge-react';

const config = {
  apiKey: import.meta.env.VITE_SHOPIFY_API_KEY,
  host: new URLSearchParams(location.search).get("host") || "",
  forceRedirect: true,
};

<AppProvider config={config}>
  {/* Your app */}
</AppProvider>
```

---

### Problem 7: Redirect URL Mismatch

**Síntomas**:
- Error después de autorizar en Shopify: "redirect_uri_mismatch"

**Causa**:
- La URL de redirect no está registrada en Shopify Partners

**Solución**:
1. Ve a Shopify Partners → Apps → Tu App → App Setup
2. En "App URL" y "Allowed redirection URL(s)", agrega:
```
https://api.ordefy.io/api/shopify-oauth/callback
```

3. Verifica que `SHOPIFY_REDIRECT_URI` en `.env` coincida:
```bash
SHOPIFY_REDIRECT_URI=https://api.ordefy.io/api/shopify-oauth/callback
```

---

### Problem 8: Webhooks Llegan pero No Se Procesan

**Síntomas**:
- Webhooks aparecen en Shopify como "delivered"
- Pero órdenes no aparecen en Ordefy

**Causa**:
- Error en verificación HMAC de webhook
- Error en procesamiento del payload

**Solución**:
1. Revisa logs de webhooks:
```bash
tail -f logs/api.log | grep SHOPIFY-WEBHOOK
```

2. Verifica métricas de webhooks:
```bash
curl -X GET "https://api.ordefy.io/api/shopify/webhook-health?hours=24" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Store-ID: YOUR_STORE_ID"
```

3. Procesa cola de reintentos manualmente:
```bash
curl -X POST "https://api.ordefy.io/api/shopify/webhook-retry/process" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Store-ID: YOUR_STORE_ID"
```

---

## 🔧 Debugging Tools

### 1. Check OAuth Health

```bash
curl -X GET "https://api.ordefy.io/api/shopify-oauth/health"
```

Expected response:
```json
{
  "configured": true,
  "missing_vars": [],
  "config": {
    "api_key": true,
    "api_secret": true,
    "redirect_uri": true,
    "scopes": "read_products,write_products,read_orders,write_orders,read_customers,write_customers",
    "api_version": "2025-10"
  },
  "message": "Shopify OAuth is properly configured"
}
```

### 2. List Registered Webhooks

```bash
curl -X GET "https://api.ordefy.io/api/shopify/webhooks/list" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Store-ID: YOUR_STORE_ID"
```

### 3. Verify Webhooks Configuration

```bash
curl -X GET "https://api.ordefy.io/api/shopify/webhooks/verify" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Store-ID: YOUR_STORE_ID"
```

### 4. Manually Setup Webhooks

```bash
curl -X POST "https://api.ordefy.io/api/shopify/webhooks/setup" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Store-ID: YOUR_STORE_ID"
```

### 5. Test Shopify API Directly

```bash
# Replace with your values
SHOP_DOMAIN="yourstore.myshopify.com"
ACCESS_TOKEN="shpat_xxxxx"
API_VERSION="2025-10"

# Get shop info
curl -X GET "https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/shop.json" \
  -H "X-Shopify-Access-Token: ${ACCESS_TOKEN}"

# List webhooks
curl -X GET "https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/webhooks.json" \
  -H "X-Shopify-Access-Token: ${ACCESS_TOKEN}"

# List products
curl -X GET "https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/products.json?limit=5" \
  -H "X-Shopify-Access-Token: ${ACCESS_TOKEN}"
```

---

## 📊 Monitoring

### Webhook Health Dashboard

Ve a Integraciones → Panel de Diagnósticos de Shopify para ver:

- ✅ Webhooks registrados (4 esperados)
- 📊 Tasa de éxito de webhooks
- ⚠️ Errores recientes
- 🔄 Reintentos pendientes

### Database Queries

Check integration status:
```sql
SELECT * FROM shopify_integrations WHERE store_id = 'YOUR_STORE_ID';
```

Check registered webhooks:
```sql
SELECT * FROM shopify_webhooks WHERE integration_id = 'INTEGRATION_ID';
```

Check webhook metrics:
```sql
SELECT * FROM shopify_webhook_metrics
WHERE integration_id = 'INTEGRATION_ID'
ORDER BY created_at DESC
LIMIT 24;
```

Check import jobs:
```sql
SELECT * FROM shopify_import_jobs
WHERE integration_id = 'INTEGRATION_ID'
ORDER BY created_at DESC;
```

---

## 🚨 Emergency Reset

Si nada funciona, haz un reset completo:

### 1. Disconnect Shopify Integration

```bash
curl -X DELETE "https://api.ordefy.io/api/shopify-oauth/disconnect?shop=yourstore.myshopify.com" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Store-ID: YOUR_STORE_ID"
```

### 2. Clean Database

```sql
-- Backup first!
DELETE FROM shopify_webhooks WHERE integration_id = 'INTEGRATION_ID';
DELETE FROM shopify_import_jobs WHERE integration_id = 'INTEGRATION_ID';
DELETE FROM shopify_integrations WHERE id = 'INTEGRATION_ID';
```

### 3. Uninstall App from Shopify

- Go to Shopify Admin → Apps
- Find Ordefy
- Click "Uninstall"

### 4. Re-install

- Go to Ordefy → Integraciones
- Click "Conectar tienda" en Shopify
- Follow OAuth flow
- Verify webhooks are registered in panel de diagnósticos

---

## 📝 Checklist Before Going Live

- [ ] SHOPIFY_API_KEY matches shopify.app.toml client_id
- [ ] SHOPIFY_API_SECRET is correct
- [ ] SHOPIFY_REDIRECT_URI is whitelisted in Shopify Partners
- [ ] shopify.app.toml has embedded = false (or App Bridge implemented)
- [ ] All 4 webhooks registered successfully
- [ ] OAuth health check returns "configured": true
- [ ] Test products sync manually
- [ ] Test customers sync manually
- [ ] Create test order in Shopify → verify it arrives via webhook
- [ ] Webhook health dashboard shows 100% success rate

---

## 📚 Resources

- [Shopify API Documentation](https://shopify.dev/docs/api)
- [Shopify OAuth Flow](https://shopify.dev/docs/apps/auth/oauth)
- [Shopify Webhooks](https://shopify.dev/docs/apps/webhooks)
- [App Bridge Documentation](https://shopify.dev/docs/apps/tools/app-bridge)
- [ORDEFY WEBHOOK_RELIABILITY.md](./WEBHOOK_RELIABILITY.md)
- [ORDEFY SHOPIFY_SETUP.md](./SHOPIFY_SETUP.md)

---

## 🆘 Getting Help

If you still have issues after following this guide:

1. Run the test script and save output:
```bash
./test-shopify-connection.sh yourstore.myshopify.com > shopify-test.log 2>&1
```

2. Export webhook health metrics:
```bash
curl -X GET "https://api.ordefy.io/api/shopify/webhook-health?hours=24" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Store-ID: YOUR_STORE_ID" > webhook-health.json
```

3. Check API logs:
```bash
tail -100 logs/api.log | grep SHOPIFY > shopify-errors.log
```

4. Create GitHub issue with:
   - shopify-test.log
   - webhook-health.json
   - shopify-errors.log
   - Screenshots from panel de diagnósticos
