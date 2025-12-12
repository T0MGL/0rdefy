# Corrección: Costos de Envío y Facturación Proyectada

## Problemas Identificados y Solucionados

### 1. ✅ Costos de Envío No Se Deducían de la Ganancia Neta

**Problema:**
El campo `shipping_cost` (costo que la tienda paga a la transportadora) no se estaba guardando al crear/actualizar órdenes, por lo tanto siempre era 0 y no se deducía de las ganancias.

**Diferencia importante:**
- `total_shipping`: Lo que SE COBRA al cliente (ej: $10)
- `shipping_cost`: Lo que SE PAGA a la transportadora (ej: $5)
- Diferencia: Ganancia o costo absorbido por la tienda

**Solución implementada:**
✅ Añadido `shipping_cost` al endpoint `POST /api/orders` (línea 848, 893)
✅ Añadido `shipping_cost` al endpoint `PUT /api/orders/:id` (línea 944, 966)
✅ El backend YA estaba calculando correctamente los costos en analytics (línea 168-175, 267-273, 289-290 de `analytics.ts`)

### 2. ✅ Facturación Proyectada

**Problema:**
La facturación proyectada (Entregados + en tránsito) mostraba lo mismo que la facturación real.

**Análisis:**
El cálculo en el backend SÍ está correcto (líneas 142-160 de `analytics.ts`):
```typescript
// Facturación proyectada = Entregados (100%) + En tránsito (ajustado por tasa de entrega)
const projectedRevenue = realRevenue + (shippedRevenue * deliveryRateDecimal);
```

**Posibles causas:**
1. No hay pedidos en estado "shipped" (en tránsito)
2. Todos los pedidos ya fueron entregados
3. La tasa de entrega calculada es muy baja

**Verificación:**
El frontend muestra correctamente en Dashboard.tsx (línea 179-186):
- **Facturación Bruta**: Solo pedidos entregados
- **Facturación Proyectada**: Entregados + en tránsito ajustado

## Cómo Usar los Cambios

### Opción 1: Configurar Manualmente el Shipping Cost

Al crear o editar un pedido, ahora puedes enviar el campo `shipping_cost`:

```javascript
// Crear orden
POST /api/orders
{
  "customer_phone": "+595981234567",
  "line_items": [...],
  "total_price": 150000,
  "total_shipping": 15000,    // Lo que cobras al cliente
  "shipping_cost": 10000,     // Lo que pagas a la transportadora
  "courier_id": "uuid-del-courier"
}

// Actualizar orden
PUT /api/orders/:id
{
  "shipping_cost": 10000
}
```

### Opción 2: Usar Sistema de Zonas de Transportadoras (Automático)

El sistema ya tiene una tabla `carrier_zones` que permite configurar costos por zona:

1. **Configurar zonas de transportadoras:**
```sql
INSERT INTO carrier_zones (store_id, carrier_id, zone_name, cost_per_delivery)
VALUES
  ('tu-store-id', 'courier-id', 'Asunción Centro', 10000),
  ('tu-store-id', 'courier-id', 'Gran Asunción', 15000),
  ('tu-store-id', 'courier-id', 'Interior', 25000);
```

2. **Al crear pedido, especificar la zona:**
```javascript
POST /api/orders
{
  "customer_address": "Calle 1, Asunción",
  "delivery_zone": "Asunción Centro",  // Auto-calcula shipping_cost
  "courier_id": "uuid-del-courier"
}
```

3. **El sistema calculará automáticamente:**
```javascript
// Busca en carrier_zones:
// WHERE carrier_id = courier_id AND zone_name = delivery_zone
// Y asigna: shipping_cost = cost_per_delivery
```

### Opción 3: Integración con Shopify

Para pedidos que vienen de Shopify:

**Problema:** Shopify solo envía `total_shipping` (lo que cobra al cliente), no el costo interno.

**Solución recomendada:**
1. Configurar zonas de transportadoras (Opción 2)
2. Implementar lógica que detecte la zona basándose en la dirección del cliente
3. O permitir edición manual después de que se crea el pedido desde Shopify

