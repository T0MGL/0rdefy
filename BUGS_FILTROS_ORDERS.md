# 🐛 REPORTE DE BUGS - SISTEMA DE FILTROS DE ORDERS

**Fecha:** 2026-02-09
**Sistema:** Ordefy v1.0 ($150k USD)
**Componente:** Filtros de Orders (Fechas, Estados, Búsqueda)
**Severidad:** 3 CRÍTICOS, 2 ALTOS, 2 MEDIOS

---

## 🔴 BUG #1: Estado "contacted" FALTA en FilterChips (CRÍTICO)

### Descripción
El estado `contacted` fue agregado en la Migration 099 (confirmado en CLAUDE.md) pero NO existe en los chips de filtro permanentes. Los usuarios NO pueden filtrar órdenes contactadas.

### Ubicación
**Archivo:** `src/components/FilterChips.tsx`
**Líneas:** 51-122

### Código Actual
```typescript
const defaults: SavedFilter[] = [
  { id: 'pending', name: 'Pendientes', icon: '⏰', filters: { status: 'pending' }, isPermanent: true },
  { id: 'awaiting-carrier', name: 'Esperando Asignación', icon: '🚛', filters: { status: 'awaiting_carrier' }, isPermanent: true },
  { id: 'confirmed', name: 'Confirmados', icon: '✅', filters: { status: 'confirmed' }, isPermanent: true },
  // ❌ FALTA: { id: 'contacted', name: 'Contactados', icon: '📞', filters: { status: 'contacted' }, isPermanent: true }
  { id: 'in-preparation', name: 'En Preparación', icon: '🔧', filters: { status: 'in_preparation' }, isPermanent: true },
  { id: 'ready-to-ship', name: 'Preparados', icon: '📦', filters: { status: 'ready_to_ship' }, isPermanent: true },
  // ... resto de filtros
];
```

### Impacto
- ❌ Los confirmadores NO pueden ver qué clientes ya fueron contactados
- ❌ No hay forma de hacer seguimiento a órdenes contactadas pendientes de confirmación
- ❌ El flujo de trabajo `pending → contacted → confirmed` queda invisible

### Solución
Agregar el chip "Contactados" en la posición correcta (entre "Pendientes" y "Esperando Asignación"):

```typescript
const defaults: SavedFilter[] = [
  {
    id: 'pending',
    name: 'Pendientes',
    icon: '⏰',
    filters: { status: 'pending' },
    isPermanent: true,
  },
  {
    id: 'contacted',
    name: 'Contactados',
    icon: '📞',
    filters: { status: 'contacted' },
    isPermanent: true,
  },
  {
    id: 'awaiting-carrier',
    name: 'Esperando Asignación',
    icon: '🚛',
    filters: { status: 'awaiting_carrier' },
    isPermanent: true,
  },
  // ... resto
];
```

---

## 🔴 BUG #2: Búsqueda Multi-Palabra usa OR en vez de AND (CRÍTICO)

### Descripción
La búsqueda de múltiples palabras (ej: "Juan Perez") usa lógica **OR** cuando debería usar **AND**. Esto devuelve TODOS los "Juan" Y TODOS los "Perez" en vez de solo "Juan Perez".

### Ubicación
**Archivo:** `api/routes/orders.ts`
**Líneas:** 790-800

### Código Actual (INCORRECTO)
```typescript
if (words.length > 1) {
  // ❌ COMENTARIO DICE "AND logic" PERO EL CÓDIGO USA OR
  // Multiple words: search each word in both first and last name (AND logic)
  const nameConditions = words.map(word =>
    `customer_first_name.ilike.%${word}%,customer_last_name.ilike.%${word}%`
  ).join(',');

  // ❌ ESTO CREA: "first.ilike.%Juan%,last.ilike.%Juan%,first.ilike.%Perez%,last.ilike.%Perez%,..."
  // Lo cual es un OR gigante (cualquier campo que coincida)
  query = query.or(
    `${nameConditions},customer_phone.ilike.%${searchClean}%,shopify_order_name.ilike.%${searchClean}%,shopify_order_number.ilike.%${searchClean}%,id.ilike.%${searchClean}%`
  );
}
```

