# Shopify Custom App - Scopes Requeridos

## Problema Detectado

Al usar Custom Apps, Shopify **restringe el acceso a datos de clientes (PII)** dependiendo del plan de la tienda:

- ✅ **Shopify Plus, Advanced, Shopify**: Acceso completo a customer data
- ❌ **Shopify Basic, Starter**: **NO** tienen acceso a PII (customer names, addresses, emails, phone numbers)

## Error Común

```
This app is not approved to access the Customer object.
Access to personally identifiable information (PII) like customer names,
addresses, emails, phone numbers is only available on Shopify, Advanced, and Plus plans.
```

Este error aparece cuando:
1. Tu Custom App solicita datos de clientes (`customer` object)
2. La tienda está en un plan que no permite acceso a PII
3. El webhook incluye datos del customer que tu app no puede leer

## Solución

### Opción 1: Upgrade del Plan (Recomendado)

Si necesitas datos de clientes, la tienda debe estar en uno de estos planes:
- Shopify
- Advanced
- Shopify Plus

### Opción 2: Modificar Scopes (Para planes básicos)

Si la tienda está en Basic/Starter, **NO pidas scopes de customer**:

#### Scopes Mínimos para Custom App (sin customer data):

```
read_products
write_products
read_orders
write_orders
read_inventory
write_inventory
read_locations
```

#### Scopes Completos (requiere Shopify/Advanced/Plus):

```
read_products
write_products
read_orders
write_orders
read_customers        ← Requiere plan avanzado
write_customers       ← Requiere plan avanzado
read_inventory
write_inventory
read_locations
```

## Cómo Configurar Scopes

1. Ve a tu **Shopify Admin**
2. Settings → Apps and sales channels
3. Develop apps → [Tu Custom App]
4. Configuration → **Configure Admin API scopes**
5. Selecciona los scopes según tu plan
6. Guarda cambios
7. **Reinstala el Admin API access token** (se regenera)

## HMAC y Custom Apps

### IMPORTANTE: Shopify SIEMPRE usa base64 para HMAC

Ambos tipos de apps (OAuth y Custom Apps) reciben el HMAC en **formato base64**:

- ✅ **Correcto**: `X-Shopify-Hmac-SHA256: et55aZiQmPQU0IpugNoxxzCzQVDY9W2rTiskFm+CTDM=`
- ❌ **Incorrecto**: Asumir que Custom Apps usan formato hex

### Secreto usado para HMAC:

- **OAuth Apps**: `SHOPIFY_API_SECRET` (del .env, Client Secret de la Public App)
- **Custom Apps**: `api_secret_key` (de la base de datos, API Secret Key de la Custom App)

Ambos secretos empiezan con `shpss_` y Shopify los usa para generar el HMAC en **base64**.

## Verificar Plan de la Tienda

Para saber qué plan tiene una tienda:

```graphql
query {
  shop {
    name
    plan {
      displayName
      partnerDevelopment
      shopifyPlus
    }
  }
}
```

Planes disponibles:
- `Starter`
- `Basic`
- `Shopify` (antes "Professional")
- `Advanced`
- `Shopify Plus`

## Impact en Webhooks

### Webhook con customer data (plan avanzado):

```json
{
  "id": 12345,
  "customer": {
    "id": 67890,
    "email": "customer@example.com",
    "first_name": "John",
    "last_name": "Doe",
    "phone": "+1234567890"
  }
}
```

### Webhook SIN customer data (plan básico):

```json
{
  "id": 12345,
  "customer": null
}
```

El body cambia → el HMAC cambia → validación puede fallar en primeros intentos.

## Fallback Strategy ✅ IMPLEMENTADO

Cuando GraphQL falla por ACCESS_DENIED (planes Basic/Starter), el sistema automáticamente:

1. **Intenta obtener customer data desde GraphQL** → Si falla por ACCESS_DENIED:
2. **Extrae customer info desde las direcciones de la orden** (billing_address/shipping_address)

### Código del Fallback

```typescript
// Fallback: Extract customer from order addresses
if (!enrichedOrder.customer || !enrichedOrder.customer.email) {
  const customerFromAddresses = extractCustomerFromOrderAddresses(enrichedOrder);
  if (customerFromAddresses) {
    enrichedOrder.customer = customerFromAddresses;
  }
}
```

### Datos Extraídos

Desde `billing_address` y `shipping_address`:
- `first_name` / `last_name` → Customer name
- `email` (del order) → Customer email
- `phone` → Customer phone
- `address1`, `city`, `country`, etc. → Customer address

**Ventaja:** Funciona en **TODOS los planes de Shopify** porque las direcciones de la orden siempre están disponibles.

## Recomendaciones

1. **Siempre verifica el plan** antes de solicitar customer scopes
2. **Implementa fallbacks** para cuando customer data no esté disponible ✅ YA IMPLEMENTADO
3. **No bloquees el procesamiento** si falta customer data ✅ YA IMPLEMENTADO
4. **Loguea warnings** en lugar de errors cuando faltan datos de customer ✅ YA IMPLEMENTADO

## Testing

Para probar tu Custom App:

1. **Crear orden de prueba** en Shopify
2. **Verificar logs** - debe mostrar `✅ HMAC validated (base64)`
3. **Si falla HMAC** en primeros intentos pero pasa después:
   - Verifica que los scopes coincidan con el plan
   - Verifica que el `api_secret_key` en la DB sea correcto
4. **Si siempre falla**:
   - El `api_secret_key` está incorrecto
   - Copia el correcto desde Shopify Admin → Custom App → API credentials

## Links Útiles

- [Shopify Plans Comparison](https://www.shopify.com/pricing)
- [API Access Scopes](https://shopify.dev/docs/api/usage/access-scopes)
- [Custom App Setup](https://shopify.dev/docs/apps/build/authentication-authorization/custom-apps)
- [Webhook HMAC Verification](https://shopify.dev/docs/apps/build/webhooks/subscribe/https#verify-a-webhook)
