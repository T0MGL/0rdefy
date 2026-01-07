# Validaciones Correctas para Flujos Reales de Ordefy

## 🔍 Flujos Actuales (Corrección)

### 1. Crear Pedido
**Flujo Real:**
1. Usuario hace clic en "Crear Pedido"
2. Se abre formulario
3. Usuario ingresa nombre de cliente (se autocompleta si existe, se crea si es nuevo)
4. Usuario agrega productos
5. Usuario confirma → Pedido se crea

**Validaciones Correctas:**
```typescript
const orderValidations = [
  {
    check: customerName.trim().length > 0,
    message: 'Ingresa el nombre del cliente',
    severity: 'error'
  },
  {
    check: products.length > 0,
    message: 'Agrega al menos un producto al pedido',
    severity: 'error'
  },
  {
    check: products.every(p => p.quantity > 0),
    message: 'La cantidad de cada producto debe ser mayor a 0',
    severity: 'error'
  },
  {
    check: products.every(p => p.quantity <= p.stock),
    message: 'Stock insuficiente para algunos productos',
    severity: 'error'
  },
  {
    check: customerPhone.trim().length > 0,
    message: 'Agrega el teléfono del cliente para enviar confirmación por WhatsApp',
    severity: 'warning' // Warning, no error
  }
];
```

**Empty State Correcto:**
```typescript
<ImprovedEmptyState
  icon={<ShoppingCart />}
  title="¡Crea tu primer pedido!"
  description="Registra ventas de clientes y controla inventario automáticamente"
  checklist={[
    {
      done: products.length > 0, // Solo verificar productos
      label: 'Tener productos en inventario',
      action: products.length === 0 ? () => navigate('/products') : undefined
    },
    {
      done: false,
      label: 'Crear tu primer pedido'
    }
  ]}
  tips={[
    'El cliente se crea automáticamente cuando ingresas su nombre',
    'El stock se descuenta cuando el pedido llega a "Listo para Enviar"',
    'Puedes confirmar pedidos vía WhatsApp con un solo clic'
  ]}
/>
```

---

### 2. Crear Producto
**Flujo Real:**
1. Usuario hace clic en "Crear Producto"
2. Ingresa nombre, SKU, precio, costo
3. Stock inicial (puede ser 0)
4. Producto se crea

**Validaciones Correctas:**
```typescript
const productValidations = [
  {
    check: productName.trim().length > 0,
    message: 'Ingresa el nombre del producto',
    severity: 'error'
  },
  {
    check: price > 0,
    message: 'El precio debe ser mayor a 0',
    severity: 'error'
  },
  {
    check: cost >= 0,
    message: 'El costo no puede ser negativo',
    severity: 'error'
  },
  {
    check: stock >= 0,
    message: 'El stock no puede ser negativo',
    severity: 'error'
  },
  {
    check: sku.trim().length > 0,
    message: 'Agrega un SKU para identificar el producto fácilmente',
    severity: 'warning'
  },
  {
    check: stock > 0,
    message: 'El producto tendrá stock 0 (no podrás venderlo hasta recibir mercadería)',
    severity: 'info'
  }
];
```

---

### 3. Crear Sesión de Picking (Warehouse)
**Flujo Real:**
1. Usuario ve pedidos confirmados
2. Selecciona 1+ pedidos
3. Hace clic "Crear Sesión"
4. Sesión se crea → Redirige a picking

**Validaciones Correctas:**
```typescript
const sessionValidations = [
  {
    check: selectedOrderIds.size > 0,
    message: 'Selecciona al menos un pedido para crear una sesión',
    severity: 'error'
  },
  {
    check: selectedOrders.every(o => o.status === 'confirmed'),
    message: 'Solo puedes procesar pedidos en estado "Confirmado"',
    severity: 'error'
  },
  {
    check: selectedOrders.every(o =>
      o.order_line_items?.every(item => item.products?.stock >= item.quantity)
    ),
    message: 'Algunos pedidos tienen productos sin stock suficiente',
    severity: 'warning' // Warning porque puede procesar parcialmente
  }
];
```

---

