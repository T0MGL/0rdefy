# Guía: Conectar Ordefy con Shopify usando Custom App

Esta guía te permite conectar tiendas reales de Shopify a Ordefy sin necesitar que tu app pública esté aprobada.

## ¿Cuándo usar Custom App?

- Tu app de Shopify todavía está en revisión
- Necesitas conectar tiendas de clientes inmediatamente
- Quieres probar en tiendas de producción (no solo dev stores)

## Paso 1: Crear Custom App en Shopify

### 1.1 Acceder a la configuración

En el Admin de Shopify del cliente:
1. Ve a **Settings** (Configuración)
2. Click en **Apps and sales channels** (Apps y canales de venta)
3. Click en **Develop apps** (Desarrollar apps)
4. Click **Allow custom app development** (primera vez)
5. Click **Create an app**

### 1.2 Configurar permisos

Nombre de la app: `Ordefy Integration`

Click en **Configure Admin API scopes** y selecciona:

**Products (Productos):**
- ✅ `read_products`
- ✅ `write_products`
- ✅ `read_inventory`
- ✅ `write_inventory`

**Orders (Pedidos):**
- ✅ `read_orders`
- ✅ `write_orders`

**Customers (Clientes):**
- ✅ `read_customers`
- ✅ `write_customers`

**Locations (Ubicaciones):**
- ✅ `read_locations`

**Otros:**
- ✅ `read_merchant_managed_fulfillment_orders` (opcional, para fulfillment)

### 1.3 Instalar y obtener credenciales

1. Click **Install app** (confirmar)
2. En la pestaña **API credentials**:
   - 📝 Copia el **Admin API access token** (⚠️ solo se muestra una vez!)
   - 📝 Copia el **API key**
   - 📝 Copia el **API secret key**

**⚠️ IMPORTANTE:** Guarda estas credenciales de forma segura. El access token solo se muestra una vez.

## Paso 2: Configurar Webhooks Manualmente

### 2.1 Crear webhooks en Shopify

Ve a **Settings → Notifications → Webhooks** y crea los siguientes:

| Event | URL | Format |
|-------|-----|--------|
| Order creation | `https://api.ordefy.io/api/shopify/webhook/orders-create` | JSON |
| Order updated | `https://api.ordefy.io/api/shopify/webhook/orders-updated` | JSON |
| Product delete | `https://api.ordefy.io/api/shopify/webhook/products-delete` | JSON |

**Configuración de cada webhook:**
- Format: **JSON**
- API Version: **2024-10** (o la más reciente estable)

### 2.2 Nota sobre HMAC

Ordefy usa `SHOPIFY_API_SECRET` del archivo `.env` para verificar webhooks. Este valor **DEBE** coincidir con el **API secret key** de tu Custom App.

## Paso 3: Conectar en Ordefy

### 3.1 Formato de datos

Prepara un JSON con las credenciales:

```json
{
  "shop_domain": "tu-tienda.myshopify.com",
  "access_token": "shpat_xxxxxxxxxxxxxxxxxxxxx",
  "api_key": "xxxxxxxxxxxxxxxx",
  "api_secret_key": "shpss_xxxxxxxxxxxxxxxx",
  "webhook_signature": "shpss_xxxxxxxxxxxxxxxx",
  "import_products": true,
  "import_customers": true,
  "import_orders": false,
  "import_historical_orders": false
}
```

**Notas importantes:**
- `shop_domain`: El dominio completo (ej: `mi-tienda.myshopify.com`)
- `access_token`: El Admin API access token (empieza con `shpat_`)
- `webhook_signature`: Debe ser el **mismo valor** que `api_secret_key`
- `import_orders`: Dejar en `false` (los pedidos se cargan automáticamente vía webhooks)
- `import_historical_orders`: Dejar en `false` (solo para tiendas nuevas sin historial)

### 3.2 Hacer el request

**Opción A: Desde el frontend de Ordefy**

