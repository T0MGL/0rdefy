# Sistema de Notificaciones Inteligente

**Última actualización:** Diciembre 2025

## Resumen

Sistema de notificaciones en tiempo real con cálculos precisos de tiempo basados en timezone del usuario, navegación directa a problemas específicos, y metadata enriquecida para mejor UX.

## Características Principales

### ✅ Timezone-Aware
- Detecta automáticamente el timezone del usuario usando `Intl.DateTimeFormat()`
- Cálculos precisos de tiempo ("hace 2 horas" es realmente 2 horas, no aproximado)
- Soporta múltiples timezones sin configuración adicional

### ✅ Notificaciones Clickeables
- Cada notificación navega directamente al problema
- Soporte para highlighting automático de items
- URL parameters para filtros y orden específicos

### ✅ Metadata Enriquecida
- `orderId`, `productId`, `adId`, `carrierId` para navegación precisa
- `count` para notificaciones agregadas
- `itemIds` para filtros bulk
- `timeReference` para cálculos precisos de "hace X tiempo"

### ✅ Niveles de Prioridad Inteligentes
- **Critical (high)**: Requiere acción inmediata
  - Pedidos >48h sin confirmar (notificaciones individuales)
  - Productos sin stock
  - Campañas con ROAS <1.5
  - Transportadoras con tasa <60%

- **Warning (medium)**: Requiere atención
  - Pedidos 24-48h sin confirmar
  - Productos con stock bajo (1-9 unidades)
  - Campañas con ROAS 1.5-2.5
  - Transportadoras con tasa 60-80%
  - Pedidos >12h sin confirmación WhatsApp

- **Info (low)**: Informativo
  - Pedidos programados para mañana

## Arquitectura

### Archivos Principales

```
src/
├── utils/
│   ├── timeUtils.ts           # Utilidades de tiempo con timezone support
│   └── notificationEngine.ts  # Generador de notificaciones
├── services/
│   └── notifications.service.ts  # Servicio singleton de notificaciones
├── hooks/
│   └── useHighlight.ts        # Hook para highlighting de items
├── components/
│   └── Header.tsx             # Bell icon con dropdown de notificaciones
└── types/
    └── notification.ts        # TypeScript types
```

### Flujo de Datos

```
1. Header.tsx (cada 5 min)
   ↓
2. Load orders, products, ads, carriers
   ↓
3. notificationsService.updateNotifications(data)
   ↓
4. generateNotifications(data) → Notification[]
   ↓
5. Merge con notificaciones existentes (preserva read status)
   ↓
6. Render en Header dropdown
   ↓
7. Click → Navigate to actionUrl → Highlight item
```

## API de Utilidades de Tiempo

### Funciones Principales

```typescript
import {
  getNow,
  getHoursDifference,
  getMinutesDifference,
  formatTimeAgo,
  isOlderThan,
  getUserTimezone,
  formatDateInUserTz,
  isTomorrow,
} from '@/utils/timeUtils';

// Obtener hora actual en timezone del usuario
const now = getNow();

// Calcular diferencia en horas
const hours = getHoursDifference(order.date); // from order.date to now
const hours2 = getHoursDifference(startDate, endDate); // between two dates

// Formatear tiempo relativo
const timeAgo = formatTimeAgo(order.date);
// → "hace 2 horas", "hace 3 días", "hace 1 mes"

// Verificar si es más viejo que X horas
if (isOlderThan(order.date, 24)) {
  // Order is older than 24 hours
}

// Timezone del usuario
const tz = getUserTimezone(); // → "America/Asuncion", "America/New_York", etc

// Formatear fecha en timezone del usuario
const formatted = formatDateInUserTz(order.date);
// → "02/12/2025, 14:30"

// Verificar si es mañana
if (isTomorrow(delivery.date)) {
  // Delivery is tomorrow
}
```

### Debugging

```typescript
import { getTimeInfo } from '@/utils/timeUtils';

const debug = getTimeInfo(order.date);
console.log(debug);
/*
{
  timezone: "America/Asuncion",
  localTime: "02/12/2025, 14:30",
  utcTime: "2025-12-02T18:30:00.000Z",
  hoursAgo: 2.5,
  minutesAgo: 150,
  formattedAgo: "hace 2 horas"
}
*/
```

## Tipos de Notificaciones

### 1. Pedidos Pendientes (>24h)

**Críticas (>48h)** - Una notificación por pedido:
```typescript
{
  id: "notif-order-critical-abc123",
  type: "order",
  message: "Pedido #abc12345 de Juan Pérez sin confirmar (hace 3 días)",
  priority: "high",
  actionUrl: "/orders?filter=pending&highlight=abc123",
  metadata: {
    orderId: "abc123",
    timeReference: "2025-11-29T10:00:00.000Z",
    count: 1
  }
}
```

**Warning (24-48h)** - Notificación agregada:
```typescript
{
  id: "notif-orders-pending-24h",
  message: "5 pedidos pendientes de confirmación por más de 24h",
  priority: "high",
  actionUrl: "/orders?filter=pending&sort=oldest",
  metadata: {
    count: 5,
    itemIds: ["id1", "id2", "id3", "id4", "id5"]
  }
}
```

### 2. Stock Bajo

**Sin stock (0 unidades)** - Individual:
```typescript
{
  id: "notif-stock-critical-prod123",
  message: "⚠️ \"Producto XYZ\" sin stock disponible",
  priority: "high",
  actionUrl: "/products?highlight=prod123",
  metadata: {
    productId: "prod123",
    count: 1
  }
}
```

**Stock bajo (1-9)** - Agregada:
```typescript
{
  id: "notif-stock-low",
  message: "12 productos con stock bajo (menos de 10 unidades)",
  priority: "medium",
  actionUrl: "/products?filter=low-stock"
}
```