### Ejemplo del Problema
**Búsqueda:** "Juan Perez"
**Resultado Esperado:** Solo clientes con nombre "Juan" Y apellido "Perez"
**Resultado Actual:** TODOS los clientes llamados "Juan" + TODOS los clientes apellidados "Perez" + teléfonos con "Juan Perez" + etc.

### Impacto
- ❌ Búsquedas de nombres completos devuelven demasiados resultados (falsos positivos)
- ❌ Imposible buscar clientes específicos cuando hay muchos con el mismo nombre o apellido
- ❌ Confirmadores pierden tiempo revisando resultados irrelevantes

### Solución (Supabase no soporta AND nativo, requiere múltiples filtros)
```typescript
if (words.length > 1) {
  // Opción 1: Buscar frase completa (más estricto)
  query = query.or(
    `customer_first_name.ilike.%${searchClean}%,customer_last_name.ilike.%${searchClean}%,customer_phone.ilike.%${searchClean}%,shopify_order_name.ilike.%${searchClean}%,shopify_order_number.ilike.%${searchClean}%,id.ilike.%${searchClean}%`
  );

  // Opción 2: Aplicar filtros secuenciales (AND real)
  // Esto requiere cambiar la arquitectura a múltiples .filter() en vez de un solo .or()
  words.forEach(word => {
    query = query.or(
      `customer_first_name.ilike.%${word}%,customer_last_name.ilike.%${word}%`
    );
  });
}
```

**NOTA:** La solución correcta requiere reestructurar la lógica de búsqueda. PostgREST no soporta AND entre múltiples OR dentro de un solo filtro.

---

## 🔴 BUG #3: Filtro de Carrier "none" está mal implementado (CRÍTICO)

### Descripción
El filtro "Sin transportadora" NO funciona correctamente porque `.or()` sobrescribe el filtro anterior en PostgREST/Supabase.

### Ubicación
**Archivo:** `api/routes/orders.ts`
**Línea:** 764

### Código Actual (INCORRECTO)
```typescript
} else if (carrierStr === 'none') {
  // ❌ ESTO NO FUNCIONA: .or() SOBRESCRIBE el .is() anterior
  query = query.is('courier_id', null).or('is_pickup.is.null,is_pickup.eq.false');
}
```

### Qué hace realmente
El código intenta decir:
- "courier_id es NULL" **Y** "(is_pickup es NULL **O** is_pickup es false)"

Pero PostgREST interpreta:
- "is_pickup es NULL **O** is_pickup es false"
  (El `.is('courier_id', null)` se ignora)

### Impacto
- ❌ El filtro "Sin transportadora" muestra órdenes con transportadora
- ❌ Órdenes de pickup aparecen cuando no deberían
- ❌ Imposible identificar órdenes que necesitan asignación de carrier

### Solución
```typescript
} else if (carrierStr === 'none') {
  // ✅ CORRECTO: Combinar todas las condiciones en un solo .or()
  query = query.or('courier_id.is.null,is_pickup.is.null')
    .or('courier_id.is.null,is_pickup.eq.false');

  // O mejor aún, usando AND implícito:
  query = query.is('courier_id', null)
    .in('is_pickup', [null, false]);  // is_pickup es NULL o false
}
```

---

## 🟠 BUG #4: Filtro de Programados rompe la paginación (ALTO)

### Descripción
El filtro de "Programados" (delivery preferences) se aplica **CLIENT-SIDE** después de recibir resultados del servidor. Esto rompe la paginación y causa problemas de rendimiento.

### Ubicación
**Archivo:** `src/pages/Orders.tsx`
**Líneas:** 1186-1199

### Código Problemático
```typescript
// ❌ FILTRO CLIENT-SIDE: Se aplica DESPUÉS de traer datos del servidor
const filteredOrders = useMemo(() => {
  return orders.filter(order => {
    // Aplicar filtro de pedidos programados (client-side only)
    if (scheduledFilter !== 'all') {
      const scheduled = getScheduledDeliveryInfo(order);
      if (scheduledFilter === 'scheduled' && !scheduled.isScheduled) return false;
      if (scheduledFilter === 'ready' && scheduled.isScheduled) return false;
    }
    return true;
  });
}, [orders, scheduledFilter]);
```

