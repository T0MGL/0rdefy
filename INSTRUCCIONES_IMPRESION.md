# Sistema de Impresión de Etiquetas de Envío

## Cambios Aplicados ✅

### 1. Base de Datos ✅
- Migración `017_add_printed_status.sql` creada
- Campos agregados: `printed`, `printed_at`, `printed_by`

### 2. Backend ✅
- Endpoint: `POST /api/orders/:id/mark-printed`
- Endpoint: `POST /api/orders/mark-printed-bulk`

### 3. Frontend ✅
- Tipo `Order` actualizado con campos de impresión
- Servicio `ordersService` con funciones de marcado
- **Formato optimizado: 4x6 pulgadas PORTRAIT** (compatible con impresoras térmicas)
- CSS de impresión robusto con tamaños fijos garantizados
- Instrucciones de feedback para clientes agregadas
- Handlers de bulk printing implementados
- **Sistema de clases CSS semánticas** para mejor control del layout
- **Page-break automático** para impresión en lote

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

## Mejoras Técnicas del CSS de Impresión ✅

### Optimizaciones Implementadas

1. **Formato Portrait 4x6 pulgadas** (10.16cm x 15.24cm)
   - `@page { size: 4in 6in portrait; margin: 0; }`
   - Tamaño estándar para impresoras térmicas de etiquetas
   - Compatible con Dymo, Zebra, Brother, etc.

2. **Tamaños Fijos y Controlados**
   - Todas las dimensiones en pulgadas (`in`) para precisión
   - QR Code: 1.5in x 1.5in (legible y compacto)
   - Padding: 0.2in (espacio seguro en los bordes)
   - Gaps y márgenes en unidades físicas (0.04in - 0.1in)

3. **Tipografía Optimizada**
   - Tamaños de fuente fijos en puntos (pt)
   - Títulos: 11pt (legible sin ocupar mucho espacio)
   - Contenido principal: 7-8pt
   - Detalles secundarios: 5-6pt
   - Line-height: 1.1-1.3 (compacto pero legible)

4. **Layout Vertical en Print**
   - Screen: Layout horizontal (QR izquierda, info derecha)
   - Print: Layout vertical (QR arriba, info abajo)
   - Aprovecha mejor el espacio en formato portrait
   - `flex-direction: column` en `.label-content` para print

5. **Control de Desbordamiento**
   - `overflow: hidden` en contenedor principal
   - `page-break-inside: avoid` evita cortes de contenido
   - `page-break-after: always` separa etiquetas en batch
   - `orphans: 3` y `widows: 3` para mejor control de texto

6. **Preservación de Colores**
   - `-webkit-print-color-adjust: exact`
   - `print-color-adjust: exact`
   - Garantiza que fondos de colores (azul para instrucciones) se impriman correctamente

7. **Sistema de Clases Semánticas**
   - `.shipping-label` - Contenedor principal
   - `.qr-section` - Sección del QR code
   - `.info-section` - Sección de información
   - `.customer-section`, `.courier-section`, `.products-section` - Secciones específicas
   - Fácil mantenimiento y modificación

8. **Batch Printing Support**
   - Cada etiqueta se imprime en su propia página
   - `page-break-after: always` después de cada etiqueta
   - Visibilidad controlada: solo se muestra la etiqueta actual
   - Sin interferencia entre etiquetas consecutivas

## Soporte de Impresoras

El nuevo formato de 4x6 pulgadas portrait es compatible con:
- **Impresoras térmicas directas**: Dymo, Zebra, Brother
- **Impresoras de transferencia térmica**: Zebra ZD/ZT series
- **Impresoras láser/inkjet**: Con papel de etiquetas 4x6
- **Impresoras de etiquetas adhesivas**: Rollo continuo o hojas

### Configuración Recomendada

**Para impresoras térmicas:**
- Tamaño de papel: 4" x 6" (10.16cm x 15.24cm)
- Orientación: Portrait (vertical)
- Márgenes: Mínimos (0.1in o menos)
- Escala: 100% (sin ajustar)

**Para impresoras láser/inkjet:**
- Usar papel de etiquetas adhesivas 4x6
- Configurar tamaño personalizado en driver
- Orientación: Portrait
- Márgenes: 0

## Testing

Para probar el sistema:

1. **Impresión Individual:**
   ```
   1. Ir a Pedidos
   2. Click en ícono de impresora (azul)
   3. Click en "Imprimir Etiqueta"
   4. Verificar preview antes de imprimir
   5. Ícono cambia a verde después de imprimir
   ```

2. **Impresión en Lote (Batch):**
   ```
   1. Seleccionar múltiples pedidos con checkboxes
   2. Click en "Imprimir X etiquetas"
   3. Imprimir primera etiqueta
   4. Click en "Siguiente Etiqueta"
   5. Repetir hasta completar todas
   6. Todos los pedidos marcados como impresos
   ```

3. **Verificar Layout:**
   ```
   - QR code centrado arriba (1.5in x 1.5in)
   - Información del cliente legible (8pt)
   - Productos listados claramente (7pt)
   - Instrucciones para cliente visibles (fondo azul)
   - Link de entrega al final
   - Todo cabe en 4x6 inches sin cortes
   ```
