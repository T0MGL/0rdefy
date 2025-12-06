# Shopify Order Line Items - Sistema de Mapeo de Productos

**Fecha:** 2025-01-06
**Versión:** 1.0
**Migración:** 024_order_line_items.sql

## Resumen del Problema

El sistema anterior tenía varios problemas críticos con los pedidos de Shopify:

### 1. **Sin Mapeo de Productos**
- Los `line_items` se guardaban como JSONB sin relación con la tabla `products`
- No se podía identificar qué producto local correspondía a cada item de Shopify
- Imposible hacer análisis de ventas por producto
- El sistema de inventario automático no funcionaba correctamente

### 2. **Solo Mostraba 1 Producto**
- Aunque un pedido tuviera múltiples productos, solo se mostraba el primero
- Pérdida de información crítica del pedido

### 3. **Dirección Incompleta**
- Los campos de dirección desglosados (`customer_address`, `neighborhood`, `phone_backup`) no se llenaban desde Shopify
- Dificultad para procesar entregas

### 4. **IDs Diferentes**
- El `shopify_order_id` se guardaba, pero no había claridad sobre la diferencia entre IDs locales (UUID) y IDs de Shopify (numéricos)

## Solución Implementada

### Arquitectura

```
┌─────────────┐      ┌──────────────────┐      ┌─────────────────────┐
│   Shopify   │─────>│  Webhook/Import  │─────>│  order_line_items   │
│   Orders    │      │     Services     │      │    (normalized)     │
└─────────────┘      └──────────────────┘      └─────────────────────┘
                              │                           │
                              │                           │
                              v                           v
                    ┌──────────────────┐      ┌─────────────────────┐
                    │   orders table   │      │  products table     │
                    │   (main data)    │<────>│  (local products)   │
                    └──────────────────┘      └─────────────────────┘
```

### 1. Nueva Tabla `order_line_items`

Tabla normalizada que mapea cada línea de producto de un pedido:

**Campos principales:**
- `order_id` (UUID) - FK a orders
- `product_id` (UUID) - FK a products (puede ser NULL si no se encuentra)
- `shopify_product_id`, `shopify_variant_id` - IDs de Shopify para tracking
- `product_name`, `variant_title`, `sku` - Snapshot del producto al momento del pedido
- `quantity`, `unit_price`, `total_price` - Cantidades y precios
- `stock_deducted` - Control de inventario

**Beneficios:**
- Relación directa con productos locales
- Queries eficientes (JOIN vs JSONB parsing)
- Soporte para múltiples productos por pedido
- Tracking de stock por line item

### 2. Funciones de PostgreSQL

#### `find_product_by_shopify_ids()`
Busca un producto local usando IDs de Shopify:
1. Primero por `shopify_variant_id` (más específico)
2. Luego por `shopify_product_id`
3. Finalmente por `sku`

```sql
SELECT find_product_by_shopify_ids(
    'store-uuid',
    'shopify-product-123',
    'shopify-variant-456',
    'SKU-001'
);
```

#### `create_line_items_from_shopify()`
Parsea el JSONB `line_items` de Shopify y crea registros normalizados:

```sql
SELECT create_line_items_from_shopify(
    'order-uuid',
    'store-uuid',
    '[{...shopify line items...}]'::jsonb
);
```

### 3. Sistema de Inventario Mejorado

**Trigger actualizado:** `update_product_stock_on_order_status()`

- Usa `order_line_items` en lugar de JSONB cuando están disponibles
- Decrementa stock cuando el pedido pasa a `ready_to_ship`
- Restaura stock si el pedido se cancela después de decrementar
- Marca cada line item con `stock_deducted = TRUE`
- Registra movimientos en `inventory_movements`

**Ventaja:** Control granular por producto, no por pedido completo

### 4. Mapeo de Direcciones Mejorado

Ahora se extraen correctamente:
- `customer_address` - address1 + address2 concatenados
- `neighborhood` - Del campo `address2` o `neighborhood` de Shopify
- `phone_backup` - Teléfono de billing si es diferente al principal
- `delivery_notes` - Del campo `note` del pedido

### 5. Servicios Actualizados

#### `shopify-webhook.service.ts`
- Método `createLineItemsForOrder()` - Crea line items normalizados
- Método `mapShopifyOrderToLocal()` mejorado - Mapea direcciones completas
- Busca productos locales automáticamente
- Logs de advertencia si no encuentra productos

#### `shopify-import.service.ts`
- Misma lógica aplicada a importación masiva
- Procesa line items para todos los pedidos históricos
- Mapeo completo de direcciones

### 6. Endpoints API Actualizados