### Escenario del Problema
1. Tienes 10,000 órdenes totales
2. Solo 10 son "programadas"
3. Traes 50 órdenes de la página 1
4. Client-side filtra y quedan 0 órdenes programadas
5. Usuario ve tabla vacía
6. Usuario hace clic en "Cargar más" → trae 50 órdenes más → filtra → 0 resultados
7. **Tiene que hacer clic 200 veces para encontrar las 10 órdenes programadas**

### Impacto
- ❌ Paginación no funciona con filtro "Programados"
- ❌ Performance: Trae miles de órdenes para filtrar pocas
- ❌ UX horrible: Usuario hace clic infinito en "Cargar más"
- ❌ Desperdicio de ancho de banda y tokens de API

### Solución (Requiere cambio arquitectónico)
**Opción 1:** Agregar columna `has_delivery_restriction` calculada en DB
```sql
ALTER TABLE orders ADD COLUMN has_delivery_restriction BOOLEAN GENERATED ALWAYS AS (
  CASE
    WHEN delivery_preferences->>'not_before_date' IS NOT NULL
      AND (delivery_preferences->>'not_before_date')::date > CURRENT_DATE
    THEN true
    ELSE false
  END
) STORED;
```

**Opción 2:** Crear vista materializada para órdenes programadas
```sql
CREATE MATERIALIZED VIEW v_orders_scheduled AS
SELECT o.*,
  (delivery_preferences->>'not_before_date')::date > CURRENT_DATE as is_scheduled
FROM orders o
WHERE delivery_preferences IS NOT NULL;
```

**Opción 3:** Hacer el filtro server-side usando RPC function
```sql
CREATE OR REPLACE FUNCTION get_scheduled_orders(p_store_id UUID, p_scheduled_only BOOLEAN)
RETURNS TABLE (id UUID, ...) AS $$
BEGIN
  IF p_scheduled_only THEN
    RETURN QUERY SELECT * FROM orders
    WHERE store_id = p_store_id
      AND delivery_preferences->>'not_before_date' IS NOT NULL
      AND (delivery_preferences->>'not_before_date')::date > CURRENT_DATE;
  ELSE
    -- lógica para "listos para entregar"
  END IF;
END;
$$ LANGUAGE plpgsql;
```

---

## 🟠 BUG #5: Sanitización de búsqueda elimina caracteres válidos (ALTO)

### Descripción
La sanitización de búsqueda elimina caracteres que son legítimos en números de teléfono y direcciones.

### Ubicación
**Archivo:** `api/routes/orders.ts`
**Línea:** 784

### Código Actual
```typescript
// ❌ Elimina puntos, comas, paréntesis - todos comunes en teléfonos
const searchClean = searchStr.replace(/[%_.,()\\]/g, '');
```

### Ejemplos del Problema
| Búsqueda Original | Después de Sanitizar | Problema |
|---|---|---|
| `(0981) 123-456` | `0981 123-456` | Elimina paréntesis pero NO guiones (inconsistente) |
| `Av. España 123` | `Av España 123` | Elimina punto de abreviatura |
| `1,234` | `1234` | Elimina separador de miles |
| `50%` | `50` | Elimina porcentaje (OK, es para SQL injection) |

### Impacto
- ⚠️ Búsqueda de teléfonos con formato falla parcialmente
- ⚠️ Búsqueda de direcciones con abreviaturas puede fallar
- ⚠️ Inconsistencia: elimina `()` pero no `-`

### Solución
```typescript
// ✅ Solo eliminar caracteres peligrosos para SQL injection
// Mantener caracteres comunes en búsquedas (puntos, comas, paréntesis, guiones)
const searchClean = searchStr
  .replace(/[%_\\]/g, '')  // Solo caracteres SQL wildcard
  .trim();

// O normalizar formato de teléfonos antes de comparar:
const normalizePhone = (str: string) => str.replace(/[\s\-().]/g, '');
// Buscar: normalizePhone(customer_phone) === normalizePhone(searchStr)
```

---

