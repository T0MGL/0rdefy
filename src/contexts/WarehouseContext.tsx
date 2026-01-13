/**
 * Warehouse Context
 * Manages the state for the warehouse picking and packing workflow
 * Provides a seamless, progressive flow without page reloads
 */

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import * as warehouseService from '@/services/warehouse.service';
import { ordersService } from '@/services/orders.service';
import { useToast } from '@/hooks/use-toast';
import type {
  PickingSession,
  ConfirmedOrder,
  PackingListResponse,
  OrderForPacking
} from '@/services/warehouse.service';

// Extended types for the new order-first approach
export interface OrderInSession {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  addressReference?: string;
  neighborhood?: string;
  deliveryNotes?: string;
  deliveryToken?: string;
  carrierName?: string;
  codAmount?: number;
  paymentMethod?: string;
  financialStatus?: string;
  items: ItemInOrder[];
  pickingComplete: boolean;
  packingComplete: boolean;
  labelPrinted: boolean;
  notes: string[];
}

export interface ItemInOrder {
  productId: string;
  productName: string;
  productImage?: string;
  sku?: string;
  location?: string;
  quantityNeeded: number;
  quantityPicked: number;
  quantityPacked: number;
  outOfStock: boolean;
  outOfStockReason?: string;
}

export type WorkflowStep = 'selection' | 'picking' | 'packing' | 'verification';

interface WarehouseState {
  // Current step in the workflow
  currentStep: WorkflowStep;

  // Session data
  session: PickingSession | null;

  // Orders data
  confirmedOrders: ConfirmedOrder[];
  selectedOrderIds: Set<string>;
  ordersInSession: OrderInSession[];

  // Packing specific
  currentOrderIndex: number;
  packingData: PackingListResponse | null;

  // Progress tracking
  progress: {
    picking: number;
    packing: number;
    overall: number;
  };

  // Loading states
  loading: boolean;
  actionLoading: boolean;
}

interface WarehouseContextValue extends WarehouseState {
  // Navigation
  goToStep: (step: WorkflowStep) => void;
  goBack: () => void;
  reset: () => void;

  // Selection actions
  toggleOrderSelection: (orderId: string) => void;
  selectAllOrders: () => void;
  clearSelection: () => void;

  // Session actions
  createSession: () => Promise<void>;
  resumeSession: (session: PickingSession) => Promise<void>;

  // Picking actions
  updatePickingQuantity: (productId: string, quantity: number) => Promise<void>;
  markItemComplete: (productId: string) => Promise<void>;
  markItemOutOfStock: (productId: string, reason: string) => Promise<void>;
  finishPicking: () => Promise<void>;

  // Packing actions
  packItem: (orderId: string, productId: string) => Promise<void>;
  packAllItems: (orderId: string) => Promise<void>;
  goToNextOrder: () => void;
  goToPreviousOrder: () => void;
  goToOrder: (index: number) => void;

  // Completion actions
  printLabel: (order: OrderForPacking) => Promise<void>;
  printAllLabels: () => Promise<void>;
  completeSession: () => Promise<void>;

  // Data loading
  loadConfirmedOrders: () => Promise<void>;
  loadActiveSessions: () => Promise<PickingSession[]>;

  // Computed
  currentOrder: OrderForPacking | null;
  canProceedToPacking: boolean;
  canCompleteSession: boolean;
  unprintedOrders: OrderForPacking[];
}

const WarehouseContext = createContext<WarehouseContextValue | null>(null);

const initialState: WarehouseState = {
  currentStep: 'selection',
  session: null,
  confirmedOrders: [],
  selectedOrderIds: new Set(),
  ordersInSession: [],
  currentOrderIndex: 0,
  packingData: null,
  progress: {
    picking: 0,
    packing: 0,
    overall: 0,
  },
  loading: false,
  actionLoading: false,
};

