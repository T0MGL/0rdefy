# 🚨 HOTFIX 029: Corrección Crítica de Schema en Producción

**Urgencia:** CRÍTICA
**Impacto:** Bloqueando inserción de pedidos de Shopify en TODAS las tiendas
**Fecha:** 2025-01-17
**Autor:** Bright Idea Engineering

---

## 📋 Resumen del Problema

Dos errores críticos están bloqueando la creación de pedidos desde Shopify:

1. **`shopify_webhook_idempotency.id` no existe**
   - Error: `column shopify_webhook_idempotency.id does not exist`
   - Causa: Tabla creada sin columna `id` (Primary Key)
   - Impacto: Webhooks de Shopify no pueden registrar idempotencia

2. **Falta índice UNIQUE en `orders.shopify_order_id`**
   - Error: `there is no unique or exclusion constraint matching the ON CONFLICT specification`
   - Causa: UPSERT requiere índice UNIQUE que no existe
   - Impacto: No se pueden crear/actualizar pedidos desde webhooks

---

## 🔍 Paso 1: Verificar Estado Actual

**Antes de ejecutar cualquier migración**, verifica el estado de tu base de datos:

```bash
psql $DATABASE_URL -f db/migrations/verify_schema_before_029.sql
```

Este script **NO modifica nada**, solo inspecciona:
- ✅ Existencia de columna `id` en `shopify_webhook_idempotency`
- ✅ Existencia de índices UNIQUE en `orders`
- ✅ Detección de pedidos duplicados
- ✅ Estructura actual de tablas

**Output esperado:**
```
================================================
   DIAGNÓSTICO PRE-MIGRACIÓN 029
================================================

1️⃣  TABLA: shopify_webhook_idempotency
────────────────────────────────────────────────
Columna "id" existe: ❌ NO (SERÁ CREADA)
...

2️⃣  TABLA: orders (índices UNIQUE)
────────────────────────────────────────────────
Índice UNIQUE compuesto: ❌ FALTA (SERÁ CREADO)
Duplicados detectados: 0
...
```

---

## 🧹 Paso 2: Limpiar Duplicados (Si Existen)

**⚠️ SOLO si el paso anterior detectó duplicados:**

```bash
# Primero ejecutar en modo inspección (no elimina nada)
psql $DATABASE_URL -f db/migrations/cleanup_duplicate_orders.sql
```

Este script mostrará los duplicados detectados. Si decides eliminarlos:

1. **Hacer backup:**
   ```bash
   pg_dump $DATABASE_URL -t orders > backup_orders_$(date +%Y%m%d_%H%M%S).sql
   ```

2. **Editar el script:**
   - Abrir `cleanup_duplicate_orders.sql`
   - Descomentar la línea `DELETE FROM orders...` (buscar `PASO 3`)
   - Cambiar `ROLLBACK;` por `COMMIT;` al final

3. **Ejecutar limpieza:**
   ```bash
   psql $DATABASE_URL -f db/migrations/cleanup_duplicate_orders.sql
   ```

4. **Verificar:**
   ```sql
   SELECT shopify_order_id, store_id, COUNT(*)
   FROM orders
   WHERE shopify_order_id IS NOT NULL
   GROUP BY shopify_order_id, store_id
   HAVING COUNT(*) > 1;
   -- Debe retornar 0 filas
   ```

---

## 🚀 Paso 3: Ejecutar Migración

Elige UNA de las dos versiones:

### Opción A: Versión CONCURRENTE (Recomendada para Producción)

**Ventajas:**
- ✅ No bloquea la tabla `orders` (tráfico continúa)
- ✅ Índices se crean en background
- ✅ Mínimo impacto en usuarios

**Desventajas:**
- ❌ No puede ejecutarse dentro de transacción
- ❌ Si falla, puede dejar índices parciales (se auto-limpian)

```bash
psql $DATABASE_URL -f db/migrations/029_fix_critical_schema.sql
```

---

### Opción B: Versión TRANSACCIONAL (Más Segura)

**Ventajas:**
- ✅ Rollback automático si algo falla
- ✅ Ejecución atómica (todo o nada)
- ✅ Más predecible

