# Instrucciones para Completar el Sistema de Impresión

## Cambios Aplicados

### 1. Base de Datos ✅
- Migración `017_add_printed_status.sql` creada
- Campos agregados: `printed`, `printed_at`, `printed_by`

### 2. Backend ✅
- Endpoint: `POST /api/orders/:id/mark-printed`
- Endpoint: `POST /api/orders/mark-printed-bulk`

### 3. Frontend ✅
- Tipo `Order` actualizado con campos de impresión
- Servicio `ordersService` con funciones de marcado
- Formato de etiqueta cambiado a 4x6 pulgadas
- Instrucciones de feedback para clientes agregadas
- Handlers de bulk printing implementados

## Cambios Finales en la UI

### En `src/pages/Orders.tsx`:

#### 1. Agregar columna de checkbox en la tabla (línea ~527):

```tsx
<thead className="bg-muted/50">
  <tr>
    {/* Nueva columna de checkbox */}
    <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">
      <input
        type="checkbox"
        className="rounded border-gray-300"
        checked={selectedOrderIds.size > 0 && selectedOrderIds.size === filteredOrders.filter(o => o.delivery_link_token).length}
        onChange={handleToggleSelectAll}
      />
    </th>
    <th className="text-left py-4 px-6 text-sm font-medium text-muted-foreground">
      ID Pedido
    </th>
    {/* ... resto de columnas ... */}
  </tr>
</thead>
```

#### 2. Agregar checkbox en cada fila (línea ~555):

```tsx
<tr key={order.id} className="border-t border-border hover:bg-muted/30 transition-colors">
  {/* Nueva celda de checkbox */}
  <td className="py-4 px-4">
    {order.delivery_link_token && (
      <input
        type="checkbox"
        className="rounded border-gray-300"
        checked={selectedOrderIds.has(order.id)}
        onChange={() => handleToggleSelect(order.id)}
      />
    )}
  </td>
  <td className="py-4 px-6 text-sm font-mono">{order.id}</td>
  {/* ... resto de celdas ... */}
</tr>
```

#### 3. Actualizar botón de impresora con color dinámico (línea ~665-677):

Reemplazar:
```tsx
{order.delivery_link_token && (
  <Button
    variant="ghost"
    size="icon"
    onClick={() => {
      setOrderToPrint(order);
      setPrintLabelDialogOpen(true);
    }}
    title="Imprimir etiqueta de entrega"
    className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/20"
  >
    <Printer size={16} />
  </Button>
)}
```

Con:
```tsx
{order.delivery_link_token && (
  <Button
    variant="ghost"
    size="icon"
    onClick={() => handlePrintLabel(order)}
    title={order.printed ? "Etiqueta impresa" : "Imprimir etiqueta de entrega"}
    className={order.printed
      ? "text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/20"
      : "text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/20"
    }
  >
    <Printer size={16} />
  </Button>
)}
```

#### 4. Agregar botón "Imprimir Seleccionados" en el header (línea ~423-451):

Después del botón "Ver Mapa" y antes de "Follow-ups", agregar:

```tsx
{selectedOrderIds.size > 0 && (
  <Button
    onClick={handleBulkPrint}
    className="gap-2"
  >
    <Printer size={18} />
    Imprimir {selectedOrderIds.size} etiqueta{selectedOrderIds.size !== 1 ? 's' : ''}
  </Button>
)}
```

#### 5. Actualizar el diálogo de impresión (línea ~811-833):

Reemplazar:
```tsx
<Dialog open={printLabelDialogOpen} onOpenChange={setPrintLabelDialogOpen}>
  <DialogContent className="max-w-[950px] max-h-[90vh] overflow-y-auto">
    <DialogHeader>
      <DialogTitle>Etiqueta de Entrega</DialogTitle>
    </DialogHeader>
    {orderToPrint && orderToPrint.delivery_link_token && (
      <OrderShippingLabel
        orderId={orderToPrint.id}
        deliveryToken={orderToPrint.delivery_link_token}
        customerName={orderToPrint.customer}
        customerPhone={orderToPrint.phone}
        customerAddress={orderToPrint.address}
        courierName={orderToPrint.carrier}
        products={[
          {
            name: orderToPrint.product,
            quantity: orderToPrint.quantity,
          },
        ]}
      />
    )}
  </DialogContent>
</Dialog>
```