### 3. ROAS Bajo

**Crítico (<1.5)** - Individual:
```typescript
{
  id: "notif-ads-critical-ad123",
  message: "Campaña \"Black Friday\" con ROAS crítico (0.8x) - ¡Revisa urgente!",
  priority: "high",
  actionUrl: "/ads?highlight=ad123",
  metadata: {
    adId: "ad123",
    count: 1
  }
}
```

### 4. Transportadoras

**Crítica (<60%)** - Individual:
```typescript
{
  id: "notif-carrier-critical-carr123",
  message: "Transportadora \"Express SA\" con tasa crítica de entrega (45%) - Considera cambiar",
  priority: "high",
  actionUrl: "/carriers/carr123",
  metadata: {
    carrierId: "carr123",
    count: 1
  }
}
```

### 5. Entregas Programadas

```typescript
{
  id: "notif-deliveries-tomorrow",
  message: "8 pedidos programados para entrega mañana",
  priority: "low",
  actionUrl: "/orders?filter=tomorrow-delivery",
  metadata: {
    count: 8,
    itemIds: [...]
  }
}
```

### 6. Sin Confirmación WhatsApp (>12h)

```typescript
{
  id: "notif-unconfirmed-whatsapp",
  message: "3 pedidos sin confirmación de WhatsApp por más de 12h",
  priority: "medium",
  actionUrl: "/orders?filter=pending&sort=oldest",
  metadata: {
    count: 3,
    itemIds: [...]
  }
}
```

## Implementación en Páginas

### Ejemplo: Orders Page con Highlighting

```typescript
import { useHighlight } from '@/hooks/useHighlight';

export default function Orders() {
  const { highlightId, isHighlighted } = useHighlight();

  return (
    <div>
      {orders.map((order) => (
        <div
          key={order.id}
          id={`item-${order.id}`} // IMPORTANTE: ID para scroll
          className={cn(
            "order-card",
            isHighlighted(order.id) && "ring-2 ring-primary animate-pulse"
          )}
        >
          {/* Order content */}
        </div>
      ))}
    </div>
  );
}
```

### URL Parameters Soportados

```
/orders?highlight=order-id-123        # Resalta pedido específico
/orders?filter=pending                # Filtra por pending
/orders?sort=oldest                   # Ordena por más antiguo
/orders?filter=pending&sort=oldest    # Combina filtros

/products?highlight=prod-123          # Resalta producto
/products?filter=low-stock            # Productos con stock bajo

/ads?highlight=ad-123                 # Resalta campaña
/ads?filter=low-roas                  # Campañas con ROAS bajo

/carriers/carrier-id-123              # Vista detalle de transportadora
/carriers?filter=poor-performance     # Transportadoras con bajo rendimiento
```

## Storage & Persistencia

- **LocalStorage Key:** `ordefy_notifications`
- **Version:** `1.0` (auto-reset si cambia versión)
- **TTL:** 7 días (notificaciones antiguas se eliminan automáticamente)
- **Read Status:** Se preserva entre recargas
- **Merge Logic:** Notificaciones nuevas se agregan, existentes mantienen su read status

## Testing

### Escenarios de Prueba

1. **Timezone Accuracy**
   ```typescript
   // Verificar que un pedido de hace exactamente 25 horas muestra ">24h"
   const order = { date: new Date(Date.now() - 25 * 60 * 60 * 1000) };
   const hours = getHoursDifference(order.date);
   console.assert(hours >= 24 && hours < 26);
   ```

2. **Notification Click Navigation**
   - Click en notificación → Navega a página correcta
   - Item se resalta automáticamente
   - Scroll automático al item
   - Highlight desaparece después de 5s

3. **Multiple Timezones**
   - Probar con usuario en Paraguay (UTC-4)
   - Probar con usuario en España (UTC+1)
   - Verificar que "hace 2 horas" sea consistente

4. **Read Status Persistence**
   - Marcar notificación como leída
   - Recargar página
   - Verificar que sigue marcada como leída

## Mejoras Futuras

- [ ] Push notifications (Web Push API)
- [ ] Email notifications para alertas críticas
- [ ] Notificaciones de webhook failures de Shopify
- [ ] Sound alerts para notificaciones de alta prioridad
- [ ] Snooze functionality (postponer notificaciones)
- [ ] Bulk actions (mark all as read, clear all)
- [ ] Notification preferences per tipo
- [ ] In-app notification center (página dedicada)

## Troubleshooting

### "Las notificaciones muestran tiempos incorrectos"
- Verificar timezone del navegador: `Intl.DateTimeFormat().resolvedOptions().timeZone`
- Verificar que las fechas en DB estén en UTC ISO format
- Usar `getTimeInfo()` para debugging

### "Click en notificación no navega"
- Verificar que `actionUrl` esté definido
- Verificar que la ruta exista en React Router
- Check console para errores de navegación

### "Highlight no funciona"
- Verificar que el elemento tenga `id="item-{itemId}"`
- Verificar que `useHighlight` hook esté implementado
- Check que el item esté renderizado (no en lazy load)

### "Notificaciones duplicadas"
- Verificar lógica de merge en `notifications.service.ts`
- Check que IDs sean únicos y estables
- Verificar que no haya múltiples instancias del servicio

## Compatibilidad

- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+
- ✅ Mobile browsers (iOS Safari, Chrome Android)
- ✅ Todos los timezones (IANA timezone database)

## Performance

- Refresh interval: 5 minutos (configurable en Header.tsx:115)
- Storage: ~5KB por 100 notificaciones
- Render: <10ms para 50 notificaciones
- Memory: Singleton service, no memory leaks

---

**Desarrollado por:** Bright Idea
**Plataforma:** Ordefy
**Copyright:** All Rights Reserved
