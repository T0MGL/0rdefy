# Feature: Flujo de Confirmación Separado

## Investigación Técnica Completa

**Fecha:** 2026-01-28
**Versión:** 1.0
**Estado:** Pendiente de Aprobación

---

## 1. Resumen Ejecutivo

### Problema de Negocio
En tiendas con equipos grandes, existe una separación de responsabilidades:
- **Confirmador:** Contacta al cliente, verifica disponibilidad, confirma la compra
- **Administrador/Logística:** Decide qué transportadora llevará el pedido basándose en zona, carga de trabajo, costos

Actualmente, ambas acciones ocurren en un solo paso, forzando al confirmador a tomar decisiones de logística que no le corresponden.

### Solución Propuesta
Crear un **flujo de confirmación de dos pasos** activable por preferencia:
1. **Paso 1 (Confirmador):** Confirma que el cliente aceptó → Estado: `awaiting_carrier`
2. **Paso 2 (Admin/Owner):** Asigna transportadora y zona → Estado: `confirmed`

### Restricción de Plan
Solo disponible para planes con **más de 1 usuario** (Starter, Growth, Professional).

---

## 2. Estado Actual del Sistema

### 2.1 Flujo de Estados de Órdenes
```
pending → contacted → confirmed → in_preparation → ready_to_ship → shipped → delivered
           (opt)        ↑
                        │
                    [Confirmación actual: carrier asignado aquí]
```

### 2.2 Proceso de Confirmación Actual

**Archivo:** `src/components/OrderConfirmationDialog.tsx`

El diálogo de confirmación actual realiza TODO en un solo paso:
- Selección de ciudad/zona
- Selección de transportadora
- Cálculo de costo de envío
- Aplicación de descuentos
- Upsell de productos
- Preferencias de entrega

**RPC:** `confirm_order_atomic()` en `db/migrations/091_mark_prepaid_cod_orders.sql`
- Requiere `courier_id` (excepto para pickup)
- Actualiza: `sleeves_status='confirmed'`, `courier_id`, `shipping_cost`, etc.

### 2.3 Permisos del Rol Confirmador

```typescript
// api/permissions.ts líneas 115-132
[Role.CONFIRMADOR]: {
  ORDERS: [VIEW, CREATE, EDIT],  // Puede confirmar
  CARRIERS: [VIEW],               // Solo ver carriers
  // ... resto sin acceso
}
```

**Problema:** El confirmador tiene `ORDERS.EDIT`, lo que le permite confirmar Y asignar carrier.

### 2.4 Sistema de Preferencias de Tienda

**Tabla:** `stores` (líneas 60-71 de `000_MASTER_MIGRATION.sql`)
```sql
CREATE TABLE stores (
  id UUID PRIMARY KEY,
  name VARCHAR(255),
  timezone VARCHAR(50) DEFAULT 'America/Asuncion',
  currency VARCHAR(3) DEFAULT 'USD',
  -- ... otros campos
);
```

**NO existe:** Un campo para preferencias de flujo de trabajo.

### 2.5 Validación de Usuarios por Plan

```typescript
// src/contexts/SubscriptionContext.tsx
Free: max_users = 1        // NO elegible
Starter: max_users = 3     // Elegible
Growth: max_users = 10     // Elegible
Professional: max_users = 25  // Elegible
```

---

## 3. Propuesta de Arquitectura

### 3.1 Nuevo Estado: `awaiting_carrier`

```
pending → contacted → awaiting_carrier → confirmed → in_preparation → ...
           (opt)           ↑                  ↑
                           │                  │
            [Confirmador confirma    [Admin asigna
             sin carrier]             carrier]
```

**Justificación para nuevo estado vs flag:**
1. ✅ Explícito y claro en UI (badge diferente)
2. ✅ Filtros nativos en queries SQL
3. ✅ No afecta triggers de stock (solo disparan en `ready_to_ship`)
4. ✅ Reportes y analytics funcionan sin modificación
5. ✅ Consistent con patrón existente (ver Migration 099 - `contacted`)

### 3.2 Nueva Preferencia de Tienda

**Campo:** `stores.separate_confirmation_flow BOOLEAN DEFAULT FALSE`

- `FALSE` (default): Flujo tradicional (confirmador asigna carrier)
- `TRUE`: Flujo separado (confirmador → awaiting_carrier, admin → confirmed)

### 3.3 Nuevas Columnas de Tracking