**Código sugerido para webhooks de Shopify:**
```typescript
// En api/services/shopify-webhook.service.ts, después de línea 614:

// Calcular shipping_cost basado en zona
let shipping_cost = 0;
const customerAddress = shopifyOrder.shipping_address;
const delivery_zone = detectZone(customerAddress); // Implementar lógica

if (delivery_zone && courier_id) {
  const { data: zone } = await supabase
    .from('carrier_zones')
    .select('cost_per_delivery')
    .eq('carrier_id', courier_id)
    .eq('zone_name', delivery_zone)
    .eq('is_active', true)
    .single();

  shipping_cost = zone?.cost_per_delivery || 0;
}

// Añadir al objeto de orden:
orderData.shipping_cost = shipping_cost;
orderData.delivery_zone = delivery_zone;
```

## Verificar que Funciona

### 1. Revisar Analytics

Después de configurar `shipping_cost` en tus pedidos, verifica en el Dashboard:

**Desglose de Costos:**
- Costos de Productos: $XXX
- **Costos de Envío: $YYY** ← Ahora debe mostrar un valor > 0
- Marketing: $ZZZ
- **Beneficio Neto Real**: Revenue - (Productos + Envío + Marketing)

### 2. Consultar Base de Datos

```sql
-- Verificar que shipping_cost se está guardando
SELECT
  id,
  customer_first_name,
  total_price,
  total_shipping,  -- Lo que cobras al cliente
  shipping_cost,   -- Lo que pagas a la transportadora
  delivery_zone,
  sleeves_status
FROM orders
WHERE created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;

-- Verificar cálculo de costos en analytics
SELECT
  COUNT(*) as total_orders,
  SUM(total_price) as revenue,
  SUM(shipping_cost) as total_shipping_costs,
  COUNT(*) FILTER (WHERE shipping_cost > 0) as orders_with_shipping_cost
FROM orders
WHERE sleeves_status = 'delivered'
  AND created_at > NOW() - INTERVAL '30 days';
```

### 3. Verificar Facturación Proyectada

```sql
-- Pedidos entregados vs en tránsito
SELECT
  sleeves_status,
  COUNT(*) as count,
  SUM(total_price) as revenue
FROM orders
WHERE sleeves_status IN ('delivered', 'shipped')
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY sleeves_status;
```

Si tienes pedidos en estado "shipped", la facturación proyectada debe ser mayor que la real.

## Próximos Pasos Recomendados

1. **Configurar zonas de transportadoras** en la tabla `carrier_zones`
2. **Actualizar pedidos existentes** con el `shipping_cost` correcto (script SQL)
3. **Implementar detección automática de zona** basada en dirección del cliente
4. **Actualizar el frontend** para permitir seleccionar zona al crear/editar pedidos
5. **Integrar con webhooks de Shopify** para calcular `shipping_cost` automáticamente

## Script para Actualizar Pedidos Existentes

```sql
-- BACKUP primero!
-- Opción 1: Asignar costo fijo por transportadora
UPDATE orders o
SET shipping_cost = 10000  -- Ajustar según tu costo promedio
WHERE o.courier_id IS NOT NULL
  AND o.shipping_cost = 0
  AND o.sleeves_status IN ('delivered', 'shipped', 'ready_to_ship');

-- Opción 2: Asignar basado en zonas (si ya están configuradas)
UPDATE orders o
SET shipping_cost = cz.cost_per_delivery,
    delivery_zone = cz.zone_name
FROM carrier_zones cz
WHERE o.courier_id = cz.carrier_id
  AND o.shipping_cost = 0
  AND cz.is_active = true
  AND cz.zone_name = o.delivery_zone;  -- Si ya tienes delivery_zone asignado
```

## Soporte

Los cambios están listos en:
- `api/routes/orders.ts` (líneas 848, 893, 944, 966)
- `api/routes/analytics.ts` (ya estaba correcto)
- `src/pages/Dashboard.tsx` (ya estaba correcto)

El backend ahora acepta y guarda `shipping_cost` correctamente. Solo necesitas comenzar a enviarlo en tus pedidos.
