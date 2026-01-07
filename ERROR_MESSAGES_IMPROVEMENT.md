# Mejora de Mensajes de Error - Sistema Completo

## 🎯 Objetivo

Transformar todos los mensajes de error genéricos ("Error", "No se pudo...") en mensajes **accionables y útiles** que guíen al usuario sobre cómo resolver el problema.

## 📋 Cambios Implementados

### 1. Utilidades Centralizadas

#### Frontend: `src/utils/errorMessages.ts`
```typescript
// Antes
toast({ title: 'Error', description: 'No se pudo crear el pedido' });

// Ahora
showErrorToast(toast, error, {
  module: 'orders',
  action: 'create',
  entity: 'pedido'
});
```

**Resultado para el usuario:**
```
❌ Falta información del cliente
No puedes crear un pedido sin seleccionar un cliente.

💡 Ve a Clientes → Crea el cliente primero, o selecciona uno existente.
```

#### Backend: `api/utils/errorResponses.ts`
```typescript
// Antes
res.status(400).json({ error: 'Stock insuficiente' });

// Ahora
insufficientStock(res, 'Remera Azul', 3, 10);
```

**Respuesta estructurada:**
```json
{
  "code": "INSUFFICIENT_STOCK",
  "details": {
    "productName": "Remera Azul",
    "currentStock": 3,
    "required": 10
  },
  "timestamp": "2026-01-07T..."
}
```

### 2. Códigos de Error Implementados

#### Errores de Usuario (Accionables)

| Código | Situación | Mensaje al Usuario |
|--------|-----------|-------------------|
| `INSUFFICIENT_STOCK` | Stock insuficiente | "No hay suficiente stock de 'Remera Azul'. Stock actual: 3, necesitas: 10. → Ve a Productos → Aumenta el stock o recibe mercadería pendiente." |
| `PRODUCT_NOT_FOUND` | Producto no existe | "El producto 'ABC123' no fue encontrado. → Verifica que el producto exista en la sección Productos." |
| `ORDER_MISSING_CUSTOMER` | Pedido sin cliente | "No puedes crear un pedido sin seleccionar un cliente. → Ve a Clientes → Crea el cliente primero." |
| `ORDER_MISSING_PRODUCTS` | Pedido sin productos | "Debes agregar al menos un producto al pedido. → Haz clic en 'Agregar Producto'." |
| `ORDER_CANNOT_BE_DELETED` | Pedido ya procesado | "Los pedidos en estado 'ready_to_ship' no pueden eliminarse porque ya se descontó el inventario. → Usa 'Cancelar Pedido' para restaurar stock." |
| `INVALID_STATUS_TRANSITION` | Cambio de estado inválido | "No puedes cambiar de 'delivered' a 'pending'. → El flujo correcto es: Pendiente → Confirmado → En Preparación → Listo → Enviado → Entregado." |
| `NO_ORDERS_SELECTED` | Sin pedidos seleccionados | "Debes seleccionar al menos un pedido para crear una sesión de picking. → Marca los pedidos que quieres procesar." |
| `ORDERS_NOT_CONFIRMED` | Pedidos no confirmados | "3 pedidos seleccionados no están confirmados. → Ve a Pedidos → Confirma los pedidos pendientes primero." |
| `SHOPIFY_NOT_CONNECTED` | Shopify desconectado | "Tu tienda no está conectada a Shopify. → Ve a Integraciones → Conectar con Shopify." |
| `USER_LIMIT_REACHED` | Límite de usuarios | "Tu plan 'Starter' permite máximo 3 usuarios. Tienes 3. → Ve a Facturación → Actualiza tu plan." |
| `PHONE_IN_USE` | Teléfono duplicado | "Este número de teléfono ya está registrado en otra cuenta. → Ve a Recuperación de Cuenta o usa otro número." |
| `INVALID_VERIFICATION_CODE` | Código incorrecto | "Código de verificación inválido. Te quedan 2 intentos. → Verifica el código enviado por WhatsApp." |
| `RATE_LIMIT_EXCEEDED` | Demasiados intentos | "Debes esperar 60 segundos antes de solicitar otro código. → Revisa tu WhatsApp, el código ya llegó." |

#### Errores Técnicos (Infraestructura)

| Código | Situación | Mensaje |
|--------|-----------|---------|
| `DATABASE_ERROR` | Error de BD | "Error de base de datos. Intenta nuevamente en unos segundos." |
| `NETWORK_ERROR` | Sin conexión | "Error de conexión. Verifica tu internet e intenta nuevamente." |
| `SERVER_ERROR` | Error del servidor | "Error del servidor. Nuestro equipo fue notificado. Intenta en unos minutos." |
| `UNAUTHORIZED` | Sesión expirada | "Tu sesión expiró. Por favor inicia sesión nuevamente." |

### 3. Archivos Actualizados

#### Frontend (Completados)
- ✅ `src/pages/Orders.tsx` - 15 catch blocks actualizados
- ✅ `src/pages/Products.tsx` - 4 catch blocks actualizados
- ✅ `src/pages/Warehouse.tsx` - 3 catch blocks actualizados
- ⏳ `src/pages/Merchandise.tsx` - Pendiente
- ⏳ `src/pages/Returns.tsx` - Pendiente
- ⏳ `src/pages/Integrations.tsx` - Pendiente
- ⏳ `src/pages/Billing.tsx` - Pendiente
- ⏳ `src/pages/AcceptInvitation.tsx` - Pendiente