```sql
orders.carrier_assigned_at TIMESTAMP
orders.carrier_assigned_by VARCHAR(100)
```

Permite auditar quién y cuándo asignó el carrier.

### 3.4 Lógica Condicional de Confirmación

```typescript
// Pseudocódigo
async function handleConfirm(order, payload, userRole, storeConfig) {
  const separateFlow = storeConfig.separate_confirmation_flow;
  const isConfirmador = userRole === 'confirmador';

  if (separateFlow && isConfirmador) {
    // Paso 1: Confirmador confirma SIN carrier
    return confirmWithoutCarrier(order, payload);
    // Estado resultante: 'awaiting_carrier'
  } else {
    // Flujo tradicional: confirmar CON carrier
    return confirmWithCarrier(order, payload);
    // Estado resultante: 'confirmed'
  }
}
```

### 3.5 Nuevo Endpoint para Asignación de Carrier

```typescript
POST /api/orders/:id/assign-carrier
Authorization: Bearer {token}
X-Store-ID: {storeId}

Body: {
  courier_id: UUID,
  delivery_zone?: string,
  shipping_city?: string,
  shipping_cost: number
}

Response: {
  success: true,
  order: { ...updatedOrder },
  meta: {
    previous_status: 'awaiting_carrier',
    new_status: 'confirmed',
    carrier_assigned_by: string,
    carrier_assigned_at: timestamp
  }
}

Permissions: Requiere ORDERS.EDIT + (role === 'owner' || role === 'admin')
```

---

## 4. Plan de Implementación Detallado

### Fase 1: Base de Datos (Migration 111)

**Archivo:** `db/migrations/111_separate_confirmation_flow.sql`

