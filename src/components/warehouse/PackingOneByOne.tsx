/**
 * PackingOneByOne Component
 * Full-screen packing interface that shows one order at a time
 * Uses pagination instead of split-view for a cleaner, focused experience
 */

import { useState, useCallback, useMemo } from 'react';
import {
  Package,
  Check,
  ChevronLeft,
  ChevronRight,
  Printer,
  AlertTriangle,
  Loader2,
  User,
  Phone,
  MapPin,
  Truck
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { OrderForPacking, PackingListResponse } from '@/services/warehouse.service';

interface PackingOneByOneProps {
  packingData: PackingListResponse;
  currentOrderIndex: number;
  onPackItem: (orderId: string, productId: string) => Promise<void>;
  onPackAllItems: (orderId: string) => Promise<void>;
  onPrintLabel: (order: OrderForPacking) => Promise<void>;
  onNextOrder: () => void;
  onPreviousOrder: () => void;
  onGoToOrder: (index: number) => void;
  onCompleteSession: () => Promise<void>;
  loading?: boolean;
}

export function PackingOneByOne({
  packingData,
  currentOrderIndex,
  onPackItem,
  onPackAllItems,
  onPrintLabel,
  onNextOrder,
  onPreviousOrder,
  onGoToOrder,
  onCompleteSession,
  loading,
}: PackingOneByOneProps) {
  const { orders, availableItems } = packingData;
  const currentOrder = orders[currentOrderIndex];

  const [packingProduct, setPackingProduct] = useState<string | null>(null);
  const [printingOrder, setPrintingOrder] = useState(false);
  const [reportDialog, setReportDialog] = useState(false);
  const [reportReason, setReportReason] = useState('');

  // Progress calculation
  const progress = useMemo(() => {
    const completedOrders = orders.filter(o => o.is_complete).length;
    const totalItems = orders.reduce(
      (sum, o) => sum + o.items.reduce((s, i) => s + i.quantity_needed, 0),
      0
    );
    const packedItems = orders.reduce(
      (sum, o) => sum + o.items.reduce((s, i) => s + i.quantity_packed, 0),
      0
    );

    return {
      ordersComplete: completedOrders,
      ordersTotal: orders.length,
      itemsComplete: packedItems,
      itemsTotal: totalItems,
      percentage: totalItems > 0 ? (packedItems / totalItems) * 100 : 0,
    };
  }, [orders]);

  const allOrdersComplete = progress.ordersComplete === progress.ordersTotal;

  // Check item availability in basket
  const getItemAvailability = useCallback((productId: string) => {
    const item = availableItems.find(i => i.product_id === productId);
    return item?.remaining || 0;
  }, [availableItems]);

  // Handle packing a single item
  const handlePackItem = useCallback(async (productId: string) => {
    if (!currentOrder) return;

    setPackingProduct(productId);
    try {
      await onPackItem(currentOrder.id, productId);
    } finally {
      setPackingProduct(null);
    }
  }, [currentOrder, onPackItem]);

  // Handle packing all items for current order
  const handlePackAll = useCallback(async () => {
    if (!currentOrder) return;

    setPackingProduct('all');
    try {
      await onPackAllItems(currentOrder.id);
    } finally {
      setPackingProduct(null);
    }
  }, [currentOrder, onPackAllItems]);

  // Handle printing label
  const handlePrintLabel = useCallback(async () => {
    if (!currentOrder) return;

    setPrintingOrder(true);
    try {
      await onPrintLabel(currentOrder);
    } finally {
      setPrintingOrder(false);
    }
  }, [currentOrder, onPrintLabel]);

  if (!currentOrder) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">No hay pedidos para empacar</p>
      </div>
    );
  }

  const orderComplete = currentOrder.is_complete;
  const canPackMore = currentOrder.items.some(
    item => item.quantity_packed < item.quantity_needed && getItemAvailability(item.product_id) > 0
  );

  return (
    <div className="h-full flex flex-col">
      {/* Progress Header */}
      <div className="bg-card border-b p-4 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold">Empaque de Pedidos</h2>
            <p className="text-sm text-muted-foreground">
              {progress.ordersComplete} de {progress.ordersTotal} pedidos completados
            </p>
          </div>

          {allOrdersComplete && (
            <Button
              onClick={onCompleteSession}
              disabled={loading}
              size="lg"
              className="gap-2 bg-primary"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Finalizar Sesión
            </Button>
          )}
        </div>

        <Progress value={progress.percentage} className="h-2" />
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto">
          {/* Order Card */}
          <Card className={cn(
            'overflow-hidden transition-all',
            orderComplete ? 'border-primary' : ''
          )}>
            {/* Order Header */}
            <div className={cn(
              'p-6 border-b',
              orderComplete ? 'bg-primary/10' : 'bg-muted/30'
            )}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <h2 className="text-3xl font-bold text-primary">
                      #{currentOrder.order_number}
                    </h2>
                    {orderComplete && (
                      <Badge className="bg-primary text-primary-foreground">
                        <Check className="h-3 w-3 mr-1" />
                        Completo
                      </Badge>
                    )}
                  </div>

                  <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{currentOrder.customer_name}</span>
                    </div>
                    {currentOrder.customer_phone && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Phone className="h-4 w-4" />
                        <span>{currentOrder.customer_phone}</span>
                      </div>
                    )}
                    {currentOrder.customer_address && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <MapPin className="h-4 w-4" />
                        <span className="line-clamp-1">{currentOrder.customer_address}</span>
                      </div>
                    )}
                    {currentOrder.carrier_name && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Truck className="h-4 w-4" />
                        <span>{currentOrder.carrier_name}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* COD Badge */}
                {currentOrder.cod_amount && currentOrder.cod_amount > 0 && (
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-base px-3 py-1">
                    COD: {new Intl.NumberFormat('es-PY').format(currentOrder.cod_amount)} Gs
                  </Badge>
                )}
              </div>
            </div>

            {/* Quick Action - Pack All Button */}
            {!orderComplete && canPackMore && (
              <div className="px-6 pt-4">
                <Button
                  onClick={handlePackAll}
                  disabled={packingProduct !== null}
                  size="lg"
                  className="w-full h-14 text-lg gap-3 bg-primary hover:bg-primary/90"
                >
                  {packingProduct === 'all' ? (
                    <>
                      <Loader2 className="h-6 w-6 animate-spin" />
                      Empacando...
                    </>
                  ) : (
                    <>
                      <Check className="h-6 w-6" />
                      Empacar Todo el Pedido
                    </>
                  )}
                </Button>
              </div>
            )}

            {/* Products List */}
            <div className="p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Package className="h-5 w-5" />
                Productos para esta caja ({currentOrder.items.length})
              </h3>

              <div className="space-y-3">
                {currentOrder.items.map(item => {
                  const itemComplete = item.quantity_packed >= item.quantity_needed;
                  const availableInBasket = getItemAvailability(item.product_id);
                  const canPack = !itemComplete && availableInBasket > 0;
                  const isPacking = packingProduct === item.product_id;

                  return (
                    <div
                      key={item.product_id}
                      className={cn(
                        'flex items-center gap-4 p-4 rounded-lg border transition-all',
                        itemComplete
                          ? 'bg-primary/5 border-primary/30'
                          : canPack
                            ? 'bg-card border-border hover:border-primary/50 cursor-pointer'
                            : 'bg-muted/30 border-transparent'
                      )}
                      onClick={() => canPack && !isPacking && packingProduct !== 'all' && handlePackItem(item.product_id)}
                    >
                      {/* Status Indicator */}
                      <div className="shrink-0">
                        {itemComplete ? (
                          <div className="h-10 w-10 rounded-full bg-primary flex items-center justify-center">
                            <Check className="h-5 w-5 text-primary-foreground" />
                          </div>
                        ) : (
                          <div className={cn(
                            'h-10 w-10 rounded-full border-2 flex items-center justify-center transition-all',
                            canPack ? 'border-primary/50 bg-primary/10' : 'border-muted-foreground/30'
                          )}>
                            <span className={cn(
                              'text-sm font-bold',
                              canPack ? 'text-primary' : 'text-muted-foreground'
                            )}>
                              {item.quantity_packed}/{item.quantity_needed}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Product Image */}
                      {item.product_image ? (
                        <img
                          src={item.product_image}
                          alt={item.product_name}
                          className="w-14 h-14 object-cover rounded-lg shrink-0"
                        />
                      ) : (
                        <div className="w-14 h-14 bg-muted rounded-lg flex items-center justify-center shrink-0">
                          <Package className="h-7 w-7 text-muted-foreground" />
                        </div>
                      )}

                      {/* Product Info */}
                      <div className="flex-1 min-w-0">
                        <h4 className={cn(
                          'font-medium line-clamp-1',
                          itemComplete && 'text-muted-foreground line-through'
                        )}>
                          {item.product_name}
                        </h4>
                        <p className="text-sm text-muted-foreground">
                          {item.quantity_needed} unidad{item.quantity_needed !== 1 ? 'es' : ''}
                        </p>
                      </div>

                      {/* Action Button / Status */}
                      <div className="shrink-0">
                        {itemComplete ? (
                          <Badge className="bg-primary/10 text-primary border-primary/30">
                            <Check className="h-3 w-3 mr-1" />
                            Listo
                          </Badge>
                        ) : isPacking ? (
                          <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        ) : canPack ? (
                          <Badge variant="outline" className="text-primary border-primary/30 cursor-pointer hover:bg-primary/10">
                            Clic para empacar
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            Sin stock
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Actions Footer */}
            <div className="p-6 border-t bg-muted/20">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={handlePrintLabel}
                    disabled={printingOrder || !currentOrder.delivery_link_token}
                    variant={orderComplete && !currentOrder.printed ? 'default' : 'outline'}
                    size="lg"
                    className="gap-2"
                  >
                    {printingOrder ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Printer className="h-4 w-4" />
                    )}
                    {currentOrder.printed ? 'Reimprimir Etiqueta' : 'Imprimir Etiqueta'}
                  </Button>

                  <Button
                    onClick={() => setReportDialog(true)}
                    variant="ghost"
                    className="gap-2 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                  >
                    <AlertTriangle className="h-4 w-4" />
                    Reportar Problema
                  </Button>
                </div>

                {/* Next Order Button when complete */}
                {orderComplete && currentOrderIndex < orders.length - 1 && (
                  <Button
                    onClick={onNextOrder}
                    size="lg"
                    className="gap-2"
                  >
                    Siguiente Pedido
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Navigation Footer */}
      <div className="bg-card border-t p-4 shrink-0">
        <div className="flex items-center justify-between max-w-3xl mx-auto">
          <Button
            onClick={onPreviousOrder}
            disabled={currentOrderIndex === 0}
            variant="outline"
            className="gap-2"
          >
            <ChevronLeft className="h-4 w-4" />
            Anterior
          </Button>

          {/* Pagination Dots */}
          <div className="flex items-center gap-2">
            {orders.map((order, index) => (
              <button
                key={order.id}
                onClick={() => onGoToOrder(index)}
                className={cn(
                  'w-3 h-3 rounded-full transition-all',
                  index === currentOrderIndex
                    ? 'bg-primary scale-125'
                    : order.is_complete
                      ? 'bg-primary/50'
                      : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'
                )}
                title={`Pedido #${order.order_number}`}
              />
            ))}
          </div>

          <Button
            onClick={onNextOrder}
            disabled={currentOrderIndex === orders.length - 1}
            variant="outline"
            className="gap-2"
          >
            Siguiente
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-2">
          Pedido {currentOrderIndex + 1} de {orders.length}
        </p>
      </div>

      {/* Report Problem Dialog */}
      <Dialog open={reportDialog} onOpenChange={setReportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Reportar Problema
            </DialogTitle>
            <DialogDescription>
              Pedido #{currentOrder.order_number}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <label className="text-sm font-medium mb-2 block">
              Describe el problema
            </label>
            <Textarea
              placeholder="Ej: Producto dañado, Falta un item, Cliente contactó..."
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              rows={4}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReportDialog(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                // TODO: Implement report logic
                setReportDialog(false);
                setReportReason('');
              }}
            >
              Enviar Reporte
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      </div>
  );
}