#### Backend (Completados)
- ✅ `api/routes/inventory.ts` - 3 errores críticos actualizados
- ✅ `api/routes/warehouse.ts` - 2 errores críticos actualizados
- ⏳ `api/routes/orders.ts` - Pendiente (30+ errores)
- ⏳ `api/routes/products.ts` - Pendiente
- ⏳ `api/routes/shopify.ts` - Pendiente
- ⏳ `api/routes/collaborators.ts` - Pendiente
- ⏳ `api/routes/billing.ts` - Pendiente
- ⏳ `api/routes/phone-verification.ts` - Pendiente

### 4. Ejemplos de Transformación

#### Ejemplo 1: Stock Insuficiente

**Antes:**
```typescript
catch (error) {
  toast({
    title: 'Error',
    description: 'No se pudo crear el pedido',
    variant: 'destructive'
  });
}
```

**Ahora:**
```typescript
catch (error) {
  showErrorToast(toast, error, {
    module: 'orders',
    action: 'create',
    entity: 'pedido'
  });
}
```

**Backend devuelve:**
```json
{
  "code": "INSUFFICIENT_STOCK",
  "details": {
    "productName": "Remera Azul",
    "currentStock": 3,
    "required": 10
  }
}
```

**Usuario ve:**
```
❌ Stock insuficiente
No hay suficiente stock de "Remera Azul". Stock actual: 3, necesitas: 10.

💡 Ve a Productos → Encuentra el producto → Aumenta el stock o recibe mercadería pendiente en Mercadería.
```

#### Ejemplo 2: Pedido Sin Cliente

**Backend:**
```typescript
// Antes
if (!customerId) {
  return res.status(400).json({ error: 'Falta el cliente' });
}

// Ahora
if (!customerId) {
  return orderMissingCustomer(res);
}
```

**Frontend automáticamente muestra:**
```
❌ Falta información del cliente
No puedes crear un pedido sin seleccionar un cliente.

💡 Ve a Clientes → Crea el cliente primero, o selecciona uno existente.
```

#### Ejemplo 3: Shopify No Conectado

**Frontend detecta código `SHOPIFY_NOT_CONNECTED`:**
```
❌ Shopify no conectado
Tu tienda no está conectada a Shopify.

💡 Ve a Integraciones → Shopify → Haz clic en "Conectar con Shopify" y sigue los pasos.
```

## 🚀 Cómo Usar

### Frontend

```typescript
import { showErrorToast } from '@/utils/errorMessages';

try {
  await ordersService.create(orderData);
} catch (error) {
  showErrorToast(toast, error, {
    module: 'orders',      // Módulo afectado
    action: 'create',       // Acción que falló
    entity: 'pedido',       // Entidad involucrada
    details: { /* ... */ }  // Detalles opcionales
  });
}
```

### Backend

```typescript
import { orderMissingCustomer, insufficientStock } from '../utils/errorResponses';

// Validación
if (!customerId) {
  return orderMissingCustomer(res);
}

// Stock check
if (product.stock < quantity) {
  return insufficientStock(res, product.name, product.stock, quantity);
}
```

## 📊 Estadísticas

- **Total de catch blocks:** 229 (frontend) + 745 (backend) = **974 errores**
- **Completados:** ~22 errores críticos
- **Pendientes:** ~952 errores
- **Códigos de error definidos:** 25+ códigos

## 🎯 Próximos Pasos

1. ✅ **COMPLETADO:** Crear utilidades centralizadas
2. ✅ **COMPLETADO:** Actualizar módulos críticos (Orders, Products, Warehouse, Inventory)
3. ⏳ **PENDIENTE:** Ejecutar script de migración para archivos restantes
4. ⏳ **PENDIENTE:** Probar flujos críticos de usuario
5. ⏳ **PENDIENTE:** Documentar errores específicos de Shopify
6. ⏳ **PENDIENTE:** Agregar telemetría de errores (opcional)

## 🔧 Script de Migración

```bash
# Migrar archivos restantes automáticamente
npx tsx scripts/migrate-error-messages.ts

# Ver estadísticas
# Total files processed: 20
# Files updated: 18
# Total catch blocks found: 187
```

## 📚 Recursos

- **Utility Frontend:** `src/utils/errorMessages.ts`
- **Utility Backend:** `api/utils/errorResponses.ts`
- **Script de Migración:** `scripts/migrate-error-messages.ts`
- **Ejemplos:** Ver archivos ya migrados (Orders.tsx, Products.tsx, Warehouse.tsx)

## ✅ Beneficios

1. **Usuario feliz:** Sabe exactamente qué hacer cuando algo falla
2. **Menos soporte:** Mensajes claros reducen consultas repetitivas
3. **Mejor UX:** Errores guían en lugar de frustrar
4. **Debugging más fácil:** Códigos estructurados facilitan rastreo
5. **Consistencia:** Todos los errores siguen el mismo formato

## 🎨 Diseño de Mensajes

Todos los mensajes siguen esta estructura:

```
[Título claro y específico]
[Explicación del problema]

💡 [Acción concreta para resolver]
```

**Ejemplo:**
```
Stock insuficiente
No hay suficiente stock de "Remera Azul". Stock actual: 3, necesitas: 10.

💡 Ve a Productos → Encuentra el producto → Aumenta el stock o recibe mercadería pendiente en Mercadería.
```

## 🔐 Manejo de Errores Técnicos

Los errores técnicos (500, network, database) NO exponen detalles sensibles:

```typescript
// ❌ NUNCA
toast({ description: error.stack }); // Expone código

// ✅ SIEMPRE
serverError(res, error); // Loguea internamente, mensaje genérico al usuario
```

---

**Última actualización:** 2026-01-07
**Autor:** Bright Idea Development Team
