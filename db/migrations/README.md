# Ordefy Database Migrations

## Migración Maestra (Recomendada)

Para configurar una nueva base de datos de Ordefy, ejecuta **SOLO** este archivo:

```bash
psql -h <host> -U <user> -d <database> -f db/migrations/000_MASTER_MIGRATION.sql
```

Este archivo contiene TODAS las tablas, índices, funciones y triggers necesarios para ejecutar Ordefy en producción.

### ¿Qué incluye?

#### Tablas (50+ tablas)

✅ **Core (4 tablas)**
- stores, users, user_stores, store_config

✅ **Negocio (7 tablas)**
- products, customers, carriers, suppliers, campaigns, shipping_integrations, additional_values

✅ **Pedidos (3 tablas)**
- orders (con COD, delivery, rating, Shopify sync, warehouse statuses)
- order_status_history
- follow_up_log

✅ **Delivery/COD (3 tablas)**
- delivery_attempts, daily_settlements, settlement_orders

✅ **Shopify Integración (5 tablas)**
- shopify_integrations, shopify_oauth_states, shopify_import_jobs
- shopify_webhook_events, shopify_sync_conflicts

✅ **Webhook Reliability (3 tablas)**
- shopify_webhook_idempotency
- shopify_webhook_retry_queue
- shopify_webhook_metrics

✅ **Mercadería/Inbound Shipments (2 tablas)** 🆕
- inbound_shipments (envíos de proveedores)
- inbound_shipment_items (items con qty tracking)

✅ **Warehouse/Picking & Packing (4 tablas)** 🆕
- picking_sessions (sesiones de preparación)
- picking_session_orders (junction table)
- picking_session_items (lista de picking agregada)
- packing_progress (progreso de empaque por pedido)

✅ **Carrier Zones & Settlements (2 tablas)** 🆕
- carrier_zones (tarifas por zona)
- carrier_settlements (liquidaciones de carriers)

#### Funciones (20+ funciones)

✅ **Timestamps**: fn_update_timestamp, update_shopify_updated_at, update_inbound_shipment_timestamp, update_picking_session_timestamp

✅ **Customer Stats**: fn_update_customer_stats, fn_update_customer_stats_on_update

✅ **Order Tracking**: fn_log_order_status_change, set_delivery_token, generate_delivery_token, calculate_cod_amount

✅ **Carrier Stats**: update_carrier_delivery_stats, update_carrier_rating

✅ **Cleanup**: cleanup_expired_idempotency_keys, cleanup_expired_oauth_states, delete_old_delivery_photos

✅ **Webhook Metrics**: record_webhook_metric

✅ **Mercadería**: generate_inbound_reference, receive_shipment_items, update_shipment_total_cost 🆕

✅ **Warehouse**: generate_session_code 🆕

✅ **Carrier Settlements**: create_carrier_settlement 🆕

#### Vistas (4 vistas)

✅ **courier_performance**: Rendimiento de carriers con métricas detalladas

✅ **shopify_integrations_with_webhook_issues**: Integraciones con problemas de webhooks

✅ **inbound_shipments_summary**: Resumen de mercadería con estadísticas 🆕

✅ **pending_carrier_settlements_summary**: Liquidaciones pendientes por carrier 🆕

#### Triggers (30+ triggers)

✅ **Updated_at**: 15+ triggers automáticos para timestamps

✅ **Customer Stats**: Actualización de total_orders y total_spent

✅ **Order Tracking**: Status change logging, delivery token generation, COD calculation

✅ **Carrier Stats**: Delivery stats y rating updates

✅ **Mercadería**: Total cost updates automáticos 🆕

✅ **Warehouse**: Picking/packing timestamps 🆕

✅ **Carrier Zones**: Settlements timestamps 🆕

### Características

- ✅ **Idempotente**: Puede ejecutarse múltiples veces sin errores (usa `IF NOT EXISTS` y `DROP TRIGGER IF EXISTS`)
- ✅ **Completa**: Incluye TODAS las migraciones históricas consolidadas + nuevos módulos
- ✅ **Ordenada**: Las tablas se crean en el orden correcto respetando foreign keys
- ✅ **Actualizada**: Incluye todas las funcionalidades hasta enero 2025
- ✅ **Multi-tenant**: Isolation por store_id
- ✅ **Auditoría**: Timestamps, user tracking, status history
- ✅ **Performance**: 50+ índices optimizados
- ✅ **Shopify**: Integración bidireccional con webhooks confiables
- ✅ **Warehouse**: Sistema de picking & packing sin barcode scanners 🆕
- ✅ **Mercadería**: Gestión de inventario con recepción y validación 🆕
- ✅ **Carrier Zones**: Tarifas por zona y liquidaciones automáticas 🆕

## Migraciones Históricas (Archivadas)

Las migraciones individuales (`001_*.sql` a `020_*.sql`) están archivadas para referencia histórica. **NO es necesario ejecutarlas** si usas la migración maestra.

Si ya tienes una base de datos con migraciones anteriores, la migración maestra detectará las tablas existentes y solo creará las faltantes.

## Migraciones Adicionales (Opcionales)

Las siguientes migraciones están **INCLUIDAS** en la migración maestra, pero se mantienen como archivos separados para referencia:

### 011_merchandise_system.sql
Sistema completo de gestión de mercadería entrante desde proveedores.
- **Estado**: ✅ Incluido en 000_MASTER_MIGRATION.sql
- **Uso independiente**: Solo si necesitas el módulo en una base de datos mínima

### 015_warehouse_picking.sql
Sistema de picking & packing para preparación de pedidos sin barcode scanners.
- **Estado**: ✅ Incluido en 000_MASTER_MIGRATION.sql
- **Uso independiente**: Solo si necesitas el módulo en una base de datos mínima

### 016_carrier_zones_and_settlements.sql
Sistema de zonas de entrega y liquidaciones de carriers.
- **Estado**: ✅ Incluido en 000_MASTER_MIGRATION.sql
- **Uso independiente**: Solo si necesitas el módulo en una base de datos mínima

**Nota**: Si ya ejecutaste la migración maestra (000_MASTER_MIGRATION.sql), NO necesitas ejecutar estas migraciones adicionales.

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
