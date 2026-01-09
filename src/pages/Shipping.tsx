/**
 * Shipping Page
 * Manages dispatch of prepared orders to couriers
 * Shows orders in 'ready_to_ship' status and allows marking them as 'shipped'
 */

import { useState, useEffect } from 'react';
import { Truck, Send, CheckCircle, Package, MapPin, Phone, DollarSign, FileText, Download, FileSpreadsheet } from 'lucide-react';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { FeatureBlockedPage } from '@/components/FeatureGate';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import * as shippingService from '@/services/shipping.service';
import { generateDispatchCSV } from '@/services/shipping.service';
import { unifiedService } from '@/services/unified.service';
import { GlobalViewToggle } from '@/components/GlobalViewToggle';
import { DeliveryManifestGenerator } from '@/components/DeliveryManifest';
import type { ReadyToShipOrder, BatchDispatchResponse } from '@/services/shipping.service';

export default function Shipping() {
  const { hasFeature } = useSubscription();
  const { toast } = useToast();
  const [orders, setOrders] = useState<ReadyToShipOrder[]>([]);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [dispatchDialogOpen, setDispatchDialogOpen] = useState(false);
  const [singleDispatchOrder, setSingleDispatchOrder] = useState<ReadyToShipOrder | null>(null);
  const [dispatchNotes, setDispatchNotes] = useState('');
  const [dispatching, setDispatching] = useState(false);

  // Global View
  const [isGlobalView, setIsGlobalView] = useState(false);

  const hasWarehouseFeature = hasFeature('warehouse');

  useEffect(() => {
    if (!hasWarehouseFeature) return;
    loadOrders();
  }, [isGlobalView, hasWarehouseFeature]);

  async function loadOrders() {
    setLoading(true);
    try {
      if (isGlobalView) {
        const data = await unifiedService.getDispatchReady();
        // Convert to ReadyToShipOrder (compatible)
        const adaptedData = data.map((d: any) => ({
          ...d,
          total_items: 1, // Defaulting as unified might not return count yet (TODO: improve unified API)
          customer_phone: d.customer_phone || '',
          customer_address: d.address || '',
          address_reference: '',
        }));
        setOrders(adaptedData as unknown as ReadyToShipOrder[]);
      } else {
        const data = await shippingService.getReadyToShipOrders();
        setOrders(data);
      }
    } catch (error) {
      console.error('Error loading ready to ship orders:', error);
      toast({
        title: 'Error',
        description: 'No se pudieron cargar los pedidos preparados',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  // Check warehouse feature access - AFTER all hooks
  if (!hasWarehouseFeature) {
    return <FeatureBlockedPage feature="warehouse" />;
  }

  function toggleOrderSelection(orderId: string) {
    const newSelected = new Set(selectedOrders);
    if (newSelected.has(orderId)) {
      newSelected.delete(orderId);
    } else {
      newSelected.add(orderId);
    }
    setSelectedOrders(newSelected);
  }

  function selectAll() {
    if (selectedOrders.size === orders.length) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(orders.map(o => o.id)));
    }
  }

  function handleOpenDispatchDialog() {
    if (selectedOrders.size === 0) {
      toast({
        title: 'Error',
        description: 'Por favor selecciona al menos un pedido para despachar',
        variant: 'destructive',
      });
      return;
    }
    setSingleDispatchOrder(null);
    setDispatchDialogOpen(true);
  }

  function handleOpenSingleDispatch(order: ReadyToShipOrder) {
    setSingleDispatchOrder(order);
    setSelectedOrders(new Set([order.id]));
    setDispatchDialogOpen(true);
  }

  function handleGenerateManifest() {
    if (selectedOrders.size === 0) {
      toast({
        title: 'Error',
        description: 'Por favor selecciona al menos un pedido',
        variant: 'destructive',
      });
      return;
    }

    const selectedOrdersList = orders.filter(o => selectedOrders.has(o.id));

    // Get carrier name from first order (all should have same carrier in batch)
    const carrierName = selectedOrdersList[0]?.carrier_name || 'Transportadora';

    // Get store info from localStorage
    const storeName = localStorage.getItem('store_name') || 'Mi Tienda';

    DeliveryManifestGenerator.generate({
      orders: selectedOrdersList,
      carrierName,
      dispatchDate: new Date(),
      storeName,
      notes: dispatchNotes || undefined,
    });

    toast({
      title: 'Orden de entrega generada',
      description: `PDF descargado con ${selectedOrdersList.length} pedido(s)`,
    });
  }

  function handleExportCSV() {
    if (selectedOrders.size === 0) {
      toast({
        title: 'Error',
        description: 'Por favor selecciona al menos un pedido',
        variant: 'destructive',
      });
      return;
    }

    const selectedOrdersList = orders.filter(o => selectedOrders.has(o.id));
    const carrierName = selectedOrdersList[0]?.carrier_name || 'Transportadora';

    generateDispatchCSV(selectedOrdersList, carrierName);

    toast({
      title: 'CSV exportado',
      description: `Planilla descargada con ${selectedOrdersList.length} pedido(s) para el courier`,
    });
  }

  async function handleDispatch() {
    if (selectedOrders.size === 0) return;

    setDispatching(true);
    try {
      const result: BatchDispatchResponse = await shippingService.dispatchBatch(
        Array.from(selectedOrders),
        dispatchNotes || undefined
      );

      // Show results
      if (result.failed > 0) {
        toast({
          title: 'Despacho parcial',
          description: `${result.succeeded} pedidos despachados, ${result.failed} fallaron`,
          variant: 'default',
        });
      } else {
        toast({
          title: 'Despacho exitoso',
          description: `${result.succeeded} pedidos marcados como "En Tránsito"`,
        });
      }

      // Reset and reload
      setDispatchDialogOpen(false);
      setDispatchNotes('');
      setSelectedOrders(new Set());
      setSingleDispatchOrder(null);
      await loadOrders();
    } catch (error: any) {
      console.error('Error dispatching orders:', error);
      toast({
        title: 'Error',
        description: error.response?.data?.details || 'No se pudieron despachar los pedidos',
        variant: 'destructive',
      });
    } finally {
      setDispatching(false);
    }
  }

  const allSelected = orders.length > 0 && selectedOrders.size === orders.length;
  const someSelected = selectedOrders.size > 0 && selectedOrders.size < orders.length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Despacho</h1>
          <p className="text-muted-foreground mt-1">
            Entrega de pedidos preparados a los couriers
          </p>
        </div>
        <div className="flex items-center gap-4">
          <GlobalViewToggle enabled={isGlobalView} onToggle={setIsGlobalView} />
          <Truck className="h-10 w-10 text-primary" />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-950/30 rounded-lg">
              <Package className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Pedidos Preparados</p>
              <p className="text-2xl font-bold">{orders.length}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 dark:bg-green-950/30 rounded-lg">
              <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Seleccionados</p>
              <p className="text-2xl font-bold">{selectedOrders.size}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-950/30 rounded-lg">
              <Truck className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Items</p>
              <p className="text-2xl font-bold">
                {orders.reduce((sum, o) => sum + o.total_items, 0)}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Actions */}
      {
        orders.length > 0 && (
          <div className="flex items-center gap-4">
            <Checkbox
              checked={allSelected}
              onCheckedChange={selectAll}
              className="h-5 w-5"
            />
            <span className="text-sm text-muted-foreground">
              {allSelected ? 'Deseleccionar todos' : 'Seleccionar todos'}
            </span>
            <div className="flex-1" />
            <Button
              onClick={handleExportCSV}
              disabled={selectedOrders.size === 0 || loading}
              variant="outline"
              size="lg"
              className="gap-2"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Exportar CSV
            </Button>
            <Button
              onClick={handleGenerateManifest}
              disabled={selectedOrders.size === 0 || loading}
              variant="outline"
              size="lg"
              className="gap-2"
            >
              <FileText className="h-4 w-4" />
              Orden de Entrega
            </Button>
            <Button
              onClick={handleOpenDispatchDialog}
              disabled={selectedOrders.size === 0 || loading}
              size="lg"
              className="gap-2"
            >
              <Send className="h-4 w-4" />
              Despachar ({selectedOrders.size})
            </Button>
          </div>
        )
      }

      {/* Orders List */}
      {
        loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : orders.length === 0 ? (
          <Card className="p-12">
            <div className="text-center">
              <Package className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-semibold mb-2">No hay pedidos preparados</h3>
              <p className="text-sm text-muted-foreground">
                Los pedidos que completen el proceso de warehouse aparecerán aquí
              </p>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {orders.map(order => {
              const isSelected = selectedOrders.has(order.id);

              return (
                <Card
                  key={order.id}
                  className={`p-4 transition-all cursor-pointer ${isSelected
                    ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                    : 'hover:border-primary/50'
                    }`}
                  onClick={() => toggleOrderSelection(order.id)}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleOrderSelection(order.id)}
                      className="mt-1"
                      onClick={(e) => e.stopPropagation()}
                    />

                    <div className="flex-1 min-w-0">
                      {/* Header */}
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h3 className="font-bold text-lg">#{order.order_number}</h3>
                          <p className="text-sm text-muted-foreground">
                            {order.customer_name}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950/20">
                            {order.total_items} items
                          </Badge>
                          {/* Show Store Name in Global View */}
                          {(order as any).store_name && (
                            <Badge variant="secondary" className="font-medium text-[11px] h-6 px-3 bg-secondary/50 text-secondary-foreground border border-border shadow-sm">
                              {(order as any).store_name}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Details */}
                      <div className="space-y-2 text-sm">
                        <div className="flex items-start gap-2">
                          <Phone className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                          <span className="text-muted-foreground">{order.customer_phone}</span>
                        </div>

                        <div className="flex items-start gap-2">
                          <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                          <span className="text-muted-foreground line-clamp-2">
                            {order.customer_address}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <Truck className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <span className="font-medium">{order.carrier_name}</span>
                        </div>

                        {order.cod_amount > 0 && (
                          <div className="flex items-center gap-2">
                            <DollarSign className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                            <span className="font-semibold text-green-600 dark:text-green-400">
                              ${order.cod_amount.toLocaleString()} COD
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Footer */}
                      <div className="mt-3 pt-3 border-t flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">
                          Creado: {new Date(order.created_at).toLocaleDateString('es-ES', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-2 h-7 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenSingleDispatch(order);
                          }}
                        >
                          <Send className="h-3 w-3" />
                          Despachar
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )
      }

      {/* Dispatch Dialog */}
      <Dialog open={dispatchDialogOpen} onOpenChange={setDispatchDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {singleDispatchOrder ? 'Despachar Pedido' : 'Confirmar Despacho'}
            </DialogTitle>
            <DialogDescription>
              {singleDispatchOrder
                ? `Despachar pedido #${singleDispatchOrder.order_number} a ${singleDispatchOrder.carrier_name}`
                : `Se marcarán ${selectedOrders.size} pedido(s) como "En Tránsito"`
              }
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {!singleDispatchOrder && (
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                <div className="flex gap-3">
                  <FileText className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-amber-900 dark:text-amber-100 mb-2">
                      Orden de Entrega
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-300 mb-3">
                      Genera una orden de entrega legal antes de despachar. Este documento debe ser firmado por el encargado y el repartidor.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30"
                      onClick={handleGenerateManifest}
                    >
                      <Download className="h-4 w-4" />
                      Descargar Orden de Entrega
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div>
              <p className="text-sm font-medium mb-2">Pedidos seleccionados:</p>
              <div className="flex flex-wrap gap-2">
                {Array.from(selectedOrders).map(orderId => {
                  const order = orders.find(o => o.id === orderId);
                  return order ? (
                    <Badge key={orderId} variant="secondary">
                      #{order.order_number}
                    </Badge>
                  ) : null;
                })}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">
                Notas (opcional)
              </label>
              <Textarea
                placeholder="Ej: Entregado a Juan, conductor placa ABC-123"
                value={dispatchNotes}
                onChange={(e) => setDispatchNotes(e.target.value)}
                rows={3}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Información sobre quién recibió los pedidos, vehículo, etc.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDispatchDialogOpen(false)}
              disabled={dispatching}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleDispatch}
              disabled={dispatching}
              className="gap-2"
            >
              {dispatching ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Despachando...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Confirmar Despacho
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div >
  );
}
