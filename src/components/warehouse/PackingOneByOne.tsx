/**
 * PackingOneByOne Component
 * Full-screen packing interface that shows one order at a time
 * Uses pagination instead of split-view for a cleaner, focused experience
 *
 * UPDATED: Jan 2026 - Full variant support (Migration 108)
 * - Uses composite keys (product_id|variant_id) for all lookups
 * - Properly handles bundles and variations
 * - Fixed pagination overflow for large order counts
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { logger } from '@/utils/logger';
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
  Truck,
  XCircle,
  MoreHorizontal
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
import { useToast } from '@/hooks/use-toast';
import type { OrderForPacking, PackingListResponse, PackingProgressItem, AvailableItem } from '@/services/warehouse.service';
import { getProductVariantKey } from '@/services/warehouse.service';

// ============================================================================
// TYPES
// ============================================================================

interface PackingOneByOneProps {
  packingData: PackingListResponse;
  currentOrderIndex: number;
  /**
   * Pack a single item - now includes optional variantId
   * @param orderId - Order to pack into
   * @param productId - Product being packed
   * @param variantId - Optional variant ID (Migration 108)
   */
  onPackItem: (orderId: string, productId: string, variantId?: string | null) => Promise<void>;
  onPackAllItems: (orderId: string) => Promise<void>;
  onAutoPackSession?: () => Promise<void>;
  onPrintLabel: (order: OrderForPacking) => Promise<void>;
  onNextOrder: () => void;
  onPreviousOrder: () => void;
  onGoToOrder: (index: number) => void;
  onCompleteSession: () => Promise<void>;
  onCancelSession?: () => Promise<void>;
  onReportProblem?: (orderId: string, reason: string) => Promise<void>;
  loading?: boolean;
}

// Maximum pagination dots to show before collapsing
const MAX_PAGINATION_DOTS = 7;

// ============================================================================
// COMPONENT
// ============================================================================

