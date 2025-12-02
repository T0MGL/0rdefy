# Ejemplo de Implementación del Sistema de Notificaciones

Este documento muestra cómo implementar el sistema de notificaciones en páginas existentes.

## Ejemplo 1: Highlighting en Orders Page

Para que los pedidos se resalten cuando el usuario hace click en una notificación:

```typescript
// src/pages/Orders.tsx
import { useHighlight } from '@/hooks/useHighlight';
import { cn } from '@/lib/utils';

export default function Orders() {
  const { isHighlighted } = useHighlight();
  const [orders, setOrders] = useState<Order[]>([]);

  return (
    <div className="space-y-4">
      {orders.map((order) => (
        <Card
          key={order.id}
          id={`item-${order.id}`} // IMPORTANTE: permite scroll automático
          className={cn(
            "p-4 transition-all duration-300",
            isHighlighted(order.id) && "ring-2 ring-primary shadow-lg animate-pulse"
          )}
        >
          {/* Contenido del pedido */}
          <h3>Pedido #{order.id.substring(0, 8)}</h3>
          <p>{order.customer}</p>
        </Card>
      ))}
    </div>
  );
}
```

**Resultado:**
- Usuario hace click en notificación "Pedido #abc12345 sin confirmar"
- Navega a `/orders?highlight=abc123`
- Pedido se resalta con ring azul y animación pulse
- Scroll automático al pedido
- Highlight desaparece después de 5 segundos

## Ejemplo 2: Filtros en Products Page

Para filtrar productos cuando hay notificación de stock bajo:

```typescript
// src/pages/Products.tsx
import { useSearchParams } from 'react-router-dom';
import { useHighlight } from '@/hooks/useHighlight';

export default function Products() {
  const [searchParams] = useSearchParams();
  const { isHighlighted } = useHighlight();
  const [products, setProducts] = useState<Product[]>([]);

  // Filtrar productos según URL params
  const filteredProducts = useMemo(() => {
    const filter = searchParams.get('filter');

    if (filter === 'low-stock') {
      return products.filter(p => p.stock < 10 && p.stock > 0);
    }

    if (filter === 'out-of-stock') {
      return products.filter(p => p.stock === 0);
    }

    return products;
  }, [products, searchParams]);

  return (
    <div className="space-y-4">
      {/* Mostrar filtro activo */}
      {searchParams.get('filter') && (
        <Badge variant="secondary">
          Filtro: {searchParams.get('filter')}
        </Badge>
      )}

      {filteredProducts.map((product) => (
        <Card
          key={product.id}
          id={`item-${product.id}`}
          className={cn(
            "p-4",
            isHighlighted(product.id) && "ring-2 ring-yellow-500 animate-pulse",
            product.stock === 0 && "bg-red-50 dark:bg-red-950/20"
          )}
        >
          <h3>{product.name}</h3>
          <Badge
            variant={product.stock === 0 ? 'destructive' : 'warning'}
          >
            Stock: {product.stock}
          </Badge>
        </Card>
      ))}
    </div>
  );
}
```

**URLs soportadas:**
- `/products?filter=low-stock` - Productos con stock 1-9
- `/products?filter=out-of-stock` - Productos sin stock
- `/products?highlight=prod-123` - Resalta producto específico

## Ejemplo 3: Mostrar Tiempos Precisos en UI

Para mostrar "hace X tiempo" en cualquier parte de la app:

```typescript
// src/components/OrderCard.tsx
import { formatTimeAgo, getHoursDifference } from '@/utils/timeUtils';

export function OrderCard({ order }: { order: Order }) {
  const hoursAgo = getHoursDifference(order.date);
  const isOld = hoursAgo > 24;

  return (
    <Card>
      <div className="flex justify-between items-center">
        <h3>Pedido de {order.customer}</h3>
        <div className={cn(
          "text-sm",
          isOld && "text-red-600 font-semibold"
        )}>
          {formatTimeAgo(order.date)}
          {isOld && " ⚠️"}
        </div>
      </div>

      {isOld && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Pedido antiguo</AlertTitle>
          <AlertDescription>
            Este pedido lleva {Math.floor(hoursAgo)} horas sin confirmar
          </AlertDescription>
        </Alert>
      )}
    </Card>
  );
}
```

## Ejemplo 4: Crear Notificaciones Personalizadas

Si necesitas crear notificaciones desde otro lugar:

```typescript
// src/services/orders.service.ts
import { notificationsService } from '@/services/notifications.service';
import { getNow } from '@/utils/timeUtils';

export async function confirmOrder(orderId: string) {
  try {
    await api.patch(`/orders/${orderId}`, { status: 'confirmed' });

    // Agregar notificación de éxito
    notificationsService.updateNotifications({
      orders: await ordersService.getAll(),
      products: await productsService.getAll(),
      ads: await adsService.getAll(),
      carriers: await carriersService.getAll(),
    });

    return { success: true };
  } catch (error) {
    console.error('Error confirming order:', error);
    throw error;
  }
}
```

