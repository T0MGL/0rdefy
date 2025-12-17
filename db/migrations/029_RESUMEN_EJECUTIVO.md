# 🚨 Hotfix 029: Resumen Ejecutivo

## TL;DR (1 minuto)

**Problema:** Webhooks de Shopify fallan al crear pedidos.
**Causa:** 2 errores de schema en producción.
**Solución:** Ejecutar migración 029.
**Tiempo:** 2-5 minutos.
**Downtime:** 0 segundos (versión CONCURRENT) o 5 segundos (versión transaccional).

---

## Opción 1: Fix Rápido (EMERGENCIA) ⚡

Si producción está CAÍDA y necesitas fix INMEDIATO:

```bash
psql $DATABASE_URL -f db/migrations/QUICK_FIX_029.sql
```

**Tiempo:** 30 segundos
**Riesgo:** Bajo (pero sin validaciones previas)

---

## Opción 2: Fix Seguro (RECOMENDADO) ✅

Si tienes 5 minutos para hacerlo bien:

### Paso 1: Verificar
```bash
psql $DATABASE_URL -f db/migrations/verify_schema_before_029.sql
```

### Paso 2: Migrar (elegir UNA opción)

**Opción A - SIN downtime (producción con tráfico):**
```bash
psql $DATABASE_URL -f db/migrations/029_fix_critical_schema.sql
```

**Opción B - CON transacción (más seguro, ~5seg downtime):**
```bash
psql $DATABASE_URL -f db/migrations/029_fix_critical_schema_transactional.sql
```

### Paso 3: Probar
```bash
# Crear pedido de prueba en Shopify
# Verificar que aparece en tu base de datos
```

---

## Qué Hace la Migración

### Fix 1: `shopify_webhook_idempotency`
```sql
-- Agrega columna id (Primary Key)
ALTER TABLE shopify_webhook_idempotency
ADD COLUMN id UUID PRIMARY KEY DEFAULT gen_random_uuid();
```

**Por qué:** El código intenta insertar con `RETURNING id` pero la columna no existe.

---

### Fix 2: `orders`
```sql
-- Crea índice UNIQUE para UPSERTS de Shopify
CREATE UNIQUE INDEX idx_orders_shopify_store_unique
ON orders(shopify_order_id, store_id)
WHERE shopify_order_id IS NOT NULL;
```

**Por qué:** El código usa `ON CONFLICT (shopify_order_id, store_id)` pero falta el constraint UNIQUE.

---

## Errores Que Corrige

### Error 1
```
column shopify_webhook_idempotency.id does not exist
```