**Desventajas:**
- ❌ Bloquea brevemente la tabla `orders` (2-5 segundos)
- ❌ Requiere ventana de mantenimiento

```bash
psql $DATABASE_URL -f db/migrations/029_fix_critical_schema_transactional.sql
```

**⚠️ IMPORTANTE:** Si hay mucho tráfico en producción, usar **Opción A**.

---

## ✅ Paso 4: Verificar Migración Exitosa

Después de ejecutar la migración, verificar:

```sql
-- 1. Verificar columna id
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'shopify_webhook_idempotency'
AND column_name = 'id';
-- Debe retornar: id | uuid | NO

-- 2. Verificar índice UNIQUE simple
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'orders'
AND indexname = 'idx_orders_shopify_id';
-- Debe retornar 1 fila

-- 3. Verificar índice UNIQUE compuesto
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'orders'
AND indexname = 'idx_orders_shopify_store_unique';
-- Debe retornar 1 fila
```

---

## 🧪 Paso 5: Testing Post-Migración

### Test 1: Inserción en `shopify_webhook_idempotency`

```sql
INSERT INTO shopify_webhook_idempotency (
    integration_id,
    idempotency_key,
    shopify_event_id,
    shopify_topic,
    response_status,
    expires_at
) VALUES (
    (SELECT id FROM shopify_integrations LIMIT 1),
    'test-key-' || NOW()::TEXT,
    'test-event-123',
    'orders/create',
    200,
    NOW() + INTERVAL '24 hours'
) RETURNING id;
```

**Resultado esperado:** Debe retornar un UUID.

---

### Test 2: UPSERT en `orders`

```sql
-- Primera inserción
INSERT INTO orders (
    store_id,
    shopify_order_id,
    customer_email,
    total_price
) VALUES (
    (SELECT id FROM stores LIMIT 1),
    'test-shopify-order-' || NOW()::TEXT,
    'test@example.com',
    100.00
)
ON CONFLICT (shopify_order_id, store_id)
DO UPDATE SET total_price = EXCLUDED.total_price
RETURNING id, shopify_order_id;

-- Segunda inserción (mismo shopify_order_id - debe actualizar)
INSERT INTO orders (
    store_id,
    shopify_order_id,
    customer_email,
    total_price
) VALUES (
    (SELECT id FROM stores LIMIT 1),
    'test-shopify-order-XXXX',  -- Usar el mismo shopify_order_id del test anterior
    'test@example.com',
    200.00
)
ON CONFLICT (shopify_order_id, store_id)
DO UPDATE SET total_price = EXCLUDED.total_price
RETURNING id, shopify_order_id;
```

**Resultado esperado:**
- Primera vez: INSERT (crea nuevo pedido)
- Segunda vez: UPDATE (actualiza total_price a 200.00)
- NO debe lanzar error de constraint

---

### Test 3: Webhook Real de Shopify

Desde el admin de Shopify:

1. Crear un pedido de prueba
2. Verificar en logs de backend que el webhook se procesa sin errores
3. Confirmar que el pedido aparece en la tabla `orders`

```sql
SELECT id, shopify_order_id, customer_email, total_price, created_at
FROM orders
ORDER BY created_at DESC
LIMIT 5;
```

---

## 📊 Monitoreo Post-Migración

Monitorear estos logs durante las próximas 2-4 horas:

```bash
# Logs de backend (webhooks)
tail -f logs/backend.log | grep -i "shopify\|webhook\|order"

# Errores de base de datos
psql $DATABASE_URL -c "SELECT * FROM pg_stat_activity WHERE state = 'active';"
```

Queries útiles:

```sql
-- Webhooks procesados en última hora
SELECT
    shopify_topic,
    response_status,
    COUNT(*) as count
FROM shopify_webhook_idempotency
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY shopify_topic, response_status
ORDER BY count DESC;

-- Pedidos creados en última hora
SELECT
    COUNT(*) as total,
    COUNT(CASE WHEN shopify_order_id IS NOT NULL THEN 1 END) as from_shopify
FROM orders
WHERE created_at > NOW() - INTERVAL '1 hour';
```

---

## 🔄 Rollback (En Caso de Emergencia)