Con:
```tsx
{/* Single Print Dialog */}
<Dialog open={printLabelDialogOpen && !isPrintingBulk} onOpenChange={setPrintLabelDialogOpen}>
  <DialogContent className="max-w-[500px] max-h-[90vh] overflow-y-auto">
    <DialogHeader>
      <DialogTitle>Etiqueta de Entrega</DialogTitle>
    </DialogHeader>
    {orderToPrint && orderToPrint.delivery_link_token && (
      <OrderShippingLabel
        orderId={orderToPrint.id}
        deliveryToken={orderToPrint.delivery_link_token}
        customerName={orderToPrint.customer}
        customerPhone={orderToPrint.phone}
        customerAddress={orderToPrint.address}
        courierName={orderToPrint.carrier}
        products={[
          {
            name: orderToPrint.product,
            quantity: orderToPrint.quantity,
          },
        ]}
        onPrinted={() => handleOrderPrinted(orderToPrint.id)}
      />
    )}
  </DialogContent>
</Dialog>

{/* Bulk Print Dialog */}
<Dialog open={isPrintingBulk} onOpenChange={() => setIsPrintingBulk(false)}>
  <DialogContent className="max-w-[500px] max-h-[90vh] overflow-y-auto">
    <DialogHeader>
      <DialogTitle>
        Imprimiendo Etiquetas ({bulkPrintIndex + 1} de {bulkPrintOrders.length})
      </DialogTitle>
    </DialogHeader>
    {bulkPrintOrders[bulkPrintIndex] && bulkPrintOrders[bulkPrintIndex].delivery_link_token && (
      <div className="space-y-4">
        <OrderShippingLabel
          orderId={bulkPrintOrders[bulkPrintIndex].id}
          deliveryToken={bulkPrintOrders[bulkPrintIndex].delivery_link_token!}
          customerName={bulkPrintOrders[bulkPrintIndex].customer}
          customerPhone={bulkPrintOrders[bulkPrintIndex].phone}
          customerAddress={bulkPrintOrders[bulkPrintIndex].address}
          courierName={bulkPrintOrders[bulkPrintIndex].carrier}
          products={[
            {
              name: bulkPrintOrders[bulkPrintIndex].product,
              quantity: bulkPrintOrders[bulkPrintIndex].quantity,
            },
          ]}
          onPrinted={handleNextBulkPrint}
        />
        <Button
          onClick={handleNextBulkPrint}
          className="w-full"
          variant="outline"
        >
          {bulkPrintIndex < bulkPrintOrders.length - 1 ? 'Siguiente Etiqueta →' : 'Finalizar Impresión'}
        </Button>
      </div>
    )}
  </DialogContent>
</Dialog>
```

## Instrucciones de Uso

### 1. Ejecutar Migración de Base de Datos

```bash
psql -h <host> -U <user> -d <database> \
  -f db/migrations/017_add_printed_status.sql
```

### 2. Aplicar los cambios de UI en Orders.tsx

Sigue los 5 pasos descritos arriba.

### 3. Probar el Sistema

1. **Impresión Individual:**
   - Ir a la página de Pedidos
   - Click en el icono de impresora (azul)
   - Imprimir la etiqueta
   - El icono debería cambiar a verde

2. **Impresión Masiva:**
   - Seleccionar múltiples pedidos con checkboxes
   - Click en "Imprimir X etiquetas"
   - Imprimir cada etiqueta secuencialmente
   - Click en "Siguiente Etiqueta" o "Finalizar"
   - Todos los pedidos se marcan como impresos

## Características Implementadas

✅ Etiqueta de 4x6 pulgadas (10.16cm x 15.24cm)
✅ QR Code centrado y compacto
✅ Instrucciones para el repartidor
✅ Instrucciones de feedback para el cliente (sección azul)
✅ Marcado individual de impresión
✅ Marcado masivo de impresión
✅ Indicador visual (azul/verde) de estado de impresión
✅ Selección múltiple con checkboxes
✅ Cola de impresión secuencial

## Soporte

El nuevo formato de 4x6 pulgadas es compatible con:
- Impresoras térmicas de etiquetas
- Impresoras láser/inkjet (papel carta)
- Impresoras de etiquetas adhesivas
- Dymo, Zebra, Brother, etc.