### 4. Recibir Mercadería (Merchandise)
**Flujo Real:**
1. Usuario crea inbound shipment
2. Agrega productos (puede crearlos inline si no existen)
3. Recibe mercadería → Stock se incrementa

**Validaciones Correctas:**
```typescript
const shipmentValidations = [
  {
    check: supplierName.trim().length > 0,
    message: 'Ingresa el nombre del proveedor',
    severity: 'error'
  },
  {
    check: items.length > 0,
    message: 'Agrega al menos un producto al embarque',
    severity: 'error'
  },
  {
    check: items.every(i => i.quantity_ordered > 0),
    message: 'La cantidad ordenada debe ser mayor a 0',
    severity: 'error'
  },
  {
    check: reference.trim().length > 0,
    message: 'Agrega una referencia para identificar el embarque',
    severity: 'warning'
  }
];
```

---

### 5. Shopify Sync
**Flujo Real:**
1. Usuario conecta Shopify (una vez)
2. Importa productos → Se crean en Ordefy
3. Productos se sincronizan automáticamente

**Validaciones Correctas:**
```typescript
const shopifySyncValidations = [
  {
    check: shopifyIntegration?.status === 'connected',
    message: 'Tu tienda de Shopify no está conectada',
    severity: 'error'
  },
  {
    check: !importJob || importJob.status !== 'in_progress',
    message: 'Ya hay una importación en progreso. Espera a que termine.',
    severity: 'error'
  },
  {
    check: products.every(p => p.shopify_product_id),
    message: 'Algunos productos no están vinculados a Shopify',
    severity: 'warning'
  }
];
```

---

## ✅ Validaciones por Error Code

### Stock Insuficiente
```typescript
{
  check: products.every(p => p.quantity <= p.stock),
  message: `Stock insuficiente: "${productName}" (Disponible: ${stock}, Solicitado: ${quantity})`,
  severity: 'error',
  action: () => navigate(`/products?highlight=${productId}`)
}
```

### Pedido Sin Productos
```typescript
{
  check: products.length > 0,
  message: 'Agrega al menos un producto al pedido',
  severity: 'error'
}
```

### Cliente Sin Nombre
```typescript
{
  check: customerName.trim().length > 0,
  message: 'Ingresa el nombre del cliente (se creará automáticamente)',
  severity: 'error'
}
```

### Pedido Ya Procesado (No se puede editar)
```typescript
{
  check: order.status === 'pending' || order.status === 'confirmed',
  message: `No puedes editar pedidos en estado "${order.status}"`,
  severity: 'error',
  action: () => toast.info('Los pedidos ya procesados no pueden modificarse')
}
```

### Shopify No Conectado
```typescript
{
  check: shopifyIntegration?.status === 'connected',
  message: 'Tu tienda de Shopify no está conectada',
  severity: 'error',
  action: () => navigate('/integrations?tab=shopify')
}
```

---

## 🎯 Checklist Corregido - Empty States

### Orders Empty State
```typescript
<ImprovedEmptyState
  icon={<ShoppingCart />}
  title="¡Crea tu primer pedido!"
  description="Registra ventas y controla inventario automáticamente"
  checklist={[
    {
      done: products.length > 0,
      label: 'Tener productos en inventario',
      action: products.length === 0 ? () => navigate('/products') : undefined
    },
    {
      done: false,
      label: 'Crear tu primer pedido'
    }
  ]}
  tips={[
    'El cliente se crea automáticamente al ingresar su nombre',
    'El stock se descuenta cuando el pedido llega a "Listo para Enviar"',
    'Confirma pedidos por WhatsApp con un clic'
  ]}
  actions={[
    {
      label: 'Crear Pedido',
      onClick: () => setDialogOpen(true),
      primary: true
    }
  ]}
/>
```

### Products Empty State
```typescript
<ImprovedEmptyState
  icon={<Package />}
  title="Agrega tu primer producto"
  description="Los productos son la base de tu inventario"
  tips={[
    'El SKU te ayuda a identificar productos rápidamente',
    'Define el costo para calcular tu margen automáticamente',
    'Puedes importar productos desde Shopify en segundos'
  ]}
  actions={[
    {
      label: 'Crear Producto',
      onClick: () => setDialogOpen(true),
      primary: true
    },
    ...(hasShopify ? [{
      label: 'Importar desde Shopify',
      onClick: () => importFromShopify(),
      variant: 'outline'
    }] : [])
  ]}
/>
```

