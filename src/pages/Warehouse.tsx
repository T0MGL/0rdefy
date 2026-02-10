/**
 * Warehouse Page
 * Manages picking and packing workflow for confirmed orders
 * Optimized for manual input without barcode scanners
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Package, PackageCheck, PackageOpen, Printer, ArrowLeft, Check, Plus, Minus, Layers, Loader2, XCircle, AlertTriangle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { logger } from '@/utils/logger';
import { formatLocalDate } from '@/utils/timeUtils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useDateRange } from '@/contexts/DateRangeContext';
import { useAuth } from '@/contexts/AuthContext';
import * as warehouseService from '@/services/warehouse.service';
import { getProductVariantKey, parseProductVariantKey } from '@/services/warehouse.service';
import { ordersService } from '@/services/orders.service';

import { printLabelPDF, printBatchLabelsPDF } from '@/components/printing/printLabelPDF';
import type {
  PickingSession,
  PickingSessionItem,
  ConfirmedOrder,
  OrderForPacking,
  PackingListResponse
} from '@/services/warehouse.service';
import { showErrorToast } from '@/utils/errorMessages';
import { FirstTimeWelcomeBanner } from '@/components/FirstTimeTooltip';

type View = 'dashboard' | 'picking' | 'packing';

// TIMEOUT FIX: Helper function to add timeout to promises (with timer cleanup)
const withTimeout = <T,>(promise: Promise<T>, ms: number, operation: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Timeout: ${operation} tardó más de ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
};

// Default timeout for warehouse operations (90 seconds)
// Large sessions (200+ orders) need more time for batched queries
const OPERATION_TIMEOUT = 90000;

export default function Warehouse() {
  const { toast } = useToast();
  const { currentStore } = useAuth();
  const { getDateRange } = useDateRange();
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<View>('dashboard');
  const [currentSession, setCurrentSession] = useState<PickingSession | null>(null);

  // Track URL session param processing
  const lastProcessedSessionId = useRef<string | null>(null);
  const sessionLoadingTimeout = useRef<NodeJS.Timeout | null>(null);

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
  const [isPrinting, setIsPrinting] = useState(false);
  const [printingOrderId, setPrintingOrderId] = useState<string | null>(null);

  // Abandon session state
  const [showAbandonDialog, setShowAbandonDialog] = useState(false);
  const [sessionToAbandon, setSessionToAbandon] = useState<PickingSession | null>(null);
  const [abandoningSession, setAbandoningSession] = useState(false);

  const storeTimezone = currentStore?.timezone || 'America/Asuncion';

  // ✅ FIXED: Track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef<boolean>(true);

  // Calculate date ranges from global context using store timezone
  const dateRange = useMemo(() => {
    const range = getDateRange();

    // CRITICAL FIX (Bug #17): Validate dates before calling toISOString()
    // Invalid dates will throw exception and crash the entire page
    if (!range.from || !range.to ||
        isNaN(range.from.getTime()) || isNaN(range.to.getTime())) {
      logger.warn('Warehouse: Invalid date range detected, using defaults');
      const today = new Date();
      const weekAgo = new Date();
      weekAgo.setDate(today.getDate() - 7);
      return {
        startDate: formatLocalDate(weekAgo, storeTimezone),
        endDate: formatLocalDate(today, storeTimezone),
      };
    }

    const result = {
      startDate: formatLocalDate(range.from, storeTimezone),
      endDate: formatLocalDate(range.to, storeTimezone),
    };
    return result;
  }, [getDateRange, storeTimezone]);

  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      const [orders, sessions] = await Promise.all([
        warehouseService.getConfirmedOrders(),
        warehouseService.getActiveSessions(),
      ]);
      // ✅ FIXED: Only update state if component is still mounted
      if (isMountedRef.current) {
        setConfirmedOrders(orders);
        setActiveSessions(sessions);
      }
    } catch (error) {
      logger.error('Error loading dashboard data:', error);
      // ✅ FIXED: Only show toast if component is still mounted
      if (isMountedRef.current) {
        showErrorToast(toast, error, {
          module: 'warehouse',
          action: 'load_dashboard',
          entity: 'datos del almacén',
          variant: 'destructive',
        });
      }
    } finally {
      // ✅ FIXED: Only update loading state if component is still mounted
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [toast]);

  const loadPickingList = useCallback(async () => {
    if (!currentSession) return;
    setLoading(true);
    try {
      // TIMEOUT FIX: Add timeout to prevent hanging requests
      const data = await withTimeout(
        warehouseService.getPickingList(currentSession.id),
        OPERATION_TIMEOUT,
        'cargar lista de picking'
      );
      // ✅ FIXED: Only update state if component is still mounted
      if (isMountedRef.current) {
        setPickingList(data.items);
        setSessionOrders(data.orders);
      }
    } catch (error: any) {
      logger.error('Error loading picking list:', error);
      // ✅ FIXED: Only show toast if component is still mounted
      if (isMountedRef.current) {
        toast({
          title: 'Error',
          description: error.message?.includes('Timeout')
            ? 'La operación tardó demasiado. Por favor, intenta de nuevo.'
            : 'No se pudo cargar la lista de picking',
          variant: 'destructive',
        });
      }
    } finally {
      // ✅ FIXED: Only update loading state if component is still mounted
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [currentSession, toast]);

  const loadPackingList = useCallback(async () => {
    if (!currentSession) return;
    setLoading(true);
    try {
      // TIMEOUT FIX: Add timeout to prevent hanging requests
      const data = await withTimeout(
        warehouseService.getPackingList(currentSession.id),
        OPERATION_TIMEOUT,
        'cargar lista de empaque'
      );
      // ✅ FIXED: Only update state if component is still mounted
      if (isMountedRef.current) {
        setPackingData(data);
      }
    } catch (error: any) {
      logger.error('Error loading packing list:', error);
      // ✅ FIXED: Only show toast if component is still mounted
      if (isMountedRef.current) {
        toast({
          title: 'Error',
          description: error.message?.includes('Timeout')
            ? 'La operación tardó demasiado. Por favor, intenta de nuevo.'
            : 'No se pudo cargar la lista de empaque',
          variant: 'destructive',
        });
      }
    } finally {
      // ✅ FIXED: Only update loading state if component is still mounted
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [currentSession, toast]);

  // ✅ FIXED: Set mounted flag and cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Load dashboard data when entering dashboard view
  useEffect(() => {
    if (view === 'dashboard') {
      loadDashboardData();
    }
  }, [view, loadDashboardData]);

  // Handle session param from URL (e.g., /warehouse?session=123)
  // This is used when navigating from Orders page "Preparar" button
  useEffect(() => {
    const sessionId = searchParams.get('session');

    // No session param in URL - nothing to do
    if (!sessionId) {
      return;
    }

    // Validate UUID format to prevent invalid lookups
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(sessionId)) {
      logger.warn(`Invalid session ID format: ${sessionId}`);
      setSearchParams({}, { replace: true });
      return;
    }

    // Already processed this exact session ID - skip
    if (lastProcessedSessionId.current === sessionId) {
      return;
    }

    // Sessions not loaded yet - wait (dashboard useEffect will load them)
    if (activeSessions.length === 0 && !loading) {
      // Set a timeout to prevent infinite waiting (10 seconds max)
      if (!sessionLoadingTimeout.current) {
        sessionLoadingTimeout.current = setTimeout(() => {
          if (searchParams.get('session') === sessionId) {
            logger.warn(`Timeout waiting for session ${sessionId}`);
            lastProcessedSessionId.current = sessionId;
            setSearchParams({}, { replace: true });
            toast({
              title: 'Error',
              description: 'No se pudo cargar la sesión. Intenta de nuevo.',
              variant: 'destructive',
            });
          }
        }, 10000);
      }
      return;
    }

    // Clear any pending timeout since sessions are loaded
    if (sessionLoadingTimeout.current) {
      clearTimeout(sessionLoadingTimeout.current);
      sessionLoadingTimeout.current = null;
    }

    // Find the session in active sessions
    const targetSession = activeSessions.find(s => s.id === sessionId);

    if (targetSession) {
      lastProcessedSessionId.current = sessionId;
      setSearchParams({}, { replace: true });

      // Auto-open the session
      setCurrentSession(targetSession);
      if (targetSession.status === 'picking') {
        setView('picking');
      } else if (targetSession.status === 'packing') {
        setView('packing');
      }

      toast({
        title: '📦 Sesión abierta',
        description: `Continuando con ${targetSession.code}`,
      });
    } else {
      // Session not found - maybe it was completed or cancelled
      lastProcessedSessionId.current = sessionId;
      setSearchParams({}, { replace: true });

      logger.warn(`Session ${sessionId} not found in active sessions`);
      toast({
        title: 'Sesión no encontrada',
        description: 'La sesión ya fue completada o cancelada',
        variant: 'destructive',
      });
    }
  }, [searchParams, activeSessions, loading, setSearchParams, toast]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (sessionLoadingTimeout.current) {
        clearTimeout(sessionLoadingTimeout.current);
      }
    };
  }, []);

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
      logger.error('Error creating session:', error);
      showErrorToast(toast, error, {
        module: 'warehouse',
        action: 'create_session',
        entity: 'sesión de picking',
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

  async function handleQuickPrepare(order: ConfirmedOrder) {
    setLoading(true);
    try {
      const session = await warehouseService.createSession([order.id]);
      setCurrentSession(session);
      setView('picking');
      toast({
        title: 'Sesión creada',
        description: `Preparando pedido #${order.order_number}`,
      });
    } catch (error: any) {
      logger.error('Error creating session:', error);
      showErrorToast(toast, error, {
        module: 'warehouse',
        action: 'quick_prepare',
        entity: 'sesión de picking',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  /**
   * Update picking progress for a product (with variant support)
   * FIX: Now accepts and passes variantId (Migration 108)
   */
  async function handleUpdatePickingProgress(
    productId: string,
    newQuantity: number,
    variantId?: string | null
  ) {
    if (!currentSession) return;

    // Use composite key for matching items with variants
    const itemKey = getProductVariantKey(productId, variantId);

    // Deep clone to prevent concurrent update corruption
    const previousPickingList = pickingList.map(item => ({ ...item }));

    // Optimistic update using composite key match
    setPickingList(prev =>
      prev.map(item => {
        const currentKey = getProductVariantKey(item.product_id, item.variant_id);
        return currentKey === itemKey
          ? { ...item, quantity_picked: newQuantity }
          : item;
      })
    );

    try {
      await warehouseService.updatePickingProgress(
        currentSession.id,
        productId,
        newQuantity,
        variantId  // Pass variantId to backend
      );
    } catch (error: any) {
      logger.error('Error updating picking progress:', error);
      // Revert optimistic update on error
      setPickingList(previousPickingList);
      showErrorToast(toast, error, {
        module: 'warehouse',
        action: 'update_picking',
        entity: 'progreso de picking',
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
        title: 'Picking incompleto',
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
      logger.error('Error finishing picking:', error);
      showErrorToast(toast, error, {
        module: 'warehouse',
        action: 'finish_picking',
        entity: 'picking',
      });
    } finally {
      setLoading(false);
    }
  }

  /**
   * Pack a single item into an order (with variant support)
   * FIX: Now accepts and passes variantId (Migration 108)
   * FIX: Uses structuredClone for better performance
   * FIX: Optimistic update uses composite key for variant matching
   */
  async function handlePackItem(
    orderId: string,
    productId: string,
    variantId?: string | null
  ) {
    if (!currentSession || packingInProgress) return;

    setPackingInProgress(true);

    // Use composite key for matching items with variants
    const itemKey = getProductVariantKey(productId, variantId);

    // PERFORMANCE FIX: Use structuredClone instead of JSON.parse(JSON.stringify())
    // structuredClone is faster and handles more data types correctly
    const previousPackingData = packingData
      ? structuredClone(packingData)
      : null;

    if (packingData) {
      // Optimistic update using composite key match for variants
      const updatedOrders = packingData.orders.map(order => {
        if (order.id === orderId) {
          const updatedItems = order.items.map(item => {
            const currentKey = getProductVariantKey(item.product_id, item.variant_id);
            if (currentKey === itemKey && item.quantity_packed < item.quantity_needed) {
              return { ...item, quantity_packed: item.quantity_packed + 1 };
            }
            return item;
          });

          const isComplete = updatedItems.every(item => item.quantity_packed >= item.quantity_needed);
          return { ...order, items: updatedItems, is_complete: isComplete };
        }
        return order;
      });

      const updatedAvailableItems = packingData.availableItems.map(item => {
        const currentKey = getProductVariantKey(item.product_id, item.variant_id);
        if (currentKey === itemKey) {
          return {
            ...item,
            total_packed: item.total_packed + 1,
            remaining: item.remaining - 1
          };
        }
        return item;
      });

      setPackingData({
        ...packingData,
        orders: updatedOrders,
        availableItems: updatedAvailableItems
      });
    }

    try {
      await warehouseService.updatePackingProgress(
        currentSession.id,
        orderId,
        productId,
        variantId  // Pass variantId to backend
      );

      // PERFORMANCE FIX: Skip reload - trust optimistic update
      // Only reload on error or when explicitly needed
      // This reduces unnecessary API calls and prevents UI flicker

      setSelectedItem(null);
    } catch (error: any) {
      logger.error('Error packing item:', error);

      // Revert optimistic update on error
      if (previousPackingData) {
        setPackingData(previousPackingData);
      }

      // Reload from server to ensure consistency after error
      await loadPackingList();

      setSelectedItem(null);

      showErrorToast(toast, error, {
        module: 'warehouse',
        action: 'pack_item',
        entity: 'producto',
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
    // Reset session param tracking to allow processing new session links
    lastProcessedSessionId.current = null;
  }

  async function handleAbandonSession(session: PickingSession) {
    setSessionToAbandon(session);
    setShowAbandonDialog(true);
  }

  async function confirmAbandonSession() {
    if (!sessionToAbandon) return;

    setAbandoningSession(true);
    try {
      const result = await warehouseService.abandonSession(sessionToAbandon.id);
      toast({
        title: 'Sesión cancelada',
        description: `${result.orders_restored} pedido(s) restaurados a estado confirmado`,
      });
      setShowAbandonDialog(false);
      setSessionToAbandon(null);

      // If we're currently in this session, go back to dashboard
      if (currentSession?.id === sessionToAbandon.id) {
        handleBackToDashboard();
      }

      // Reload dashboard data
      loadDashboardData();
    } catch (error: any) {
      logger.error('Error abandoning session:', error);
      showErrorToast(toast, error, {
        module: 'warehouse',
        action: 'abandon_session',
        entity: 'sesión',
        variant: 'destructive',
      });
    } finally {
      setAbandoningSession(false);
    }
  }

  /**
   * Calculate session age for staleness indicators
   * FIX: Uses last_activity_at for inactivity measurement (not updated_at)
   * This correctly shows how long since last user interaction, not last any update
   */
  function getSessionAge(session: PickingSession): { hours: number; level: 'OK' | 'WARNING' | 'CRITICAL' } {
    // Priority: last_activity_at > updated_at > created_at
    // last_activity_at specifically tracks user interactions
    const activityTimestamp = session.last_activity_at || session.updated_at || session.created_at;
    const lastActivity = new Date(activityTimestamp);
    const now = new Date();

    // Validate the date before calculating
    if (isNaN(lastActivity.getTime())) {
      // Invalid date, use created_at as fallback
      const fallbackDate = new Date(session.created_at);
      const hours = isNaN(fallbackDate.getTime())
        ? 0
        : (now.getTime() - fallbackDate.getTime()) / (1000 * 60 * 60);

      return {
        hours: Math.round(hours * 10) / 10,
        level: hours > 48 ? 'CRITICAL' : hours > 24 ? 'WARNING' : 'OK'
      };
    }

    const hours = (now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60);

    return {
      hours: Math.round(hours * 10) / 10,
      level: hours > 48 ? 'CRITICAL' : hours > 24 ? 'WARNING' : 'OK'
    };
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
      logger.error('Error updating order after print:', error);
      toast({
        title: 'Error',
        description: 'No se pudo actualizar el estado del pedido',
        variant: 'destructive',
      });
    }
  }, [toast, loadPackingList]);

  const handlePrintLabel = useCallback(async (order: OrderForPacking) => {
    try {
      setPrintingOrderId(order.id);
      const success = await printLabelPDF({
        storeName: currentStore?.name || 'ORDEFY',
        orderNumber: order.order_number,
        orderDate: order.created_at ? format(new Date(order.created_at), "dd/MM/yyyy", { locale: es }) : undefined,
        customerName: order.customer_name,
        customerPhone: order.customer_phone,
        customerAddress: order.customer_address,
        city: order.shipping_city,
        neighborhood: order.neighborhood,
        addressReference: order.address_reference,
        carrierName: order.carrier_name,
        codAmount: order.cod_amount,
        totalPrice: order.total_price,
        discountAmount: order.total_discounts,
        paymentMethod: order.payment_method,
        paymentGateway: order.payment_gateway, // Critical for COD detection
        financialStatus: order.financial_status,
        deliveryToken: order.delivery_link_token || '',
        items: order.items.map(item => ({
          name: item.product_name,
          quantity: item.quantity_needed,
          price: item.unit_price || 0
        }))
      });

      if (success) {
        handleOrderPrinted(order.id);
      }
    } catch (error) {
      logger.error('Print error:', error);
      toast({
        title: 'Error de impresión',
        description: 'No se pudo generar el PDF para imprimir.',
        variant: 'destructive',
      });
    } finally {
      setPrintingOrderId(null);
    }
  }, [currentStore, handleOrderPrinted, toast]);

  const handleBatchPrinted = useCallback(async () => {
    const orderCount = selectedOrdersForPrint.size;
    try {
      // PERF FIX: Mark all orders as printed in parallel instead of sequentially
      // This reduces time from ~5s (50 orders × 100ms) to ~200ms
      await Promise.all(
        [...selectedOrdersForPrint].map(orderId =>
          ordersService.markAsPrinted(orderId)
        )
      );

      // Clear selection
      setSelectedOrdersForPrint(new Set());

      // Reload packing list
      await loadPackingList();

      toast({
        title: 'Etiquetas impresas',
        description: `${orderCount} etiquetas han sido impresas correctamente`,
      });
    } catch (error) {
      logger.error('Error updating orders after batch print:', error);
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
      setIsPrinting(true);

      // Filter orders that have delivery tokens
      const ordersToPrint = packingData.orders.filter(o =>
        selectedOrdersForPrint.has(o.id) && o.delivery_link_token
      );

      // UX FIX: Notify user if some orders were skipped due to missing tokens
      const skippedCount = selectedOrdersForPrint.size - ordersToPrint.length;
      if (skippedCount > 0) {
        toast({
          title: 'Aviso',
          description: `${skippedCount} pedido(s) sin token de entrega fueron omitidos de la impresión.`,
          variant: 'default',
        });
      }

      if (ordersToPrint.length === 0) {
        toast({
          title: 'Error',
          description: 'Ninguno de los pedidos seleccionados tiene token de entrega válido.',
          variant: 'destructive',
        });
        setIsPrinting(false);
        return;
      }

      const labelsData = ordersToPrint.map(order => ({
        storeName: currentStore?.name || 'ORDEFY',
        orderNumber: order.order_number,
        orderDate: order.created_at ? format(new Date(order.created_at), "dd/MM/yyyy", { locale: es }) : undefined,
        customerName: order.customer_name,
        customerPhone: order.customer_phone,
        customerAddress: order.customer_address,
        city: order.shipping_city,
        neighborhood: order.neighborhood,
        addressReference: order.address_reference,
        carrierName: order.carrier_name,
        codAmount: order.cod_amount,
        paymentMethod: order.payment_method,
        paymentGateway: order.payment_gateway, // Critical for COD detection
        financialStatus: order.financial_status,
        deliveryToken: order.delivery_link_token || '',
        items: order.items.map(item => ({
          name: item.product_name,
          quantity: item.quantity_needed,
          price: item.unit_price || 0
        }))
      }));

      const success = await printBatchLabelsPDF(labelsData);

      if (success) {
        handleBatchPrinted();
      }
    } catch (error) {
      logger.error('Batch print error:', error);
      toast({
        title: 'Error de impresión',
        description: 'No se pudo generar el PDF en lote.',
        variant: 'destructive',
      });
    } finally {
      setIsPrinting(false);
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
      logger.error('Error completing session:', error);
      showErrorToast(toast, error, {
        module: 'warehouse',
        action: 'complete_session',
        entity: 'sesión de picking',
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
      {/* Abandon Session Confirmation Dialog */}
      <AlertDialog open={showAbandonDialog} onOpenChange={setShowAbandonDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Cancelar Sesión {sessionToAbandon?.code}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción restaurará todos los pedidos de esta sesión al estado "confirmado".
              Podrás volver a preparar estos pedidos en una nueva sesión.
              <br /><br />
              <span className="font-medium text-foreground">¿Estás seguro de que deseas cancelar esta sesión?</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={abandoningSession}>
              No, mantener sesión
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmAbandonSession}
              disabled={abandoningSession}
              className="bg-red-600 hover:bg-red-700"
            >
              {abandoningSession ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Cancelando...
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 mr-2" />
                  Sí, cancelar sesión
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {view === 'dashboard' && (
        <DashboardView
          confirmedOrders={confirmedOrders}
          activeSessions={activeSessions}
          selectedOrders={selectedOrders}
          loading={loading}
          onToggleOrder={toggleOrderSelection}
          onCreateSession={handleCreateSession}
          onResumeSession={handleResumeSession}
          onQuickPrepare={handleQuickPrepare}
          onAbandonSession={handleAbandonSession}
          getSessionAge={getSessionAge}
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
          isPrinting={isPrinting}
          printingOrderId={printingOrderId}
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
  onQuickPrepare: (order: ConfirmedOrder) => void;
  onAbandonSession: (session: PickingSession) => void;
  getSessionAge: (session: PickingSession) => { hours: number; level: 'OK' | 'WARNING' | 'CRITICAL' };
}

function DashboardView({
  confirmedOrders,
  activeSessions,
  selectedOrders,
  loading,
  onToggleOrder,
  onCreateSession,
  onResumeSession,
  onQuickPrepare,
  onAbandonSession,
  getSessionAge,
}: DashboardViewProps) {
  return (
    <div className="p-6 space-y-6">
      {/* First-time Welcome Banner */}
      <FirstTimeWelcomeBanner
        moduleId="warehouse"
        title="¡Bienvenido al Almacén!"
        description="Aquí preparas pedidos para envío mediante Picking (recolección) y Packing (empaque)."
        tips={['Selecciona pedidos confirmados', 'Crea sesión de picking', 'Empaca y genera etiquetas']}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Almacén</h1>
          <p className="text-muted-foreground mt-1">
            Gestiona la preparación y empaquetado de pedidos
          </p>
        </div>
      </div>

      {/* 3-Column Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Column 1: Active Sessions */}
        <Card className="p-6" data-tour-target="warehouse-sessions">
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
              {activeSessions.map(session => {
                const sessionAge = getSessionAge(session);
                const isStale = sessionAge.level !== 'OK';

                return (
                  <Card
                    key={session.id}
                    className={`p-3 transition-all ${
                      isStale
                        ? sessionAge.level === 'CRITICAL'
                          ? 'border-red-300 bg-red-50 dark:bg-red-950/20'
                          : 'border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20'
                        : 'hover:shadow-md hover:border-primary'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span
                        className="font-mono font-bold text-sm cursor-pointer hover:text-primary"
                        onClick={() => onResumeSession(session)}
                      >
                        {session.code}
                      </span>
                      <div className="flex items-center gap-1">
                        <Badge
                          variant={session.status === 'picking' ? 'default' : 'secondary'}
                          className="text-xs"
                        >
                          {session.status === 'picking' ? '📦 Picking' : '📋 Packing'}
                        </Badge>
                        {isStale && (
                          <Badge
                            variant="outline"
                            className={`text-[10px] h-5 ${
                              sessionAge.level === 'CRITICAL'
                                ? 'bg-red-100 text-red-700 border-red-300'
                                : 'bg-yellow-100 text-yellow-700 border-yellow-300'
                            }`}
                          >
                            <Clock className="h-3 w-3 mr-1" />
                            {Math.round(sessionAge.hours)}h
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Staleness Warning */}
                    {isStale && (
                      <div className={`flex items-center gap-1 text-xs mb-2 ${
                        sessionAge.level === 'CRITICAL' ? 'text-red-600' : 'text-yellow-600'
                      }`}>
                        <AlertTriangle className="h-3 w-3" />
                        <span>
                          {sessionAge.level === 'CRITICAL'
                            ? 'Sesión muy antigua - considera cancelarla'
                            : 'Sesión inactiva por más de 24h'}
                        </span>
                      </div>
                    )}

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

                    {/* Action Buttons */}
                    <div className="flex gap-2 mt-3">
                      <Button
                        variant="default"
                        size="sm"
                        className="flex-1 h-8"
                        onClick={() => onResumeSession(session)}
                      >
                        Continuar
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20 border-red-200"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAbandonSession(session);
                        }}
                        title="Cancelar sesión y restaurar pedidos"
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    </div>
                  </Card>
                );
              })}
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
                    className={`p-3 transition-all ${selectedOrders.has(order.id)
                      ? 'border-primary bg-primary/5'
                      : 'hover:border-primary/50'
                      }`}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={selectedOrders.has(order.id)}
                        onCheckedChange={() => onToggleOrder(order.id)}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onToggleOrder(order.id)}>
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
                      {/* Quick Prepare Button */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onQuickPrepare(order);
                        }}
                        className="h-7 px-2 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/20 flex-shrink-0"
                        title="Preparar este pedido ahora"
                      >
                        <PackageOpen className="h-4 w-4 mr-1" />
                        Preparar
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>

              <Button
                onClick={onCreateSession}
                disabled={selectedOrders.size === 0 || loading}
                className="w-full"
                size="lg"
                data-tour-target="create-session-button"
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
  /** Updated to include variantId for variant support (Migration 108) */
  onUpdateProgress: (productId: string, newQuantity: number, variantId?: string | null) => void;
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
      <div className={`mb-6 p-6 rounded-lg border-2 ${allPicked ? 'bg-primary/10 border-primary' : 'bg-muted/50 border-border'}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-primary">
              {allPicked ? (
                <Check className="h-5 w-5 text-primary-foreground" />
              ) : (
                <Package className="h-5 w-5 text-primary-foreground" />
              )}
            </div>
            <div>
              <span className="text-sm font-medium">
                Progreso de Picking
              </span>
              <p className="text-xs text-muted-foreground">
                {totalQuantityPicked} de {totalQuantityNeeded} unidades • {pickedItems}/{totalItems} productos
              </p>
            </div>
          </div>
          <span className="text-3xl font-bold text-primary">
            {Math.round(progress)}%
          </span>
        </div>
        <Progress value={progress} className="h-4" />
        {allPicked && (
          <div className="mt-4 p-3 bg-primary/20 dark:bg-primary/10 border border-primary/30 rounded-lg flex items-center gap-2">
            <Check className="h-5 w-5 text-primary" />
            <p className="text-sm font-semibold text-primary">
              ¡Recolección completa! Haz clic en "Finalizar Recolección" para continuar.
            </p>
          </div>
        )}
      </div>

      {/* Picking List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {pickingList.map(item => {
          const isComplete = item.quantity_picked >= item.total_quantity_needed;
          return (
            <Card
              key={item.id}
              className={`p-4 transition-all relative ${isComplete
                ? 'border-primary bg-primary/5 shadow-sm'
                : 'border-border hover:border-primary/50'
                }`}
            >
              {/* Checkmark Badge for Completed Items */}
              {isComplete && (
                <div className="absolute top-3 right-3 bg-primary rounded-full p-1">
                  <Check className="h-4 w-4 text-primary-foreground" />
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
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      📍 {item.shelf_location}
                    </p>
                  )}
                </div>
              </div>

              {/* Quantity Display - Larger, More Prominent */}
              <div className="mb-3">
                <div className={`text-center py-2 px-3 rounded-lg ${isComplete ? 'bg-primary/10' : 'bg-muted'}`}>
                  <div className="text-xs text-muted-foreground mb-1">Recolectado</div>
                  <div className={`text-3xl font-bold ${isComplete ? 'text-primary' : 'text-foreground'}`}>
                    {item.quantity_picked} <span className="text-lg text-muted-foreground">/ {item.total_quantity_needed}</span>
                  </div>
                  {isComplete && (
                    <p className="text-xs text-primary font-semibold mt-1">
                      ✓ Completo
                    </p>
                  )}
                </div>
              </div>

              {/* Action Buttons - Reorganized for Speed */}
              {!isComplete ? (
                <div className="space-y-2">
                  {/* Primary Action: Complete All */}
                  <Button
                    variant="default"
                    size="lg"
                    className="w-full h-12 text-base font-semibold"
                    onClick={() => onUpdateProgress(item.product_id, item.total_quantity_needed, item.variant_id)}
                  >
                    <Check className="h-5 w-5 mr-2" />
                    Completar Todo
                  </Button>

                  {/* Secondary Actions: Fine Control */}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() => onUpdateProgress(item.product_id, Math.max(0, item.quantity_picked - 1), item.variant_id)}
                      disabled={item.quantity_picked === 0}
                      className="flex-1 h-10"
                    >
                      <Minus className="h-4 w-4" />
                    </Button>

                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() => onUpdateProgress(item.product_id, Math.min(item.total_quantity_needed, item.quantity_picked + 1), item.variant_id)}
                      disabled={item.quantity_picked >= item.total_quantity_needed}
                      className="flex-1 h-10"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
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
  isPrinting: boolean;
  printingOrderId: string | null;
  packingInProgress: boolean;
  onBack: () => void;
  onSelectItem: (productId: string | null) => void;
  /** Updated to include variantId for variant support (Migration 108) */
  onPackItem: (orderId: string, productId: string, variantId?: string | null) => void;
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
  isPrinting,
  printingOrderId,
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
  // FIX: Guard against vacuous truth - empty array .every() returns true
  const allItemsRemaining = availableItems.length > 0
    && availableItems.every(item => item.remaining === 0);

  // Calculate ready to print orders (complete and have token)
  const readyToPrintOrders = orders.filter(
    order => order.is_complete && order.delivery_link_token && !order.printed
  );

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="bg-card border-b p-4 shadow-sm">
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
                Selecciona producto de la izquierda → Haz clic en el pedido para empacar
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {readyToPrintOrders.length > 0 && (
              <Button
                variant="outline"
                onClick={onBatchPrint}
                disabled={selectedOrdersForPrint.size === 0 || isPrinting}
                className="gap-2"
              >
                {isPrinting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Preparando...
                  </>
                ) : (
                  <>
                    <Layers className="h-4 w-4" />
                    Imprimir Lote ({selectedOrdersForPrint.size})
                  </>
                )}
              </Button>
            )}
            {allOrdersComplete && allItemsRemaining && (
              <Button
                onClick={onCompleteSession}
                disabled={loading}
                size="lg"
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              >
                <Check className="h-4 w-4 mr-2" />
                Finalizar Sesión
              </Button>
            )}
          </div>
        </div>

        {/* Progress Indicator */}
        {!allOrdersComplete && (
          <div className="mt-4 p-3 bg-muted rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Progreso de Empaque</span>
              <span className="text-sm font-semibold text-primary">
                {orders.filter(o => o.is_complete).length} / {orders.length} pedidos completos
              </span>
            </div>
            <Progress
              value={(orders.filter(o => o.is_complete).length / orders.length) * 100}
              className="h-2"
            />
          </div>
        )}

        {allOrdersComplete && allItemsRemaining && (
          <div className="mt-4 p-3 bg-primary/10 border border-primary/30 rounded-lg flex items-center gap-2">
            <Check className="h-5 w-5 text-primary" />
            <p className="text-sm font-semibold text-primary">
              ¡Todos los pedidos están empacados! Haz clic en "Finalizar Sesión" para completar.
            </p>
          </div>
        )}
      </div>

      {/* Split View */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Available Items (Basket) */}
        <div className="w-1/3 border-r p-4 overflow-y-auto bg-muted/20">
          <div className="sticky top-0 bg-muted/20 pb-3 mb-4 border-b">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              Productos Disponibles
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              {selectedItem ? '✓ Producto seleccionado - Haz clic en un pedido →' : 'Selecciona un producto para empacar'}
            </p>
          </div>
          <div className="space-y-3">
            {availableItems.map(item => {
              // FIX: Use composite key for proper variant selection (Migration 108)
              const itemKey = item.variant_id
                ? `${item.product_id}|${item.variant_id}`
                : item.product_id;
              const isSelected = selectedItem === itemKey;
              const hasRemaining = item.remaining > 0;

              return (
                <Card
                  key={itemKey}
                  className={`p-3 transition-all ${!hasRemaining || packingInProgress
                    ? 'opacity-40 cursor-not-allowed bg-muted/50'
                    : isSelected
                      ? 'border-primary border-2 ring-2 ring-primary/20 bg-primary/10 cursor-pointer shadow-md'
                      : 'hover:shadow-md hover:border-primary/50 cursor-pointer bg-card'
                    }`}
                  onClick={() => hasRemaining && !packingInProgress && onSelectItem(isSelected ? null : itemKey)}
                >
                  <div className="flex gap-3">
                    {/* Selection Indicator */}
                    <div className="flex-shrink-0 mt-1">
                      {isSelected ? (
                        <div className="h-5 w-5 rounded bg-primary flex items-center justify-center">
                          <Check className="h-4 w-4 text-primary-foreground" />
                        </div>
                      ) : (
                        <div className={`h-5 w-5 rounded border-2 ${hasRemaining ? 'border-muted-foreground/30' : 'border-muted-foreground/10'}`} />
                      )}
                    </div>

                    {item.product_image ? (
                      <img
                        src={item.product_image}
                        alt={item.product_name}
                        className="w-14 h-14 object-cover rounded-lg"
                      />
                    ) : (
                      <div className="w-14 h-14 bg-muted rounded-lg flex items-center justify-center">
                        <Package className="h-7 w-7 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm line-clamp-2 mb-1">
                        {item.product_name}
                      </h3>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={hasRemaining ? 'default' : 'secondary'}
                          className={`text-xs font-semibold ${isSelected ? 'bg-primary/90' : ''}`}
                        >
                          {item.remaining} por empacar
                        </Badge>
                      </div>
                      {isSelected && (
                        <p className="text-xs text-primary font-medium mt-1">
                          → Selecciona pedido
                        </p>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Right Column: Orders (Boxes) */}
        <div className="flex-1 p-4 overflow-y-auto bg-background">
          <div className="sticky top-0 bg-background pb-3 mb-4 border-b">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <PackageCheck className="h-5 w-5 text-primary" />
              Pedidos ({orders.length})
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              {selectedItem ? 'Haz clic en un pedido para empacar el producto seleccionado' : 'Primero selecciona un producto de la izquierda'}
            </p>
          </div>
          <div className="space-y-4">
            {orders.map(order => {
              // FIX: Use parseProductVariantKey for proper null handling (Migration 108)
              // selectedItem can be "product_id" or "product_id|variant_id"
              const { productId: selectedProductId, variantId: selectedVariantId } = selectedItem
                ? parseProductVariantKey(selectedItem)
                : { productId: null, variantId: null };

              const needsSelectedItem = selectedProductId
                ? order.items.some(item => {
                    const matchesProduct = item.product_id === selectedProductId;
                    // When selectedVariantId is null, match items WITHOUT variants only
                    // When selectedVariantId is a string, match exact variant
                    const matchesVariant = selectedVariantId !== null
                      ? (item.variant_id || null) === selectedVariantId
                      : (item.variant_id || null) === null;
                    return matchesProduct && matchesVariant && item.quantity_packed < item.quantity_needed;
                  })
                : false;

              const selectedItemInOrder = selectedProductId
                ? order.items.find(item => {
                    const matchesProduct = item.product_id === selectedProductId;
                    const matchesVariant = selectedVariantId !== null
                      ? (item.variant_id || null) === selectedVariantId
                      : (item.variant_id || null) === null;
                    return matchesProduct && matchesVariant;
                  })
                : null;

              const canSelectForPrint = order.is_complete && order.delivery_link_token && !order.printed;
              const isSelectedForPrint = selectedOrdersForPrint.has(order.id);

              return (
                <Card
                  key={order.id}
                  className={`p-4 transition-all ${order.is_complete
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : needsSelectedItem
                      ? `border-primary border-2 ring-4 ring-primary/20 shadow-lg ${packingInProgress ? 'cursor-wait opacity-70' : 'cursor-pointer hover:ring-primary/30'} bg-primary/5`
                      : 'border-border bg-card'
                    }`}
                  onClick={() => {
                    if (needsSelectedItem && selectedItemInOrder && !packingInProgress) {
                      // FIX: Pass variant_id to properly handle variants (Migration 108)
                      onPackItem(order.id, selectedItemInOrder.product_id, selectedItemInOrder.variant_id);
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
                        <Badge className="bg-primary hover:bg-primary text-primary-foreground">
                          <Check className="h-3 w-3 mr-1" />
                          Completo
                        </Badge>
                        {order.printed && order.printed_at ? (
                          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                            <Printer className="h-3 w-3 mr-1" />
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
                            disabled={printingOrderId === order.id}
                            className="h-8"
                          >
                            {printingOrderId === order.id ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-1" />
                            ) : (
                              <Printer className="h-4 w-4 mr-1" />
                            )}
                            Imprimir
                          </Button>
                        ) : (
                          <Badge variant="outline" className="text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800">
                            Sin token
                          </Badge>
                        )}
                      </div>
                    ) : needsSelectedItem ? (
                      <Badge className="bg-primary text-primary-foreground animate-pulse font-semibold">
                        👈 Haz clic aquí
                      </Badge>
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
                      // FIX: Use composite key for highlight matching (Migration 108)
                      const orderItemKey = item.variant_id
                        ? `${item.product_id}|${item.variant_id}`
                        : item.product_id;
                      const isHighlighted =
                        selectedItem === orderItemKey && !itemComplete;

                      return (
                        <div
                          key={orderItemKey}
                          className={`flex items-center gap-3 p-2 rounded-lg transition-all ${isHighlighted
                            ? 'bg-primary/15 border-2 border-primary/50 shadow-sm'
                            : itemComplete
                              ? 'bg-primary/5'
                              : 'bg-muted/30'
                            }`}
                        >
                          {/* Status Indicator */}
                          <div className="flex-shrink-0">
                            {itemComplete ? (
                              <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                                <Check className="h-3 w-3 text-primary-foreground" />
                              </div>
                            ) : isHighlighted ? (
                              <div className="h-5 w-5 rounded-full bg-primary/30 animate-pulse" />
                            ) : (
                              <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/20" />
                            )}
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
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium line-clamp-1 ${itemComplete ? 'text-muted-foreground line-through' : ''}`}>
                              {item.product_name}
                            </p>
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-xs font-semibold ${itemComplete
                                  ? 'text-primary'
                                  : isHighlighted
                                    ? 'text-primary'
                                    : 'text-muted-foreground'
                                  }`}
                              >
                                {item.quantity_packed} / {item.quantity_needed}
                              </span>
                              {isHighlighted && (
                                <Badge variant="outline" className="text-[10px] h-4 px-1.5 bg-primary/10 text-primary border-primary/30 font-semibold">
                                  ← Empacar
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
