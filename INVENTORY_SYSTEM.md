# Sistema de Gestión de Inventario - Ordefy

## Descripción General

Sistema automático de tracking de inventario que actualiza el stock de productos en tiempo real a medida que los pedidos avanzan por su ciclo de vida.

## Flujo de Stock

### Estados de Pedido y Stock

```
pending → confirmed → in_preparation → ready_to_ship → shipped → delivered
  ↓           ↓            ↓               ↓            ↓         ↓
stock=100   stock=100   stock=100      stock=97     stock=97  stock=97
                                        ⬇️ DECREMENTO
```

**Punto de Decremento:** `ready_to_ship` (cuando el picking/packing está completo)

### Razón del Punto de Decremento

Se eligió `ready_to_ship` porque:
- ✅ El inventario físico ya fue separado del almacén (picking completado)
- ✅ Los productos están empaquetados y listos para enviar
- ✅ Es el punto donde el producto deja de estar disponible para otros pedidos
- ✅ Evita decrementar stock de pedidos que aún pueden ser modificados/cancelados

## Arquitectura

### Tabla Principal: `inventory_movements`

Audit log completo de todos los movimientos de inventario.

```sql
CREATE TABLE inventory_movements (
    id UUID PRIMARY KEY,
    store_id UUID NOT NULL,
    product_id UUID NOT NULL,
    order_id UUID,
    quantity_change INT NOT NULL,          -- Negativo para decrementos, positivo para incrementos
    stock_before INT NOT NULL,
    stock_after INT NOT NULL,
    movement_type VARCHAR(50) NOT NULL,    -- order_ready, order_cancelled, order_reverted, manual_adjustment
    order_status_from VARCHAR(50),
    order_status_to VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### Triggers Automáticos

#### 1. `trigger_update_stock_on_order_status`

**Función:** `update_product_stock_on_order_status()`

**Eventos:**
- **AFTER INSERT** en orders (si el estado es `ready_to_ship`)
- **AFTER UPDATE OF sleeves_status** en orders

**Casos Manejados:**

##### Caso 1: Decremento de Stock
```sql
-- Condición
sleeves_status cambia a 'ready_to_ship'

-- Acción
FOR EACH line_item IN order.line_items:
    products.stock = GREATEST(0, stock - quantity)
    INSERT INTO inventory_movements (movement_type = 'order_ready')
```

##### Caso 2: Restauración por Cancelación
```sql
-- Condición
sleeves_status cambia a 'cancelled' o 'rejected'
Y el estado anterior era 'ready_to_ship', 'shipped' o 'delivered'

-- Acción
FOR EACH line_item IN order.line_items:
    products.stock = stock + quantity
    INSERT INTO inventory_movements (movement_type = 'order_cancelled')
```

##### Caso 3: Restauración por Reversión
```sql
-- Condición
sleeves_status cambia de ('ready_to_ship', 'shipped', 'delivered')
A ('pending', 'confirmed', 'in_preparation')

-- Acción
FOR EACH line_item IN order.line_items:
    products.stock = stock + quantity
    INSERT INTO inventory_movements (movement_type = 'order_reverted')
