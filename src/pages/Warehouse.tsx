/**
 * Warehouse Page
 * Manages picking and packing workflow for confirmed orders
 * Optimized for manual input without barcode scanners
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Package, PackageCheck, Printer, ArrowLeft, Check, Plus, Minus, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useDateRange } from '@/contexts/DateRangeContext';
import { useAuth } from '@/contexts/AuthContext';
import * as warehouseService from '@/services/warehouse.service';
import { ordersService } from '@/services/orders.service';
import { BatchLabelPrinter } from '@/components/BatchLabelPrinter';
import { printLabelPDF, printBatchLabelsPDF } from '@/components/printing/printLabelPDF';
import type {
  PickingSession,
  PickingSessionItem,
  ConfirmedOrder,
  OrderForPacking,
  PackingListResponse
} from '@/services/warehouse.service';
import { unifiedService } from '@/services/unified.service';
import { GlobalViewToggle } from '@/components/GlobalViewToggle';

type View = 'dashboard' | 'picking' | 'packing';

export default function Warehouse() {
  const { toast } = useToast();
  const { currentStore } = useAuth();
  const { getDateRange } = useDateRange();
  const [view, setView] = useState<View>('dashboard');
  const [currentSession, setCurrentSession] = useState<PickingSession | null>(null);

  // Global View State (Multi-store)
  const [isGlobalView, setIsGlobalView] = useState(false);

  // Dashboard state
  const [confirmedOrders, setConfirmedOrders] = useState<ConfirmedOrder[]>([]);
  const [activeSessions, setActiveSessions] = useState<PickingSession[]>([]);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  // Picking state
  const [pickingList, setPickingList] = useState<PickingSessionItem[]>([]);
  const [sessionOrders, setSessionOrders] = useState<Array<{
    id: string;
    order_number: string;
    customer_name: string;
  }>>([]);

  // Packing state
  const [packingData, setPackingData] = useState<PackingListResponse | null>(null);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [packingInProgress, setPackingInProgress] = useState(false);

  // Print/Batch state
  const [selectedOrdersForPrint, setSelectedOrdersForPrint] = useState<Set<string>>(new Set());

  // Calculate date ranges from global context
  const dateRange = useMemo(() => {
    const range = getDateRange();
    const result = {
      startDate: range.from.toISOString().split('T')[0],
      endDate: range.to.toISOString().split('T')[0],
    };
    return result;
  }, [getDateRange]);

  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      if (isGlobalView) {
        // Unified Data Load
        const [orders, sessions] = await Promise.all([
          unifiedService.getWarehouseReady(),
          unifiedService.getWarehouseSessions(),
        ]);
        // Adapt unified types to local types (they are compatible enough for display)
        setConfirmedOrders(orders as unknown as ConfirmedOrder[]);
        setActiveSessions(sessions as unknown as PickingSession[]);
      } else {
        // Single Store Data Load
        const [orders, sessions] = await Promise.all([
          warehouseService.getConfirmedOrders(),
          warehouseService.getActiveSessions(),
        ]);
        setConfirmedOrders(orders);
        setActiveSessions(sessions);
      }
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
  }, [toast, dateRange, isGlobalView]);

  const loadPickingList = useCallback(async () => {
    if (!currentSession) return;
    setLoading(true);
    try {
      const data = await warehouseService.getPickingList(currentSession.id);
      setPickingList(data.items);
      setSessionOrders(data.orders);
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
    if (!currentSession || packingInProgress) return;

    setPackingInProgress(true);
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
    } finally {
      setPackingInProgress(false);
    }
  }

  function handleBackToDashboard() {
    setView('dashboard');
    setCurrentSession(null);
    setPickingList([]);
    setPackingData(null);
    setSelectedItem(null);
  }

  const handleOrderPrinted = useCallback(async (orderId: string) => {
    try {
      // Mark order as printed
      await ordersService.markAsPrinted(orderId);

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

  const handlePrintLabel = useCallback(async (order: OrderForPacking) => {
    try {
      const success = await printLabelPDF({
        storeName: currentStore?.name || 'ORDEFY',
        orderNumber: order.order_number,
        customerName: order.customer_name,
        customerPhone: order.customer_phone,
        customerAddress: order.customer_address,
        neighborhood: order.neighborhood,
        addressReference: order.address_reference,
        carrierName: order.carrier_name,
        codAmount: order.cod_amount,
        paymentMethod: order.payment_method,
        deliveryToken: order.delivery_link_token || '',
        items: order.items.map(item => ({
          name: item.product_name,
          quantity: item.quantity_needed
        }))
      });

      if (success) {
        handleOrderPrinted(order.id);
      }
    } catch (error) {
      console.error('Print error:', error);
      toast({
        title: 'Error de impresión',
        description: 'No se pudo generar el PDF para imprimir.',
        variant: 'destructive',
      });
    }
  }, [currentStore, handleOrderPrinted, toast]);

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
    } catch (error) {
      console.error('Error updating orders after batch print:', error);
      toast({
        title: 'Error',
        description: 'No se pudo actualizar el estado de los pedidos',
        variant: 'destructive',
      });
    }
  }, [selectedOrdersForPrint, toast, loadPackingList]);

  const handleBatchPrint = useCallback(async () => {
    if (selectedOrdersForPrint.size === 0) {
      toast({
        title: 'Error',
        description: 'Por favor selecciona al menos un pedido para imprimir',
        variant: 'destructive',
      });
      return;
    }

    if (!packingData) return;

    try {
      const ordersToPrint = packingData.orders.filter(o =>
        selectedOrdersForPrint.has(o.id) && o.delivery_link_token
      );

      const labelsData = ordersToPrint.map(order => ({
        storeName: currentStore?.name || 'ORDEFY',
        orderNumber: order.order_number,
        customerName: order.customer_name,
        customerPhone: order.customer_phone,
        customerAddress: order.customer_address,
        neighborhood: order.neighborhood,
        addressReference: order.address_reference,
        carrierName: order.carrier_name,
        codAmount: order.cod_amount,
        paymentMethod: order.payment_method,
        deliveryToken: order.delivery_link_token || '',
        items: order.items.map(item => ({
          name: item.product_name,
          quantity: item.quantity_needed
        }))
      }));

      const success = await printBatchLabelsPDF(labelsData);

      if (success) {
        handleBatchPrinted();
      }
    } catch (error) {
      console.error('Batch print error:', error);
      toast({
        title: 'Error de impresión',
        description: 'No se pudo generar el PDF en lote.',
        variant: 'destructive',
      });
    }
  }, [selectedOrdersForPrint, packingData, currentStore, handleBatchPrinted, toast]);

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

  // Calculate progress for picking based on actual quantities
  const pickingProgress = useMemo(() => {
    if (pickingList.length === 0) return 0;

    const totalNeeded = pickingList.reduce((sum, item) => sum + item.total_quantity_needed, 0);
    const totalPicked = pickingList.reduce((sum, item) => sum + item.quantity_picked, 0);

    return totalNeeded > 0 ? (totalPicked / totalNeeded) * 100 : 0;
  }, [pickingList]);

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
          isGlobalView={isGlobalView}
          onToggleGlobalView={setIsGlobalView}
        />
      )}

      {view === 'picking' && currentSession && (
        <PickingView
          session={currentSession}
          pickingList={pickingList}
          sessionOrders={sessionOrders}
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
          packingInProgress={packingInProgress}
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
  isGlobalView: boolean;
  onToggleGlobalView: (enabled: boolean) => void;
}

function DashboardView({
  confirmedOrders,
  activeSessions,
  selectedOrders,
  loading,
  onToggleOrder,
  onCreateSession,
  onResumeSession,
  isGlobalView,
  onToggleGlobalView
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
      </div>
      <div className="flex items-center gap-4">
        <GlobalViewToggle enabled={isGlobalView} onToggle={onToggleGlobalView} />
        <Package className="h-10 w-10 text-primary" />
      </div>

      {/* 3-Column Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Column 1: Active Sessions */}
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Layers className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Sesiones Activas</h2>
            <Badge variant="secondary" className="ml-auto">
              {activeSessions.length}
            </Badge>
          </div>

          {activeSessions.length === 0 ? (
            <div className="text-center py-8">
              <Layers className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-sm text-muted-foreground">
                No hay sesiones activas
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeSessions.map(session => (
                <Card
                  key={session.id}
                  className="p-3 cursor-pointer hover:shadow-md hover:border-primary transition-all"
                  onClick={() => onResumeSession(session)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono font-bold text-sm">
                      {session.code}
                    </span>
                    <Badge
                      variant={session.status === 'picking' ? 'default' : 'secondary'}
                      className="text-xs"
                    >
                      {session.status === 'picking' ? '📦 Picking' : '📋 Packing'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(session.created_at).toLocaleString('es-ES', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </p>
                  {/* Show Store Name in Global View */}
                  {(session as any).store_name && (
                    <Badge variant="outline" className="mt-2 text-[10px] h-5 bg-blue-50 text-blue-700 border-blue-200">
                      {(session as any).store_name}
                    </Badge>
                  )}
                </Card>
              ))}
            </div>
          )}
        </Card>

        {/* Column 2: Ready Orders */}
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <PackageCheck className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Listos para Picking</h2>
            <Badge variant="secondary" className="ml-auto">
              {confirmedOrders.length}
            </Badge>
          </div>

          {confirmedOrders.length === 0 ? (
            <div className="text-center py-8">
              <PackageCheck className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-sm text-muted-foreground">
                No hay pedidos confirmados
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2 max-h-[400px] overflow-y-auto mb-4">
                {confirmedOrders.map(order => (
                  <Card
                    key={order.id}
                    className={`p-3 transition-all cursor-pointer ${selectedOrders.has(order.id)
                      ? 'border-primary bg-primary/5'
                      : 'hover:border-primary/50'
                      }`}
                    onClick={() => onToggleOrder(order.id)}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={selectedOrders.has(order.id)}
                        onCheckedChange={() => onToggleOrder(order.id)}
                        className="mt-0.5"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-sm">
                            #{order.order_number}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {order.total_items} items
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {order.customer_name}
                        </p>
                        {/* Show Store Name in Global View */}
                        {(order as any).store_name && (
                          <Badge variant="outline" className="mt-1 text-[10px] h-4 px-1 bg-amber-50 text-amber-700 border-amber-200">
                            {(order as any).store_name}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>

              <Button
                onClick={onCreateSession}
                disabled={selectedOrders.size === 0 || loading}
                className="w-full"
                size="lg"
              >
                <PackageCheck className="h-4 w-4 mr-2" />
                Iniciar Preparación ({selectedOrders.size})
              </Button>
            </>
          )}
        </Card>

        {/* Column 3: Workflow Guide */}
        <Card className="p-6 bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-blue-600 rounded-full">
              <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-blue-900 dark:text-blue-100">
              Flujo de Trabajo
            </h2>
          </div>

          <ol className="space-y-4">
            <li className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">
                1
              </div>
              <div>
                <p className="font-semibold text-sm text-blue-900 dark:text-blue-100">
                  Selecciona Pedidos
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                  Marca los pedidos confirmados que deseas preparar
                </p>
              </div>
            </li>

            <li className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">
                2
              </div>
              <div>
                <p className="font-semibold text-sm text-blue-900 dark:text-blue-100">
                  Crea Sesión de Picking
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                  Inicia una nueva sesión de recolección
                </p>
              </div>
            </li>

            <li className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">
                3
              </div>
              <div>
                <p className="font-semibold text-sm text-blue-900 dark:text-blue-100">
                  Recoge Productos
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                  Usa los contadores para marcar productos recolectados
                </p>
              </div>
            </li>

            <li className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">
                4
              </div>
              <div>
                <p className="font-semibold text-sm text-blue-900 dark:text-blue-100">
                  Empaca Pedidos
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                  Asigna productos a cada pedido individual
                </p>
              </div>
            </li>

            <li className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">
                5
              </div>
              <div>
                <p className="font-semibold text-sm text-blue-900 dark:text-blue-100">
                  Imprime Etiquetas
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                  Genera etiquetas de envío para cada pedido
                </p>
              </div>
            </li>
          </ol>

          <div className="mt-6 p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg border border-blue-300 dark:border-blue-700">
            <p className="text-xs text-blue-800 dark:text-blue-200 font-medium">
              💡 Tip: Puedes reanudar sesiones activas en cualquier momento
            </p>
          </div>
        </Card>
      </div>
    </div >
  );
}

// ================================================================
// PICKING VIEW COMPONENT
// ================================================================

interface PickingViewProps {
  session: PickingSession;
  pickingList: PickingSessionItem[];
  sessionOrders: Array<{
    id: string;
    order_number: string;
    customer_name: string;
  }>;
  progress: number;
  onBack: () => void;
  onUpdateProgress: (productId: string, newQuantity: number) => void;
  onFinish: () => void;
  loading: boolean;
}

function PickingView({
  session,
  pickingList,
  sessionOrders,
  progress,
  onBack,
  onUpdateProgress,
  onFinish,
  loading
}: PickingViewProps) {
  const allPicked = pickingList.every(
    item => item.quantity_picked >= item.total_quantity_needed
  );

  const pickedItems = pickingList.filter(
    item => item.quantity_picked >= item.total_quantity_needed
  ).length;
  const totalItems = pickingList.length;

  // Calculate total quantities for progress display
  const totalQuantityNeeded = pickingList.reduce((sum, item) => sum + item.total_quantity_needed, 0);
  const totalQuantityPicked = pickingList.reduce((sum, item) => sum + item.quantity_picked, 0);

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
          size="lg"
          className={allPicked ? 'bg-green-600 hover:bg-green-700 text-white' : ''}
        >
          <Check className="h-4 w-4 mr-2" />
          Finalizar Recolección
        </Button>
      </div>

      {/* Orders in Session */}
      {sessionOrders.length > 0 && (
        <Card className="p-4 bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
          <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2">
            Pedidos en esta sesión ({sessionOrders.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {sessionOrders.map(order => (
              <Badge
                key={order.id}
                variant="outline"
                className="bg-white dark:bg-blue-900/30 border-blue-300 dark:border-blue-700"
              >
                <span className="font-semibold">#{order.order_number}</span>
                <span className="mx-1">-</span>
                <span className="text-xs">{order.customer_name}</span>
              </Badge>
            ))}
          </div>
        </Card>
      )}

      {/* Enhanced Progress Bar */}
      <div className={`mb-6 p-6 rounded-lg border-2 ${allPicked ? 'bg-green-50 dark:bg-green-950/20 border-green-500/30' : 'bg-primary/10 border-primary/20'}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-full ${allPicked ? 'bg-green-600' : 'bg-primary'}`}>
              {allPicked ? (
                <Check className="h-5 w-5 text-white" />
              ) : (
                <Package className="h-5 w-5 text-white" />
              )}
            </div>
            <div>
              <span className="text-sm font-medium text-muted-foreground">
                Progreso de Picking
              </span>
              <p className="text-xs text-muted-foreground">
                {totalQuantityPicked} de {totalQuantityNeeded} unidades recolectadas • {pickedItems}/{totalItems} productos completos
              </p>
            </div>
          </div>
          <span className={`text-3xl font-bold ${allPicked ? 'text-green-600' : 'text-primary'}`}>
            {Math.round(progress)}%
          </span>
        </div>
        <Progress
          value={progress}
          className={`h-4 ${allPicked ? '[&>div]:bg-green-600' : ''}`}
        />
        {allPicked && (
          <p className="text-sm text-green-600 dark:text-green-400 font-medium mt-3 flex items-center gap-2">
            <Check className="h-4 w-4" />
            ¡Todos los productos han sido recolectados! Puedes finalizar.
          </p>
        )}
      </div>

      {/* Picking List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {pickingList.map(item => {
          const isComplete = item.quantity_picked >= item.total_quantity_needed;
          return (
            <Card
              key={item.id}
              className={`p-4 transition-all ${isComplete
                ? 'border-green-500 bg-green-50 dark:bg-green-950/20 shadow-md'
                : 'border-border'
                }`}
            >
              {/* Checkmark Badge for Completed Items */}
              {isComplete && (
                <div className="absolute top-2 right-2 bg-green-500 rounded-full p-1">
                  <Check className="h-4 w-4 text-white" />
                </div>
              )}

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
                  <div className={`text-2xl font-bold ${isComplete ? 'text-green-600' : ''}`}>
                    {item.quantity_picked} / {item.total_quantity_needed}
                  </div>
                  {isComplete && (
                    <p className="text-xs text-green-600 dark:text-green-400 font-medium mt-1">
                      ✓ Completo
                    </p>
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
                variant={isComplete ? "secondary" : "default"}
                className="w-full mt-2"
                onClick={() => onUpdateProgress(item.product_id, item.total_quantity_needed)}
                disabled={isComplete}
              >
                {isComplete ? '✓ COMPLETADO' : 'MÁX'}
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
  packingInProgress: boolean;
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
  packingInProgress,
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
                  className={`p-3 transition-all ${!hasRemaining || packingInProgress
                    ? 'opacity-50 cursor-not-allowed bg-muted'
                    : isSelected
                      ? 'border-primary ring-2 ring-primary/20 bg-primary/10 cursor-pointer'
                      : 'hover:shadow-md hover:border-primary/50 cursor-pointer'
                    }`}
                  onClick={() => hasRemaining && !packingInProgress && onSelectItem(isSelected ? null : item.product_id)}
                >
                  <div className="flex gap-3">
                    {/* Checkbox Visual */}
                    <div className="flex-shrink-0 mt-1">
                      <Checkbox
                        checked={isSelected}
                        disabled={!hasRemaining || packingInProgress}
                        className="h-5 w-5"
                        onClick={(e) => e.stopPropagation()}
                        onCheckedChange={() => hasRemaining && !packingInProgress && onSelectItem(isSelected ? null : item.product_id)}
                      />
                    </div>

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
                    ? 'border-green-600 dark:border-green-600 bg-green-50 dark:bg-green-950/20'
                    : needsSelectedItem
                      ? `border-green-600 dark:border-green-600 ring-2 ring-green-600/20 shadow-lg ${packingInProgress ? 'cursor-wait opacity-70' : 'cursor-pointer'} bg-green-50/50 dark:bg-green-950/10`
                      : ''
                    }`}
                  onClick={() => {
                    if (needsSelectedItem && selectedItemInOrder && !packingInProgress) {
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
                        <Badge className="bg-green-600 hover:bg-green-600">
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
                          className={`flex items-center gap-3 p-2 rounded ${isHighlighted
                            ? 'bg-green-100 dark:bg-green-950/30 border border-green-600/30 dark:border-green-600/30'
                            : itemComplete
                              ? 'bg-green-50 dark:bg-green-950/20'
                              : ''
                            }`}
                        >
                          {/* Checkbox para items completados */}
                          <div className="flex-shrink-0">
                            <Checkbox
                              checked={itemComplete}
                              disabled
                              className="h-4 w-4"
                            />
                          </div>

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
                            <p className={`text-sm font-medium line-clamp-1 ${itemComplete ? 'text-muted-foreground line-through' : ''}`}>
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
                              {isHighlighted && (
                                <Badge variant="outline" className="text-[10px] h-4 px-1 bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-300 dark:border-green-600">
                                  Click para empacar
                                </Badge>
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
