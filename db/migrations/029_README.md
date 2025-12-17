# Migración 029: Fix Critical Schema Errors

**Estado:** 🚨 CRÍTICA - Bloqueando inserción de pedidos en producción
**Fecha:** 2025-01-17
**Versión:** 1.0

---

## 📦 Archivos de la Migración

### Ejecutables (Elegir UNO)

1. **`QUICK_FIX_029.sql`** ⚡
   - Fix ultra-rápido (30 segundos)
   - Para emergencias con producción caída
   - Sin validaciones previas
   - **Usar cuando:** Producción CAÍDA ahora mismo

2. **`029_fix_critical_schema.sql`** ✅ RECOMENDADO
   - Migración CONCURRENT (sin bloqueos)
   - Para producción con tráfico activo
   - Indices creados en background
   - **Usar cuando:** Producción activa, sin ventana de mantenimiento

3. **`029_fix_critical_schema_transactional.sql`**
   - Migración con transacción
   - Rollback automático si falla
   - Bloquea tabla ~5 segundos
   - **Usar cuando:** Ventana de mantenimiento disponible

### Utilidades

4. **`verify_schema_before_029.sql`**
   - Diagnóstico pre-migración
   - No modifica nada
   - Detecta duplicados
   - **Ejecutar SIEMPRE antes de migrar**

5. **`cleanup_duplicate_orders.sql`**
   - Elimina pedidos duplicados
   - Modo seguro (ROLLBACK por defecto)
   - Conserva el más reciente
   - **Usar cuando:** verify detecta duplicados

### Documentación

6. **`HOTFIX_029_INSTRUCTIONS.md`**
   - Guía completa paso a paso
   - Testing y verificación
   - Procedimientos de rollback
   - **Leer cuando:** Primera vez ejecutando hotfix

7. **`029_RESUMEN_EJECUTIVO.md`**
   - Resumen ejecutivo (TL;DR)
   - Decisión rápida
   - Checklist mínimo
   - **Leer cuando:** Necesitas referencia rápida

8. **`029_README.md`** (este archivo)
   - Índice de archivos
   - Comandos rápidos
   - FAQ

### Scripts

9. **`scripts/apply-migration-029.js`**
   - Script Node.js para ejecutar migración
   - Confirmación interactiva
   - Logging mejorado
   - **Usar cuando:** Prefieres ejecutar desde Node.js

---

## ⚡ Comandos Rápidos

### Opción 1: Desde psql

```bash
# 1. Verificar estado actual
psql $DATABASE_URL -f db/migrations/verify_schema_before_029.sql

# 2. Ejecutar fix (elegir UNA opción)

# Opción A: EMERGENCIA (producción caída)
psql $DATABASE_URL -f db/migrations/QUICK_FIX_029.sql

# Opción B: Producción activa (SIN downtime)
psql $DATABASE_URL -f db/migrations/029_fix_critical_schema.sql

# Opción C: Con ventana de mantenimiento (más seguro)
psql $DATABASE_URL -f db/migrations/029_fix_critical_schema_transactional.sql
```

### Opción 2: Desde Node.js

```bash
# Verificar
node scripts/apply-migration-029.js --verify-only

# Ejecutar (elegir UNA opción)
node scripts/apply-migration-029.js --quick              # Emergencia
node scripts/apply-migration-029.js --concurrent         # Producción activa
node scripts/apply-migration-029.js --transactional      # Ventana mantenimiento

# Sin confirmación (CI/CD)
AUTO_CONFIRM=true node scripts/apply-migration-029.js --concurrent
```

### Opción 3: Desde Supabase Dashboard

1. Ir a SQL Editor
2. Copiar contenido de `029_fix_critical_schema_transactional.sql`
3. Pegar y ejecutar
4. Verificar output (debe decir "✅ Migración completada")

---

## 🔍 Verificación Post-Migración

