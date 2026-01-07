# Problemas con Despacho de Pedidos

## 🔴 Problema 1: Error 500 en `/api/shipping/dispatch-batch`

### Error Reportado
```
Failed to load resource: the server responded with a status of 500
[API] 500 Server Error
Error dispatching orders: structure of query does not match function result type
```

### Causa Raíz
La función `create_shipments_batch()` **no existe en la base de datos de producción**.

**Migración requerida:** `027_shipments_system.sql`

### Función Faltante
```sql
CREATE OR REPLACE FUNCTION create_shipments_batch(
  p_store_id UUID,
  p_order_ids UUID[],
  p_shipped_by UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
  shipment_id UUID,
  order_id UUID,
  order_number TEXT,
  success BOOLEAN,
  error_message TEXT
) AS $$
-- ... (código completo en migration 027)
$$;
```

### Solución
Aplicar **Migration 027** en Supabase SQL Editor.

---

## 🔴 Problema 2: Pedidos Despachados No Desaparecen de Packing

### Comportamiento Actual
1. Usuario empaca pedidos en sesión de warehouse
2. Usuario despacha pedidos (shipped status)
3. ❌ Pedidos despachados **siguen apareciendo en packing**
4. ❌ Sesión de warehouse permanece activa

### Comportamiento Esperado
1. Pedido despachado → status = 'shipped'
2. Pedido desaparece automáticamente de sesión de packing
3. Si todos los pedidos despachados → sesión se completa automáticamente

### Causa
No hay lógica para:
- Filtrar pedidos despachados de la vista de packing
- Completar automáticamente sesiones cuando todos los pedidos se despacharon

### Solución Requerida

#### Opción 1: Filtro en Frontend (Quick Fix)
Filtrar pedidos con status !== 'ready_to_ship' en componente Warehouse

#### Opción 2: Completar Sesión Automáticamente (Ideal)
Trigger que completa la sesión cuando todos los pedidos están shipped/delivered

```sql
CREATE OR REPLACE FUNCTION auto_complete_warehouse_session()
RETURNS TRIGGER AS $$
DECLARE
  v_session_id UUID;
  v_all_shipped BOOLEAN;
BEGIN
  -- Si el pedido cambió a shipped/delivered
  IF NEW.sleeves_status IN ('shipped', 'delivered', 'cancelled')
     AND OLD.sleeves_status = 'ready_to_ship' THEN

    -- Buscar sesiones activas con este pedido
    FOR v_session_id IN
      SELECT DISTINCT ps.id
      FROM picking_sessions ps
      JOIN picking_session_orders pso ON ps.id = pso.picking_session_id
      WHERE pso.order_id = NEW.id
        AND ps.status = 'packing'
    LOOP
      -- Verificar si todos los pedidos de esta sesión están despachados
      SELECT NOT EXISTS (
        SELECT 1
        FROM picking_session_orders pso2
        JOIN orders o ON pso2.order_id = o.id
        WHERE pso2.picking_session_id = v_session_id
          AND o.sleeves_status = 'ready_to_ship'
      ) INTO v_all_shipped;

      -- Si todos despachados, completar sesión
      IF v_all_shipped THEN
        UPDATE picking_sessions
        SET status = 'completed',
            completed_at = NOW()
        WHERE id = v_session_id;
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_auto_complete_warehouse_session
  AFTER UPDATE OF sleeves_status
  ON orders
  FOR EACH ROW
  EXECUTE FUNCTION auto_complete_warehouse_session();
```

---

## 📋 Plan de Acción

### Inmediato (Crítico)
1. ✅ Aplicar **Migration 027** en Supabase (función create_shipments_batch)
2. ✅ Aplicar **Migration 039** en Supabase (CASCADE DELETE)

### Corto Plazo (UX)
3. ⏳ Implementar auto-completado de sesiones de warehouse (trigger)
4. ⏳ Filtrar pedidos despachados de vista de packing

### Testing
5. Probar flujo completo:
   - Crear pedido confirmado
   - Iniciar picking → completar picking
   - Iniciar packing → empacar productos
   - Despachar pedido
   - Verificar que desaparece de warehouse
   - Verificar que sesión se completa

---

## 🔧 Archivos Afectados

### Backend
- `api/services/shipping.service.ts` (OK - usa función correcta)
- `api/routes/shipping.ts` (OK - maneja errores correctamente)
- `db/migrations/027_shipments_system.sql` (FALTA APLICAR)

### Frontend
- `src/pages/Shipping.tsx` (llama a dispatch-batch)
- `src/pages/Warehouse.tsx` (muestra pedidos en packing - NECESITA FILTRO)

---

## 📊 Estado Actual

| Componente | Estado | Acción Requerida |
|------------|--------|------------------|
| Migration 027 | ❌ No aplicada | Aplicar en Supabase |
| Migration 039 | ❌ No aplicada | Aplicar en Supabase |
| Auto-complete sessions | ❌ No existe | Crear migration 040 |
| Filtro packing UI | ❌ No existe | Modificar Warehouse.tsx |