#### `GET /api/orders`
```typescript
{
  id: "uuid",
  customer: "Juan Perez",
  product: "Producto A (+2 más)",  // Indica múltiples productos
  quantity: 5,  // Suma total de todos los line items
  total: 150.00,
  line_items: [  // Array completo de productos
    {
      product_id: "uuid-local",
      product_name: "Producto A",
      variant_title: "Talla M",
      quantity: 2,
      unit_price: 25.00,
      total_price: 50.00,
      shopify_product_id: "123",
      shopify_variant_id: "456"
    },
    // ... más productos
  ]
}
```

#### `GET /api/orders/:id`
- Incluye todos los line items con detalles completos
- Información de producto local si está mapeado
- `shopify_order_id` y `shopify_order_number` en la respuesta

## Instalación

### 1. Aplicar Migración

```bash
# Dar permisos de ejecución al script
chmod +x apply-line-items-migration.sh

# Ejecutar migración completa (schema + datos)
./apply-line-items-migration.sh
```

El script:
1. Crea la tabla `order_line_items`
2. Crea funciones helper
3. Actualiza triggers de inventario
4. Migra órdenes existentes

### 2. Verificar Migración

```bash
# Verificar productos sin mapear
psql $DATABASE_URL -c "
SELECT
    shopify_product_id,
    product_name,
    COUNT(*) as occurrences
FROM order_line_items
WHERE product_id IS NULL
GROUP BY shopify_product_id, product_name
ORDER BY occurrences DESC;
"
```

### 3. Importar Productos Faltantes

Si hay line items sin `product_id`, significa que esos productos no existen en tu base de datos local:

```bash
# Opción 1: Importar productos desde Shopify
# Ir a Integraciones → Shopify → Importar Productos

# Opción 2: Crear productos manualmente
# Con los mismos shopify_product_id y shopify_variant_id
```

## Uso

### Nuevos Pedidos desde Shopify

Los webhooks ahora automáticamente:
1. Crean el pedido en la tabla `orders`
2. Buscan cada producto en la tabla `products` local
3. Crean registros en `order_line_items` con mapeo correcto
4. Llenan campos de dirección desglosados

**Ejemplo de log:**
```
✅ Created 3 normalized line items for order abc-123
⚠️  Product not found for line item: Shopify Product ID 789, Variant ID 456, SKU "PROD-001"
```

### Pedidos con Productos No Encontrados

Si un producto de Shopify no existe localmente:
- El line item se crea con `product_id = NULL`
- Se guardan todos los demás datos (nombre, precio, cantidad)
- Se muestra advertencia en logs
- El pedido funciona normalmente (solo no hay mapeo)

**Solución:** Importar ese producto desde Shopify para futuras órdenes.

### Tracking de Inventario

El sistema ahora:
1. Cuando un pedido llega a `ready_to_ship`:
   - Busca todos los `order_line_items` del pedido
   - Decrementa stock de cada producto mapeado (`product_id != NULL`)
   - Marca `stock_deducted = TRUE` en cada line item
   - Registra en `inventory_movements`

2. Si el pedido se cancela después:
   - Restaura stock de productos que tenían `stock_deducted = TRUE`
   - Marca `stock_deducted = FALSE`
   - Registra restauración en `inventory_movements`

## Queries Útiles

### Ver Line Items de un Pedido

```sql
SELECT
    oli.product_name,
    oli.variant_title,
    oli.quantity,
    oli.unit_price,
    oli.total_price,
    p.name as local_product_name,
    p.stock as current_stock,
    oli.stock_deducted
FROM order_line_items oli
LEFT JOIN products p ON oli.product_id = p.id
WHERE oli.order_id = 'order-uuid'
ORDER BY oli.created_at;
```

### Productos Más Vendidos (con mapeo correcto)

```sql
SELECT
    p.name,
    p.sku,
    SUM(oli.quantity) as total_sold,
    COUNT(DISTINCT oli.order_id) as num_orders,
    SUM(oli.total_price) as total_revenue
FROM order_line_items oli
JOIN products p ON oli.product_id = p.id
JOIN orders o ON oli.order_id = o.id
WHERE o.created_at >= NOW() - INTERVAL '30 days'
GROUP BY p.id, p.name, p.sku
ORDER BY total_sold DESC
LIMIT 10;
```

### Pedidos con Múltiples Productos

```sql
SELECT
    o.id,
    o.shopify_order_number,
    COUNT(oli.id) as num_products,
    SUM(oli.quantity) as total_items,
    o.total_price
FROM orders o
JOIN order_line_items oli ON o.id = oli.order_id
GROUP BY o.id
HAVING COUNT(oli.id) > 1
ORDER BY num_products DESC;
```

