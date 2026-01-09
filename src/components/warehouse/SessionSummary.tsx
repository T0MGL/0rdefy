/**
 * SessionSummary Component
 * Final verification screen showing what was prepared and inventory changes
 */

import { useMemo } from 'react';
import {
  Check,
  Package,
  Printer,
  Clock,
  AlertTriangle,
  ArrowRight,
  Truck,
  RotateCcw
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { PackingListResponse, PickingSession } from '@/services/warehouse.service';

interface SessionSummaryProps {
  session: PickingSession;
  packingData: PackingListResponse;
  onPrintAllLabels: () => Promise<void>;
  onPrintLabel: (orderId: string) => Promise<void>;
  onClose: () => void;
}

export function SessionSummary({
  session,
  packingData,
  onPrintAllLabels,
  onPrintLabel,
  onClose,
}: SessionSummaryProps) {
  const { orders, availableItems } = packingData;

  // Calculate session stats
  const stats = useMemo(() => {
    const totalOrders = orders.length;
    const completedOrders = orders.filter(o => o.is_complete).length;
    const printedOrders = orders.filter(o => o.printed).length;
    const totalProducts = availableItems.reduce((sum, i) => sum + i.total_picked, 0);

    // Calculate session duration
    let duration = 'N/A';
    if (session.picking_started_at && session.completed_at) {
      const start = new Date(session.picking_started_at);
      const end = new Date(session.completed_at);
      const diffMs = end.getTime() - start.getTime();
      const diffMins = Math.round(diffMs / 60000);

      if (diffMins < 60) {
        duration = `${diffMins} min`;
      } else {
        const hours = Math.floor(diffMins / 60);
        const mins = diffMins % 60;
        duration = `${hours}h ${mins}min`;
      }
    }

    // Orders with issues (missing items, notes, etc.)
    const ordersWithIssues = orders.filter(o => !o.is_complete);

    // Unprinted labels
    const unprintedOrders = orders.filter(o => o.is_complete && !o.printed && o.delivery_link_token);

    return {
      totalOrders,
      completedOrders,
      printedOrders,
      totalProducts,
      duration,
      ordersWithIssues,
      unprintedOrders,
    };
  }, [orders, availableItems, session]);

  // Calculate inventory changes
  const inventoryChanges = useMemo(() => {
    return availableItems.map(item => ({
      productId: item.product_id,
      productName: item.product_name,
      quantityUsed: item.total_packed,
    })).filter(item => item.quantityUsed > 0);
  }, [availableItems]);

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* Success Header */}
      <div className="text-center py-8">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10 mb-4">
          <Check className="h-10 w-10 text-primary" />
        </div>
        <h1 className="text-3xl font-bold mb-2">Preparación Completada</h1>
        <p className="text-muted-foreground">
          Sesión {session.code} finalizada exitosamente
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 text-center">
          <Package className="h-6 w-6 mx-auto mb-2 text-primary" />
          <div className="text-2xl font-bold">{stats.totalOrders}</div>
          <div className="text-sm text-muted-foreground">Pedidos</div>
        </Card>

        <Card className="p-4 text-center">
          <Check className="h-6 w-6 mx-auto mb-2 text-primary" />
          <div className="text-2xl font-bold">{stats.totalProducts}</div>
          <div className="text-sm text-muted-foreground">Productos</div>
        </Card>

        <Card className="p-4 text-center">
          <Printer className="h-6 w-6 mx-auto mb-2 text-primary" />
          <div className="text-2xl font-bold">{stats.printedOrders}</div>
          <div className="text-sm text-muted-foreground">Etiquetas</div>
        </Card>

        <Card className="p-4 text-center">
          <Clock className="h-6 w-6 mx-auto mb-2 text-primary" />
          <div className="text-2xl font-bold">{stats.duration}</div>
          <div className="text-sm text-muted-foreground">Tiempo</div>
        </Card>
      </div>

      {/* Unprinted Labels Warning */}
      {stats.unprintedOrders.length > 0 && (
        <Card className="p-4 bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              <div>
                <h3 className="font-semibold text-amber-900 dark:text-amber-100">
                  {stats.unprintedOrders.length} etiqueta{stats.unprintedOrders.length !== 1 ? 's' : ''} sin imprimir
                </h3>
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  Estos pedidos están listos pero no se han impreso sus etiquetas
                </p>
              </div>
            </div>
            <Button onClick={onPrintAllLabels} className="gap-2">
              <Printer className="h-4 w-4" />
              Imprimir Todas
            </Button>
          </div>
        </Card>
      )}

      {/* Orders List */}
      <Card className="overflow-hidden">
        <div className="p-4 border-b bg-muted/30">
          <h2 className="font-semibold flex items-center gap-2">
            <Truck className="h-5 w-5" />
            Pedidos Preparados
          </h2>
        </div>

        <div className="divide-y">
          {orders.map(order => (
            <div
              key={order.id}
              className={cn(
                'p-4 flex items-center justify-between',
                !order.is_complete && 'bg-amber-50 dark:bg-amber-950/20'
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center',
                  order.is_complete
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-amber-200 dark:bg-amber-800 text-amber-700 dark:text-amber-200'
                )}>
                  {order.is_complete ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <AlertTriangle className="h-4 w-4" />
                  )}
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold">#{order.order_number}</span>
                    <span className="text-muted-foreground">-</span>
                    <span className="text-sm">{order.customer_name}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-xs">
                      {order.items.length} producto{order.items.length !== 1 ? 's' : ''}
                    </Badge>
                    {order.cod_amount && order.cod_amount > 0 && (
                      <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                        COD: {new Intl.NumberFormat('es-PY').format(order.cod_amount)} Gs
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {order.printed ? (
                  <Badge className="bg-primary/10 text-primary border-primary/30">
                    <Printer className="h-3 w-3 mr-1" />
                    Impreso
                  </Badge>
                ) : order.delivery_link_token ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onPrintLabel(order.id)}
                    className="gap-1"
                  >
                    <Printer className="h-3 w-3" />
                    Imprimir
                  </Button>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    Sin token
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Inventory Changes */}
      {inventoryChanges.length > 0 && (
        <Card className="overflow-hidden">
          <div className="p-4 border-b bg-muted/30">
            <h2 className="font-semibold flex items-center gap-2">
              <RotateCcw className="h-5 w-5" />
              Cambios de Inventario
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Stock descontado al completar la sesión
            </p>
          </div>

          <div className="p-4">
            <div className="space-y-2">
              {inventoryChanges.map(change => (
                <div
                  key={change.productId}
                  className="flex items-center justify-between py-2"
                >
                  <span className="text-sm">{change.productName}</span>
                  <Badge variant="outline" className="text-red-600 bg-red-50 border-red-200">
                    -{change.quantityUsed}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Actions */}
      <div className="flex justify-center gap-4 pt-4">
        <Button onClick={onClose} size="lg" className="gap-2">
          <ArrowRight className="h-4 w-4" />
          Volver al Dashboard
        </Button>
      </div>
    </div>
  );
}