```sql
-- Verificar columna id en shopify_webhook_idempotency
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'shopify_webhook_idempotency' AND column_name = 'id';
-- Resultado esperado: id | uuid | NO

-- Verificar índices UNIQUE en orders
SELECT indexname FROM pg_indexes
WHERE tablename = 'orders'
AND indexname IN ('idx_orders_shopify_id', 'idx_orders_shopify_store_unique');
-- Resultado esperado: 2 filas
```

---

## 🧪 Testing Post-Migración

### Test 1: Webhook Idempotency
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
    'test-' || NOW()::TEXT,
    'evt-123',
    'orders/create',
    200,
    NOW() + INTERVAL '1 day'
) RETURNING id;
```
✅ Debe retornar un UUID

### Test 2: Order UPSERT
```sql
-- Primera inserción (INSERT)
INSERT INTO orders (store_id, shopify_order_id, total_price)
VALUES (
    (SELECT id FROM stores LIMIT 1),
    'test-shopify-' || NOW()::TEXT,
    100.00
)
ON CONFLICT (shopify_order_id, store_id)
DO UPDATE SET total_price = EXCLUDED.total_price
RETURNING id, total_price;

-- Segunda inserción con mismo shopify_order_id (UPDATE)
-- Cambiar 'test-shopify-XXXX' por el shopify_order_id del test anterior
INSERT INTO orders (store_id, shopify_order_id, total_price)
VALUES (
    (SELECT id FROM stores LIMIT 1),
    'test-shopify-XXXX',
    200.00
)
ON CONFLICT (shopify_order_id, store_id)
DO UPDATE SET total_price = EXCLUDED.total_price
RETURNING id, total_price;
```
✅ Primera vez: total_price = 100.00
✅ Segunda vez: total_price = 200.00 (UPDATE, no INSERT)

### Test 3: Crear Pedido desde Shopify
1. Ir a Shopify Admin → Orders
2. Crear pedido de prueba
3. Verificar en logs que webhook se procesa sin errores
4. Verificar que pedido aparece en base de datos:
```sql
SELECT id, shopify_order_id, customer_email, created_at
FROM orders
ORDER BY created_at DESC
LIMIT 5;
```

---

## ❓ FAQ

### ¿Cuál versión de migración usar?

| Situación | Usar |
|-----------|------|
| 🔥 Producción caída AHORA | `QUICK_FIX_029.sql` |
| 🚦 Producción con tráfico activo | `029_fix_critical_schema.sql` |
| 🛠️ Tengo ventana de mantenimiento | `029_fix_critical_schema_transactional.sql` |
| 🔍 Solo quiero ver el estado | `verify_schema_before_029.sql` |

### ¿Cuánto tiempo toma?
- **QUICK_FIX:** 30 segundos
- **CONCURRENT:** 1-2 minutos
- **TRANSACTIONAL:** 30 segundos
- **VERIFY:** 10 segundos

### ¿Hay downtime?
- **QUICK_FIX:** ~5 segundos (bloqueo de tabla)
- **CONCURRENT:** 0 segundos (índices en background)
- **TRANSACTIONAL:** ~5 segundos (bloqueo de tabla)

### ¿Qué pasa si ya ejecuté la migración?
Todas las migraciones son **idempotentes**. Puedes ejecutarlas múltiples veces sin problemas.

### ¿Qué pasa si hay duplicados?
1. Ejecutar `verify_schema_before_029.sql`
2. Si detecta duplicados, ejecutar `cleanup_duplicate_orders.sql`
3. Luego ejecutar la migración

### ¿Cómo hago rollback?
```sql
-- Eliminar índices creados
DROP INDEX CONCURRENTLY IF EXISTS idx_orders_shopify_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_orders_shopify_store_unique;

-- Recrear índice simple (no único)
CREATE INDEX IF NOT EXISTS idx_orders_shopify ON orders(shopify_order_id);
```

**IMPORTANTE:** NO eliminar columna `id` de `shopify_webhook_idempotency` - es necesaria.

### ¿Cómo monitoreo que todo funciona?
```bash
# Logs de backend
tail -f logs/backend.log | grep -i "shopify\|webhook"

