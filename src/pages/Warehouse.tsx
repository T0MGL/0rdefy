/**
 * Warehouse Page
 * Manages picking and packing workflow for confirmed orders
 * Optimized for manual input without barcode scanners
 */

import { useState, useEffect, useCallback } from 'react';
import { Package, PackageCheck, Printer, ArrowLeft, Check, Plus, Minus, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import * as warehouseService from '@/services/warehouse.service';
import { ordersService } from '@/services/orders.service';
import { OrderShippingLabel } from '@/components/OrderShippingLabel';
import { BatchLabelPrinter } from '@/components/BatchLabelPrinter';
import type {
  PickingSession,
  PickingSessionItem,
  ConfirmedOrder,
  OrderForPacking,
  PackingListResponse
} from '@/services/warehouse.service';

type View = 'dashboard' | 'picking' | 'packing';

export default function Warehouse() {
  const { toast } = useToast();
  const [view, setView] = useState<View>('dashboard');
  const [currentSession, setCurrentSession] = useState<PickingSession | null>(null);

  // Dashboard state
  const [confirmedOrders, setConfirmedOrders] = useState<ConfirmedOrder[]>([]);
  const [activeSessions, setActiveSessions] = useState<PickingSession[]>([]);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  // Picking state
  const [pickingList, setPickingList] = useState<PickingSessionItem[]>([]);

  // Packing state
  const [packingData, setPackingData] = useState<PackingListResponse | null>(null);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  // Print state
  const [printLabelDialogOpen, setPrintLabelDialogOpen] = useState(false);
  const [orderToPrint, setOrderToPrint] = useState<OrderForPacking | null>(null);

  // Batch print state
  const [batchPrintDialogOpen, setBatchPrintDialogOpen] = useState(false);
  const [selectedOrdersForPrint, setSelectedOrdersForPrint] = useState<Set<string>>(new Set());

  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      const [orders, sessions] = await Promise.all([
        warehouseService.getConfirmedOrders(),
        warehouseService.getActiveSessions()
      ]);
      setConfirmedOrders(orders);
      setActiveSessions(sessions);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
      toast({
        title: 'Error',
        description: 'No se pudieron cargar los datos del almacén',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadPickingList = useCallback(async () => {
    if (!currentSession) return;
    setLoading(true);
    try {
      const list = await warehouseService.getPickingList(currentSession.id);
      setPickingList(list);
    } catch (error) {
      console.error('Error loading picking list:', error);
      toast({
        title: 'Error',
        description: 'No se pudo cargar la lista de picking',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [currentSession, toast]);

  const loadPackingList = useCallback(async () => {
    if (!currentSession) return;
    setLoading(true);
    try {
      const data = await warehouseService.getPackingList(currentSession.id);
      setPackingData(data);
    } catch (error) {
      console.error('Error loading packing list:', error);
      toast({
        title: 'Error',
        description: 'No se pudo cargar la lista de empaque',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [currentSession, toast]);

  // Load dashboard data
  useEffect(() => {
    if (view === 'dashboard') {
      loadDashboardData();
    }
  }, [view, loadDashboardData]);

  // Load picking list when entering picking mode
  useEffect(() => {
    if (view === 'picking' && currentSession) {
      loadPickingList();
    }
  }, [view, currentSession, loadPickingList]);

  // Load packing list when entering packing mode
  useEffect(() => {
    if (view === 'packing' && currentSession) {
      loadPackingList();
    }
  }, [view, currentSession, loadPackingList]);

  async function handleCreateSession() {
    if (selectedOrders.size === 0) {
      toast({
        title: 'Error',
        description: 'Por favor selecciona al menos un pedido',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const session = await warehouseService.createSession(Array.from(selectedOrders));
      setCurrentSession(session);
      setSelectedOrders(new Set());
      setView('picking');
      toast({
        title: 'Sesión creada',
        description: `Sesión ${session.code} creada exitosamente`,
      });
    } catch (error: any) {
      console.error('Error creating session:', error);
      toast({
        title: 'Error',
        description: error.response?.data?.details || 'No se pudo crear la sesión',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleResumeSession(session: PickingSession) {
    setCurrentSession(session);
    if (session.status === 'picking') {
      setView('picking');
    } else if (session.status === 'packing') {
      setView('packing');
    }
  }

  async function handleUpdatePickingProgress(productId: string, newQuantity: number) {
    if (!currentSession) return;
    try {
      await warehouseService.updatePickingProgress(currentSession.id, productId, newQuantity);
      // Update local state
      setPickingList(prev =>
        prev.map(item =>
          item.product_id === productId
            ? { ...item, quantity_picked: newQuantity }
            : item
        )
      );
    } catch (error: any) {
      console.error('Error updating picking progress:', error);
      toast({
        title: 'Error',
        description: error.response?.data?.details || 'No se pudo actualizar el progreso',
        variant: 'destructive',
      });
    }
  }

  async function handleFinishPicking() {
    if (!currentSession) return;

    // Check if all items are picked
    const allPicked = pickingList.every(
      item => item.quantity_picked >= item.total_quantity_needed
    );

    if (!allPicked) {
      toast({
        title: 'Error',
        description: 'Todos los productos deben estar recolectados antes de continuar',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const updated = await warehouseService.finishPicking(currentSession.id);
      setCurrentSession(updated);
      setView('packing');
      toast({
        title: 'Picking completado',
        description: 'Listo para empacar los pedidos',
      });
    } catch (error: any) {
      console.error('Error finishing picking:', error);
      toast({
        title: 'Error',
        description: error.response?.data?.details || 'No se pudo completar el picking',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  async function handlePackItem(orderId: string, productId: string) {
    if (!currentSession) return;
    try {
      await warehouseService.updatePackingProgress(currentSession.id, orderId, productId);
      toast({
        title: 'Producto empacado',
        description: 'El producto se agregó al pedido correctamente',
      });
      // Reload packing list to update state
      await loadPackingList();
      // Clear selection
      setSelectedItem(null);
    } catch (error: any) {
      console.error('Error packing item:', error);
      toast({
        title: 'Error',
        description: error.response?.data?.details || 'No se pudo empacar el producto',
        variant: 'destructive',
      });
    }
  }

  function handleBackToDashboard() {
    setView('dashboard');
    setCurrentSession(null);
    setPickingList([]);
    setPackingData(null);
    setSelectedItem(null);
  }

  const handlePrintLabel = useCallback((order: OrderForPacking) => {
    setOrderToPrint(order);
    setPrintLabelDialogOpen(true);
  }, []);

  const handleOrderPrinted = useCallback(async (orderId: string) => {
    try {
      // Mark order as printed
      const updatedOrder = await ordersService.markAsPrinted(orderId);

      // Reload packing list to update UI with printed status
      await loadPackingList();

      toast({
        title: 'Etiqueta impresa',
        description: 'La etiqueta ha sido impresa correctamente',
      });
    } catch (error) {
      console.error('Error updating order after print:', error);
      toast({
        title: 'Error',
        description: 'No se pudo actualizar el estado del pedido',
        variant: 'destructive',
      });
    }
  }, [toast, loadPackingList]);

  const handleBatchPrint = useCallback(() => {
    if (selectedOrdersForPrint.size === 0) {
      toast({
        title: 'Error',
        description: 'Por favor selecciona al menos un pedido para imprimir',
        variant: 'destructive',
      });
      return;
    }
    setBatchPrintDialogOpen(true);
  }, [selectedOrdersForPrint, toast]);

  const handleBatchPrinted = useCallback(async () => {
    try {
      // Mark all selected orders as printed
      for (const orderId of selectedOrdersForPrint) {
        await ordersService.markAsPrinted(orderId);
      }

      // Clear selection
      setSelectedOrdersForPrint(new Set());

      // Reload packing list
      await loadPackingList();

      toast({
        title: 'Etiquetas impresas',
        description: `${selectedOrdersForPrint.size} etiquetas han sido impresas correctamente`,
      });

      setBatchPrintDialogOpen(false);
    } catch (error) {
      console.error('Error updating orders after batch print:', error);
      toast({
        title: 'Error',
        description: 'No se pudo actualizar el estado de los pedidos',
        variant: 'destructive',
      });
    }
  }, [selectedOrdersForPrint, toast, loadPackingList]);

  function toggleOrderForPrint(orderId: string) {
    const newSelected = new Set(selectedOrdersForPrint);
    if (newSelected.has(orderId)) {
      newSelected.delete(orderId);
    } else {
      newSelected.add(orderId);
    }
    setSelectedOrdersForPrint(newSelected);
  }

  async function handleCompleteSession() {
    if (!currentSession) return;

    setLoading(true);
    try {
      const updated = await warehouseService.completeSession(currentSession.id);
      toast({
        title: 'Sesión completada',
        description: 'Todos los pedidos han sido preparados y están listos para enviar',
      });
      handleBackToDashboard();
    } catch (error: any) {
      console.error('Error completing session:', error);
      toast({
        title: 'Error',
        description: error.response?.data?.details || 'No se pudo completar la sesión',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
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

  // Calculate progress for picking
  const pickingProgress = pickingList.length > 0
    ? (pickingList.filter(item => item.quantity_picked >= item.total_quantity_needed).length / pickingList.length) * 100
    : 0;

  return (
    <>
      {view === 'dashboard' && (
        <DashboardView
          confirmedOrders={confirmedOrders}
          activeSessions={activeSessions}
          selectedOrders={selectedOrders}
          loading={loading}
          onToggleOrder={toggleOrderSelection}
          onCreateSession={handleCreateSession}
          onResumeSession={handleResumeSession}
        />
      )}

      {view === 'picking' && currentSession && (
        <PickingView
          session={currentSession}
          pickingList={pickingList}
          progress={pickingProgress}
          onBack={handleBackToDashboard}
          onUpdateProgress={handleUpdatePickingProgress}
          onFinish={handleFinishPicking}
          loading={loading}
        />
      )}

      {view === 'packing' && currentSession && packingData && (
        <PackingView
          session={currentSession}
          packingData={packingData}
          selectedItem={selectedItem}
          loading={loading}
          onBack={handleBackToDashboard}
          onSelectItem={setSelectedItem}
          onPackItem={handlePackItem}
          onPrintLabel={handlePrintLabel}
          onCompleteSession={handleCompleteSession}
          selectedOrdersForPrint={selectedOrdersForPrint}
          onToggleOrderForPrint={toggleOrderForPrint}
          onBatchPrint={handleBatchPrint}
        />
      )}

      {/* Print Label Dialog */}
      <Dialog open={printLabelDialogOpen} onOpenChange={setPrintLabelDialogOpen}>
        <DialogContent className="max-w-[950px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Etiqueta de Entrega</DialogTitle>
            <DialogDescription>
              Vista previa de la etiqueta de entrega para impresión
            </DialogDescription>
          </DialogHeader>
          {orderToPrint && orderToPrint.delivery_link_token && (
            <OrderShippingLabel
              orderId={orderToPrint.id}
              deliveryToken={orderToPrint.delivery_link_token}
              customerName={orderToPrint.customer_name}
              customerPhone={orderToPrint.customer_phone}
              customerAddress={orderToPrint.customer_address}
              addressReference={orderToPrint.address_reference}
              neighborhood={orderToPrint.neighborhood}
              deliveryNotes={orderToPrint.delivery_notes}
              courierName={orderToPrint.carrier_name}
              codAmount={orderToPrint.cod_amount}
              products={orderToPrint.items.map(item => ({
                name: item.product_name,
                quantity: item.quantity_needed,
              }))}
              onPrinted={() => handleOrderPrinted(orderToPrint.id)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Batch Print Dialog */}
      <Dialog open={batchPrintDialogOpen} onOpenChange={setBatchPrintDialogOpen}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Impresión en Lote</DialogTitle>
            <DialogDescription>
              Vista previa de todas las etiquetas seleccionadas
            </DialogDescription>
          </DialogHeader>
          {packingData && (
            <BatchLabelPrinter
              orders={packingData.orders
                .filter(order => selectedOrdersForPrint.has(order.id) && order.delivery_link_token)
                .map(order => ({
                  id: order.id,
                  order_number: order.order_number,
                  customer_name: order.customer_name,
                  customer_phone: order.customer_phone,
                  customer_address: order.customer_address,
                  address_reference: order.address_reference,
                  neighborhood: order.neighborhood,
                  delivery_notes: order.delivery_notes,
                  carrier_name: order.carrier_name,
                  cod_amount: order.cod_amount,
                  delivery_link_token: order.delivery_link_token,
                  items: order.items.map(item => ({
                    product_name: item.product_name,
                    quantity_needed: item.quantity_needed,
                  })),
                }))}
              onClose={() => setBatchPrintDialogOpen(false)}
              onPrinted={handleBatchPrinted}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ================================================================
// DASHBOARD VIEW COMPONENT
// ================================================================

interface DashboardViewProps {
  confirmedOrders: ConfirmedOrder[];
  activeSessions: PickingSession[];
  selectedOrders: Set<string>;
  loading: boolean;
  onToggleOrder: (orderId: string) => void;
  onCreateSession: () => void;
  onResumeSession: (session: PickingSession) => void;
}

function DashboardView({
  confirmedOrders,
  activeSessions,
  selectedOrders,
  loading,
  onToggleOrder,
  onCreateSession,
  onResumeSession
}: DashboardViewProps) {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Almacén</h1>
          <p className="text-muted-foreground mt-1">
            Gestiona la preparación y empaquetado de pedidos
          </p>
        </div>
        <Package className="h-10 w-10 text-primary" />
      </div>

      {/* Active Sessions */}
      {activeSessions.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xl font-semibold">
            Sesiones Activas
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeSessions.map(session => (
              <Card
                key={session.id}
                className="p-4 cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => onResumeSession(session)}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono font-bold text-lg">
                    {session.code}
                  </span>
                  <Badge
                    variant={session.status === 'picking' ? 'default' : 'secondary'}
                  >
                    {session.status === 'picking' ? 'Recolección' : 'Empaque'}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Creado {new Date(session.created_at).toLocaleString('es-ES')}
                </p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Orders Ready for Preparation */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">
            Pedidos Listos ({confirmedOrders.length})
          </h2>
          <Button
            onClick={onCreateSession}
            disabled={selectedOrders.size === 0 || loading}
          >
            <PackageCheck className="h-4 w-4 mr-2" />
            Iniciar Preparación ({selectedOrders.size})
          </Button>
        </div>

        {confirmedOrders.length === 0 ? (
          <Card className="p-8 text-center">
            <PackageCheck className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">
              No hay pedidos confirmados listos para preparación
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {confirmedOrders.map(order => (
              <Card
                key={order.id}
                className="p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-4">
                  <Checkbox
                    checked={selectedOrders.has(order.id)}
                    onCheckedChange={() => onToggleOrder(order.id)}
                    className="h-5 w-5"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold">
                        #{order.order_number}
                      </span>
                      <Badge variant="outline">
                        {order.total_items} artículos
                      </Badge>
                      {order.carrier && (
                        <Badge variant="secondary">
                          {order.carrier.name}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {order.customer_name} • {order.customer_phone}
                    </p>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {new Date(order.created_at).toLocaleDateString('es-ES')}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ================================================================
// PICKING VIEW COMPONENT
// ================================================================

interface PickingViewProps {
  session: PickingSession;
  pickingList: PickingSessionItem[];
  progress: number;
  onBack: () => void;
  onUpdateProgress: (productId: string, newQuantity: number) => void;
  onFinish: () => void;
  loading: boolean;
}

function PickingView({
  session,
  pickingList,
  progress,
  onBack,
  onUpdateProgress,
  onFinish,
  loading
}: PickingViewProps) {
  const allPicked = pickingList.every(
    item => item.quantity_picked >= item.total_quantity_needed
  );

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Volver
          </Button>
          <div>
            <h1 className="text-3xl font-bold">
              Recolección: {session.code}
            </h1>
            <p className="text-muted-foreground mt-1">
              Recolecta todos los artículos de este lote
            </p>
          </div>
        </div>
        <Button
          onClick={onFinish}
          disabled={!allPicked || loading}
        >
          <Check className="h-4 w-4 mr-2" />
          Finalizar Recolección
        </Button>
      </div>

      {/* Progress Bar */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">
            Progreso General
          </span>
          <span className="text-sm font-bold">
            {Math.round(progress)}%
          </span>
        </div>
        <Progress value={progress} className="h-3" />
      </Card>

      {/* Picking List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {pickingList.map(item => {
          const isComplete = item.quantity_picked >= item.total_quantity_needed;
          return (
            <Card
              key={item.id}
              className={`p-4 transition-all ${isComplete
                ? 'border-primary bg-primary/10'
                : ''
                }`}
            >
              {/* Product Info */}
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
                <div className="flex-1">
                  <h3 className="font-semibold line-clamp-2">
                    {item.product_name}
                  </h3>
                  {item.product_sku && (
                    <p className="text-xs text-muted-foreground mt-1">
                      SKU: {item.product_sku}
                    </p>
                  )}
                  {item.shelf_location && (
                    <p className="text-xs text-muted-foreground mt-1">
                      📍 {item.shelf_location}
                    </p>
                  )}
                </div>
              </div>

              {/* Counter Controls */}
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => onUpdateProgress(item.product_id, Math.max(0, item.quantity_picked - 1))}
                  disabled={item.quantity_picked === 0}
                  className="h-12 w-12 p-0"
                >
                  <Minus className="h-5 w-5" />
                </Button>

                <div className="flex-1 text-center">
                  <div className="text-2xl font-bold">
                    {item.quantity_picked} / {item.total_quantity_needed}
                  </div>
                  {isComplete && (
                    <Check className="h-5 w-5 text-primary mx-auto mt-1" />
                  )}
                </div>

                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => onUpdateProgress(item.product_id, Math.min(item.total_quantity_needed, item.quantity_picked + 1))}
                  disabled={item.quantity_picked >= item.total_quantity_needed}
                  className="h-12 w-12 p-0"
                >
                  <Plus className="h-5 w-5" />
                </Button>
              </div>

              {/* MAX Button */}
              <Button
                variant="secondary"
                className="w-full mt-2"
                onClick={() => onUpdateProgress(item.product_id, item.total_quantity_needed)}
                disabled={isComplete}
              >
                MÁX
              </Button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ================================================================
// PACKING VIEW COMPONENT
// ================================================================

interface PackingViewProps {
  session: PickingSession;
  packingData: PackingListResponse;
  selectedItem: string | null;
  loading: boolean;
  onBack: () => void;
  onSelectItem: (productId: string | null) => void;
  onPackItem: (orderId: string, productId: string) => void;
  onPrintLabel: (order: OrderForPacking) => void;
  onCompleteSession: () => void;
  selectedOrdersForPrint: Set<string>;
  onToggleOrderForPrint: (orderId: string) => void;
  onBatchPrint: () => void;
}

function PackingView({
  session,
  packingData,
  selectedItem,
  loading,
  onBack,
  onSelectItem,
  onPackItem,
  onPrintLabel,
  onCompleteSession,
  selectedOrdersForPrint,
  onToggleOrderForPrint,
  onBatchPrint
}: PackingViewProps) {
  const { orders, availableItems } = packingData;

  // Calculate if all orders are complete
  const allOrdersComplete = orders.every(order => order.is_complete);
  const allItemsRemaining = availableItems.every(item => item.remaining === 0);

  // Calculate ready to print orders (complete and have token)
  const readyToPrintOrders = orders.filter(
    order => order.is_complete && order.delivery_link_token && !order.printed
  );

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="bg-card border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              onClick={onBack}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Volver
            </Button>
            <div>
              <h1 className="text-2xl font-bold">
                Empaque: {session.code}
              </h1>
              <p className="text-sm text-muted-foreground">
                Distribuye los artículos en las cajas de pedidos
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {readyToPrintOrders.length > 0 && (
              <Button
                variant="outline"
                onClick={onBatchPrint}
                disabled={selectedOrdersForPrint.size === 0}
                className="gap-2"
              >
                <Layers className="h-4 w-4" />
                Imprimir en Lote ({selectedOrdersForPrint.size})
              </Button>
            )}
            {allOrdersComplete && allItemsRemaining && (
              <Button
                onClick={onCompleteSession}
                disabled={loading}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                <Check className="h-4 w-4 mr-2" />
                Finalizar Sesión
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Split View */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Available Items (Basket) */}
        <div className="w-1/3 border-r p-4 overflow-y-auto bg-card">
          <h2 className="text-lg font-semibold mb-4 sticky top-0 bg-card pb-2">
            Artículos para Empaquetar
          </h2>
          <div className="space-y-3">
            {availableItems.map(item => {
              const isSelected = selectedItem === item.product_id;
              const hasRemaining = item.remaining > 0;

              return (
                <Card
                  key={item.product_id}
                  className={`p-3 cursor-pointer transition-all ${!hasRemaining
                    ? 'opacity-50 cursor-not-allowed bg-muted'
                    : isSelected
                      ? 'border-primary ring-2 ring-primary/20 bg-primary/10'
                      : 'hover:shadow-md'
                    }`}
                  onClick={() => hasRemaining && onSelectItem(isSelected ? null : item.product_id)}
                >
                  <div className="flex gap-3">
                    {item.product_image ? (
                      <img
                        src={item.product_image}
                        alt={item.product_name}
                        className="w-12 h-12 object-cover rounded"
                      />
                    ) : (
                      <div className="w-12 h-12 bg-muted rounded flex items-center justify-center">
                        <Package className="h-6 w-6 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1">
                      <h3 className="font-medium text-sm line-clamp-1">
                        {item.product_name}
                      </h3>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge
                          variant={hasRemaining ? 'default' : 'secondary'}
                          className="text-xs"
                        >
                          {item.remaining} restantes
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Recolectado: {item.total_picked} • Empacado: {item.total_packed}
                      </p>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Right Column: Orders (Boxes) */}
        <div className="flex-1 p-4 overflow-y-auto">
          <h2 className="text-lg font-semibold mb-4 sticky top-0 bg-background pb-2">
            Pedidos ({orders.length})
          </h2>
          <div className="space-y-4">
            {orders.map(order => {
              const needsSelectedItem = selectedItem
                ? order.items.some(
                  item =>
                    item.product_id === selectedItem &&
                    item.quantity_packed < item.quantity_needed
                )
                : false;

              const selectedItemInOrder = selectedItem
                ? order.items.find(item => item.product_id === selectedItem)
                : null;

              const canSelectForPrint = order.is_complete && order.delivery_link_token && !order.printed;
              const isSelectedForPrint = selectedOrdersForPrint.has(order.id);

              return (
                <Card
                  key={order.id}
                  className={`p-4 transition-all ${order.is_complete
                    ? 'border-green-500 dark:border-green-600 bg-green-50 dark:bg-green-950/20'
                    : needsSelectedItem
                      ? 'border-green-500 dark:border-green-600 ring-2 ring-green-500/20 shadow-lg cursor-pointer bg-green-50/50 dark:bg-green-950/10'
                      : ''
                    }`}
                  onClick={() => {
                    if (needsSelectedItem && selectedItemInOrder) {
                      onPackItem(order.id, selectedItem);
                    }
                  }}
                >
                  {/* Order Header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      {canSelectForPrint && (
                        <Checkbox
                          checked={isSelectedForPrint}
                          onCheckedChange={() => onToggleOrderForPrint(order.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-5 w-5"
                        />
                      )}
                      <div>
                        <h3 className="font-bold">
                          Pedido #{order.order_number}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {order.customer_name}
                        </p>
                      </div>
                    </div>
                    {order.is_complete ? (
                      <div className="flex items-center gap-2">
                        <Badge className="bg-green-600 dark:bg-green-500">
                          <Check className="h-3 w-3 mr-1" />
                          Listo
                        </Badge>
                        {order.printed && order.printed_at ? (
                          <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400">
                            <Check className="h-3 w-3 mr-1" />
                            Impreso
                          </Badge>
                        ) : order.delivery_link_token ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              onPrintLabel(order);
                            }}
                            className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/20"
                          >
                            <Printer className="h-4 w-4 mr-1" />
                            Imprimir Etiqueta
                          </Button>
                        ) : (
                          <Badge variant="outline" className="text-yellow-600">
                            Sin token de entrega
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <Badge variant="secondary">
                        En Proceso
                      </Badge>
                    )}
                  </div>

                  {/* Order Items */}
                  <div className="space-y-2">
                    {order.items.map(item => {
                      const itemComplete = item.quantity_packed >= item.quantity_needed;
                      const isHighlighted =
                        selectedItem === item.product_id && !itemComplete;

                      return (
                        <div
                          key={item.product_id}
                          className={`flex items-center gap-2 p-2 rounded ${isHighlighted
                            ? 'bg-green-100 dark:bg-green-950/30 border border-green-500/30 dark:border-green-600/30'
                            : itemComplete
                              ? 'bg-muted'
                              : ''
                            }`}
                        >
                          {item.product_image ? (
                            <img
                              src={item.product_image}
                              alt={item.product_name}
                              className="w-10 h-10 object-cover rounded"
                            />
                          ) : (
                            <div className="w-10 h-10 bg-muted rounded flex items-center justify-center">
                              <Package className="h-5 w-5 text-muted-foreground" />
                            </div>
                          )}
                          <div className="flex-1">
                            <p className="text-sm font-medium line-clamp-1">
                              {item.product_name}
                            </p>
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-xs font-semibold ${itemComplete
                                  ? 'text-green-600 dark:text-green-400'
                                  : 'text-muted-foreground'
                                  }`}
                              >
                                {item.quantity_packed} / {item.quantity_needed}
                              </span>
                              {itemComplete && (
                                <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
