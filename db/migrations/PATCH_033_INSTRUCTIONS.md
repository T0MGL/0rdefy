# MIGRATION 033 - Instrucciones de Aplicación

**Fecha:** 2025-12-30
**Propósito:** Aplicar migraciones 026, 030, 031, 032 que faltaban en MASTER migration

---

## 📋 Resumen de Cambios

### ✅ Archivos Creados/Modificados:

1. **`033_patch_missing_migrations.sql`** (NUEVO)
   - Script de parche para aplicar en producción
   - Agrega columnas faltantes: `order_number`, `customer_name`
   - Crea función `generate_order_number()` y su trigger
   - Backfill de datos existentes
   - Verificación automática post-migración

2. **`000_MASTER_MIGRATION.sql`** (ACTUALIZADO)
   - Agregadas columnas: `order_number`, `customer_name` (líneas 320-321)
   - Agregados índices: `idx_orders_order_status_url`, `idx_orders_shopify_order_name`, `idx_orders_payment_gateway` (líneas 422-424)
   - Agregada función `generate_order_number()` (líneas 1279-1303)
   - Agregado trigger `trigger_generate_order_number` (líneas 2440-2443)

---

## 🚀 Instrucciones de Aplicación en Producción

### Opción A: Aplicación Manual (Recomendada)

```bash
# 1. Conectar a la base de datos de producción
psql -h vmi2873172.contaboserver.net -U postgres -d ordefy_prod

# 2. Ejecutar el script de parche
\i /ruta/a/033_patch_missing_migrations.sql

# 3. Verificar resultados
# El script mostrará un reporte de verificación al final
```

### Opción B: Desde Node.js

```bash
# Desde el directorio del proyecto
node scripts/apply-migration-033.js
```

---

## 🔍 Qué Hace el Script de Parche

### 1. Agregar Columnas a `orders`:
```sql
- order_number VARCHAR(100)     -- Auto-generado: "ORD-YYYYMMDD-XXXXXX" o shopify_order_number
- customer_name VARCHAR(255)    -- Auto-generado: "first_name last_name" o email
- order_status_url TEXT         -- URL de tracking de Shopify
- processed_at TIMESTAMP        -- Fecha de procesamiento en Shopify
- tags TEXT                     -- Tags de Shopify (comma-separated)
```

### 2. Crear Índices:
- `idx_orders_order_status_url` - Búsqueda rápida por URL de tracking
- `idx_orders_processed_at` - Filtrado por fecha de procesamiento
- `idx_orders_tags` - Búsqueda full-text en tags (GIN index)
- `idx_orders_payment_gateway` - Analytics por método de pago
- `idx_orders_shopify_order_name` - Búsqueda por nombre de orden Shopify

### 3. Crear Función y Trigger:
- **Función:** `generate_order_number()`
  - Auto-genera `order_number` si es NULL
  - Auto-genera `customer_name` si es NULL

- **Trigger:** `trigger_generate_order_number`
  - Se ejecuta BEFORE INSERT en tabla `orders`
  - Garantiza que toda orden nueva tenga order_number y customer_name

### 4. Backfill de Datos Existentes:
- Actualiza `order_number` en órdenes existentes que no lo tengan
- Actualiza `customer_name` en órdenes existentes que no lo tengan
- Actualiza `shopify_order_name` desde `shopify_order_number` donde aplique

---

## ✅ Verificación Post-Migración

El script incluye verificación automática que mostrará:

```
============================================
MIGRATION 033 - VERIFICATION RESULTS
============================================

Columns:
  ✓ order_number: true
  ✓ customer_name: true
  ✓ order_status_url: true
  ✓ processed_at: true
  ✓ tags: true

Functions & Triggers:
  ✓ generate_order_number(): true
  ✓ trigger_generate_order_number: true

Data Quality:
  ✓ Orders without order_number: 0
  ✓ Orders without customer_name: 0

============================================
✅ MIGRATION 033 COMPLETED SUCCESSFULLY
============================================
```

### Verificación Manual Adicional:

```sql
-- 1. Verificar columnas
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'orders'
  AND column_name IN ('order_number', 'customer_name', 'order_status_url', 'processed_at', 'tags')
ORDER BY column_name;

-- 2. Verificar índices
SELECT indexname
FROM pg_indexes
WHERE tablename = 'orders'
  AND indexname LIKE 'idx_orders_%'
ORDER BY indexname;

-- 3. Verificar función
SELECT proname, prosrc
FROM pg_proc
WHERE proname = 'generate_order_number';

-- 4. Verificar trigger
SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers
WHERE event_object_table = 'orders'
  AND trigger_name = 'trigger_generate_order_number';

-- 5. Probar auto-generación (crear orden de prueba)
INSERT INTO orders (store_id, customer_first_name, customer_last_name, customer_email)
VALUES (
  '00000000-0000-0000-0000-000000000000', -- Reemplaza con un store_id válido
  'Test',
  'User',
  'test@example.com'
)
RETURNING id, order_number, customer_name;
-- Debe retornar order_number y customer_name auto-generados

-- 6. Limpiar orden de prueba
DELETE FROM orders WHERE customer_email = 'test@example.com';
```

---

## 🔄 Estado de Migraciones

| Migración | Descripción | En MASTER | Aplicada |
|-----------|-------------|-----------|----------|
| 025 | `shopify_order_name`, `payment_gateway` | ✅ SÍ | ✅ SÍ |
| 026 | `order_number`, `customer_name`, función | ✅ SÍ (ahora) | ⏳ Pendiente |
| 028 | `is_popup` en oauth_states | ✅ SÍ | ✅ SÍ |
| 029 | `recurring_additional_values` table | ✅ SÍ | ✅ SÍ |
| 030 | `order_status_url`, `cancel_reason` | ✅ SÍ | ✅ SÍ |
| 031 | `processed_at`, `cancelled_at` | ✅ SÍ | ✅ SÍ |
| 032 | `tags` en orders | ✅ SÍ | ✅ SÍ |
| **033** | **Consolidación de 026-032** | ✅ SÍ | ⏳ **Aplicar ahora** |

---

## ⚠️ Precauciones

1. **Backup antes de aplicar:**
   ```bash
   pg_dump -h vmi2873172.contaboserver.net -U postgres ordefy_prod > backup_pre_migration_033.sql
   ```

2. **Ventana de mantenimiento:**
   - La migración es rápida (~5-10 segundos)
   - NO requiere downtime del sistema
   - Operaciones idempotentes (puede ejecutarse múltiples veces)

3. **Rollback (si es necesario):**
   ```sql
   -- Revertir cambios (NO RECOMENDADO, solo en emergencia)
   ALTER TABLE orders DROP COLUMN IF EXISTS order_number;
   ALTER TABLE orders DROP COLUMN IF EXISTS customer_name;
   DROP TRIGGER IF EXISTS trigger_generate_order_number ON orders;
   DROP FUNCTION IF EXISTS generate_order_number();
   -- Nota: order_status_url, processed_at, tags NO se revierten (ya están en MASTER)
   ```

---

## 📊 Impacto Esperado

### Positivo:
- ✅ Auto-generación de números de orden (mejor UX)
- ✅ Nombres de clientes pre-populados (mejor performance)
- ✅ Compatibilidad completa con webhooks de Shopify
- ✅ Búsquedas optimizadas por tags
- ✅ MASTER migration actualizada para futuras instalaciones

### Neutral:
- 📦 ~5 nuevas columnas en tabla `orders` (overhead mínimo)
- 📦 ~5 nuevos índices (mejora performance de búsquedas)
- 📦 1 nueva función + 1 trigger (overhead mínimo en inserts)

### Riesgos Mitigados:
- ✅ Script idempotente (puede ejecutarse múltiples veces sin errores)
- ✅ Backfill automático de datos existentes
- ✅ Verificación automática post-migración
- ✅ Sin breaking changes en API/frontend

---

## 🎯 Próximos Pasos

Después de aplicar la migración 033:

1. ✅ Verificar que la migración se aplicó correctamente
2. ✅ Probar creación de nuevas órdenes (debe auto-generar order_number)
3. ✅ Verificar que Shopify webhooks funcionen correctamente
4. ✅ Monitorear logs por 24h para detectar errores
5. ✅ Actualizar documentación del proyecto (CLAUDE.md)

---

## 📞 Soporte

Si encuentras algún problema durante la aplicación:

1. Revisar logs de PostgreSQL: `/var/log/postgresql/postgresql-*.log`
2. Verificar el output del script de verificación
3. Ejecutar las verificaciones manuales listadas arriba
4. Si persisten problemas, revisar la sección de Rollback

---

**Última actualización:** 2025-12-30
**Autor:** Claude Code
**Versión:** 1.0