**Ubicación:** [shopify-webhook.service.ts:190-194](api/services/shopify-webhook.service.ts#L190-L194)

**Código que falla:**
```typescript
const { data: newOrder, error: insertError } = await this.supabaseAdmin
  .from('orders')
  .insert(orderData)
  .select('id')  // ❌ Esta columna no existe en la tabla
  .single();
```

---

### Error 2
```
there is no unique or exclusion constraint matching the ON CONFLICT specification
```

**Ubicación:** [shopify-webhook.service.ts:429-436](api/services/shopify-webhook.service.ts#L429-L436)

**Código que falla:**
```typescript
const { data: updatedOrder } = await this.supabaseAdmin
  .from('orders')
  .upsert(fullOrderData, {
    onConflict: 'shopify_order_id,store_id',  // ❌ No hay índice UNIQUE
    ignoreDuplicates: false
  })
  .select('id')
  .single();
```

---

## Impacto

### Antes (Estado Actual - ROTO 🔴)
- ❌ Webhooks de Shopify fallan
- ❌ Pedidos nuevos NO se crean
- ❌ Actualizaciones de pedidos NO se procesan
- ❌ TODAS las tiendas afectadas

### Después (Post-Migración - FUNCIONAL ✅)
- ✅ Webhooks procesan correctamente
- ✅ Pedidos se crean automáticamente
- ✅ Actualizaciones se sincronizan
- ✅ Todas las tiendas operativas

---

## Testing Rápido

Después de migrar, ejecutar:

```sql
-- Test 1: Insertar en shopify_webhook_idempotency
INSERT INTO shopify_webhook_idempotency (
    integration_id,
    idempotency_key,
    shopify_event_id,
    shopify_topic,
    response_status,
    expires_at
) VALUES (
    (SELECT id FROM shopify_integrations LIMIT 1),
    'test-' || NOW()::TEXT,
    'evt-123',
    'orders/create',
    200,
    NOW() + INTERVAL '1 day'
) RETURNING id;  -- Debe retornar UUID
```

```sql
-- Test 2: UPSERT en orders
INSERT INTO orders (store_id, shopify_order_id, total_price)
VALUES (
    (SELECT id FROM stores LIMIT 1),
    'shopify-test-' || NOW()::TEXT,
    100.00
)
ON CONFLICT (shopify_order_id, store_id)
DO UPDATE SET total_price = 200.00
RETURNING id;  -- No debe fallar
```

---

## Archivos Creados

| Archivo | Propósito | Cuándo Usar |
|---------|-----------|-------------|
| `QUICK_FIX_029.sql` | Fix ultra-rápido | Emergencia (producción caída) |
| `verify_schema_before_029.sql` | Diagnóstico | Antes de migrar (recomendado) |
| `029_fix_critical_schema.sql` | Migración CONCURRENT | Producción con tráfico |
| `029_fix_critical_schema_transactional.sql` | Migración con transacción | Ventana de mantenimiento |
| `cleanup_duplicate_orders.sql` | Limpieza de duplicados | Si verify detecta duplicados |
| `HOTFIX_029_INSTRUCTIONS.md` | Guía completa | Documentación detallada |
| `029_RESUMEN_EJECUTIVO.md` | Este archivo | Referencia rápida |

---

## Checklist Mínimo

```
[ ] Ejecutar migración (QUICK_FIX_029.sql o 029_fix_critical_schema.sql)
[ ] Verificar que no hay errores en output
[ ] Crear pedido de prueba en Shopify
[ ] Confirmar que aparece en base de datos
[ ] Monitorear logs durante 1 hora
```

---

## Rollback

Si algo sale mal:

```sql
-- Eliminar índices
DROP INDEX IF EXISTS idx_orders_shopify_id;
DROP INDEX IF EXISTS idx_orders_shopify_store_unique;

-- Recrear índice simple (no único)
CREATE INDEX idx_orders_shopify ON orders(shopify_order_id);
```

**Nota:** NO eliminar columna `id` de `shopify_webhook_idempotency` - es necesaria.

---

## Soporte

**Logs a revisar:**
```bash
# Backend
tail -f logs/backend.log | grep -i "shopify\|webhook"

# PostgreSQL
psql $DATABASE_URL -c "SELECT * FROM pg_stat_activity WHERE state = 'active';"
```

**Queries útiles:**
```sql
-- Webhooks en última hora
SELECT shopify_topic, COUNT(*) FROM shopify_webhook_idempotency
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY shopify_topic;

-- Pedidos nuevos
SELECT COUNT(*) FROM orders
WHERE created_at > NOW() - INTERVAL '1 hour';
```

---

## Tiempo Estimado de Ejecución

| Tarea | Tiempo |
|-------|--------|
| Verificación pre-migración | 30 seg |
| Migración CONCURRENT | 1-2 min |
| Migración transaccional | 30 seg |
| Testing post-migración | 2 min |
| **TOTAL** | **3-5 min** |

---

## Decisión Rápida

```
¿Producción CAÍDA ahora?
├─ SÍ → Ejecutar QUICK_FIX_029.sql
└─ NO → Seguir pasos en HOTFIX_029_INSTRUCTIONS.md

¿Hay mucho tráfico en producción?
├─ SÍ → Usar 029_fix_critical_schema.sql (CONCURRENT)
└─ NO → Usar 029_fix_critical_schema_transactional.sql

¿Necesitas más detalles?
└─ Leer HOTFIX_029_INSTRUCTIONS.md
```

---

**Última actualización:** 2025-01-17
**Responsable:** Bright Idea Engineering
**Aprobado para producción:** ✅ SÍ