### Warehouse Empty State
```typescript
<ImprovedEmptyState
  icon={<Warehouse />}
  title={hasConfirmedOrders ? "Selecciona pedidos" : "No hay pedidos confirmados"}
  description={
    hasConfirmedOrders
      ? "Marca uno o más pedidos confirmados para crear una sesión de picking"
      : "Confirma algunos pedidos primero para poder prepararlos en el almacén"
  }
  tips={[
    'Puedes procesar múltiples pedidos en una sola sesión',
    'El picking agrupa productos de todos los pedidos',
    'El empaque te guía pedido por pedido'
  ]}
  actions={[
    {
      label: 'Ver Pedidos',
      onClick: () => navigate('/orders?status=pending'),
      primary: true
    }
  ]}
/>
```

---

## 🔧 Ejemplo Completo: OrderForm con Validación Correcta

```typescript
import { useState } from 'react';
import { ValidatedButton, InlineValidation, StockValidator } from '@/components/PreventiveValidation';

export function OrderForm({ onSubmit }: { onSubmit: (data: OrderData) => void }) {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [products, setProducts] = useState<OrderProduct[]>([]);

  // Validaciones CORRECTAS para el flujo real
  const validations = [
    {
      check: customerName.trim().length > 0,
      message: 'Ingresa el nombre del cliente (se creará automáticamente)',
      severity: 'error' as const
    },
    {
      check: products.length > 0,
      message: 'Agrega al menos un producto al pedido',
      severity: 'error' as const
    },
    {
      check: products.every(p => p.quantity > 0),
      message: 'La cantidad debe ser mayor a 0',
      severity: 'error' as const
    },
    {
      check: products.every(p => p.quantity <= p.stock),
      message: 'Stock insuficiente para algunos productos',
      severity: 'error' as const
    },
    {
      check: customerPhone.trim().length > 0,
      message: 'Agrega teléfono para enviar confirmación por WhatsApp',
      severity: 'warning' as const // Solo warning, no error
    }
  ];

  return (
    <div className="space-y-4">
      {/* Validaciones inline */}
      <InlineValidation validations={validations} />

      {/* Customer info */}
      <div>
        <Label>Nombre del Cliente</Label>
        <Input
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="Escribe el nombre..."
        />
        <p className="text-xs text-gray-500 mt-1">
          Si el cliente no existe, se creará automáticamente
        </p>
      </div>

      <div>
        <Label>Teléfono (Opcional)</Label>
        <Input
          value={customerPhone}
          onChange={(e) => setCustomerPhone(e.target.value)}
          placeholder="+54 9 11 1234-5678"
        />
      </div>

      {/* Products */}
      <div>
        <Label>Productos</Label>
        {products.map((product, index) => (
          <div key={index} className="space-y-2">
            <ProductSelector
              value={product}
              onChange={(p) => updateProduct(index, p)}
            />
            <StockValidator
              productId={product.id}
              productName={product.name}
              requestedQuantity={product.quantity}
              availableStock={product.stock}
            />
          </div>
        ))}
        <Button onClick={addProduct} variant="outline" size="sm">
          + Agregar Producto
        </Button>
      </div>

      {/* Submit con validación */}
      <ValidatedButton
        onClick={() => onSubmit({ customerName, customerPhone, products })}
        validations={validations}
        className="w-full"
      >
        Crear Pedido
      </ValidatedButton>
    </div>
  );
}
```

---

**Cambios Clave:**
1. ❌ ~~"Debes seleccionar un cliente"~~ → ✅ "Ingresa el nombre del cliente"
2. ❌ ~~Cliente como prerequisito~~ → ✅ Cliente se crea inline
3. ✅ Teléfono como **warning** (no error)
4. ✅ Validación de stock en tiempo real
5. ✅ Empty states solo verifican productos (no clientes)
