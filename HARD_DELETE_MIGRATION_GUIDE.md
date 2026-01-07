# Hard Delete Migration Guide

## 🎯 Objetivo

Implementar **sistema de eliminación dual** según el rol del usuario:

### Non-Owners (Admin, Confirmador, etc.)
- ✅ **Soft Delete:** Marca `deleted_at` timestamp
- ✅ **Opacidad reducida** en UI (pedido visible pero atenuado)
- ✅ **No se elimina de la base de datos** (solo se oculta)
- ✅ Owner puede hacer hard delete después

### Owner
- ✅ **Hard Delete:** Eliminación permanente (no recuperable)
- ✅ **Limpieza completa en cascada** de TODAS las tablas relacionadas
- ✅ **Restauración automática de stock** si el pedido afectó inventario
- ✅ **Sin data fantasma** en Dashboard, Warehouse, Despacho

## 📋 Cambios Implementados

### 1. Base de Datos (Migration 039)

**Archivo:** `db/migrations/039_hard_delete_cascading_cleanup.sql`

**Cambios:**
- ✅ **Mantiene** columnas de soft delete: `deleted_at`, `deleted_by`, `deletion_type` (para non-owners)
- ✅ **Mantiene** índices para filtrar soft-deleted orders
- ✅ Nueva función `cascade_delete_order_data()` que limpia (solo para owner hard delete):
  - `order_status_history` - Historial de cambios de estado
  - `delivery_attempts` - Intentos de entrega
  - `picking_session_orders` + `picking_sessions` - Sesiones de picking
  - `packing_progress` - Progreso de empaquetado
  - `return_session_orders` + `return_sessions` - Sesiones de devoluciones
  - `order_line_items` - Items del pedido normalizados
  - `settlement_orders` - Liquidaciones diarias
  - `follow_up_log` - Logs de seguimiento
  - `shopify_webhook_idempotency` - Idempotencia de webhooks
  - `shopify_webhook_events` - Eventos de webhooks
  - Restauración automática de stock si `sleeves_status IN ('ready_to_ship', 'shipped', 'delivered')`

### 2. API Backend (api/routes/orders.ts)

**Cambios:**
- ✅ Endpoint `DELETE /api/orders/:id` con **lógica dual**:
  - **Non-owners:** Soft delete (marca `deleted_at`, opacidad reducida)
  - **Owner:** Hard delete (eliminación permanente + cascading cleanup)
- ✅ Endpoint `GET /api/orders` incluye soft-deleted orders:
  - Devuelve campo `deleted_at` para aplicar opacidad en UI
  - Filtro opcional `show_deleted=false` para ocultarlos completamente
  - Por defecto: `show_deleted=true` (muestra todos con opacidad)

### 3. Scripts de Verificación

**Archivo:** `scripts/verify-order-cleanup.cjs`

Verifica que un pedido eliminado no dejó data huérfana en ninguna tabla.

## 🚀 Cómo Aplicar la Migración

### Opción 1: Supabase SQL Editor (Recomendado)

1. Abre Supabase Dashboard: https://supabase.com/dashboard
2. Ve a **SQL Editor**
3. Crea una nueva query
4. Copia y pega el contenido completo de `db/migrations/039_hard_delete_cascading_cleanup.sql`
5. Ejecuta la query (Run)
6. Verifica que no haya errores

### Opción 2: psql CLI (Local/Railway)

```bash
# Si tienes conexión directa a PostgreSQL
psql -h <host> -U <user> -d <database> -f db/migrations/039_hard_delete_cascading_cleanup.sql
```

## ✅ Verificar que la Migración Funcionó

### 1. Verificar que la función existe:

```sql
-- En Supabase SQL Editor
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_name = 'cascade_delete_order_data'
  AND routine_schema = 'public';
```

**Resultado esperado:** 1 fila con `cascade_delete_order_data | FUNCTION`

### 2. Verificar que el trigger está activo:

```sql
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_name = 'trigger_cascade_delete_order_data';
```

**Resultado esperado:** 1 fila con `trigger_cascade_delete_order_data | DELETE | orders`

### 3. Verificar que las columnas de soft delete EXISTEN:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'orders'
  AND column_name IN ('deleted_at', 'deleted_by', 'deletion_type');
