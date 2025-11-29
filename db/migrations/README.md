# Ordefy Database Migrations

## Migración Maestra (Recomendada)

Para configurar una nueva base de datos de Ordefy, ejecuta **SOLO** este archivo:

```bash
psql -h <host> -U <user> -d <database> -f db/migrations/000_MASTER_MIGRATION.sql
```

Este archivo contiene TODAS las tablas, índices, funciones y triggers necesarios para ejecutar Ordefy en producción.

### ¿Qué incluye?

✅ **Tablas Base**: stores, users, user_stores, store_config
✅ **Tablas de Negocio**: products, customers, carriers, suppliers, campaigns, shipping_integrations, additional_values
✅ **Tabla de Pedidos**: orders (con todos los campos de COD, delivery, rating, Shopify, etc.)
✅ **Historial y Logs**: order_status_history, follow_up_log
✅ **Delivery/COD**: delivery_attempts, daily_settlements, settlement_orders
✅ **Shopify Integración**: shopify_integrations, shopify_oauth_states, shopify_import_jobs, shopify_webhook_events, shopify_sync_conflicts
✅ **Webhook Reliability**: shopify_webhook_idempotency, shopify_webhook_retry_queue, shopify_webhook_metrics
✅ **Funciones y Triggers**: Todos los triggers automáticos (customer stats, order status history, carrier stats, delivery tokens, COD calculation, etc.)
✅ **Vistas**: courier_performance, shopify_integrations_with_webhook_issues

### Características

- ✅ **Idempotente**: Puede ejecutarse múltiples veces sin errores (usa `IF NOT EXISTS` y `DROP TRIGGER IF EXISTS`)
- ✅ **Completa**: Incluye TODAS las migraciones históricas consolidadas
- ✅ **Ordenada**: Las tablas se crean en el orden correcto respetando foreign keys
- ✅ **Actualizada**: Incluye todas las funcionalidades hasta enero 2025

## Migraciones Históricas (Archivadas)

Las migraciones individuales (`001_*.sql` a `020_*.sql`) están archivadas para referencia histórica. **NO es necesario ejecutarlas** si usas la migración maestra.

Si ya tienes una base de datos con migraciones anteriores, la migración maestra detectará las tablas existentes y solo creará las faltantes.

## Migraciones Personalizadas

Si necesitas hacer cambios adicionales a la base de datos:

1. Crea un nuevo archivo con número mayor a 000: `021_tu_migracion.sql`
2. Usa siempre `IF NOT EXISTS` para hacer la migración idempotente
3. Documenta claramente qué agrega/modifica

Ejemplo:

```sql
-- 021_add_custom_field.sql
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS custom_field VARCHAR(100);

COMMENT ON COLUMN orders.custom_field IS 'Descripción del campo';
```

## Troubleshooting

### Error: "relation already exists"
No hay problema. La migración maestra usa `IF NOT EXISTS` para evitar errores. Simplemente ignora este mensaje.

### Error: "column already exists"
Mismo caso. Las migraciones usan `ADD COLUMN IF NOT EXISTS`.

### ¿Cómo verifico qué tablas tengo?
```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

### ¿Cómo verifico qué funciones tengo?
```sql
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_type = 'FUNCTION'
ORDER BY routine_name;
```

## Orden de Ejecución (Desarrollo)

Si necesitas ejecutar las migraciones en orden estricto (solo para desarrollo/debugging):

1. `000_MASTER_MIGRATION.sql` - **ESTO ES TODO LO QUE NECESITAS**

Todas las demás migraciones están incluidas en el archivo maestro.
