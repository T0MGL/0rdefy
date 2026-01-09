/**
 * PickingList Component
 * New picking interface with order-first approach and direct controls
 */

import { useState, useMemo, useCallback } from 'react';
import {
  Package,
  Check,
  Plus,
  Minus,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Loader2,
  MapPin
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
import type { PickingSessionItem } from '@/services/warehouse.service';

type ViewMode = 'by-product' | 'by-order';

interface PickingListProps {
  items: PickingSessionItem[];
  orders: Array<{
    id: string;
    order_number: string;
    customer_name: string;
  }>;
  onUpdateQuantity: (productId: string, quantity: number) => Promise<void>;
  onFinishPicking: () => Promise<void>;
  loading?: boolean;
}

export function PickingList({
  items,
  orders,
  onUpdateQuantity,
  onFinishPicking,
  loading,
}: PickingListProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('by-product');
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set(orders.map(o => o.id)));
  const [outOfStockDialog, setOutOfStockDialog] = useState<{ productId: string; productName: string } | null>(null);
  const [outOfStockReason, setOutOfStockReason] = useState('');
  const [updatingProduct, setUpdatingProduct] = useState<string | null>(null);

  // Calculate progress
  const progress = useMemo(() => {
    const totalNeeded = items.reduce((sum, item) => sum + item.total_quantity_needed, 0);
    const totalPicked = items.reduce((sum, item) => sum + item.quantity_picked, 0);
    return {
      percentage: totalNeeded > 0 ? (totalPicked / totalNeeded) * 100 : 0,
      totalNeeded,
      totalPicked,
      itemsComplete: items.filter(i => i.quantity_picked >= i.total_quantity_needed).length,
      totalItems: items.length,
    };
  }, [items]);

  const allPicked = progress.itemsComplete === progress.totalItems;

  // Handle quantity update with loading state
  const handleUpdateQuantity = useCallback(async (productId: string, quantity: number) => {
    setUpdatingProduct(productId);
    try {
      await onUpdateQuantity(productId, quantity);
    } finally {
      setUpdatingProduct(null);
    }
  }, [onUpdateQuantity]);

  // Complete all for a product
  const handleCompleteProduct = useCallback(async (item: PickingSessionItem) => {
    await handleUpdateQuantity(item.product_id, item.total_quantity_needed);
  }, [handleUpdateQuantity]);

  const toggleOrderExpanded = (orderId: string) => {
    setExpandedOrders(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Progress Header */}
      <Card className={cn(
        'p-4 transition-all',
        allPicked ? 'bg-primary/10 border-primary' : 'bg-muted/30'
      )}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={cn(
              'p-2 rounded-full',
              allPicked ? 'bg-primary text-primary-foreground' : 'bg-primary/20 text-primary'
            )}>
              {allPicked ? <Check className="h-5 w-5" /> : <Package className="h-5 w-5" />}
            </div>
            <div>
              <h3 className="font-semibold">Progreso de Recolección</h3>
              <p className="text-sm text-muted-foreground">
                {progress.totalPicked} de {progress.totalNeeded} unidades
                {' '}({progress.itemsComplete}/{progress.totalItems} productos)
              </p>
            </div>
          </div>
          <span className="text-3xl font-bold text-primary">
            {Math.round(progress.percentage)}%
          </span>
        </div>

        <Progress value={progress.percentage} className="h-3" />

        {allPicked && (
          <div className="mt-4 flex items-center justify-between p-3 bg-primary/20 rounded-lg">
            <div className="flex items-center gap-2">
              <Check className="h-5 w-5 text-primary" />
              <span className="font-medium text-primary">
                Recolección completa
              </span>
            </div>
            <Button onClick={onFinishPicking} disabled={loading} className="gap-2">
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
              Continuar a Empaque
            </Button>
          </div>
        )}
      </Card>

      {/* View Mode Toggle */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Vista:</span>
        <div className="flex rounded-lg border p-1">
          <Button
            variant={viewMode === 'by-product' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('by-product')}
            className="h-8"
          >
            Por Producto
          </Button>
          <Button
            variant={viewMode === 'by-order' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('by-order')}
            className="h-8"
          >
            Por Pedido
          </Button>
        </div>
      </div>

      {/* Orders Info (collapsed) */}
      <Card className="p-3 bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
        <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2">
          Pedidos en esta sesión ({orders.length})
        </h4>
        <div className="flex flex-wrap gap-2">
          {orders.map(order => (
            <Badge
              key={order.id}
              variant="outline"
              className="bg-white dark:bg-blue-900/30 border-blue-300 dark:border-blue-700"
            >
              <span className="font-bold">#{order.order_number}</span>
              <span className="mx-1">-</span>
              <span className="text-xs opacity-80">{order.customer_name}</span>
            </Badge>
          ))}
        </div>
      </Card>

      {/* Product List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map(item => {
          const isComplete = item.quantity_picked >= item.total_quantity_needed;
          const isUpdating = updatingProduct === item.product_id;

          return (
            <Card
              key={item.id}
              className={cn(
                'p-4 transition-all',
                isComplete
                  ? 'border-primary bg-primary/5'
                  : 'hover:border-primary/50'
              )}
            >
              {/* Product Header */}
              <div className="flex gap-3 mb-4">
                {item.product_image ? (
                  <img
                    src={item.product_image}
                    alt={item.product_name}
                    className="w-16 h-16 object-cover rounded-lg"
                  />
                ) : (
                  <div className="w-16 h-16 bg-muted rounded-lg flex items-center justify-center">
                    <Package className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-sm line-clamp-2 mb-1">
                    {item.product_name}
                  </h3>
                  {item.product_sku && (
                    <p className="text-xs text-muted-foreground">
                      SKU: {item.product_sku}
                    </p>
                  )}
                  {item.shelf_location && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                      <MapPin className="h-3 w-3" />
                      {item.shelf_location}
                    </div>
                  )}
                </div>

                {/* Complete Badge */}
                {isComplete && (
                  <div className="bg-primary rounded-full p-1 h-fit">
                    <Check className="h-4 w-4 text-primary-foreground" />
                  </div>
                )}
              </div>

              {/* Quantity Display */}
              <div className={cn(
                'text-center py-3 px-4 rounded-lg mb-3',
                isComplete ? 'bg-primary/10' : 'bg-muted'
              )}>
                <div className="text-xs text-muted-foreground mb-1">Recolectado</div>
                <div className={cn(
                  'text-3xl font-bold',
                  isComplete ? 'text-primary' : 'text-foreground'
                )}>
                  {item.quantity_picked}
                  <span className="text-lg text-muted-foreground">
                    {' '}/ {item.total_quantity_needed}
                  </span>
                </div>
              </div>

              {/* Actions */}
              {!isComplete ? (
                <div className="space-y-2">
                  {/* Primary: Complete All */}
                  <Button
                    variant="default"
                    size="lg"
                    className="w-full h-12 text-base font-semibold"
                    onClick={() => handleCompleteProduct(item)}
                    disabled={isUpdating}
                  >
                    {isUpdating ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        <Check className="h-5 w-5 mr-2" />
                        Completar Todo
                      </>
                    )}
                  </Button>

                  {/* Secondary: Fine Control */}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() => handleUpdateQuantity(
                        item.product_id,
                        Math.max(0, item.quantity_picked - 1)
                      )}
                      disabled={item.quantity_picked === 0 || isUpdating}
                      className="flex-1 h-10"
                    >
                      <Minus className="h-4 w-4" />
                    </Button>

                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() => handleUpdateQuantity(
                        item.product_id,
                        Math.min(item.total_quantity_needed, item.quantity_picked + 1)
                      )}
                      disabled={item.quantity_picked >= item.total_quantity_needed || isUpdating}
                      className="flex-1 h-10"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Out of Stock Option */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                    onClick={() => setOutOfStockDialog({
                      productId: item.product_id,
                      productName: item.product_name || 'Producto',
                    })}
                  >
                    <AlertTriangle className="h-4 w-4 mr-2" />
                    Sin Stock
                  </Button>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  size="lg"
                  className="w-full h-12"
                  disabled
                >
                  <Check className="h-5 w-5 mr-2" />
                  Completado
                </Button>
              )}
            </Card>
          );
        })}
      </div>

      {/* Out of Stock Dialog */}
      <Dialog open={!!outOfStockDialog} onOpenChange={() => setOutOfStockDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Marcar Sin Stock
            </DialogTitle>
            <DialogDescription>
              {outOfStockDialog?.productName}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <label className="text-sm font-medium mb-2 block">
              Razón (opcional)
            </label>
            <Textarea
              placeholder="Ej: No encontrado en almacén, Producto dañado..."
              value={outOfStockReason}
              onChange={(e) => setOutOfStockReason(e.target.value)}
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOutOfStockDialog(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                // TODO: Implement out of stock logic
                setOutOfStockDialog(null);
                setOutOfStockReason('');
              }}
            >
              Marcar Sin Stock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