```sql
-- 1. Nueva preferencia en stores
ALTER TABLE stores ADD COLUMN IF NOT EXISTS
  separate_confirmation_flow BOOLEAN DEFAULT FALSE;

-- 2. Nuevo estado en CHECK constraint
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_sleeves_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_sleeves_status_check
  CHECK (sleeves_status IS NULL OR sleeves_status IN (
    'pending', 'contacted', 'awaiting_carrier',  -- NEW
    'confirmed', 'in_preparation', 'ready_to_ship',
    'shipped', 'in_transit', 'delivered',
    'returned', 'cancelled', 'rejected', 'incident'
  ));

-- 3. Columnas de tracking de asignación
ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier_assigned_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier_assigned_by VARCHAR(100);

-- 4. Índice para filtrar órdenes pendientes de carrier
CREATE INDEX IF NOT EXISTS idx_orders_awaiting_carrier
  ON orders(store_id, sleeves_status)
  WHERE sleeves_status = 'awaiting_carrier';

-- 5. Vista para órdenes pendientes de asignación
CREATE OR REPLACE VIEW v_orders_awaiting_carrier AS
SELECT
  o.id,
  o.store_id,
  o.order_number,
  o.customer_first_name || ' ' || COALESCE(o.customer_last_name, '') AS customer_name,
  o.customer_phone,
  o.shipping_address,
  o.shipping_city,
  o.delivery_zone,
  o.total_price,
  o.confirmed_at,
  o.confirmed_by,
  EXTRACT(EPOCH FROM (NOW() - o.confirmed_at))/3600 AS hours_since_confirmation,
  CASE
    WHEN o.confirmed_at < NOW() - INTERVAL '24 hours' THEN 'CRITICAL'
    WHEN o.confirmed_at < NOW() - INTERVAL '8 hours' THEN 'WARNING'
    ELSE 'OK'
  END AS urgency_level
FROM orders o
WHERE o.sleeves_status = 'awaiting_carrier'
  AND o.deleted_at IS NULL
ORDER BY o.confirmed_at ASC;

-- 6. RPC para confirmar sin carrier (Paso 1)
CREATE OR REPLACE FUNCTION confirm_order_without_carrier(
  p_order_id UUID,
  p_store_id UUID,
  p_confirmed_by TEXT,
  p_address TEXT DEFAULT NULL,
  p_google_maps_link TEXT DEFAULT NULL,
  p_discount_amount DECIMAL DEFAULT NULL,
  p_mark_as_prepaid BOOLEAN DEFAULT FALSE,
  p_prepaid_method TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_order RECORD;
  v_result JSON;
BEGIN
  -- Lock and validate order
  SELECT * INTO v_order FROM orders
  WHERE id = p_order_id AND store_id = p_store_id
  FOR UPDATE;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  IF v_order.sleeves_status NOT IN ('pending', 'contacted') THEN
    RAISE EXCEPTION 'INVALID_STATUS: Order must be pending or contacted';
  END IF;

  -- Update order to awaiting_carrier
  UPDATE orders SET
    sleeves_status = 'awaiting_carrier',
    confirmed_at = NOW(),
    confirmed_by = p_confirmed_by,
    confirmation_method = 'dashboard',
    shipping_address = COALESCE(p_address, shipping_address),
    google_maps_link = COALESCE(p_google_maps_link, google_maps_link),
    total_discounts = COALESCE(p_discount_amount, total_discounts),
    financial_status = CASE WHEN p_mark_as_prepaid THEN 'paid' ELSE financial_status END,
    prepaid_method = CASE WHEN p_mark_as_prepaid THEN COALESCE(p_prepaid_method, 'transfer') ELSE NULL END,
    prepaid_at = CASE WHEN p_mark_as_prepaid THEN NOW() ELSE NULL END,
    prepaid_by = CASE WHEN p_mark_as_prepaid THEN p_confirmed_by ELSE NULL END,
    updated_at = NOW()
  WHERE id = p_order_id;

  -- Return result
  SELECT json_build_object(
    'success', true,
    'order_id', p_order_id,
    'new_status', 'awaiting_carrier',
    'confirmed_by', p_confirmed_by,
    'confirmed_at', NOW()
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- 7. RPC para asignar carrier (Paso 2)
CREATE OR REPLACE FUNCTION assign_carrier_to_order(
  p_order_id UUID,
  p_store_id UUID,
  p_assigned_by TEXT,
  p_courier_id UUID,
  p_delivery_zone TEXT DEFAULT NULL,
  p_shipping_city TEXT DEFAULT NULL,
  p_shipping_cost DECIMAL DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_order RECORD;
  v_carrier RECORD;
  v_result JSON;
BEGIN
  -- Lock and validate order
  SELECT * INTO v_order FROM orders
  WHERE id = p_order_id AND store_id = p_store_id
  FOR UPDATE;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  IF v_order.sleeves_status != 'awaiting_carrier' THEN
    RAISE EXCEPTION 'INVALID_STATUS: Order must be awaiting_carrier';
  END IF;

  -- Validate carrier
  SELECT * INTO v_carrier FROM carriers
  WHERE id = p_courier_id AND store_id = p_store_id AND is_active = true;

  IF v_carrier IS NULL THEN
    RAISE EXCEPTION 'CARRIER_NOT_FOUND';
  END IF;

  -- Update order with carrier
  UPDATE orders SET
    sleeves_status = 'confirmed',
    courier_id = p_courier_id,
    delivery_zone = COALESCE(p_delivery_zone, delivery_zone),
    shipping_city = COALESCE(p_shipping_city, shipping_city),
    shipping_city_normalized = LOWER(COALESCE(p_shipping_city, shipping_city)),
    shipping_cost = COALESCE(p_shipping_cost, 0),
    carrier_assigned_at = NOW(),
    carrier_assigned_by = p_assigned_by,
    updated_at = NOW()
  WHERE id = p_order_id;

  -- Return result
  SELECT json_build_object(
    'success', true,
    'order_id', p_order_id,
    'new_status', 'confirmed',
    'carrier_id', p_courier_id,
    'carrier_name', v_carrier.name,
    'carrier_assigned_by', p_assigned_by,
    'carrier_assigned_at', NOW(),
    'shipping_cost', COALESCE(p_shipping_cost, 0)
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;
```

### Fase 2: Backend API

**Archivo:** `api/routes/orders.ts`

#### 2.1 Nuevo Endpoint: Asignar Carrier

```typescript
// POST /api/orders/:id/assign-carrier
router.post('/:id/assign-carrier',
  requirePermission(Module.ORDERS, Permission.EDIT),
  async (req, res) => {
    const { id } = req.params;
    const { courier_id, delivery_zone, shipping_city, shipping_cost } = req.body;
    const storeId = req.storeId;
    const userId = req.userId;

    // Verificar que el usuario es owner o admin
    const userRole = await extractUserRoleFromDB(userId, storeId);
    if (!['owner', 'admin'].includes(userRole)) {
      return res.status(403).json({
        error: 'Solo owner o admin pueden asignar transportadora en flujo separado'
      });
    }

    // Llamar RPC
    const { data, error } = await supabaseAdmin.rpc('assign_carrier_to_order', {
      p_order_id: id,
      p_store_id: storeId,
      p_assigned_by: userId,
      p_courier_id: courier_id,
      p_delivery_zone: delivery_zone,
      p_shipping_city: shipping_city,
      p_shipping_cost: shipping_cost
    });

    if (error) {
      // Manejo de errores específicos
    }

    return res.json({ success: true, data });
  }
);
```