```

**Resultado esperado:** 3 filas (deleted_at, deleted_by, deletion_type)

## 🧪 Probar la Eliminación

### Caso 1: Soft Delete (Non-Owner)

```bash
# Como admin, confirmador, etc. (NO owner)
curl -X DELETE https://api.ordefy.io/api/orders/<ORDER_ID> \
  -H "Authorization: Bearer <NON_OWNER_TOKEN>" \
  -H "X-Store-ID: <STORE_ID>"

# Respuesta esperada:
# {
#   "success": true,
#   "message": "Order hidden successfully. It will appear with reduced opacity...",
#   "deletion_type": "soft"
# }
```

**Verificación:**
- El pedido SIGUE en la base de datos
- Campo `deleted_at` tiene timestamp
- En el frontend aparece con **opacidad reducida**
- Dashboard, Warehouse y Despacho aún muestran el pedido

### Caso 2: Hard Delete (Owner)

```bash
# Como OWNER
curl -X DELETE https://api.ordefy.io/api/orders/<ORDER_ID> \
  -H "Authorization: Bearer <OWNER_TOKEN>" \
  -H "X-Store-ID: <STORE_ID>"

# Respuesta esperada:
# {
#   "success": true,
#   "message": "Order permanently deleted. All related data has been cleaned up.",
#   "deletion_type": "hard",
#   "stock_restored": true  // Si el pedido afectó inventario
# }
```

**Verificación:**

```bash
# Usar el script de verificación
node scripts/verify-order-cleanup.cjs <ORDER_ID>
```

**Resultado esperado:**
```
🔍 Verifying deletion cleanup for order: abc-123-def
────────────────────────────────────────────────────────────
✅ orders                         - Clean (0 records)
✅ order_status_history           - Clean (0 records)
✅ delivery_attempts              - Clean (0 records)
✅ picking_session_orders         - Clean (0 records)
✅ packing_progress               - Clean (0 records)
✅ return_session_orders          - Clean (0 records)
✅ settlement_orders              - Clean (0 records)
✅ follow_up_log                  - Clean (0 records)
✅ order_line_items               - Clean (0 records)
────────────────────────────────────────────────────────────
✅ CLEANUP SUCCESSFUL: No orphaned data found in any table
🎉 The order was completely removed from the database
```

## ⚠️ Advertencias

### Para Non-Owners:
1. **Soft delete solo:** Solo pueden marcar como eliminado (opacidad reducida)
2. **Visible hasta que owner elimine:** El pedido seguirá apareciendo en la UI con opacidad
3. **No afecta inventario:** El soft delete NO restaura stock

### Para Owner:
1. **No hay vuelta atrás:** Hard delete es PERMANENTE, no se puede recuperar
2. **Stock automático:** Si el pedido afectó inventario, se restaura automáticamente
3. **Limpieza completa:** Elimina data de TODAS las tablas relacionadas
4. **Audit trail:** Se registra la restauración de stock en `inventory_movements` con tipo `order_hard_delete_restoration`

## 🐛 Troubleshooting

### Error: "Order already deleted" (Non-owner)
- **Causa:** El pedido ya fue soft-deleted previamente
- **Solución:** Solo el owner puede hacer hard delete ahora

### Error: "Permission denied" (Hard delete)
- **Causa:** Usuario no es owner intentando hard delete
- **Solución:** Solo non-owners hacen soft delete, solo owner hace hard delete

### Error: "Cannot delete order"
- **Causa:** Puede haber restricciones de foreign keys
- **Solución:** Verificar que el trigger esté activo y revisa los logs de PostgreSQL

### Quedan registros huérfanos después de eliminar
- **Causa:** El trigger no se ejecutó correctamente
- **Solución:**
  1. Verifica que el trigger existe: `SELECT * FROM information_schema.triggers WHERE trigger_name = 'trigger_cascade_delete_order_data'`
  2. Re-aplica la migración
  3. Contacta al equipo de desarrollo

## 📝 Notas Adicionales

- La migración es **idempotente** (puede ejecutarse varias veces sin problemas)
- Se mantiene la funcionalidad de `is_test` para marcar pedidos de prueba
- El sistema de permisos sigue funcionando igual (solo se cambió delete a owner-only)
- Los filtros de `show_test` en el frontend siguen funcionando

## 📞 Soporte

Si tienes problemas aplicando esta migración:
1. Revisa los logs de Supabase SQL Editor
2. Ejecuta las queries de verificación arriba
3. Usa el script `verify-order-cleanup.cjs` para diagnosticar