export function WarehouseProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const [state, setState] = useState<WarehouseState>(initialState);

  // Helper to update state
  const updateState = useCallback((updates: Partial<WarehouseState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  // ==================== DATA LOADING ====================

  const loadConfirmedOrders = useCallback(async () => {
    updateState({ loading: true });
    try {
      const orders = await warehouseService.getConfirmedOrders();
      updateState({ confirmedOrders: orders, loading: false });
    } catch (error) {
      console.error('Error loading confirmed orders:', error);
      toast({
        title: 'Error',
        description: 'No se pudieron cargar los pedidos confirmados',
        variant: 'destructive',
      });
      updateState({ loading: false });
    }
  }, [toast, updateState]);

  const loadActiveSessions = useCallback(async (): Promise<PickingSession[]> => {
    try {
      return await warehouseService.getActiveSessions();
    } catch (error) {
      console.error('Error loading active sessions:', error);
      return [];
    }
  }, []);

  const loadPickingData = useCallback(async (sessionId: string) => {
    try {
      const data = await warehouseService.getPickingList(sessionId);
      return data;
    } catch (error) {
      console.error('Error loading picking data:', error);
      throw error;
    }
  }, []);

  const loadPackingData = useCallback(async (sessionId: string) => {
    try {
      const data = await warehouseService.getPackingList(sessionId);
      updateState({ packingData: data });
      return data;
    } catch (error) {
      console.error('Error loading packing data:', error);
      throw error;
    }
  }, [updateState]);

  // ==================== NAVIGATION ====================

  const goToStep = useCallback((step: WorkflowStep) => {
    updateState({ currentStep: step });
  }, [updateState]);

  const goBack = useCallback(() => {
    const stepOrder: WorkflowStep[] = ['selection', 'picking', 'packing', 'verification'];
    const currentIndex = stepOrder.indexOf(state.currentStep);
    if (currentIndex > 0) {
      updateState({ currentStep: stepOrder[currentIndex - 1] });
    }
  }, [state.currentStep, updateState]);

  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  // ==================== SELECTION ACTIONS ====================

  const toggleOrderSelection = useCallback((orderId: string) => {
    setState(prev => {
      const newSelected = new Set(prev.selectedOrderIds);
      if (newSelected.has(orderId)) {
        newSelected.delete(orderId);
      } else {
        newSelected.add(orderId);
      }
      return { ...prev, selectedOrderIds: newSelected };
    });
  }, []);

  const selectAllOrders = useCallback(() => {
    setState(prev => ({
      ...prev,
      selectedOrderIds: new Set(prev.confirmedOrders.map(o => o.id)),
    }));
  }, []);

  const clearSelection = useCallback(() => {
    updateState({ selectedOrderIds: new Set() });
  }, [updateState]);

  // ==================== SESSION ACTIONS ====================

  const createSession = useCallback(async () => {
    if (state.selectedOrderIds.size === 0) {
      toast({
        title: 'Error',
        description: 'Por favor selecciona al menos un pedido',
        variant: 'destructive',
      });
      return;
    }

    updateState({ actionLoading: true });
    try {
      const session = await warehouseService.createSession(
        Array.from(state.selectedOrderIds)
      );

      // Load picking data
      const pickingData = await loadPickingData(session.id);

      updateState({
        session,
        currentStep: 'picking',
        selectedOrderIds: new Set(),
        actionLoading: false,
      });

      toast({
        title: 'Sesión creada',
        description: `Preparando ${state.selectedOrderIds.size} pedido(s)`,
      });
    } catch (error: any) {
      console.error('Error creating session:', error);
      toast({
        title: 'Error',
        description: error.message || 'No se pudo crear la sesión',
        variant: 'destructive',
      });
      updateState({ actionLoading: false });
    }
  }, [state.selectedOrderIds, toast, updateState, loadPickingData]);

  const resumeSession = useCallback(async (session: PickingSession) => {
    updateState({ actionLoading: true, session });

    try {
      if (session.status === 'picking') {
        await loadPickingData(session.id);
        updateState({ currentStep: 'picking', actionLoading: false });
      } else if (session.status === 'packing') {
        await loadPackingData(session.id);
        updateState({ currentStep: 'packing', actionLoading: false });
      }
    } catch (error) {
      console.error('Error resuming session:', error);
      toast({
        title: 'Error',
        description: 'No se pudo cargar la sesión',
        variant: 'destructive',
      });
      updateState({ actionLoading: false });
    }
  }, [toast, updateState, loadPickingData, loadPackingData]);

  // ==================== PICKING ACTIONS ====================

  const updatePickingQuantity = useCallback(async (productId: string, quantity: number) => {
    if (!state.session) return;

    try {
      await warehouseService.updatePickingProgress(state.session.id, productId, quantity);
    } catch (error: any) {
      console.error('Error updating picking progress:', error);
      toast({
        title: 'Error',
        description: error.message || 'No se pudo actualizar el progreso',
        variant: 'destructive',
      });
    }
  }, [state.session, toast]);

  const markItemComplete = useCallback(async (productId: string) => {
    // This will be handled by the component that has access to the quantity needed
  }, []);

  const markItemOutOfStock = useCallback(async (productId: string, reason: string) => {
    // TODO: Implement out of stock marking
    toast({
      title: 'Producto marcado',
      description: 'Producto marcado como sin stock',
    });
  }, [toast]);

  const finishPicking = useCallback(async () => {
    if (!state.session) return;

    updateState({ actionLoading: true });
    try {
      const updated = await warehouseService.finishPicking(state.session.id);
      await loadPackingData(state.session.id);

      updateState({
        session: updated,
        currentStep: 'packing',
        currentOrderIndex: 0,
        actionLoading: false,
      });

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
      updateState({ actionLoading: false });
    }
  }, [state.session, toast, updateState, loadPackingData]);

  // ==================== PACKING ACTIONS ====================

  const packItem = useCallback(async (orderId: string, productId: string) => {
    if (!state.session) return;

    try {
      await warehouseService.updatePackingProgress(state.session.id, orderId, productId);
      // Reload packing data to get updated state
      await loadPackingData(state.session.id);
    } catch (error: any) {
      console.error('Error packing item:', error);
      toast({
        title: 'Error',
        description: error.message || 'No se pudo empacar el producto',
        variant: 'destructive',
      });
    }
  }, [state.session, toast, loadPackingData]);

  const packAllItems = useCallback(async (orderId: string) => {
    if (!state.session || !state.packingData) return;

    const order = state.packingData.orders.find(o => o.id === orderId);
    if (!order) return;

    // Pack all items that aren't complete yet
    for (const item of order.items) {
      while (item.quantity_packed < item.quantity_needed) {
        await packItem(orderId, item.product_id);
      }
    }
  }, [state.session, state.packingData, packItem]);

  const goToNextOrder = useCallback(() => {
    if (!state.packingData) return;
    const maxIndex = state.packingData.orders.length - 1;
    if (state.currentOrderIndex < maxIndex) {
      updateState({ currentOrderIndex: state.currentOrderIndex + 1 });
    }
  }, [state.packingData, state.currentOrderIndex, updateState]);

  const goToPreviousOrder = useCallback(() => {
    if (state.currentOrderIndex > 0) {
      updateState({ currentOrderIndex: state.currentOrderIndex - 1 });
    }
  }, [state.currentOrderIndex, updateState]);

  const goToOrder = useCallback((index: number) => {
    if (!state.packingData) return;
    if (index >= 0 && index < state.packingData.orders.length) {
      updateState({ currentOrderIndex: index });
    }
  }, [state.packingData, updateState]);

  // ==================== COMPLETION ACTIONS ====================

  const printLabel = useCallback(async (order: OrderForPacking) => {
    try {
      await ordersService.markAsPrinted(order.id);
      if (state.session) {
        await loadPackingData(state.session.id);
      }
      toast({
        title: 'Etiqueta impresa',
        description: `Etiqueta del pedido #${order.order_number} marcada como impresa`,
      });
    } catch (error) {
      console.error('Error marking as printed:', error);
      toast({
        title: 'Error',
        description: 'No se pudo marcar la etiqueta como impresa',
        variant: 'destructive',
      });
    }
  }, [state.session, toast, loadPackingData]);

  const printAllLabels = useCallback(async () => {
    if (!state.packingData) return;

    const ordersToPrint = state.packingData.orders.filter(
      o => o.is_complete && !o.printed && o.delivery_link_token
    );

    for (const order of ordersToPrint) {
      await ordersService.markAsPrinted(order.id);
    }

    if (state.session) {
      await loadPackingData(state.session.id);
    }

    toast({
      title: 'Etiquetas marcadas',
      description: `${ordersToPrint.length} etiquetas marcadas como impresas`,
    });
  }, [state.packingData, state.session, toast, loadPackingData]);

  const completeSession = useCallback(async () => {
    if (!state.session) return;

    updateState({ actionLoading: true });
    try {
      await warehouseService.completeSession(state.session.id);

      updateState({
        currentStep: 'verification',
        actionLoading: false,
      });

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
      updateState({ actionLoading: false });
    }
  }, [state.session, toast, updateState]);

  // ==================== COMPUTED VALUES ====================

  const currentOrder = useMemo(() => {
    if (!state.packingData) return null;
    return state.packingData.orders[state.currentOrderIndex] || null;
  }, [state.packingData, state.currentOrderIndex]);

  const canProceedToPacking = useMemo(() => {
    // This will be computed based on picking list data
    return true; // Placeholder
  }, []);

  const canCompleteSession = useMemo(() => {
    if (!state.packingData) return false;
    return state.packingData.orders.every(o => o.is_complete);
  }, [state.packingData]);

  const unprintedOrders = useMemo(() => {
    if (!state.packingData) return [];
    return state.packingData.orders.filter(
      o => o.is_complete && !o.printed && o.delivery_link_token
    );
  }, [state.packingData]);

  const progress = useMemo(() => {
    const picking = 0;
    let packing = 0;

    if (state.packingData) {
      const totalItems = state.packingData.orders.reduce(
        (sum, o) => sum + o.items.reduce((s, i) => s + i.quantity_needed, 0),
        0
      );
      const packedItems = state.packingData.orders.reduce(
        (sum, o) => sum + o.items.reduce((s, i) => s + i.quantity_packed, 0),
        0
      );
      packing = totalItems > 0 ? (packedItems / totalItems) * 100 : 0;
    }

    const stepProgress: Record<WorkflowStep, number> = {
      selection: 0,
      picking: 25,
      packing: 50 + (packing * 0.4),
      verification: 100,
    };

    return {
      picking,
      packing,
      overall: stepProgress[state.currentStep],
    };
  }, [state.packingData, state.currentStep]);

  // ==================== CONTEXT VALUE ====================

  const value: WarehouseContextValue = {
    ...state,
    progress,

    // Navigation
    goToStep,
    goBack,
    reset,

    // Selection actions
    toggleOrderSelection,
    selectAllOrders,
    clearSelection,

    // Session actions
    createSession,
    resumeSession,

    // Picking actions
    updatePickingQuantity,
    markItemComplete,
    markItemOutOfStock,
    finishPicking,

    // Packing actions
    packItem,
    packAllItems,
    goToNextOrder,
    goToPreviousOrder,
    goToOrder,

    // Completion actions
    printLabel,
    printAllLabels,
    completeSession,

    // Data loading
    loadConfirmedOrders,
    loadActiveSessions,

    // Computed
    currentOrder,
    canProceedToPacking,
    canCompleteSession,
    unprintedOrders,
  };

  return (
    <WarehouseContext.Provider value={value}>
      {children}
    </WarehouseContext.Provider>
  );
}

export function useWarehouse() {
  const context = useContext(WarehouseContext);
  if (!context) {
    throw new Error('useWarehouse must be used within a WarehouseProvider');
  }
  return context;
}