#### 2.2 Modificar Endpoint de Confirmación

```typescript
// Modificar POST /api/orders/:id/confirm
// Agregar lógica para detectar flujo separado

// 1. Obtener configuración de tienda
const { data: storeConfig } = await supabaseAdmin
  .from('stores')
  .select('separate_confirmation_flow')
  .eq('id', storeId)
  .single();

// 2. Obtener rol del usuario
const userRole = await extractUserRoleFromDB(userId, storeId);

// 3. Decidir qué RPC llamar
const separateFlow = storeConfig?.separate_confirmation_flow;
const isConfirmador = userRole === 'confirmador';

if (separateFlow && isConfirmador && !courier_id && !is_pickup) {
  // Flujo separado: confirmar sin carrier
  const { data, error } = await supabaseAdmin.rpc('confirm_order_without_carrier', {
    p_order_id: id,
    p_store_id: storeId,
    p_confirmed_by: userId,
    // ... otros params
  });
} else {
  // Flujo tradicional: confirmar con carrier
  const { data, error } = await supabaseAdmin.rpc('confirm_order_atomic', {
    // ... params existentes
  });
}
```

#### 2.3 Nuevo Endpoint: Preferencias de Tienda

```typescript
// PUT /api/auth/stores/:storeId/preferences
router.put('/stores/:storeId/preferences',
  verifyToken,
  async (req, res) => {
    const { storeId } = req.params;
    const { separate_confirmation_flow } = req.body;

    // Validar acceso a tienda
    const hasAccess = await verifyStoreAccess(req.userId, storeId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Sin acceso a esta tienda' });
    }

    // Verificar que el plan permite múltiples usuarios
    const { data: subscription } = await supabaseAdmin
      .from('subscriptions')
      .select('plan')
      .eq('store_id', storeId)
      .single();

    const planLimits = await getPlanLimits(subscription?.plan || 'free');
    if (planLimits.max_users <= 1 && separate_confirmation_flow) {
      return res.status(400).json({
        error: 'Esta funcionalidad requiere un plan con múltiples usuarios'
      });
    }

    // Actualizar preferencia
    const { error } = await supabaseAdmin
      .from('stores')
      .update({ separate_confirmation_flow })
      .eq('id', storeId);

    if (error) {
      return res.status(500).json({ error: 'Error actualizando preferencia' });
    }

    return res.json({ success: true, separate_confirmation_flow });
  }
);
```

### Fase 3: Frontend

#### 3.1 Modificar Settings.tsx

**Ubicación:** `src/pages/Settings.tsx` (Tab "Preferencias")

```tsx
// Nueva sección: Flujo de Trabajo
<Card className="p-6">
  <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
    <Settings className="w-5 h-5" />
    Flujo de Trabajo
  </h3>

  {!hasTeamManagement ? (
    <div className="bg-muted/50 rounded-lg p-4 text-center">
      <Lock className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
      <p className="text-sm text-muted-foreground">
        Esta funcionalidad requiere un plan con múltiples usuarios.
      </p>
      <Button size="sm" className="mt-2" onClick={() => navigate('/billing')}>
        Ver planes
      </Button>
    </div>
  ) : (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="font-medium">Separar confirmación de asignación</Label>
          <p className="text-sm text-muted-foreground">
            Los confirmadores solo confirman la venta. El administrador asigna la transportadora después.
          </p>
        </div>
        <Switch
          checked={separateConfirmationFlow}
          onCheckedChange={handleSeparateFlowChange}
        />
      </div>

      {separateConfirmationFlow && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Cuando está activado, los pedidos confirmados por confirmadores
            quedarán en estado "Pendiente de Carrier" hasta que un administrador
            asigne la transportadora.
          </AlertDescription>
        </Alert>
      )}
    </div>
  )}
</Card>
```

#### 3.2 Modificar OrderConfirmationDialog.tsx