## 🟡 BUG #6: Filtro de fecha END puede perder el último segundo del día (MEDIO)

### Descripción
Cuando `endDate` no tiene timestamp (formato YYYY-MM-DD), el código agrega +1 día pero usa `.lt()` en vez de `.lte()`, lo que excluye el 23:59:59 del último día.

### Ubicación
**Archivo:** `api/routes/orders.ts`
**Líneas:** 832-836

### Código Actual
```typescript
} else {
  // Legacy YYYY-MM-DD format - add one day to include the full day
  const endDateTime = new Date(endStr);
  endDateTime.setDate(endDateTime.getDate() + 1);
  query = query.lt('created_at', endDateTime.toISOString());  // ❌ lt = less than (excluye el timestamp exacto)
}
```

### Problema
Si `endDate = "2026-02-09"`:
- Se convierte a `2026-02-10T00:00:00.000Z`
- `.lt()` significa "created_at < 2026-02-10T00:00:00.000Z"
- Una orden creada exactamente a las `2026-02-09T23:59:59.999Z` **NO** se incluye

### Impacto
- ⚠️ Órdenes creadas en el último segundo del día pueden no aparecer
- ⚠️ Problema raro pero puede causar confusión en reconciliaciones

### Solución
```typescript
} else {
  // ✅ CORRECTO: lte = less than or equal (incluye el timestamp)
  const endDateTime = new Date(endStr);
  endDateTime.setDate(endDateTime.getDate() + 1);
  query = query.lte('created_at', endDateTime.toISOString());
}

// O mejor aún, usar end of day:
const endDateTime = new Date(endStr + 'T23:59:59.999Z');
query = query.lte('created_at', endDateTime.toISOString());
```

---

## 🟡 BUG #7: No hay feedback cuando filtros no devuelven resultados (MEDIO)

### Descripción
Cuando aplicas múltiples filtros y no hay resultados, solo ves una tabla vacía. No hay mensaje de "No se encontraron pedidos con estos filtros activos".

### Ubicación
**Archivo:** `src/pages/Orders.tsx`
**Componente:** Renderizado de tabla vacía

### Problema de UX
Usuario aplica:
- ✅ Estado: "Confirmados"
- ✅ Carrier: "Express"
- ✅ Búsqueda: "Juan"
- ✅ Fecha: Últimos 7 días

Resultado: 0 órdenes
**UI actual:** Tabla vacía sin explicación
**Usuario piensa:** "¿Se rompió el sistema? ¿Perdí mis pedidos?"

### Impacto
- ⚠️ Confusión: Usuario no sabe si es error o realmente no hay resultados
- ⚠️ Tickets de soporte innecesarios
- ⚠️ Desconfianza en el sistema

### Solución
```typescript
// Detectar si hay filtros activos
const hasActiveFilters = chipFilters.status || carrierFilter !== 'all' || search || scheduledFilter !== 'all';

// En el render:
{filteredOrders.length === 0 && (
  hasActiveFilters ? (
    <EmptyState
      icon={<Filter size={48} />}
      title="No se encontraron pedidos"
      description="Intenta modificar los filtros activos para ver más resultados"
      action={{
        label: "Limpiar filtros",
        onClick: () => {
          setChipFilters({});
          setCarrierFilter('all');
          setSearch('');
          setScheduledFilter('all');
        }
      }}
    />
  ) : (
    <EmptyState
      icon={<ShoppingCart size={48} />}
      title="No hay pedidos aún"
      description="Comienza creando tu primer pedido"
      action={{
        label: "Crear pedido",
        onClick: () => setDialogOpen(true)
      }}
    />
  )
)}
```

---

## 📊 RESUMEN DE BUGS

| # | Bug | Severidad | Impacto | Esfuerzo Fix |
|---|---|---|---|---|
| 1 | Estado "contacted" falta | 🔴 CRÍTICO | Alto - Feature invisible | 5 min |
| 2 | Búsqueda multi-palabra usa OR | 🔴 CRÍTICO | Alto - Falsos positivos | 2 horas |
| 3 | Filtro carrier "none" roto | 🔴 CRÍTICO | Alto - Feature no funciona | 10 min |
| 4 | Filtro programados client-side | 🟠 ALTO | Medio - Performance/UX | 4 horas |
| 5 | Sanitización elimina chars válidos | 🟠 ALTO | Medio - Búsquedas fallan | 30 min |
| 6 | Fecha END pierde último segundo | 🟡 MEDIO | Bajo - Caso edge raro | 5 min |
| 7 | Sin feedback de filtros vacíos | 🟡 MEDIO | Bajo - UX confusa | 30 min |