```

#### 2. `trigger_prevent_line_items_edit`

**Función:** `prevent_line_items_edit_after_stock_deducted()`

**Evento:** BEFORE UPDATE OF line_items en orders

**Propósito:** Prevenir modificación de productos en pedidos que ya decrementaron stock.

```sql
-- Si el pedido ya llegó a ready_to_ship o posterior
-- Y los line_items cambiaron
-- → RAISE EXCEPTION
```

**Error Retornado:**
```
Cannot modify line_items for order {id} - stock has been decremented.
Cancel the order and create a new one instead.
```

#### 3. `trigger_prevent_order_deletion`

**Función:** `prevent_order_deletion_after_stock_deducted()`

**Evento:** BEFORE DELETE en orders

**Propósito:** Prevenir eliminación accidental de pedidos que ya afectaron el inventario.

```sql
-- Si sleeves_status IN ('ready_to_ship', 'shipped', 'delivered')
-- → RAISE EXCEPTION
```

**Error Retornado:**
```
Cannot delete order {id} - stock has been decremented.
Cancel the order instead.
```

## Casos de Uso

### Flujo Normal (Pedido Completado)

```
1. Crear pedido: stock=100, status=pending
2. Confirmar: stock=100, status=confirmed
3. Iniciar picking: stock=100, status=in_preparation
4. Completar packing: stock=97, status=ready_to_ship ⬇️ DECREMENTO
5. Enviar: stock=97, status=shipped
6. Entregar: stock=97, status=delivered
```

### Flujo de Cancelación Temprana

```
1. Crear pedido: stock=100, status=pending
2. Confirmar: stock=100, status=confirmed
3. Cancelar: stock=100, status=cancelled (sin cambio de stock)
```

### Flujo de Cancelación Tardía

```
1. Crear pedido: stock=100, status=pending
2. Confirmar: stock=100, status=confirmed
3. Completar packing: stock=97, status=ready_to_ship ⬇️ DECREMENTO
4. Cancelar: stock=100, status=cancelled ⬆️ RESTAURACIÓN
```

### Flujo de Reversión (Edge Case)

```
1. Pedido listo: stock=97, status=ready_to_ship
2. Error en picking: stock=100, status=in_preparation ⬆️ RESTAURACIÓN
3. Corregir y completar: stock=97, status=ready_to_ship ⬇️ DECREMENTO
```

## Testing

### Script de Prueba Automático

```bash
./test-inventory-tracking.sh [email] [password]
```

**Flujo de Prueba:**
1. Login y obtener token
2. Crear producto con stock=100
3. Crear pedido con 3 unidades
4. Verificar stock=100 (pending, no cambia)
5. Confirmar pedido
6. Verificar stock=100 (confirmed, no cambia)
7. Marcar como ready_to_ship
8. Verificar stock=97 ✅ (decrementado)
9. Cancelar pedido
10. Verificar stock=100 ✅ (restaurado)

### Casos de Prueba Manual

#### Test 1: Prevenir Edición de Line Items
```bash
# 1. Crear pedido y marcar como ready_to_ship (stock decrementa)
# 2. Intentar editar line_items
curl -X PUT "$API_URL/orders/$ORDER_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"line_items": [...]}'

# Resultado esperado: Error 500
# "Cannot modify line_items for order..."
```

#### Test 2: Prevenir Eliminación
```bash
# 1. Crear pedido y marcar como ready_to_ship (stock decrementa)
# 2. Intentar eliminar pedido
curl -X DELETE "$API_URL/orders/$ORDER_ID" \
  -H "Authorization: Bearer $TOKEN"

# Resultado esperado: Error 500
# "Cannot delete order - stock has been decremented..."
```

#### Test 3: Verificar Audit Log
```sql
-- Ver todos los movimientos de un producto
SELECT
    movement_type,
    quantity_change,
    stock_before,
    stock_after,
    order_status_from,
    order_status_to,
    created_at
FROM inventory_movements
WHERE product_id = '{product_id}'
ORDER BY created_at DESC;
```

## Migración

### Aplicar la Migration

```bash
# 1. Ejecutar migration
psql "$DATABASE_URL" -f db/migrations/019_inventory_management.sql

# 2. Verificar triggers
psql "$DATABASE_URL" -c "
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE event_object_table = 'orders'
AND trigger_name LIKE 'trigger_%stock%' OR trigger_name LIKE 'trigger_%line_items%';
"
```

### Rollback (Si es necesario)

```sql
-- Eliminar triggers
DROP TRIGGER IF EXISTS trigger_update_stock_on_order_status ON orders;
DROP TRIGGER IF EXISTS trigger_prevent_line_items_edit ON orders;
DROP TRIGGER IF EXISTS trigger_prevent_order_deletion ON orders;

-- Eliminar funciones
DROP FUNCTION IF EXISTS update_product_stock_on_order_status();
DROP FUNCTION IF EXISTS prevent_line_items_edit_after_stock_deducted();
DROP FUNCTION IF EXISTS prevent_order_deletion_after_stock_deducted();

