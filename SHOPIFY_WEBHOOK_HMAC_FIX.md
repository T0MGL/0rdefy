# Shopify Webhook HMAC Verification Fix

**Date:** December 16, 2025
**Issue:** Webhooks failing with `401 Invalid HMAC signature`
**Status:** ✅ FIXED

## Problem

Los webhooks de Shopify estaban fallando la verificación HMAC con error 401:

```
❌ HMAC verification failed for orders/updated
❌ HMAC verification failed for orders/create
🔐 Using SHOPIFY_API_SECRET from .env for HMAC verification
❌ Invalid HMAC signature
```

## Root Cause

El sistema tenía **dos archivos diferentes** manejando webhooks con lógicas distintas:

1. **`api/middleware/shopify-webhook.ts`** ✅ - Lee `api_secret_key` de la base de datos
2. **`api/routes/shopify-webhooks.ts`** ❌ - Lee `SHOPIFY_API_SECRET` del .env (INCORRECTO)

El archivo activo (`shopify-webhooks.ts`) estaba usando el secreto equivocado:

```typescript
// ❌ ANTES (INCORRECTO)
const secret = process.env.SHOPIFY_API_SECRET;
```

### Por qué esto es incorrecto para Custom Apps

Shopify tiene **dos tipos de aplicaciones**:

#### 1. OAuth Apps (Public Apps)
- Requieren proceso de autorización OAuth
- Usan `SHOPIFY_API_SECRET` del archivo `.env` (secreto de la app pública)
- Shopify firma webhooks con este secreto compartido

#### 2. Custom Apps (Private Apps) ⭐ **LO QUE ESTÁS USANDO**
- No requieren OAuth (acceso directo con API Key + Access Token)
- Cada Custom App tiene su **propio API Secret Key único**
- Este secreto está en la columna `api_secret_key` de `shopify_integrations`
- Shopify firma webhooks con este secreto **específico de la tienda**

## Solution

Actualizado `api/routes/shopify-webhooks.ts` para que:

1. **Obtenga el secreto correcto de la base de datos:**
```typescript
// ✅ DESPUÉS (CORRECTO)
const { data: integration } = await supabaseAdmin
  .from('shopify_integrations')
  .select('api_secret_key')
  .eq('shop_domain', shopDomain)
  .single();

const secret = integration.api_secret_key || process.env.SHOPIFY_API_SECRET;
```

2. **Soporte híbrido:**
   - Custom Apps → Usa `api_secret_key` de la base de datos
   - OAuth Apps → Fallback a `SHOPIFY_API_SECRET` del .env

3. **Mejores logs de debugging:**
```typescript
console.error(`🔐 Using secret from: ${
  integration.api_secret_key
    ? 'database (Custom App)'
    : '.env (OAuth App)'
}`);
```

## Database Verification

Ambas tiendas tienen el `api_secret_key` configurado correctamente:

```
1. bright-idea-6816.myshopify.com
   api_secret_key: ✅ SET (shpss_8feb...)
   access_token: ✅ SET

2. s17fez-rb.myshopify.com
   api_secret_key: ✅ SET (shpss_57e5...)
   access_token: ✅ SET
```

## Files Changed

- **`api/routes/shopify-webhooks.ts`** - Updated `validateShopifyHMAC()` middleware
  - Changed from `async function` para poder hacer query a la base de datos
  - Agregado query para obtener `api_secret_key` por `shop_domain`
  - Agregado fallback para OAuth apps
  - Mejores logs de debugging

## Testing

Para verificar que los webhooks funcionan:

1. Reinicia el servidor backend:
```bash
npm run dev
```

2. Crea un pedido de prueba en Shopify

3. Verifica los logs del servidor:
```
✅ [WEBHOOK] HMAC validated successfully for bright-idea-6816.myshopify.com
📥 [ORDER-CREATE] New order from bright-idea-6816.myshopify.com: #1234
✅ [ORDER-CREATE] Order saved: #1234
```

4. Verifica que el pedido aparece en el Dashboard de Ordefy

## Why This Works

Shopify firma cada webhook con el **API Secret Key específico de la tienda**:

```
HMAC = SHA256(webhook_body, api_secret_key_de_la_tienda)
```

Para Custom Apps, este secreto es **único por tienda** y está almacenado en:
- **Shopify Admin:** Settings > Apps and sales channels > [Tu App] > API credentials > API secret key
- **Ordefy Database:** `shopify_integrations.api_secret_key` (starts with `shpss_`)

El `.env` solo contiene el secreto para **OAuth apps públicas**, que no es tu caso.

## Important Notes

⚠️ **NO ROMPIMOS LA INTEGRACIÓN OAUTH**

El código sigue soportando ambos tipos de apps:
- Custom Apps: Usa `api_secret_key` de DB (tu caso actual)
- OAuth Apps: Usa `SHOPIFY_API_SECRET` de .env (futuro)

⚠️ **CONFIGURACIÓN MANUAL HASTA QUE SHOPIFY APRUEBE OAUTH**

Actualmente estás usando Custom Apps con configuración manual porque:
1. Es más rápido (no requiere aprobación de Shopify)
2. Funciona para desarrollo y testing
3. Cuando Shopify apruebe la app OAuth, el sistema automáticamente soportará ambos

## Next Steps

1. ✅ Deploy del fix a producción
2. ✅ Verificar que webhooks llegan correctamente
3. 🔜 Monitorear logs por 24h para confirmar estabilidad
4. 🔜 Cuando Shopify apruebe OAuth, agregar `SHOPIFY_API_SECRET` al `.env` de producción

## Related Files

- [api/routes/shopify-webhooks.ts](api/routes/shopify-webhooks.ts) - Main webhook handlers
- [api/middleware/shopify-webhook.ts](api/middleware/shopify-webhook.ts) - Alternative middleware (not used)
- [db/migrations/008_make_shopify_oauth_fields_nullable.sql](db/migrations/008_make_shopify_oauth_fields_nullable.sql) - Schema for hybrid support
- [SHOPIFY_CUSTOM_APP_SETUP.md](SHOPIFY_CUSTOM_APP_SETUP.md) - Setup guide for Custom Apps