```tsx
// Agregar detección de flujo separado
const { separateConfirmationFlow } = useStoreConfig();
const { role } = useAuth();

const isConfirmadorInSeparateFlow =
  separateConfirmationFlow &&
  role === 'confirmador';

// Modificar UI condicionalmente
{!isConfirmadorInSeparateFlow && (
  // Secciones de carrier, zona, costo de envío
  <CarrierSelection />
)}

{isConfirmadorInSeparateFlow && (
  <Alert className="bg-blue-50 border-blue-200">
    <Info className="h-4 w-4 text-blue-500" />
    <AlertDescription>
      Este pedido será asignado a una transportadora por el administrador.
      Solo debes confirmar que el cliente aceptó la compra.
    </AlertDescription>
  </Alert>
)}

// Modificar botón de submit
<Button onClick={handleConfirm}>
  {isConfirmadorInSeparateFlow
    ? 'Confirmar Venta'
    : 'Confirmar y Asignar Transportadora'}
</Button>
```

#### 3.3 Nuevo Componente: CarrierAssignmentDialog

**Archivo:** `src/components/CarrierAssignmentDialog.tsx`

```tsx
// Diálogo para que admin/owner asigne carrier a órdenes en awaiting_carrier
interface CarrierAssignmentDialogProps {
  order: Order;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssigned: () => void;
}

export function CarrierAssignmentDialog({ order, open, onOpenChange, onAssigned }: Props) {
  // Reutilizar lógica de selección de carrier del OrderConfirmationDialog
  // pero solo la parte de carrier/zona/costo

  const handleAssign = async () => {
    const response = await ordersService.assignCarrier(order.id, {
      courier_id: selectedCarrier,
      shipping_city: selectedCity,
      delivery_zone: selectedZone,
      shipping_cost: shippingCost
    });

    if (response.success) {
      toast({ title: 'Transportadora asignada', ... });
      onAssigned();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Asignar Transportadora</DialogTitle>
          <DialogDescription>
            Pedido #{order.order_number} - {order.customer_first_name}
          </DialogDescription>
        </DialogHeader>

        {/* Selector de ciudad/carrier */}
        <CityCarrierSelector
          onSelect={(carrier, city, cost) => {
            setSelectedCarrier(carrier);
            setSelectedCity(city);
            setShippingCost(cost);
          }}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleAssign}>
            Asignar y Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

#### 3.4 Modificar Orders.tsx

```tsx
// Agregar badge para awaiting_carrier
const statusBadge = (status: string) => {
  switch (status) {
    case 'awaiting_carrier':
      return (
        <Badge className="bg-amber-100 text-amber-700 border-amber-200">
          <Truck className="w-3 h-3 mr-1" />
          Pendiente de Carrier
        </Badge>
      );
    // ... otros casos
  }
};

// Agregar filtro
const statusFilters = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'contacted', label: 'Contactados' },
  { value: 'awaiting_carrier', label: 'Pendiente de Carrier' },  // NEW
  { value: 'confirmed', label: 'Confirmados' },
  // ...
];

// Agregar acción de asignar carrier
{order.sleeves_status === 'awaiting_carrier' && (role === 'owner' || role === 'admin') && (
  <Button
    size="sm"
    onClick={() => openCarrierAssignmentDialog(order)}
  >
    <Truck className="w-4 h-4 mr-1" />
    Asignar Carrier
  </Button>
)}
```

### Fase 4: TypeScript Types

**Archivo:** `src/types/index.ts`

```typescript
// Actualizar OrderStatus
export type OrderStatus =
  | 'pending'
  | 'contacted'
  | 'awaiting_carrier'  // NEW
  | 'confirmed'
  | 'in_preparation'
  | 'ready_to_ship'
  | 'shipped'
  | 'in_transit'
  | 'delivered'
  | 'returned'
  | 'cancelled'
  | 'rejected'
  | 'incident';

// Actualizar Order interface
export interface Order {
  // ... campos existentes
  carrier_assigned_at?: string;
  carrier_assigned_by?: string;
}

