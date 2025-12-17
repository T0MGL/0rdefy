# Shopify Disabled Customer Data Workaround

## Problema

Cuando los clientes de Shopify están en estado `disabled` (configuración por defecto para guest checkout en planes Basic/Trial), Shopify redacta (oculta) la información personal identificable (PII) del objeto `customer` en los webhooks.

### Ejemplo de Customer Object Redactado

```json
{
  "customer": {
    "id": 191167,
    "email": null,  // ❌ REDACTED
    "phone": null,  // ❌ REDACTED
    "first_name": null,  // ❌ REDACTED
    "last_name": null,  // ❌ REDACTED
    "state": "disabled"
  },
  "billing_address": {
    "country": "CA",
    "country_code": "CA"
    // otros campos pueden estar redactados
  }
}
```

## Solución

**Shopify SIEMPRE incluye información del cliente en campos a nivel de ORDER**, incluso cuando el objeto `customer` está redactado. Estos campos son:

- `contact_email` - Email de contacto del pedido
- `email` - Email del pedido (puede diferir de contact_email)
- `phone` - Teléfono a nivel de pedido
- `billing_address` - Dirección de facturación completa (first_name, last_name, phone, address, etc.)
- `shipping_address` - Dirección de envío completa

### Estructura del Webhook con Datos Completos

```json
{
  "id": 820982911946154508,
  "contact_email": "jon@example.com",  // ✅ SIEMPRE DISPONIBLE
  "email": "jon@doe.ca",                // ✅ SIEMPRE DISPONIBLE
  "phone": "+1234567890",               // ✅ SIEMPRE DISPONIBLE
  "billing_address": {
    "first_name": "Bob",                // ✅ SIEMPRE DISPONIBLE
    "last_name": "Biller",              // ✅ SIEMPRE DISPONIBLE
    "address1": "123 Billing Street",
    "phone": "555-555-BILL",
    "city": "Billtown",
    "province": "Kentucky",
    "country": "United States"
  },
  "shipping_address": {
    "first_name": "Steve",
    "last_name": "Shipper",
    "address1": "123 Shipping Street",
    "phone": "555-555-SHIP",
    "city": "Shippington",
    "province": "Kentucky",
    "country": "United States"
  },
  "customer": {
    "id": 115310627314723954,
    "email": null,                      // ❌ Puede estar redactado
    "phone": null,                      // ❌ Puede estar redactado
    "state": "disabled"
  }
}
```

## Implementación

### Orden de Prioridad para Extraer Datos

```typescript
// 1. TELÉFONO - Priorizar campos a nivel de pedido
const phone = shopifyOrder.phone ||
              shopifyOrder.billing_address?.phone ||
              shopifyOrder.shipping_address?.phone ||
              shopifyOrder.customer?.phone || '';

// 2. EMAIL - contact_email tiene mayor prioridad
const email = shopifyOrder.contact_email ||
              shopifyOrder.email ||
              shopifyOrder.customer?.email || '';

// 3. NOMBRE
const firstName = shopifyOrder.billing_address?.first_name ||
                 shopifyOrder.shipping_address?.first_name ||
                 shopifyOrder.customer?.first_name || '';

const lastName = shopifyOrder.billing_address?.last_name ||
                shopifyOrder.shipping_address?.last_name ||
                shopifyOrder.customer?.last_name || '';
```

### Archivo Modificado

**`api/services/shopify-webhook.service.ts`**
- Función `findOrCreateCustomer()` (líneas 638-751)
- Implementa el orden de prioridad correcto para extraer datos del cliente

## Referencias

- [Shopify Webhook Documentation - orders/create](https://shopify.dev/docs/api/admin-rest/latest/resources/webhook#event-topics-orders-create)
- [Shopify Webhook Documentation - orders/updated](https://shopify.dev/docs/api/admin-rest/latest/resources/webhook#event-topics-orders-updated)
- [Protected Customer Data Requirements](https://shopify.dev/apps/store/data-protection/protected-customer-data)

## Casos de Uso

### ✅ Funciona Correctamente

1. **Guest Checkout (state: disabled)** - Los datos están en order-level fields
2. **Registered Customer (state: enabled)** - Los datos están en ambos lugares
3. **Basic/Trial Shopify Plans** - Sin acceso a Customer API, pero order-level fields siempre disponibles
4. **Custom Apps sin scope customers** - No pueden acceder a Customer API, pero order-level fields disponibles

### ❌ Limitaciones y Problemas Comunes

1. **Customer API Access**: En planes Basic/Trial o Custom Apps sin scope `read_customers`, la API GraphQL de Customer devolverá `ACCESS_DENIED`

2. **Historical Data**: Si necesitas datos históricos del cliente (pedidos anteriores, lifetime value), debes almacenarlos localmente ya que el webhook solo trae datos del pedido actual

3. **⚠️ PROBLEMA CRÍTICO: Webhooks con Datos Incompletos**

   Algunos checkouts de Shopify (especialmente con temas personalizados, apps de terceros, o configuraciones específicas) **NO envían todos los campos en el webhook**, incluso cuando los datos se capturan en el checkout:

   **Síntoma:**
   ```json
   {
     "contact_email": null,    // ❌ Faltante
     "email": null,            // ❌ Faltante
     "phone": null,            // ❌ Faltante
     "billing_address": {
       "country": "Paraguay",  // ✅ Solo país
       "country_code": "PY"
       // ❌ Sin: first_name, last_name, phone, address, etc.
     },
     "shipping_address": {
       "country": "Paraguay",
       "country_code": "PY"
     }
   }
   ```

   **Causas:**
   - Checkout Extensions personalizados
   - Apps de checkout de terceros (PageFly, Zipify, etc.)
   - Configuración de "Don't require shipping address" en Settings
   - Campos personalizados guardados solo en `note_attributes` o `metafields`

   **Solución Implementada:**

   Cuando el webhook NO contiene datos completos, automáticamente fetcheamos el pedido completo desde la Shopify Orders API:

   ```typescript
   // Detectar si webhook tiene datos incompletos
   const hasCompleteData = (
     shopifyOrder.email || shopifyOrder.contact_email || shopifyOrder.phone
   ) && (
     shopifyOrder.billing_address?.first_name ||
     shopifyOrder.shipping_address?.first_name
   );

   // Si faltan datos, fetchear orden completa desde API
   if (!hasCompleteData && integration) {
     const completeOrder = await fetchCompleteOrderData(
       orderId,
       shopDomain,
       accessToken
     );
     // Usar datos completos en lugar del webhook
   }
   ```

   **Verificar Configuración de Shopify:**

   Si los webhooks siguen sin traer datos:

   1. **Settings → Checkout → Customer contact:**
      - ✅ "Customers can only check out using email"
      - ✅ Email/phone marcado como obligatorio

   2. **Settings → Checkout → Shipping address:**
      - ✅ "Require a shipping address"

   3. **Settings → Checkout → Form options:**
      - ✅ "Phone number" requerido
      - ✅ "Company name" si necesario

   **Fallbacks Adicionales:**

   El código también busca datos en:
   - `note_attributes` - Campos personalizados del checkout
   - `tags` - Algunos checkouts guardan el nombre en tags
   - Shopify Orders API - Fetch completo del pedido

## Notas Importantes

1. **No requerimos que los clientes se registren**: La solución funciona con guest checkout
2. **No necesitamos Customer API**: Los webhooks de pedidos contienen todos los datos necesarios
3. **Compatible con todos los planes de Shopify**: Funciona en Basic, Shopify, Advanced y Plus
4. **HMAC Verification**: Custom Apps usan firma hexadecimal, OAuth Apps usan base64