### Movimientos de Inventario por Line Item

```sql
SELECT
    o.shopify_order_number,
    oli.product_name,
    p.name as local_product_name,
    oli.quantity,
    oli.stock_deducted,
    oli.stock_deducted_at,
    im.movement_type,
    im.previous_stock,
    im.new_stock
FROM order_line_items oli
JOIN orders o ON oli.order_id = o.id
LEFT JOIN products p ON oli.product_id = p.id
LEFT JOIN inventory_movements im ON im.order_id = o.id AND im.product_id = p.id
WHERE oli.product_id IS NOT NULL
ORDER BY oli.stock_deducted_at DESC
LIMIT 50;
```

## Migración de Datos Existentes

El script `migrate-existing-orders.sql` procesa todas las órdenes existentes:

```bash
# Solo migrar datos (si ya aplicaste el schema)
psql $DATABASE_URL -f migrate-existing-orders.sql
```

**Qué hace:**
- Busca todas las órdenes con `line_items` JSONB
- Para cada una, llama a `create_line_items_from_shopify()`
- Intenta mapear productos usando los IDs de Shopify
- Muestra progreso y estadísticas

**Output esperado:**
```
========================================
Starting migration of existing orders to normalized line items
========================================
Found 245 orders with line_items to process

[1/245] ✅ Order abc-123 (Shopify #1001): Created 2 line items
[2/245] ✅ Order def-456 (Shopify #1002): Created 1 line items
...
========================================
Migration complete!
========================================
Total orders found: 245
Orders processed: 245
Total line items created: 387
Errors: 0
✅ All orders migrated successfully!
```

## Backwards Compatibility

El sistema mantiene compatibilidad con el formato anterior:

1. **Campo `line_items` JSONB** se mantiene en `orders`
2. **Endpoints API** devuelven line items normalizados si existen, sino usan JSONB
3. **Frontend** no requiere cambios (recibe mismo formato mejorado)

## Troubleshooting

### Productos no se encuentran

**Problema:** Muchos line items tienen `product_id = NULL`

**Solución:**
1. Verificar que los productos existan en tu tienda local
2. Importar productos desde Shopify: Integraciones → Shopify → Importar
3. Verificar que `shopify_product_id` y `shopify_variant_id` coincidan

### Stock no se decrementa

**Problema:** El stock no baja cuando el pedido llega a `ready_to_ship`

**Solución:**
1. Verificar que el line item tenga `product_id` (producto mapeado)
2. Verificar que `stock_deducted = FALSE` en el line item
3. Revisar logs del trigger en PostgreSQL
4. Verificar que el producto tenga stock disponible

### Pedidos duplicados después de migración

**Problema:** Los line items se crearon dos veces

**Solución:**
```sql
-- Eliminar duplicados (mantiene los más recientes)
DELETE FROM order_line_items oli1
WHERE oli1.id IN (
    SELECT oli2.id
    FROM order_line_items oli2
    WHERE oli2.order_id = oli1.order_id
    AND oli2.created_at < (
        SELECT MAX(created_at)
        FROM order_line_items
        WHERE order_id = oli1.order_id
    )
);
```

## Archivos Modificados

### Migraciones
- `db/migrations/024_order_line_items.sql` - Schema y funciones

### Servicios
- `api/services/shopify-webhook.service.ts` - Webhook processing
- `api/services/shopify-import.service.ts` - Bulk import

### API Routes
- `api/routes/orders.ts` - GET endpoints actualizados

### Scripts
- `apply-line-items-migration.sh` - Script de instalación
- `migrate-existing-orders.sql` - Migración de datos

### Documentación
- `SHOPIFY_ORDER_LINE_ITEMS.md` - Este archivo

## Notas Importantes

1. **Siempre importa productos antes de pedidos** para tener mapeo correcto
2. **El campo JSONB `line_items` se mantiene** para referencia y compatibilidad
3. **Los line items se recrean en cada update** del pedido desde Shopify
4. **El inventario solo se decrementa si hay mapeo** (`product_id != NULL`)
5. **Los webhooks funcionan automáticamente** una vez aplicada la migración

## Próximos Pasos

- [ ] Actualizar frontend para mostrar todos los productos de un pedido
- [ ] Agregar vista de productos más vendidos usando line items
- [ ] Crear reportes de inventario basados en line items
- [ ] Implementar auto-creación de productos si no existen (opcional)

## Soporte

Para problemas o preguntas, revisar:
1. Logs del backend: `console.log` en webhook/import services
2. Logs de PostgreSQL: Triggers y funciones
3. Tabla `shopify_webhook_events` para debugging de webhooks
4. Consultas SQL de verificación en este documento
