# Fix: Shopify Manual Integration - user_id y shop faltantes

## Problema

Las integraciones manuales de Shopify (vía Custom App) no estaban guardando los campos `user_id` y `shop` en la tabla `shopify_integrations`. Esto causaba que:

1. **Los webhooks no funcionaran correctamente** - No se podían procesar órdenes nuevas
2. **Faltaba información de tracking** - No se sabía qué usuario configuró la integración
3. **Problemas de auditoría** - No se podía rastrear quién hizo qué

## Solución

### 1. Migración de Base de Datos

**Archivo:** `db/migrations/029_fix_shopify_integrations_user_id.sql`

Esta migración:
- Agrega columna `user_id` si no existe
- Agrega columna `shop` si no existe
- Puebla `user_id` desde la tabla `user_stores` (toma el primer admin de cada store)
- Puebla `shop` extrayendo el nombre de `shop_domain` (ej: `tienda.myshopify.com` → `tienda`)
- Crea índices para mejor performance

### 2. Código Actualizado

**Archivo:** `api/routes/shopify.ts`

Cambios en el endpoint `POST /api/shopify/configure`:

```typescript
// ANTES (faltaban user_id y shop)
.insert({
  store_id: storeId,
  shop_domain: config.shop_domain,
  api_key: config.api_key,
  // ...
})

// DESPUÉS (incluye user_id y shop)
.insert({
  store_id: storeId,
  user_id: userId,  // ✅ NUEVO
  shop_domain: config.shop_domain,
  shop: config.shop_domain.replace('.myshopify.com', ''),  // ✅ NUEVO
  api_key: config.api_key,
  // ...
})
```

## Aplicar el Fix

### Opción 1: Script Automático (Recomendado)

```bash
# 1. Aplicar migración de base de datos
export DATABASE_URL="tu_connection_string"
node scripts/fix-shopify-user-id.js

# 2. Reiniciar backend para cargar código actualizado
pm2 restart backend
# o
npm run dev
```

### Opción 2: Manual via psql

```bash
# Conectarse a la base de datos
psql "tu_connection_string"

# Ejecutar la migración
\i db/migrations/029_fix_shopify_integrations_user_id.sql

# Verificar resultados
SELECT
  id,
  store_id,
  user_id,
  shop_domain,
  shop
FROM shopify_integrations;
```

## Verificación

### 1. Verificar que la migración se aplicó correctamente

```sql
-- Todas las integraciones deben tener user_id y shop
SELECT
  COUNT(*) as total,
  COUNT(user_id) as con_user_id,
  COUNT(shop) as con_shop
FROM shopify_integrations;

-- Resultado esperado:
-- total | con_user_id | con_shop
--   2   |      2      |    2
```

### 2. Probar nueva conexión manual

1. Ir a Integraciones en el dashboard
2. Conectar Shopify vía método manual
3. Verificar en la base de datos:

```sql
SELECT
  user_id,
  shop,
  shop_domain,
  created_at
FROM shopify_integrations
ORDER BY created_at DESC
LIMIT 1;
```

Debe mostrar `user_id` y `shop` correctamente poblados.

### 3. Probar webhooks

1. Crear un pedido de prueba en Shopify
2. Verificar que llegue a la base de datos:

```sql
SELECT
  id,
  shopify_order_id,
  shopify_order_number,
  customer_name,
  total_price,
  status,
  created_at
FROM orders
WHERE shop_domain = 'tu-tienda.myshopify.com'
ORDER BY created_at DESC
LIMIT 5;
```

3. Verificar logs del backend:
```bash
# Buscar estos mensajes en los logs:
✅ [WEBHOOK] HMAC validated (hex - Custom App) for tu-tienda.myshopify.com
📥 [ORDER-CREATE] New order from tu-tienda.myshopify.com: #1234
✅ [ORDER-CREATE] Order saved: #1234
```

## Campos de shopify_integrations

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `user_id` | UUID | ✅ | Usuario que configuró la integración |
| `shop` | VARCHAR | ✅ | Nombre corto de la tienda (sin .myshopify.com) |
| `shop_domain` | VARCHAR | ✅ | Dominio completo (tienda.myshopify.com) |
| `store_id` | UUID | ✅ | ID de la tienda en Ordefy |
| `api_key` | VARCHAR | ⚠️ | API Key (solo Custom Apps) |
| `api_secret_key` | VARCHAR | ⚠️ | API Secret (solo Custom Apps) |
| `access_token` | TEXT | ✅ | Token de acceso |
| `scope` | TEXT | ⚠️ | Scopes (solo OAuth Apps) |

**Nota:** Los campos marcados con ⚠️ son opcionales dependiendo del tipo de integración (OAuth vs Custom App).

## Rollback (si algo sale mal)

Si necesitas revertir los cambios:

```sql
-- 1. Eliminar índices creados
DROP INDEX IF EXISTS idx_shopify_integrations_user_id;
DROP INDEX IF EXISTS idx_shopify_integrations_shop;

-- 2. Limpiar campos (opcional, solo si hay problemas)
UPDATE shopify_integrations SET user_id = NULL, shop = NULL;

-- 3. Reiniciar backend con código anterior
git checkout HEAD~1 api/routes/shopify.ts
pm2 restart backend
```

## Impacto

### Antes del fix:
- ❌ Integraciones manuales sin `user_id` ni `shop`
- ❌ Webhooks no funcionan o fallan silenciosamente
- ❌ No se puede rastrear quién configuró la integración

### Después del fix:
- ✅ Todas las integraciones tienen `user_id` y `shop`
- ✅ Webhooks funcionan correctamente
- ✅ Auditoría completa de integraciones
- ✅ Mejor debugging y troubleshooting

## Testing

Script de prueba rápida:

```bash
# Test completo de integración manual
node scripts/test-shopify-manual-integration.js
```

Este script:
1. Verifica que la migración se aplicó
2. Crea una integración de prueba
3. Simula un webhook
4. Verifica que el pedido se guarde correctamente
5. Limpia los datos de prueba

## Notas Adicionales

- Esta migración es **idempotente** - puede ejecutarse múltiples veces sin problemas
- No afecta las integraciones OAuth (ya tenían estos campos)
- Es compatible con todas las versiones de PostgreSQL 12+
- Se ejecuta sin bloquear la tabla (excepto por microsegundos)

## Soporte

Si encuentras problemas:

1. Verificar logs del backend: `pm2 logs backend`
2. Verificar que la migración se aplicó: `psql -c "SELECT * FROM shopify_integrations"`
3. Verificar que el backend tiene el código actualizado: `git log -1 api/routes/shopify.ts`
4. Contactar soporte con los logs y el error específico
