# Sistema de Despacho (Shipping System)

**Fecha de implementación:** 8 de Diciembre, 2025
**Migración:** 027_shipments_system.sql

## 📋 Resumen

Se implementó un sistema completo de despacho de pedidos que permite:
1. **Identificar pedidos en Picking/Packing** - Ahora muestra los pedidos individuales durante el proceso de warehouse
2. **Despachar pedidos a couriers** - Nueva página "Despacho" para entregar pedidos preparados
3. **Tracking de envíos** - Registro completo de cuándo, quién y a qué courier se entregaron los pedidos

## 🔄 Flujo de Estados Actualizado

```
pending (Pendiente)
  ↓
confirmed (Confirmado)
  ↓
in_preparation (En Preparación) ← Picking/Packing en Warehouse
  ↓
ready_to_ship (Preparado) ← Completan warehouse, aparecen en Despacho
  ↓
shipped (En Tránsito) ← Después de despachar al courier
  ↓
delivered (Entregado)
```

## 📦 Cambios Implementados

### 1. Mejora en Vista de Picking

**Archivo:** `src/pages/Warehouse.tsx`

**Cambio:** Ahora muestra la lista de pedidos incluidos en la sesión de picking

**Antes:**
```
Recolección: PREP-08122025-01
(Solo se veía el código de sesión)
```

**Después:**
```
Recolección: PREP-08122025-01

Pedidos en esta sesión (3)
#1001 - Juan Pérez
#1002 - María García
#1003 - Carlos López
```

### 2. Base de Datos - Tabla Shipments

**Archivo:** `db/migrations/027_shipments_system.sql`

**Nueva tabla:**
```sql
CREATE TABLE shipments (
  id UUID PRIMARY KEY,
  store_id UUID REFERENCES stores(id),
  order_id UUID REFERENCES orders(id),
  courier_id UUID REFERENCES carriers(id),
  shipped_at TIMESTAMPTZ,
  shipped_by UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

**Funciones creadas:**
- `create_shipment()` - Crea un envío y actualiza orden a "shipped"
- `create_shipments_batch()` - Despacho masivo con manejo de errores

### 3. Backend - API de Shipping

**Archivos creados:**
- `api/services/shipping.service.ts` - Lógica de negocio
- `api/routes/shipping.ts` - Endpoints REST

**Endpoints:**
- `GET /api/shipping/ready-to-ship` - Pedidos listos para despachar
- `POST /api/shipping/dispatch` - Despachar un pedido
- `POST /api/shipping/dispatch-batch` - Despachar múltiples pedidos
- `GET /api/shipping/order/:orderId` - Historial de envíos de un pedido
- `GET /api/shipping/history` - Historial de todos los envíos

### 4. Frontend - Página de Despacho

**Archivos creados:**
- `src/pages/Shipping.tsx` - Página principal de despacho
- `src/services/shipping.service.ts` - Cliente API

**Funcionalidades:**
- ✅ Vista de pedidos preparados (estado `ready_to_ship`)
- ✅ Selección múltiple de pedidos
- ✅ Modal de confirmación con campo de notas
- ✅ Despacho en lote
- ✅ Estadísticas en tiempo real
- ✅ Información detallada de cada pedido (cliente, dirección, courier, COD)

### 5. Navegación

**Sidebar actualizado:**
```
Logística
  └─ Almacén
  └─ Despacho ← NUEVO
  └─ Mercadería
  └─ Transportadoras
  └─ Conciliaciones