-- Eliminar tabla (CUIDADO: perderás el audit log)
DROP TABLE IF EXISTS inventory_movements;
```

## Consideraciones Importantes

### ✅ Ventajas

1. **Automático:** No requiere cambios en el código de la aplicación
2. **Consistente:** Los triggers garantizan que el stock siempre se actualice
3. **Auditable:** Todos los movimientos quedan registrados
4. **Protegido:** Previene ediciones/eliminaciones que rompan la integridad

### ⚠️ Limitaciones

1. **Stock Negativo:** El sistema usa `GREATEST(0, stock - quantity)` para prevenir stock negativo. Si el stock es insuficiente, el decremento se hará hasta 0.
   - **Solución recomendada:** Implementar validación en el frontend/backend antes de confirmar pedidos

2. **Cambios de Productos:** Una vez que un pedido llega a `ready_to_ship`, no se pueden modificar los line_items.
   - **Solución:** Cancelar el pedido y crear uno nuevo

3. **Performance:** Los triggers ejecutan múltiples queries por pedido (uno por line_item).
   - **Impacto:** Mínimo para volúmenes normales (<1000 pedidos/día)
   - **Optimización futura:** Usar CTEs o queries batch si es necesario

### 🔧 Recomendaciones de Uso

1. **Validación Previa:** Implementar check de stock disponible antes de permitir confirmar pedidos:
   ```typescript
   // Antes de confirmar un pedido
   for (const item of order.line_items) {
     const product = await getProduct(item.product_id);
     if (product.stock < item.quantity) {
       throw new Error(`Stock insuficiente para ${product.name}`);
     }
   }
   ```

2. **Monitoreo:** Revisar periódicamente la tabla `inventory_movements` para detectar inconsistencias

3. **Alertas:** Configurar alertas cuando el stock de productos críticos baje de cierto umbral

4. **Dashboard:** Agregar visualización de movimientos de inventario en el dashboard

## API Endpoints Sugeridos

### Obtener Movimientos de Inventario

```typescript
// GET /api/inventory/movements?product_id={id}
// GET /api/inventory/movements?order_id={id}
// GET /api/inventory/movements?date_from={date}&date_to={date}

router.get('/inventory/movements', async (req: AuthRequest, res: Response) => {
  const { product_id, order_id, date_from, date_to } = req.query;

  let query = supabaseAdmin
    .from('inventory_movements')
    .select('*')
    .eq('store_id', req.storeId)
    .order('created_at', { ascending: false });

  if (product_id) query = query.eq('product_id', product_id);
  if (order_id) query = query.eq('order_id', order_id);
  if (date_from) query = query.gte('created_at', date_from);
  if (date_to) query = query.lte('created_at', date_to);

  const { data, error } = await query;

  if (error) return res.status(500).json({ error });
  return res.json(data);
});
```

### Ajuste Manual de Inventario

```typescript
// POST /api/inventory/adjust
// Body: { product_id, quantity_change, notes }

router.post('/inventory/adjust', async (req: AuthRequest, res: Response) => {
  const { product_id, quantity_change, notes } = req.body;

  // Get current stock
  const { data: product } = await supabaseAdmin
    .from('products')
    .select('stock')
    .eq('id', product_id)
    .single();

  const stock_before = product.stock;
  const stock_after = stock_before + quantity_change;

  // Update stock
  await supabaseAdmin
    .from('products')
    .update({ stock: stock_after })
    .eq('id', product_id);

  // Log movement
  await supabaseAdmin
    .from('inventory_movements')
    .insert({
      store_id: req.storeId,
      product_id,
      quantity_change,
      stock_before,
      stock_after,
      movement_type: 'manual_adjustment',
      notes: notes || 'Manual adjustment'
    });

  return res.json({ success: true, stock_after });
});
```

## Troubleshooting

### Problema: Stock no se decrementa

**Diagnóstico:**
```sql
-- Verificar que el trigger existe
SELECT * FROM pg_trigger WHERE tgname = 'trigger_update_stock_on_order_status';

-- Verificar logs de PostgreSQL
SELECT * FROM pg_stat_user_functions WHERE funcname LIKE '%stock%';
```

**Solución:** Re-ejecutar la migration

### Problema: Stock desincronizado

**Diagnóstico:**
```sql
-- Comparar stock actual vs movimientos
SELECT
    p.id,
    p.name,
    p.stock AS current_stock,
    COALESCE(SUM(im.quantity_change), 0) AS movements_total
FROM products p
LEFT JOIN inventory_movements im ON im.product_id = p.id
WHERE p.store_id = '{store_id}'
GROUP BY p.id, p.name, p.stock;
```

**Solución:** Ejecutar ajuste manual de inventario o recalcular desde movimientos

### Problema: Error al cancelar pedido

**Error:** `Cannot modify line_items for order...`

**Solución:** Usar el endpoint de actualización de status en lugar de editar el pedido completo:
```bash
# ✅ Correcto
curl -X PATCH "$API_URL/orders/$ORDER_ID/status" \
  -d '{"sleeves_status": "cancelled"}'

# ❌ Incorrecto
curl -X PUT "$API_URL/orders/$ORDER_ID" \
  -d '{"sleeves_status": "cancelled", "line_items": [...]}'
```

## Changelog

### v1.0.0 (2024-12-02)
- ✅ Sistema inicial de tracking de inventario
- ✅ Triggers automáticos para decremento/restauración
- ✅ Tabla de audit log (inventory_movements)
- ✅ Protecciones contra edición/eliminación
- ✅ Script de testing completo
- ✅ Documentación completa