Si la migración causa problemas críticos:

### Rollback de índices en `orders`

```sql
BEGIN;

-- Eliminar índices creados
DROP INDEX CONCURRENTLY IF EXISTS idx_orders_shopify_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_orders_shopify_store_unique;

-- Recrear índice simple (no único)
CREATE INDEX IF NOT EXISTS idx_orders_shopify ON orders(shopify_order_id);

COMMIT;
```

### Rollback de columna `id` en `shopify_webhook_idempotency`

**⚠️ NO RECOMENDADO** - Esta columna debería existir desde el principio.

Si absolutamente necesario:

```sql
BEGIN;

-- Eliminar Primary Key
ALTER TABLE shopify_webhook_idempotency
DROP CONSTRAINT IF EXISTS shopify_webhook_idempotency_pkey CASCADE;

-- Eliminar columna
ALTER TABLE shopify_webhook_idempotency
DROP COLUMN IF EXISTS id;

COMMIT;
```

---

## 📝 Checklist de Ejecución

Copiar y marcar al completar:

```
[ ] 1. Notificar a equipo (ventana de mantenimiento si necesario)
[ ] 2. Hacer backup completo de base de datos
[ ] 3. Ejecutar verify_schema_before_029.sql
[ ] 4. Si hay duplicados, ejecutar cleanup_duplicate_orders.sql
[ ] 5. Ejecutar migración (opción A o B)
[ ] 6. Verificar columna id existe en shopify_webhook_idempotency
[ ] 7. Verificar índices UNIQUE en orders
[ ] 8. Test 1: Inserción webhook idempotency
[ ] 9. Test 2: UPSERT en orders
[ ] 10. Test 3: Crear pedido de prueba en Shopify
[ ] 11. Monitorear logs durante 2 horas
[ ] 12. Notificar éxito a equipo
```

---

## 🆘 Soporte

**Si encuentras problemas:**

1. **NO ejecutar más scripts** - detener inmediatamente
2. Capturar logs completos:
   ```bash
   psql $DATABASE_URL -c "\d shopify_webhook_idempotency" > debug_webhook_table.txt
   psql $DATABASE_URL -c "\d orders" > debug_orders_table.txt
   psql $DATABASE_URL -c "SELECT * FROM pg_indexes WHERE tablename = 'orders';" > debug_indexes.txt
   ```
3. Revisar error específico en logs de PostgreSQL
4. Consultar con DBA o equipo de backend

---

## 📚 Archivos Relacionados

- `verify_schema_before_029.sql` - Verificación pre-migración
- `cleanup_duplicate_orders.sql` - Limpieza de duplicados
- `029_fix_critical_schema.sql` - Migración CONCURRENT
- `029_fix_critical_schema_transactional.sql` - Migración TRANSACCIONAL
- `HOTFIX_029_INSTRUCTIONS.md` - Este archivo

---

## ✨ Cambios Aplicados por la Migración

### shopify_webhook_idempotency
```sql
-- ANTES
CREATE TABLE shopify_webhook_idempotency (
    idempotency_key VARCHAR(500) NOT NULL UNIQUE,  -- Sin Primary Key
    ...
);

-- DESPUÉS
CREATE TABLE shopify_webhook_idempotency (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- ✅ Nuevo
    idempotency_key VARCHAR(500) NOT NULL UNIQUE,
    ...
);
```

### orders
```sql
-- ANTES
-- Solo índice simple no-único
CREATE INDEX idx_orders_shopify ON orders(shopify_order_id);

-- DESPUÉS
-- Índice UNIQUE simple (para queries rápidos)
CREATE UNIQUE INDEX idx_orders_shopify_id
ON orders(shopify_order_id)
WHERE shopify_order_id IS NOT NULL;

-- Índice UNIQUE compuesto (para UPSERTS de Shopify)
CREATE UNIQUE INDEX idx_orders_shopify_store_unique
ON orders(shopify_order_id, store_id)
WHERE shopify_order_id IS NOT NULL;
```

---

**Ejecutado por:** _________________
**Fecha:** _________________
**Resultado:** ☐ Éxito  ☐ Fallo (ver notas)
**Notas:** _________________
