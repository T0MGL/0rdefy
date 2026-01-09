/**
 * Warehouse Page - Redesigned
 * Seamless, progressive workflow for picking and packing orders
 * Order-first approach with order numbers as protagonists
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { ArrowLeft, Package, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

// New warehouse components
import {
  SessionProgress,
  OrderSelector,
  PickingList,
  PackingOneByOne,
  SessionSummary,
  ActiveSessions,
} from '@/components/warehouse';

// Services
import * as warehouseService from '@/services/warehouse.service';
import { ordersService } from '@/services/orders.service';
import { printLabelPDF, printBatchLabelsPDF } from '@/components/printing/printLabelPDF';
import { showErrorToast } from '@/utils/errorMessages';

import type {
  PickingSession,
  PickingSessionItem,
  ConfirmedOrder,
  PackingListResponse,
  OrderForPacking,
} from '@/services/warehouse.service';

type WorkflowStep = 'selection' | 'picking' | 'packing' | 'verification';

export default function WarehouseNew() {
  const { toast } = useToast();
  const { currentStore } = useAuth();

  // ==================== STATE ====================

  // Workflow state
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('selection');
  const [session, setSession] = useState<PickingSession | null>(null);

  // Selection state
  const [confirmedOrders, setConfirmedOrders] = useState<ConfirmedOrder[]>([]);
  const [activeSessions, setActiveSessions] = useState<PickingSession[]>([]);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());

  // Picking state
  const [pickingList, setPickingList] = useState<PickingSessionItem[]>([]);
  const [sessionOrders, setSessionOrders] = useState<Array<{
    id: string;
    order_number: string;
    customer_name: string;
  }>>([]);

  // Packing state
  const [packingData, setPackingData] = useState<PackingListResponse | null>(null);
  const [currentOrderIndex, setCurrentOrderIndex] = useState(0);

  // Loading states
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // ==================== DATA LOADING ====================

  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      const [orders, sessions] = await Promise.all([
        warehouseService.getConfirmedOrders(),
        warehouseService.getActiveSessions(),
      ]);
      setConfirmedOrders(orders);
      setActiveSessions(sessions);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
      showErrorToast(toast, error, {
        module: 'warehouse',
        action: 'load_dashboard',
        entity: 'datos del almacén',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadPickingList = useCallback(async (sessionId: string) => {
    try {
      const data = await warehouseService.getPickingList(sessionId);
      setPickingList(data.items);
      setSessionOrders(data.orders);
      return data;
    } catch (error) {
      console.error('Error loading picking list:', error);
      throw error;
    }
  }, []);

  const loadPackingList = useCallback(async (sessionId: string) => {
    try {
      const data = await warehouseService.getPackingList(sessionId);
      setPackingData(data);
      return data;
    } catch (error) {
      console.error('Error loading packing list:', error);
      throw error;
    }
  }, []);

  // Load data on mount and when returning to selection
  useEffect(() => {
    if (currentStep === 'selection') {
      loadDashboardData();
    }
  }, [currentStep, loadDashboardData]);

  // ==================== NAVIGATION ====================

  const handleBack = useCallback(() => {
    if (currentStep === 'picking') {
      // Go back to selection, but keep session active
      setCurrentStep('selection');
    } else if (currentStep === 'packing') {
      // Can't go back from packing to picking (picking is complete)
      // Go back to selection instead
      setCurrentStep('selection');
    } else if (currentStep === 'verification') {
      // Return to dashboard
      setCurrentStep('selection');
      setSession(null);
      setPackingData(null);
    }
  }, [currentStep]);

  const handleReset = useCallback(() => {
    setCurrentStep('selection');
    setSession(null);
    setPickingList([]);
    setSessionOrders([]);
    setPackingData(null);
    setCurrentOrderIndex(0);
    setSelectedOrderIds(new Set());
  }, []);

  // ==================== SELECTION ACTIONS ====================

  const handleToggleOrder = useCallback((orderId: string) => {
    setSelectedOrderIds(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedOrderIds(new Set(confirmedOrders.map(o => o.id)));
  }, [confirmedOrders]);

  const handleClearSelection = useCallback(() => {
    setSelectedOrderIds(new Set());
  }, []);

  // ==================== SESSION ACTIONS ====================

  const handleCreateSession = useCallback(async () => {
    if (selectedOrderIds.size === 0) {
      toast({
        title: 'Error',
        description: 'Por favor selecciona al menos un pedido',
        variant: 'destructive',
      });
      return;
    }

    setActionLoading(true);
    try {
      const newSession = await warehouseService.createSession(
        Array.from(selectedOrderIds)
      );

      setSession(newSession);
      await loadPickingList(newSession.id);
      setSelectedOrderIds(new Set());
      setCurrentStep('picking');

      toast({
        title: 'Sesión creada',
        description: `Preparando ${selectedOrderIds.size} pedido(s) - ${newSession.code}`,
      });
    } catch (error: any) {
      console.error('Error creating session:', error);
      showErrorToast(toast, error, {
        module: 'warehouse',
        action: 'create_session',
        entity: 'sesión de preparación',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(false);
    }
  }, [selectedOrderIds, toast, loadPickingList]);

  const handleResumeSession = useCallback(async (sessionToResume: PickingSession) => {
    setActionLoading(true);
    setSession(sessionToResume);

    try {
      if (sessionToResume.status === 'picking') {
        await loadPickingList(sessionToResume.id);
        setCurrentStep('picking');
      } else if (sessionToResume.status === 'packing') {
        await loadPackingList(sessionToResume.id);
        setCurrentOrderIndex(0);
        setCurrentStep('packing');
      }

      toast({
        title: 'Sesión cargada',
        description: `Continuando con ${sessionToResume.code}`,
      });
    } catch (error) {
      console.error('Error resuming session:', error);
      toast({
        title: 'Error',
        description: 'No se pudo cargar la sesión',
        variant: 'destructive',
      });
      setSession(null);
    } finally {
      setActionLoading(false);
    }
  }, [toast, loadPickingList, loadPackingList]);

  // ==================== PICKING ACTIONS ====================

  const handleUpdatePickingQuantity = useCallback(async (productId: string, quantity: number) => {
    if (!session) return;

    // Optimistic update
    const previousList = [...pickingList];
    setPickingList(prev =>
      prev.map(item =>
        item.product_id === productId
          ? { ...item, quantity_picked: quantity }
          : item
      )
    );

    try {
      await warehouseService.updatePickingProgress(session.id, productId, quantity);
    } catch (error: any) {
      console.error('Error updating picking progress:', error);
      // Revert on error
      setPickingList(previousList);
      toast({
        title: 'Error',
        description: error.message || 'No se pudo actualizar el progreso',
        variant: 'destructive',
      });
    }
  }, [session, pickingList, toast]);

  const handleFinishPicking = useCallback(async () => {
    if (!session) return;

    // Validate all items are picked
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

    setActionLoading(true);
    try {
      const updated = await warehouseService.finishPicking(session.id);
      setSession(updated);

      await loadPackingList(session.id);
      setCurrentOrderIndex(0);
      setCurrentStep('packing');

      toast({
        title: 'Recolección completada',
        description: 'Ahora puedes empacar los pedidos',
      });
    } catch (error: any) {
      console.error('Error finishing picking:', error);
      toast({
        title: 'Error',
        description: error.message || 'No se pudo completar la recolección',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(false);
    }
  }, [session, pickingList, toast, loadPackingList]);

  // ==================== PACKING ACTIONS ====================

  const handlePackItem = useCallback(async (orderId: string, productId: string) => {
    if (!session || !packingData) return;

    // Optimistic update
    const previousData = { ...packingData };

    setPackingData(prev => {
      if (!prev) return prev;

      const updatedOrders = prev.orders.map(order => {
        if (order.id === orderId) {
          const updatedItems = order.items.map(item => {
            if (item.product_id === productId && item.quantity_packed < item.quantity_needed) {
              return { ...item, quantity_packed: item.quantity_packed + 1 };
            }
            return item;
          });

          const isComplete = updatedItems.every(item => item.quantity_packed >= item.quantity_needed);
          return { ...order, items: updatedItems, is_complete: isComplete };
        }
        return order;
      });

      const updatedAvailableItems = prev.availableItems.map(item => {
        if (item.product_id === productId) {
          return {
            ...item,
            total_packed: item.total_packed + 1,
            remaining: item.remaining - 1,
          };
        }
        return item;
      });

      return {
        ...prev,
        orders: updatedOrders,
        availableItems: updatedAvailableItems,
      };
    });

    try {
      await warehouseService.updatePackingProgress(session.id, orderId, productId);
      // Reload to sync with server
      await loadPackingList(session.id);
    } catch (error: any) {
      console.error('Error packing item:', error);
      // Revert on error
      setPackingData(previousData);
      toast({
        title: 'Error',
        description: error.message || 'No se pudo empacar el producto',
        variant: 'destructive',
      });
    }
  }, [session, packingData, toast, loadPackingList]);

  const handlePackAllItems = useCallback(async (orderId: string) => {
    if (!session || !packingData) return;

    const order = packingData.orders.find(o => o.id === orderId);
    if (!order) return;

    // Calculate how many packs we need to do for each item
    const packOperations: Array<{ productId: string; count: number }> = [];

    for (const item of order.items) {
      const remaining = item.quantity_needed - item.quantity_packed;
      if (remaining > 0) {
        const available = packingData.availableItems.find(
          i => i.product_id === item.product_id
        );
        const canPack = Math.min(remaining, available?.remaining || 0);
        if (canPack > 0) {
          packOperations.push({ productId: item.product_id, count: canPack });
        }
      }
    }

    // Execute all pack operations sequentially
    for (const op of packOperations) {
      for (let i = 0; i < op.count; i++) {
        await warehouseService.updatePackingProgress(session.id, orderId, op.productId);
      }
    }

    // Reload data after all operations
    await loadPackingList(session.id);
  }, [session, packingData, loadPackingList]);

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
        financialStatus: order.financial_status,
        deliveryToken: order.delivery_link_token || '',
        items: order.items.map(item => ({
          name: item.product_name,
          quantity: item.quantity_needed,
          price: 0,
        })),
      });

      if (success) {
        await ordersService.markAsPrinted(order.id);
        if (session) {
          await loadPackingList(session.id);
        }
        toast({
          title: 'Etiqueta impresa',
          description: `Pedido #${order.order_number}`,
        });
      }
    } catch (error) {
      console.error('Print error:', error);
      toast({
        title: 'Error de impresión',
        description: 'No se pudo generar el PDF para imprimir',
        variant: 'destructive',
      });
    }
  }, [currentStore, session, toast, loadPackingList]);

  const handlePrintAllLabels = useCallback(async () => {
    if (!packingData) return;

    const ordersToPrint = packingData.orders.filter(
      o => o.is_complete && !o.printed && o.delivery_link_token
    );

    if (ordersToPrint.length === 0) return;

    try {
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
        financialStatus: order.financial_status,
        deliveryToken: order.delivery_link_token || '',
        items: order.items.map(item => ({
          name: item.product_name,
          quantity: item.quantity_needed,
          price: 0,
        })),
      }));

      const success = await printBatchLabelsPDF(labelsData);

      if (success) {
        for (const order of ordersToPrint) {
          await ordersService.markAsPrinted(order.id);
        }

        if (session) {
          await loadPackingList(session.id);
        }

        toast({
          title: 'Etiquetas impresas',
          description: `${ordersToPrint.length} etiquetas generadas`,
        });
      }
    } catch (error) {
      console.error('Batch print error:', error);
      toast({
        title: 'Error de impresión',
        description: 'No se pudieron generar las etiquetas',
        variant: 'destructive',
      });
    }
  }, [packingData, currentStore, session, toast, loadPackingList]);

  const handleCompleteSession = useCallback(async () => {
    if (!session) return;

    setActionLoading(true);
    try {
      await warehouseService.completeSession(session.id);

      setCurrentStep('verification');

      toast({
        title: 'Sesión completada',
        description: 'Todos los pedidos están listos para enviar',
      });
    } catch (error: any) {
      console.error('Error completing session:', error);
      toast({
        title: 'Error',
        description: error.message || 'No se pudo completar la sesión',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(false);
    }
  }, [session, toast]);

  // ==================== COMPUTED VALUES ====================

  const orderCount = useMemo(() => {
    if (packingData) return packingData.orders.length;
    return sessionOrders.length;
  }, [packingData, sessionOrders]);

  // ==================== RENDER ====================

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header with Progress - only show when in a session */}
      {currentStep !== 'selection' && session && (
        <SessionProgress
          currentStep={currentStep}
          sessionCode={session.code}
          orderCount={orderCount}
        />
      )}

      {/* Back Button for non-selection steps */}
      {currentStep !== 'selection' && (
        <div className="bg-card border-b px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            {currentStep === 'verification' ? 'Volver al Dashboard' : 'Volver'}
          </Button>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {/* Selection Step */}
        {currentStep === 'selection' && (
          <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold flex items-center gap-3">
                  <Package className="h-8 w-8 text-primary" />
                  Almacén
                </h1>
                <p className="text-muted-foreground mt-1">
                  Selecciona pedidos para preparar y empacar
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              {/* Active Sessions Sidebar */}
              <div className="lg:col-span-1">
                <ActiveSessions
                  sessions={activeSessions}
                  onResumeSession={handleResumeSession}
                />
              </div>

              {/* Orders Grid */}
              <div className="lg:col-span-3">
                <OrderSelector
                  orders={confirmedOrders}
                  selectedIds={selectedOrderIds}
                  onToggleOrder={handleToggleOrder}
                  onSelectAll={handleSelectAll}
                  onClearSelection={handleClearSelection}
                  onStartSession={handleCreateSession}
                  loading={loading}
                  actionLoading={actionLoading}
                />
              </div>
            </div>
          </div>
        )}

        {/* Picking Step */}
        {currentStep === 'picking' && session && (
          <div className="p-6">
            <PickingList
              items={pickingList}
              orders={sessionOrders}
              onUpdateQuantity={handleUpdatePickingQuantity}
              onFinishPicking={handleFinishPicking}
              loading={actionLoading}
            />
          </div>
        )}

        {/* Packing Step */}
        {currentStep === 'packing' && session && packingData && (
          <PackingOneByOne
            packingData={packingData}
            currentOrderIndex={currentOrderIndex}
            onPackItem={handlePackItem}
            onPackAllItems={handlePackAllItems}
            onPrintLabel={handlePrintLabel}
            onNextOrder={() => setCurrentOrderIndex(i => Math.min(i + 1, packingData.orders.length - 1))}
            onPreviousOrder={() => setCurrentOrderIndex(i => Math.max(i - 1, 0))}
            onGoToOrder={setCurrentOrderIndex}
            onCompleteSession={handleCompleteSession}
            loading={actionLoading}
          />
        )}

        {/* Verification Step */}
        {currentStep === 'verification' && session && packingData && (
          <SessionSummary
            session={session}
            packingData={packingData}
            onPrintAllLabels={handlePrintAllLabels}
            onPrintLabel={async (orderId) => {
              const order = packingData.orders.find(o => o.id === orderId);
              if (order) await handlePrintLabel(order);
            }}
            onClose={handleReset}
          />
        )}

        {/* Loading Overlay */}
        {actionLoading && currentStep === 'selection' && (
          <div className="fixed inset-0 bg-background/80 flex items-center justify-center z-50">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Cargando sesión...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