// Nueva interface para config de tienda
export interface StoreConfig {
  separate_confirmation_flow: boolean;
  // ... otros campos
}
```

---

## 5. Archivos Afectados

### Archivos a CREAR:
| Archivo | Descripción |
|---------|-------------|
| `db/migrations/111_separate_confirmation_flow.sql` | Migration con nuevo estado, preferencia, RPCs |
| `src/components/CarrierAssignmentDialog.tsx` | Diálogo para asignar carrier |
| `src/hooks/useStoreConfig.ts` | Hook para acceder a configuración de tienda |

### Archivos a MODIFICAR:
| Archivo | Cambios |
|---------|---------|
| `api/routes/orders.ts` | Nuevo endpoint assign-carrier, modificar confirm |
| `api/routes/auth.ts` | Nuevo endpoint preferences |
| `src/pages/Settings.tsx` | Nueva sección Flujo de Trabajo |
| `src/components/OrderConfirmationDialog.tsx` | Lógica condicional |
| `src/pages/Orders.tsx` | Badge, filtro, acción para awaiting_carrier |
| `src/types/index.ts` | Nuevo estado, nuevos campos |
| `src/services/orders.service.ts` | Nuevo método assignCarrier |

### Archivos SIN CAMBIOS:
| Archivo | Razón |
|---------|-------|
| `api/permissions.ts` | Los permisos existentes son suficientes |
| Triggers de stock | Solo disparan en ready_to_ship |
| Warehouse module | No afecta picking/packing |
| Settlements module | Solo procesa órdenes confirmed |

---

## 6. Riesgos y Mitigaciones

### Riesgo 1: Órdenes atrapadas en awaiting_carrier
**Problema:** Si no hay admin disponible, órdenes pueden quedarse sin asignar.
**Mitigación:**
- Vista de urgencia con indicadores WARNING (>8h) y CRITICAL (>24h)
- Notificación push/email a admins cuando hay órdenes pendientes

### Riesgo 2: Regresión en flujo tradicional
**Problema:** Romper el flujo para tiendas que no usan esta feature.
**Mitigación:**
- Default `separate_confirmation_flow = FALSE`
- Tests exhaustivos para ambos flujos
- Feature flag permite rollback instantáneo

### Riesgo 3: UX confusa para confirmadores
**Problema:** Confirmadores no entienden el nuevo flujo.
**Mitigación:**
- Mensaje claro en el diálogo explicando qué pasará
- Badge distintivo para órdenes awaiting_carrier
- Documentación y onboarding

### Riesgo 4: Inconsistencia en reportes
**Problema:** Analytics no reconoce el nuevo estado.
**Mitigación:**
- Actualizar queries de analytics para incluir awaiting_carrier
- El estado cuenta como "confirmado parcialmente" en métricas

---

## 7. Criterios de Aceptación

### Funcionales:
- [ ] Toggle en Settings solo visible para planes Starter+
- [ ] Toggle deshabilitado si tienda tiene solo 1 usuario
- [ ] Confirmador ve diálogo simplificado (sin carrier) cuando flujo separado activo
- [ ] Orden queda en `awaiting_carrier` después de confirmación de confirmador
- [ ] Solo owner/admin ven botón "Asignar Carrier"
- [ ] Admin puede asignar carrier y orden pasa a `confirmed`
- [ ] Flujo tradicional sigue funcionando cuando toggle OFF

### No Funcionales:
- [ ] Migración es idempotente (puede ejecutarse múltiples veces)
- [ ] Performance: No degradación en listado de órdenes
- [ ] Backward compatible: Órdenes existentes no afectadas

---

## 8. Estimación de Esfuerzo

| Fase | Componentes | Complejidad | Riesgo |
|------|-------------|-------------|--------|
| Migration SQL | 1 archivo, ~150 líneas | Media | Bajo |
| Backend API | 3 endpoints, ~200 líneas | Media | Medio |
| Frontend | 4 componentes, ~400 líneas | Alta | Medio |
| Testing | Unit + E2E | Alta | N/A |
| **Total** | ~750 líneas código nuevo | **Media-Alta** | **Medio** |

---

## 9. Decisiones Pendientes

1. **¿Permitir que logistics también asigne carrier?**
   - Opción A: Solo owner/admin (más restrictivo)
   - Opción B: owner/admin/logistics (más flexible)

2. **¿Notificaciones cuando hay órdenes awaiting_carrier?**
   - Opción A: No notificaciones (simple)
   - Opción B: Notificación en dashboard (medio)
   - Opción C: Push/email notifications (complejo)

3. **¿Permitir que confirmador asigne carrier opcionalmente?**
   - Opción A: Confirmador NUNCA asigna cuando flujo separado (estricto)
   - Opción B: Confirmador PUEDE asignar si quiere (flexible)

---

## Aprobación

**Fecha de revisión:** _______________

**Aprobado por:** _______________

**Comentarios:**

---

*Documento generado por investigación técnica profunda del codebase Ordefy.*