**Total tiempo estimado de fix:** ~7.5 horas

---

## 🎯 PRIORIDAD DE CORRECCIÓN

### INMEDIATO (Esta semana)
1. ✅ Bug #1: Agregar chip "Contactados" (5 min)
2. ✅ Bug #3: Corregir filtro carrier "none" (10 min)
3. ✅ Bug #6: Cambiar `.lt()` a `.lte()` en fecha END (5 min)

### CORTO PLAZO (Este mes)
4. ✅ Bug #7: Agregar feedback de filtros vacíos (30 min)
5. ✅ Bug #5: Mejorar sanitización de búsqueda (30 min)

### MEDIANO PLAZO (Próximo sprint)
6. ✅ Bug #2: Refactorizar búsqueda multi-palabra (2 horas)
7. ✅ Bug #4: Mover filtro programados a server-side (4 horas)

---

## 🧪 PLAN DE TESTING

Después de aplicar fixes, verificar:

### Test 1: Filtros de Estado
- [ ] Filtrar por "Contactados" devuelve solo órdenes en estado `contacted`
- [ ] Filtrar por cada estado devuelve resultados correctos
- [ ] Cambiar de un filtro a otro actualiza resultados

### Test 2: Búsqueda
- [ ] Buscar "Juan Perez" devuelve solo "Juan Perez", no todos los Juan ni todos los Perez
- [ ] Buscar teléfono "(0981) 123-456" encuentra la orden
- [ ] Buscar UUID exacto devuelve 1 orden
- [ ] Buscar orden #1315 encuentra la orden de Shopify

### Test 3: Filtro de Carrier
- [ ] Filtrar "Sin transportadora" devuelve solo órdenes sin carrier Y no-pickup
- [ ] Filtrar "Retiro en local" devuelve solo órdenes con `is_pickup=true`
- [ ] Filtrar carrier específico devuelve solo órdenes de ese carrier

### Test 4: Filtros de Fecha
- [ ] "Hoy" devuelve órdenes de hoy (00:00 a 23:59:59)
- [ ] "7 días" devuelve órdenes de últimos 7 días completos
- [ ] "Personalizado" 09/02 - 09/02 incluye órdenes hasta 23:59:59

### Test 5: Filtro de Programados
- [ ] "Programados" muestra solo órdenes con fecha futura
- [ ] "Listos para entregar" muestra solo órdenes sin restricción
- [ ] Paginación funciona correctamente con ambos filtros

### Test 6: Combinación de Filtros
- [ ] Estado + Carrier + Búsqueda devuelve resultados correctos
- [ ] Fecha + Estado + Programados funciona sin romper paginación
- [ ] Limpiar filtros restaura vista completa

---

## 📝 NOTAS ADICIONALES

### Arquitectura General
El sistema de filtros tiene una **arquitectura híbrida**:
- **Server-side:** Fecha, Estado, Carrier, Búsqueda
- **Client-side:** Programados (delivery_preferences)

Esta arquitectura causa el Bug #4 (paginación rota). Recomiendo **migrar TODO a server-side** para consistencia.

### Mejoras Recomendadas (Post-bugs)
1. **Agregar filtros avanzados:** Rango de monto, método de pago, ciudad
2. **Guardar filtros personalizados:** Usuario puede guardar combinaciones de filtros
3. **Exportar con filtros aplicados:** CSV/Excel respeta filtros activos
4. **Historial de filtros:** "Volver a filtros anteriores"
5. **Filtros rápidos con contadores:** "Pendientes (23)" muestra cantidad

---

**Generado:** 2026-02-09
**Responsable:** Claude Sonnet 4.5
**Próxima revisión:** Después de aplicar fixes prioritarios