```

## 🚀 Cómo Usar

### 1. Aplicar la migración

```bash
./apply-shipping-migration.sh
```

O manualmente:
```bash
source .env
psql "$DATABASE_URL" -f db/migrations/027_shipments_system.sql
```

### 2. Flujo de trabajo

1. **Crear pedidos** → Estado: `confirmed`
2. **Warehouse - Picking/Packing** → Estado: `in_preparation`
3. **Completar sesión de warehouse** → Estado: `ready_to_ship`
4. **Ir a "Despacho"** → Ver pedidos preparados
5. **Seleccionar pedidos** → Agregar notas opcionales
6. **Confirmar despacho** → Estado: `shipped` (En Tránsito)
7. **Delivery confirma entrega** → Estado: `delivered`

### 3. Ejemplo de uso de la API

**Despachar un pedido:**
```javascript
POST /api/shipping/dispatch
{
  "orderId": "uuid-del-pedido",
  "notes": "Entregado a Juan, conductor placa ABC-123"
}
```

**Despachar varios pedidos:**
```javascript
POST /api/shipping/dispatch-batch
{
  "orderIds": ["uuid-1", "uuid-2", "uuid-3"],
  "notes": "Lote entregado a Andrés y Andrés, 3 pedidos"
}
```

## 🔍 Validaciones y Seguridad

### Validaciones de negocio:
- ✅ Solo se pueden despachar pedidos en estado `ready_to_ship`
- ✅ Se valida que el pedido pertenezca a la tienda actual
- ✅ Se registra el usuario que realizó el despacho
- ✅ Se captura automáticamente la hora de despacho

### Manejo de errores:
- ✅ Si un pedido falla en despacho masivo, los demás continúan
- ✅ Se devuelve detalle de éxitos y fallos
- ✅ Los errores no bloquean el flujo

## 📊 Tracking y Auditoría

La tabla `shipments` permite:
- Ver historial completo de despachos
- Saber quién despachó cada pedido
- Cuándo se entregó al courier
- Notas adicionales (conductor, placa, etc.)
- Múltiples intentos de envío (devoluciones, re-envíos)

## 🛠️ Archivos Modificados/Creados

### Base de Datos:
- ✅ `db/migrations/027_shipments_system.sql` (NUEVO)
- ✅ `apply-shipping-migration.sh` (NUEVO)

### Backend:
- ✅ `api/services/shipping.service.ts` (NUEVO)
- ✅ `api/routes/shipping.ts` (NUEVO)
- ✅ `api/index.ts` (MODIFICADO - agregado router)
- ✅ `api/services/warehouse.service.ts` (MODIFICADO - mejora picking list)

### Frontend:
- ✅ `src/pages/Shipping.tsx` (NUEVO)
- ✅ `src/services/shipping.service.ts` (NUEVO)
- ✅ `src/pages/Warehouse.tsx` (MODIFICADO - muestra pedidos en picking)
- ✅ `src/services/warehouse.service.ts` (MODIFICADO - nuevo tipo de respuesta)
- ✅ `src/components/Sidebar.tsx` (MODIFICADO - enlace Despacho)
- ✅ `src/App.tsx` (MODIFICADO - ruta Shipping)

## 📝 Próximos Pasos Sugeridos

1. **Notificaciones:** Enviar WhatsApp/Email cuando un pedido se despacha
2. **Dashboard Logístico:** Agregar métricas de despacho
3. **Reportes:** Informe de pedidos despachados por día/courier
4. **Impresión de guías:** Integrar con APIs de couriers para generar guías
5. **Tracking en tiempo real:** Integración con APIs de tracking de couriers

## ⚠️ Notas Importantes

- La migración es **idempotente** (se puede ejecutar múltiples veces)
- Los pedidos existentes NO se ven afectados
- El sistema es compatible con todos los estados previos
- El campo `notes` es opcional pero recomendado para auditoría

## 🎯 Beneficios

1. **Visibilidad:** Siempre se sabe qué pedidos están en qué etapa
2. **Trazabilidad:** Registro de quién despachó cada pedido
3. **Eficiencia:** Despacho masivo en un solo clic
4. **Auditoría:** Historial completo de envíos
5. **UX mejorada:** Identificación clara de pedidos en todo el flujo

---

**¿Preguntas o problemas?** Revisa los logs del backend o frontend para más detalles.