export function PackingOneByOne({
  packingData,
  currentOrderIndex,
  onPackItem,
  onPackAllItems,
  onAutoPackSession,
  onPrintLabel,
  onNextOrder,
  onPreviousOrder,
  onGoToOrder,
  onCompleteSession,
  onCancelSession,
  onReportProblem,
  loading,
}: PackingOneByOneProps) {
  const { toast } = useToast();
  const { orders, availableItems } = packingData;

  // BOUNDS CHECK FIX: Ensure currentOrderIndex is within valid range
  // This prevents crashes when orders are removed externally (e.g., auto-cleanup)
  const safeOrderIndex = Math.min(Math.max(0, currentOrderIndex), Math.max(0, orders.length - 1));
  const currentOrder = orders.length > 0 ? orders[safeOrderIndex] : null;

  // FIX: Notify parent when currentOrderIndex is out of bounds (e.g., order removed by auto-cleanup)
  useEffect(() => {
    if (orders.length > 0 && currentOrderIndex >= orders.length) {
      onGoToOrder(Math.max(0, orders.length - 1));
    }
  }, [currentOrderIndex, orders.length, onGoToOrder]);

  const [packingProduct, setPackingProduct] = useState<string | null>(null);
  const [autoPackingSession, setAutoPackingSession] = useState(false);
  const [printingOrder, setPrintingOrder] = useState(false);
  const [reportDialog, setReportDialog] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportingProblem, setReportingProblem] = useState(false);
  const [cancelDialog, setCancelDialog] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // ============================================================================
  // MEMOIZED VALUES
  // ============================================================================

  // Build a Map for O(1) availability lookups using composite keys
  const availabilityMap = useMemo(() => {
    const map = new Map<string, AvailableItem>();
    for (const item of availableItems) {
      const key = getProductVariantKey(item.product_id, item.variant_id);
      map.set(key, item);
    }
    return map;
  }, [availableItems]);

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

  // Calculate pagination dots (with ellipsis for large order counts)
  const paginationDots = useMemo(() => {
    if (orders.length <= MAX_PAGINATION_DOTS) {
      // Show all dots
      return orders.map((order, index) => ({
        type: 'dot' as const,
        index,
        order,
      }));
    }

    // Need to collapse - show first, last, current and neighbors
    const dots: Array<{ type: 'dot' | 'ellipsis'; index?: number; order?: typeof orders[0] }> = [];
    const current = safeOrderIndex;

    // Always show first
    dots.push({ type: 'dot', index: 0, order: orders[0] });

    // Show ellipsis if there's a gap before current range
    if (current > 2) {
      dots.push({ type: 'ellipsis' });
    }

    // Show current-1, current, current+1 (if valid)
    for (let i = Math.max(1, current - 1); i <= Math.min(orders.length - 2, current + 1); i++) {
      if (i > 0 && i < orders.length - 1) {
        dots.push({ type: 'dot', index: i, order: orders[i] });
      }
    }

    // Show ellipsis if there's a gap after current range
    if (current < orders.length - 3) {
      dots.push({ type: 'ellipsis' });
    }

    // Always show last
    if (orders.length > 1) {
      dots.push({ type: 'dot', index: orders.length - 1, order: orders[orders.length - 1] });
    }

    return dots;
  }, [orders, safeOrderIndex]);

  // ============================================================================
  // CALLBACKS
  // ============================================================================

  /**
   * Get item availability using composite key (product_id + variant_id)
   * FIX: Now properly handles variants (Migration 108)
   */
  const getItemAvailability = useCallback((productId: string, variantId?: string | null): number => {
    const key = getProductVariantKey(productId, variantId);
    const item = availabilityMap.get(key);
    return item?.remaining || 0;
  }, [availabilityMap]);

  /**
   * Handle packing a single item (with variant support)
   * FIX: Now passes variant_id to parent (Migration 108)
   */
  const handlePackItem = useCallback(async (productId: string, variantId?: string | null) => {
    if (!currentOrder) return;

    const key = getProductVariantKey(productId, variantId);
    setPackingProduct(key);
    try {
      await onPackItem(currentOrder.id, productId, variantId);
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

      // Calculate if there are more orders to pack
      const currentIdx = orders.findIndex(o => o.id === currentOrder.id);
      const hasMoreOrders = currentIdx < orders.length - 1;
      const nextIncompleteIdx = orders.findIndex((o, idx) => idx > currentIdx && !o.is_complete);

      toast({
        title: '✅ Pedido empacado',
        description: hasMoreOrders
          ? `#${currentOrder.order_number} listo. Avanzando al siguiente...`
          : `#${currentOrder.order_number} listo. ¡Último pedido!`,
      });

      // Auto-advance to next incomplete order, or next order if all complete
      if (hasMoreOrders) {
        // Small delay for visual feedback before advancing
        setTimeout(() => {
          if (nextIncompleteIdx !== -1) {
            onGoToOrder(nextIncompleteIdx);
          } else {
            onNextOrder();
          }
        }, 300);
      }
    } catch (error: any) {
      logger.error('Error packing all items:', error);
      toast({
        title: 'Error al empacar',
        description: error?.message || 'No se pudieron empacar los productos. Intenta de nuevo.',
        variant: 'destructive',
      });
    } finally {
      setPackingProduct(null);
    }
  }, [currentOrder, orders, onPackAllItems, onNextOrder, onGoToOrder, toast]);

  // Handle auto-packing entire session
  const handleAutoPackSession = useCallback(async () => {
    if (!onAutoPackSession) return;

    setAutoPackingSession(true);
    try {
      await onAutoPackSession();
    } finally {
      setAutoPackingSession(false);
    }
  }, [onAutoPackSession]);

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

  // Handle reporting a problem
  const handleReportProblem = useCallback(async () => {
    if (!currentOrder || !reportReason.trim()) {
      toast({
        title: 'Error',
        description: 'Por favor describe el problema',
        variant: 'destructive',
      });
      return;
    }

    setReportingProblem(true);
    try {
      if (onReportProblem) {
        await onReportProblem(currentOrder.id, reportReason);
        toast({
          title: 'Problema reportado',
          description: `Se ha registrado el problema para el pedido #${currentOrder.order_number}`,
        });
      } else {
        // Fallback: Just log and show confirmation
        logger.info(`Problem reported for order ${currentOrder.id}: ${reportReason}`);
        toast({
          title: 'Problema registrado',
          description: 'El problema ha sido registrado. Contacta a tu supervisor para seguimiento.',
        });
      }
      setReportDialog(false);
      setReportReason('');
    } catch (error) {
      logger.error('Error reporting problem:', error);
      toast({
        title: 'Error',
        description: 'No se pudo registrar el problema. Intenta de nuevo.',
        variant: 'destructive',
      });
    } finally {
      setReportingProblem(false);
    }
  }, [currentOrder, reportReason, onReportProblem, toast]);

  // ============================================================================
  // RENDER
  // ============================================================================

  if (!currentOrder) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">No hay pedidos para empacar</p>
      </div>
    );
  }

  const orderComplete = currentOrder.is_complete;
  const canPackMore = currentOrder.items.some(
    item => item.quantity_packed < item.quantity_needed && getItemAvailability(item.product_id, item.variant_id) > 0
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

          <div className="flex items-center gap-3">
            {/* Auto-Pack All Button - Only show if not all orders complete */}
            {!allOrdersComplete && onAutoPackSession && (
              <Button
                onClick={handleAutoPackSession}
                disabled={autoPackingSession || loading}
                size="lg"
                variant="default"
                className="gap-2 bg-primary hover:bg-primary/90"
              >
                {autoPackingSession ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Empacando Todo...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Empacar Todos ({progress.ordersTotal - progress.ordersComplete})
                  </>
                )}
              </Button>
            )}

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

                {/* Order Position */}
                <div className="text-2xl font-bold text-muted-foreground">
                  {safeOrderIndex + 1}
                </div>
              </div>
            </div>

            {/* Quick Product Summary - for fast visual scanning */}
            <div className="px-6 py-3 bg-muted/20 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-primary" />
                    <span className="font-semibold text-sm">
                      {currentOrder.items.length} {currentOrder.items.length === 1 ? 'producto' : 'productos'}
                    </span>
                  </div>
                  <span className="text-muted-foreground">•</span>
                  <span className="text-sm text-muted-foreground">
                    {currentOrder.items.reduce((sum, i) => sum + i.quantity_needed, 0)} unidades total
                  </span>
                </div>
                {orderComplete && (
                  <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                    Listo para etiqueta
                  </Badge>
                )}
              </div>

              {/* Compact product list for quick scanning */}
              <div className="mt-2 flex flex-wrap gap-2">
                {currentOrder.items.map((item: PackingProgressItem) => {
                  const itemKey = getProductVariantKey(item.product_id, item.variant_id);
                  const itemComplete = item.quantity_packed >= item.quantity_needed;
                  // Get short product name (first 25 chars)
                  const shortName = item.product_name.length > 25
                    ? item.product_name.substring(0, 25) + '...'
                    : item.product_name;

                  return (
                    <Badge
                      key={itemKey}
                      variant={itemComplete ? 'default' : 'outline'}
                      className={cn(
                        'text-xs font-normal',
                        itemComplete
                          ? 'bg-primary/80 text-primary-foreground'
                          : 'bg-background'
                      )}
                    >
                      {item.quantity_needed}x {shortName}
                      {item.variant_title && ` (${item.variant_title})`}
                    </Badge>
                  );
                })}
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
                {currentOrder.items.map((item: PackingProgressItem) => {
                  const itemComplete = item.quantity_packed >= item.quantity_needed;
                  const availableInBasket = getItemAvailability(item.product_id, item.variant_id);
                  const canPack = !itemComplete && availableInBasket > 0;
                  const itemKey = getProductVariantKey(item.product_id, item.variant_id);
                  const isPacking = packingProduct === itemKey;

                  return (
                    <div
                      key={itemKey}
                      className={cn(
                        'flex items-center gap-4 p-4 rounded-lg border transition-all',
                        itemComplete
                          ? 'bg-primary/5 border-primary/30'
                          : canPack
                            ? 'bg-card border-border hover:border-primary/50 cursor-pointer'
                            : 'bg-muted/30 border-transparent'
                      )}
                      onClick={() => {
                        if (canPack && !isPacking && packingProduct !== 'all') {
                          handlePackItem(item.product_id, item.variant_id);
                        }
                      }}
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
          <div className="flex items-center gap-2">
            <Button
              onClick={onPreviousOrder}
              disabled={currentOrderIndex === 0}
              variant="outline"
              className="gap-2"
            >
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </Button>

            {onCancelSession && (
              <Button
                onClick={() => setCancelDialog(true)}
                variant="ghost"
                className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <XCircle className="h-4 w-4" />
                Cancelar Sesión
              </Button>
            )}
          </div>

          {/* Pagination Dots - Now with overflow handling */}
          <div className="flex items-center gap-1.5">
            {paginationDots.map((dot, idx) => (
              dot.type === 'ellipsis' ? (
                <div key={`ellipsis-before-${dot.index ?? idx}`} className="px-1">
                  <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                </div>
              ) : dot.index !== undefined ? (
                <button
                  key={`dot-${dot.index}`}
                  onClick={() => onGoToOrder(dot.index!)}
                  className={cn(
                    'w-3 h-3 rounded-full transition-all',
                    dot.index === safeOrderIndex
                      ? 'bg-primary scale-125'
                      : dot.order?.is_complete
                        ? 'bg-primary/50'
                        : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'
                  )}
                  title={`Pedido #${dot.order?.order_number}`}
                />
              ) : null
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
          Pedido {safeOrderIndex + 1} de {orders.length}
        </p>
      </div>

      {/* Report Problem Dialog - Now functional */}
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
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground mt-1 text-right">
              {reportReason.length}/500
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setReportDialog(false);
                setReportReason('');
              }}
              disabled={reportingProblem}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleReportProblem}
              disabled={reportingProblem || !reportReason.trim()}
            >
              {reportingProblem ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Enviando...
                </>
              ) : (
                'Enviar Reporte'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Session Dialog */}
      <Dialog open={cancelDialog} onOpenChange={setCancelDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-destructive" />
              Cancelar Sesión de Empaque
            </DialogTitle>
            <DialogDescription>
              Esta acción cancelará la sesión actual y restaurará todos los pedidos al estado "Confirmado".
              Podrás crear una nueva sesión después.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              <strong>Pedidos afectados:</strong> {orders.length} pedidos serán restaurados
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialog(false)} disabled={cancelling}>
              Volver
            </Button>
            <Button
              variant="destructive"
              disabled={cancelling}
              onClick={async () => {
                if (!onCancelSession) return;
                setCancelling(true);
                try {
                  await onCancelSession();
                  setCancelDialog(false);
                } catch (error) {
                  logger.error('Error cancelling session:', error);
                } finally {
                  setCancelling(false);
                }
              }}
            >
              {cancelling ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Cancelando...
                </>
              ) : (
                'Sí, Cancelar Sesión'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