# Webhooks en última hora
psql $DATABASE_URL -c "
SELECT shopify_topic, COUNT(*) as count
FROM shopify_webhook_idempotency
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY shopify_topic;
"

# Pedidos nuevos
psql $DATABASE_URL -c "
SELECT COUNT(*) as nuevos_pedidos
FROM orders
WHERE created_at > NOW() - INTERVAL '1 hour';
"
```

---

## 🆘 Troubleshooting

### Error: "psql: command not found"
**Solución:**
```bash
# macOS
brew install postgresql

# Ubuntu/Debian
sudo apt-get install postgresql-client

# Verificar
psql --version
```

### Error: "FATAL: password authentication failed"
**Solución:** Verificar `DATABASE_URL`
```bash
echo $DATABASE_URL
# Debe ser: postgresql://user:pass@host:5432/database
```

### Error: "could not create unique index"
**Causa:** Hay pedidos duplicados

**Solución:**
```bash
# 1. Identificar duplicados
psql $DATABASE_URL -f db/migrations/verify_schema_before_029.sql

# 2. Limpiar duplicados
psql $DATABASE_URL -f db/migrations/cleanup_duplicate_orders.sql

# 3. Reintentar migración
```

### Error: "column id already exists"
**Causa:** La migración ya fue ejecutada

**Solución:** No hacer nada. Verificar que todo funciona correctamente:
```bash
node scripts/apply-migration-029.js --verify-only
```

---

## 📊 Cambios Aplicados

### Tabla: `shopify_webhook_idempotency`

**ANTES:**
```sql
CREATE TABLE shopify_webhook_idempotency (
    -- ❌ Sin Primary Key
    idempotency_key VARCHAR(500) NOT NULL UNIQUE,
    ...
);
```

**DESPUÉS:**
```sql
CREATE TABLE shopify_webhook_idempotency (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),  -- ✅ Nuevo
    idempotency_key VARCHAR(500) NOT NULL UNIQUE,
    ...
);
```

### Tabla: `orders`

**ANTES:**
```sql
-- Solo índice simple (no único)
CREATE INDEX idx_orders_shopify ON orders(shopify_order_id);
```

**DESPUÉS:**
```sql
-- Índice UNIQUE simple
CREATE UNIQUE INDEX idx_orders_shopify_id
ON orders(shopify_order_id)
WHERE shopify_order_id IS NOT NULL;

-- Índice UNIQUE compuesto (para UPSERTS)
CREATE UNIQUE INDEX idx_orders_shopify_store_unique
ON orders(shopify_order_id, store_id)
WHERE shopify_order_id IS NOT NULL;
```

---

## 📝 Checklist de Ejecución

```
[ ] 1. Leer esta documentación
[ ] 2. Notificar a equipo (si aplica)
[ ] 3. Hacer backup de base de datos
[ ] 4. Ejecutar verify_schema_before_029.sql
[ ] 5. Si hay duplicados, ejecutar cleanup_duplicate_orders.sql
[ ] 6. Ejecutar migración (elegir versión apropiada)
[ ] 7. Verificar que no hay errores en output
[ ] 8. Ejecutar tests post-migración
[ ] 9. Crear pedido de prueba en Shopify
[ ] 10. Monitorear logs durante 1 hora
[ ] 11. Notificar éxito a equipo
```

---

## 🔗 Enlaces Útiles

- **Guía Completa:** [HOTFIX_029_INSTRUCTIONS.md](HOTFIX_029_INSTRUCTIONS.md)
- **Resumen Ejecutivo:** [029_RESUMEN_EJECUTIVO.md](029_RESUMEN_EJECUTIVO.md)
- **Código Afectado:** [shopify-webhook.service.ts:190](../api/services/shopify-webhook.service.ts#L190)
- **Script Node.js:** [apply-migration-029.js](../scripts/apply-migration-029.js)

---

**Última actualización:** 2025-01-17
**Versión:** 1.0
**Estado:** Listo para producción ✅