## Ejemplo 5: Debug de Timezone

Si un usuario reporta problemas con tiempos, usar esto para debugging:

```typescript
// En browser console o en código
import { getTimeInfo } from '@/utils/timeUtils';

const order = { date: '2025-12-02T10:00:00.000Z' };
console.log(getTimeInfo(order.date));

/* Output:
{
  timezone: "America/Asuncion",
  localTime: "02/12/2025, 06:00",
  utcTime: "2025-12-02T10:00:00.000Z",
  hoursAgo: 8.5,
  minutesAgo: 510,
  formattedAgo: "hace 8 horas"
}
*/
```

## Ejemplo 6: Navegación Directa desde Notificación

Implementación completa del flujo:

```typescript
// 1. Notificación se genera (automático)
{
  id: "notif-order-critical-abc123",
  message: "Pedido #abc12345 de Juan sin confirmar (hace 3 días)",
  actionUrl: "/orders?filter=pending&highlight=abc123",
  metadata: {
    orderId: "abc123",
    timeReference: "2025-11-29T10:00:00.000Z"
  }
}

// 2. Usuario hace click (Header.tsx - ya implementado)
const handleNotificationClick = (notif: Notification) => {
  navigate(notif.actionUrl); // → /orders?filter=pending&highlight=abc123
  setNotifOpen(false);
};

// 3. Orders page recibe params y resalta
export default function Orders() {
  const [searchParams] = useSearchParams();
  const { isHighlighted } = useHighlight();

  // filter=pending
  const filter = searchParams.get('filter'); // "pending"

  // highlight=abc123
  // useHighlight hook:
  // - Lee 'highlight' param
  // - Scroll automático a #item-abc123
  // - Aplica animación pulse
  // - Auto-limpia después de 5s

  return (
    <div>
      {orders
        .filter(o => !filter || o.status === filter)
        .map(order => (
          <Card
            id={`item-${order.id}`}
            className={cn(
              "order-card",
              isHighlighted(order.id) && "ring-2 ring-primary animate-pulse"
            )}
          >
            {/* Order content */}
          </Card>
        ))
      }
    </div>
  );
}
```

## Mejores Prácticas

### ✅ DO

1. **Siempre usa timeUtils para cálculos de tiempo**
   ```typescript
   import { getHoursDifference, formatTimeAgo } from '@/utils/timeUtils';
   const hours = getHoursDifference(order.date);
   ```

2. **Agrega ID único a elementos resaltables**
   ```typescript
   <div id={`item-${order.id}`}>
   ```

3. **Usa metadata en notificaciones**
   ```typescript
   metadata: {
     orderId: order.id,
     timeReference: order.date,
     count: 1
   }
   ```

4. **Implementa useHighlight hook en páginas**
   ```typescript
   const { isHighlighted } = useHighlight();
   ```

### ❌ DON'T

1. **No calcules tiempo manualmente**
   ```typescript
   // ❌ MAL
   const hours = (new Date() - new Date(order.date)) / (1000 * 60 * 60);

   // ✅ BIEN
   const hours = getHoursDifference(order.date);
   ```

2. **No uses toLocaleString para tiempos relativos**
   ```typescript
   // ❌ MAL
   {new Date(order.date).toLocaleString()}

   // ✅ BIEN
   {formatTimeAgo(order.date)}
   ```

3. **No asumas timezone UTC**
   ```typescript
   // ❌ MAL
   const now = new Date().toUTCString();

   // ✅ BIEN
   const now = getNow();
   ```

4. **No olvides el scroll target ID**
   ```typescript
   // ❌ MAL - No scrolleará
   <Card key={order.id}>

   // ✅ BIEN - Scrolleará al hacer click
   <Card key={order.id} id={`item-${order.id}`}>
   ```

## Testing Local

Para probar notificaciones localmente:

```typescript
// 1. Crear pedido antiguo en DB
INSERT INTO orders (id, customer, date, status, store_id)
VALUES (
  'test-old-order',
  'Test Customer',
  NOW() - INTERVAL '26 hours', -- 26 horas atrás
  'pending',
  'your-store-id'
);

// 2. Recargar app
// 3. Abrir bell icon
// 4. Debería aparecer notificación:
//    "1 pedido pendiente de confirmación por más de 24h"

// 5. Click en notificación
// 6. Debería navegar a /orders?filter=pending&sort=oldest
// 7. Pedido debería aparecer en la lista
```

Para probar highlighting:

```bash
# Navegar manualmente a:
http://localhost:8080/orders?highlight=test-old-order

# El pedido debería:
# - Tener ring azul
# - Animación pulse
# - Scroll automático
# - Highlight desaparece en 5s
```

---

**Desarrollado por:** Bright Idea
**Plataforma:** Ordefy
**Copyright:** All Rights Reserved