1. Ir a **Integraciones**
2. Click en **Configurar Shopify**
3. Llenar el formulario con las credenciales
4. Click **Conectar**

**Opción B: Usando cURL (para testing)**

```bash
curl -X POST https://api.ordefy.io/api/shopify/configure \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TU_AUTH_TOKEN" \
  -H "X-Store-ID: TU_STORE_ID" \
  -d '{
    "shop_domain": "tu-tienda.myshopify.com",
    "access_token": "shpat_xxxxxxxxxxxxxxxxxxxxx",
    "api_key": "xxxxxxxxxxxxxxxx",
    "api_secret_key": "shpss_xxxxxxxxxxxxxxxx",
    "webhook_signature": "shpss_xxxxxxxxxxxxxxxx",
    "import_products": true,
    "import_customers": true,
    "import_orders": false,
    "import_historical_orders": false
  }'
```

**Opción C: Desde Postman/Insomnia**

1. Método: `POST`
2. URL: `https://api.ordefy.io/api/shopify/configure`
3. Headers:
   ```
   Content-Type: application/json
   Authorization: Bearer TU_AUTH_TOKEN
   X-Store-ID: TU_STORE_ID
   ```
4. Body (JSON): [ver arriba]

## Paso 4: Verificar la conexión

### 4.1 Verificar respuesta del API

Deberías recibir una respuesta como:

```json
{
  "success": true,
  "integration_id": "uuid-de-la-integracion",
  "job_ids": ["uuid-job-1", "uuid-job-2"],
  "webhooks": {
    "registered": ["orders/create", "orders/updated", "products/delete"],
    "skipped": [],
    "errors": []
  },
  "message": "Integración configurada exitosamente. 3 webhooks registrados. Importación iniciada en segundo plano."
}
```

### 4.2 Verificar importación

1. En Ordefy, ve a **Productos** → deberías ver los productos de Shopify sincronizándose
2. Ve a **Clientes** → deberías ver los clientes importándose
3. Crea un pedido de prueba en Shopify → debería aparecer automáticamente en Ordefy

### 4.3 Verificar webhooks

Endpoint para verificar webhooks:

```bash
curl -X GET https://api.ordefy.io/api/shopify/webhooks/verify \
  -H "Authorization: Bearer TU_AUTH_TOKEN" \
  -H "X-Store-ID: TU_STORE_ID"
```

Respuesta esperada:
```json
{
  "success": true,
  "valid": true,
  "missing": [],
  "misconfigured": [],
  "message": "Todos los webhooks están correctamente configurados"
}
```

## Paso 5: Testing

### 5.1 Test de productos

1. Crear un producto en Shopify
2. Verificar que aparece en Ordefy (puede tomar 1-2 minutos)
3. Editar el producto en Ordefy (precio, stock)
4. Verificar que se sincroniza a Shopify automáticamente

### 5.2 Test de pedidos

1. Crear un pedido en Shopify
2. Verificar que aparece en Ordefy inmediatamente (vía webhook)
3. Los line items deben estar correctamente mapeados con los productos locales

### 5.3 Test de inventario

1. Cambiar stock de un producto en Ordefy
2. Verificar que el cambio se refleja en Shopify
3. Recibir mercancía en Ordefy (módulo Merchandise)
4. Verificar que el stock se actualiza en Shopify automáticamente

## Troubleshooting

### Error: "Invalid HMAC signature"

**Causa:** El `SHOPIFY_API_SECRET` en `.env` no coincide con el webhook signature.

**Solución:**
1. Verifica que el valor en `.env` sea exactamente el **API secret key** de tu Custom App
2. Reinicia el servidor backend después de cambiar `.env`
3. Vuelve a registrar los webhooks:

```bash
curl -X POST https://api.ordefy.io/api/shopify/webhooks/setup \
  -H "Authorization: Bearer TU_AUTH_TOKEN" \
  -H "X-Store-ID: TU_STORE_ID"
```

### Error: "Integration not found"

**Causa:** La integración no se guardó correctamente en la base de datos.

