# 🔧 Solución: Problemas de Creación y Eliminación de Pedidos

## Problema Identificado

Los triggers de protección de inventario estaban bloqueando:
1. ❌ **Creación de pedidos** cuando los productos no existen
2. ❌ **Eliminación de pedidos** incluso si no han sido procesados

## Causa Raíz

Los triggers implementados en la migración `019_inventory_management.sql` tenían dos problemas:

1. **`update_product_stock_on_order_status()`**: Lanzaba excepciones (`RAISE EXCEPTION`) cuando un producto no existía, bloqueando completamente la creación de pedidos con productos inválidos o faltantes
2. **`prevent_order_deletion_after_stock_deducted()`**: Verificaba solo el estado del pedido (`ready_to_ship`, `shipped`, `delivered`) sin confirmar si realmente se decrementó stock, bloqueando la eliminación de pedidos válidos

## Solución Implementada

He creado la migración `023_fix_order_creation_and_deletion.sql` que:

### ✅ Trigger de Stock (FIXED)
- **Antes**: `RAISE EXCEPTION` cuando falta un producto → Bloqueaba creación
- **Ahora**: `RAISE WARNING` y `CONTINUE` → Permite creación, solo advierte
- **Resultado**: Pedidos se pueden crear con productos faltantes (útil para webhooks de Shopify con productos no mapeados)

### ✅ Trigger de Eliminación (FIXED)
- **Antes**: Verificaba solo `sleeves_status IN ('ready_to_ship', 'shipped', 'delivered')`
- **Ahora**: Verifica tabla `inventory_movements` para confirmar que hubo decremento real
- **Resultado**:
  - ✅ Permite eliminar pedidos `pending`, `confirmed`, `in_preparation`
  - ✅ Permite eliminar pedidos con productos inválidos
  - ✅ Protege solo pedidos que SÍ afectaron el inventario

## Cómo Aplicar la Solución

### Opción 1: SQL Editor de Supabase (Recomendado)

1. Abre tu panel de Supabase: https://ecommerce-software-supabase.aqiebe.easypanel.host (o el dashboard si tienes acceso)
2. Ve al **SQL Editor**
3. Copia y pega el contenido de: `db/migrations/023_fix_order_creation_and_deletion.sql`
4. Ejecuta el SQL
5. ✅ Listo

### Opción 2: CLI de Supabase (Si tienes psql instalado)

```bash
# Asumiendo que tienes las credenciales de PostgreSQL
psql $DATABASE_URL -f db/migrations/023_fix_order_creation_and_deletion.sql
```

### Opción 3: Desde el backend (Si tienes acceso directo a PostgreSQL)

```bash
# Conecta a tu base de datos y ejecuta:
\i /path/to/db/migrations/023_fix_order_creation_and_deletion.sql
```

## Verificación

Después de aplicar la migración, verifica que funcione:

### Probar Creación de Pedidos:

```bash
# Crear un pedido de prueba vía API
curl -X POST http://localhost:3001/api/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Store-ID: YOUR_STORE_ID" \
  -d '{
    "customer_phone": "123456789",
    "customer_first_name": "Test",
    "customer_last_name": "User",
    "line_items": [{"product_id": "invalid-uuid", "quantity": 1}],
    "total_price": 10.00
  }'
```

✅ Debería crear el pedido con warnings en los logs (no exceptions)

### Probar Eliminación de Pedidos:

```bash
# Eliminar un pedido en estado 'pending'
curl -X DELETE http://localhost:3001/api/orders/YOUR_ORDER_ID \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Store-ID: YOUR_STORE_ID"
```

✅ Debería eliminar el pedido sin errores

## Cambios Técnicos

### 1. Función `update_product_stock_on_order_status()`

**Antes:**
```sql
IF FOUND THEN
    -- Update stock...
ELSE
    RAISE EXCEPTION 'Product % not found...'; -- ❌ BLOQUEA
END IF;
```

**Ahora:**
```sql
-- Check if product exists BEFORE trying to update
SELECT EXISTS(...) INTO product_exists;

IF NOT product_exists THEN
    RAISE WARNING 'Product % not found...'; -- ⚠️ ADVIERTE
    CONTINUE; -- ✅ CONTINÚA
END IF;
```

### 2. Función `prevent_order_deletion_after_stock_deducted()`

**Antes:**
```sql
IF OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'delivered') THEN
    RAISE EXCEPTION '...'; -- ❌ BLOQUEA BASADO SOLO EN STATUS
END IF;
```

**Ahora:**
```sql
-- Check if this order ACTUALLY decremented stock
SELECT EXISTS(
    SELECT 1 FROM inventory_movements
    WHERE order_id = OLD.id
) INTO has_stock_movements;

IF has_stock_movements THEN
    RAISE EXCEPTION '...'; -- ❌ BLOQUEA SOLO SI HAY MOVIMIENTOS
END IF;

-- ✅ PERMITE ELIMINACIÓN SI NO HAY MOVIMIENTOS
```

## Beneficios

1. ✅ **Creación de pedidos robusta**: Maneja webhooks de Shopify con productos no mapeados
2. ✅ **Eliminación flexible**: Permite borrar pedidos creados manualmente o con errores
3. ✅ **Integridad de datos**: Protege solo pedidos que afectaron el inventario
4. ✅ **Sin cambios en el código**: Solo cambios en la base de datos
5. ✅ **Logs mejorados**: Warnings en lugar de exceptions para debugging

## Prevención Futura

Para evitar problemas similares en el futuro:

1. **Validar productos antes de crear pedidos** (en la API):
   ```typescript
   // En api/routes/orders.ts
   const validProducts = await validateProducts(line_items);
   ```

2. **Agregar tests de integración**:
   ```javascript
   // test/orders.test.js
   it('should create order with invalid products', async () => {
     const order = await createOrder({ line_items: [{ product_id: 'invalid' }] });
     expect(order).toBeDefined();
   });
   ```

3. **Monitorear warnings en producción**:
   ```sql
   -- Ver warnings recientes
   SELECT * FROM pg_stat_statements
   WHERE query LIKE '%Product%not found%';
   ```

## Soporte

Si encuentras problemas:
1. Verifica los logs del servidor (`console.log` mostrará warnings)
2. Revisa la tabla `inventory_movements` para ver el historial de stock
3. Contacta al equipo de desarrollo con los logs específicos

---

**Desarrollado por**: Bright Idea
**Fecha**: 2025-12-04
**Migración**: `023_fix_order_creation_and_deletion.sql`