**Solución:**
1. Verifica que el POST a `/configure` devuelva `success: true`
2. Verifica que estés usando el `store_id` correcto en el header `X-Store-ID`
3. Consulta la base de datos:

```sql
SELECT * FROM shopify_integrations WHERE store_id = 'TU_STORE_ID';
```

### Los productos no se sincronizan

**Causa:** El producto no tiene `shopify_product_id` o `shopify_variant_id`.

**Solución:**
1. Verifica que el producto tenga ambos campos:

```sql
SELECT id, name, shopify_product_id, shopify_variant_id
FROM products
WHERE store_id = 'TU_STORE_ID';
```

2. Si faltan, re-importa los productos:

```bash
curl -X POST https://api.ordefy.io/api/shopify/manual-sync \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TU_AUTH_TOKEN" \
  -H "X-Store-ID: TU_STORE_ID" \
  -d '{"sync_type": "products"}'
```

### Los webhooks no llegan

**Causa:** Los webhooks pueden estar mal configurados o bloqueados.

**Solución:**
1. Verifica que los webhooks estén registrados en Shopify:
   - Settings → Notifications → Webhooks
2. Verifica que la URL sea correcta: `https://api.ordefy.io/api/shopify/webhook/...`
3. Crea un pedido de prueba y verifica logs del servidor:

```bash
# En el servidor backend
tail -f logs/shopify.log
```

4. Verifica health de webhooks:

```bash
curl -X GET https://api.ordefy.io/api/shopify/webhook-health \
  -H "Authorization: Bearer TU_AUTH_TOKEN" \
  -H "X-Store-ID: TU_STORE_ID"
```

## Variables de entorno requeridas

Asegúrate de tener en tu archivo `.env` del backend:

```bash
# Shopify Integration
SHOPIFY_API_SECRET=shpss_xxxxxxxxxxxxxxxx  # ⚠️ DEBE coincidir con API secret key de Custom App

# Webhook URL base (usado para registro automático de webhooks)
API_BASE_URL=https://api.ordefy.io

# N8N webhook (opcional, para automatizaciones)
N8N_WEBHOOK_URL=https://your-n8n-instance.com/webhook/...
```

## Limitaciones de Custom App vs Public App

| Feature | Custom App | Public App (cuando aprobada) |
|---------|-----------|------------------------------|
| Conexión manual | ✅ Sí | ❌ OAuth automático |
| Tiendas ilimitadas | ✅ Sí (manual c/u) | ✅ Sí (auto) |
| Funcionalidad completa | ✅ Sí | ✅ Sí |
| Listado en App Store | ❌ No | ✅ Sí |
| Setup por cliente | 5-10 min manual | 1 click |
| Distribución | Manual | Automática |

## Checklist de configuración

- [ ] Custom app creada en Shopify
- [ ] Permisos configurados (products, orders, customers, inventory, locations)
- [ ] Credenciales copiadas (access token, API key, API secret)
- [ ] Webhooks creados en Shopify (orders/create, orders/updated, products/delete)
- [ ] `SHOPIFY_API_SECRET` en `.env` coincide con API secret key
- [ ] Servidor backend reiniciado después de cambiar `.env`
- [ ] POST a `/configure` ejecutado con credenciales
- [ ] Productos importándose correctamente
- [ ] Clientes importándose correctamente
- [ ] Webhook de prueba funcionando (crear pedido en Shopify → aparece en Ordefy)
- [ ] Sincronización bidireccional funcionando (editar producto en Ordefy → se actualiza en Shopify)

## Soporte

Si tienes problemas, contacta a soporte técnico con:
1. El `integration_id` de la respuesta del API
2. Los logs del servidor backend (`tail -f logs/shopify.log`)
3. El resultado de `/webhook-health` endpoint
4. Screenshots del error en el frontend de Ordefy

---

**Nota:** Esta guía es para uso interno durante el período de revisión de la app de Shopify. Una vez aprobada la app pública, podrás usar OAuth flow automático.
