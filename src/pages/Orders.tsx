import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { OrderQuickView } from '@/components/OrderQuickView';
import { OrdersCalendar } from '@/components/OrdersCalendar';
import { OrderForm } from '@/components/forms/OrderForm';
import { FollowUpSettings } from '@/components/FollowUpSettings';
import { ExportButton } from '@/components/ExportButton';
import { OrderConfirmationDialog } from '@/components/OrderConfirmationDialog';
import { TableSkeleton } from '@/components/skeletons/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FilterChips } from '@/components/FilterChips';
import { ordersService } from '@/services/orders.service';
import { unifiedService } from '@/services/unified.service';
import { GlobalViewToggle } from '@/components/GlobalViewToggle';
import { productsService } from '@/services/products.service';
import { useCarriers } from '@/hooks/useCarriers';
import { useDebounce } from '@/hooks/useDebounce';
import { useSmartPolling } from '@/hooks/useSmartPolling';
import { useUndoRedo } from '@/hooks/useUndoRedo';
import { useDateRange } from '@/contexts/DateRangeContext';
import { useHighlight } from '@/hooks/useHighlight';
import { Order } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ordersExportColumns } from '@/utils/exportConfigs';
import { formatCurrency } from '@/utils/currency';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, Filter, Eye, Phone, Calendar as CalendarIcon, List, CheckCircle, XCircle, Plus, ShoppingCart, Edit, Trash2, Printer, Check, RefreshCw, Package2 } from 'lucide-react';
import { DeliveryAttemptsPanel } from '@/components/DeliveryAttemptsPanel';
import { OrderShippingLabel } from '@/components/OrderShippingLabel';

const statusColors = {
  pending: 'bg-yellow-50 dark:bg-yellow-950/20 text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-800',
  confirmed: 'bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-800',
  in_preparation: 'bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-400 border-indigo-300 dark:border-indigo-800',
  ready_to_ship: 'bg-cyan-50 dark:bg-cyan-950/20 text-cyan-700 dark:text-cyan-400 border-cyan-300 dark:border-cyan-800',
  shipped: 'bg-purple-50 dark:bg-purple-950/20 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-800',
  in_transit: 'bg-purple-50 dark:bg-purple-950/20 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-800',
  delivered: 'bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 border-green-300 dark:border-green-800',
  returned: 'bg-gray-50 dark:bg-gray-950/20 text-gray-700 dark:text-gray-400 border-gray-300 dark:border-gray-800',
  cancelled: 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 border-red-300 dark:border-red-800',
  incident: 'bg-orange-50 dark:bg-orange-950/20 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-800',
};

const statusLabels = {
  pending: 'Pendiente',
  confirmed: 'Confirmado',
  in_preparation: 'En Preparación',
  ready_to_ship: 'Preparado',
  shipped: 'En Tránsito',
  in_transit: 'En Tránsito',
  delivered: 'Entregado',
  returned: 'Devuelto',
  cancelled: 'Cancelado',
  incident: 'Incidencia',
};

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Global View State
  const [isGlobalView, setIsGlobalView] = useState(false);

  // Use centralized carriers hook with caching
  const { getCarrierName } = useCarriers();
  const [search, setSearch] = useState('');
  const [chipFilters, setChipFilters] = useState<Record<string, any>>({});
  const [confirmationFilter, setConfirmationFilter] = useState('all');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isQuickViewOpen, setIsQuickViewOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'calendar'>('table');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [attemptsDialogOpen, setAttemptsDialogOpen] = useState(false);
  const [selectedOrderForAttempts, setSelectedOrderForAttempts] = useState<Order | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [orderToDelete, setOrderToDelete] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [orderToEdit, setOrderToEdit] = useState<Order | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [orderToConfirm, setOrderToConfirm] = useState<Order | null>(null);
  const [printLabelDialogOpen, setPrintLabelDialogOpen] = useState(false);
  const [orderToPrint, setOrderToPrint] = useState<Order | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [isPrintingBulk, setIsPrintingBulk] = useState(false);
  const [bulkPrintOrders, setBulkPrintOrders] = useState<Order[]>([]);
  const [bulkPrintIndex, setBulkPrintIndex] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { toast } = useToast();
  const { executeAction } = useUndoRedo({ toastDuration: 5000 });
  const { getDateRange } = useDateRange();
  const debouncedSearch = useDebounce(search, 300);
  const { isHighlighted } = useHighlight();
  const previousCountRef = useRef(0);

  // Memoize date params to trigger refetch when date range changes
  const dateParams = useMemo(() => {
    const dateRange = getDateRange();
    return {
      startDate: dateRange.from.toISOString().split('T')[0],
      endDate: dateRange.to.toISOString().split('T')[0],
    };
  }, [getDateRange]);

  // Smart polling - only polls when page is visible
  const { refetch } = useSmartPolling({
    queryFn: useCallback(async () => {
      let data;
      if (isGlobalView) {
        // Fetch unified data and adapt to Order type
        const result = await unifiedService.getOrders({ limit: 50, offset: 0 }); // pagination to be implemented later fully
        data = result.data as unknown as Order[];
      } else {
        data = await ordersService.getAll(dateParams);
      }

      // Check for new orders
      if (data.length > previousCountRef.current && previousCountRef.current > 0) {
        const newOrdersCount = data.length - previousCountRef.current;
        toast({
          title: `🔔 ${newOrdersCount} Nuevo${newOrdersCount > 1 ? 's' : ''} Pedido${newOrdersCount > 1 ? 's' : ''}!`,
          description: `Tienes ${newOrdersCount} nuevo${newOrdersCount > 1 ? 's' : ''} pedido${newOrdersCount > 1 ? 's' : ''}`,
        });
      }

      setOrders(data);
      previousCountRef.current = data.length;
      setIsLoading(false);
      return data;
    }, [dateParams, toast, isGlobalView]), // Add isGlobalView dependency
    interval: 15000, // Poll every 15 seconds when page is visible
    enabled: true,
    fetchOnMount: true,
  });

  // Refetch when date range changes
  useEffect(() => {
    refetch();
  }, [dateParams, refetch]);

  const handleConfirm = useCallback(async (orderId: string) => {
    // Get original order before confirming
    const originalOrder = orders.find(o => o.id === orderId);
    if (!originalOrder) return;

    // Optimistic update - update UI immediately
    setOrders(prev => prev.map(o =>
      o.id === orderId
        ? { ...o, status: 'confirmed', confirmedByWhatsApp: true }
        : o
    ));

    try {
      const updatedOrder = await ordersService.confirm(orderId);
      if (updatedOrder) {
        // Update with server response
        setOrders(prev => prev.map(o => (o.id === orderId ? updatedOrder : o)));
        toast({
          title: 'Pedido confirmado',
          description: 'El pedido ha sido confirmado exitosamente',
        });
      } else {
        // Revert optimistic update on failure
        setOrders(prev => prev.map(o => (o.id === orderId ? originalOrder : o)));
        throw new Error('Failed to confirm order');
      }
    } catch (error) {
      // Revert optimistic update on error
      setOrders(prev => prev.map(o => (o.id === orderId ? originalOrder : o)));
      toast({
        title: 'Error',
        description: 'No se pudo confirmar el pedido',
        variant: 'destructive',
      });
    }
  }, [orders, toast]);

  const handleReject = useCallback(async (orderId: string) => {
    // Get original order before rejecting
    const originalOrder = orders.find(o => o.id === orderId);
    if (!originalOrder) return;

    // Optimistic update - update UI immediately
    setOrders(prev => prev.map(o =>
      o.id === orderId
        ? { ...o, status: 'cancelled', confirmedByWhatsApp: false }
        : o
    ));

    try {
      const updatedOrder = await ordersService.reject(orderId, 'Rechazado manualmente');
      if (updatedOrder) {
        // Update with server response
        setOrders(prev => prev.map(o => (o.id === orderId ? updatedOrder : o)));
        toast({
          title: 'Pedido rechazado',
          description: 'El pedido ha sido rechazado',
        });
      } else {
        // Revert optimistic update on failure
        setOrders(prev => prev.map(o => (o.id === orderId ? originalOrder : o)));
        throw new Error('Failed to reject order');
      }
    } catch (error) {
      // Revert optimistic update on error
      setOrders(prev => prev.map(o => (o.id === orderId ? originalOrder : o)));
      toast({
        title: 'Error',
        description: 'No se pudo rechazar el pedido',
        variant: 'destructive',
      });
    }
  }, [orders, toast]);

  const handleStatusUpdate = useCallback(async (orderId: string, newStatus: Order['status']) => {
    // Get original order before updating
    const originalOrder = orders.find(o => o.id === orderId);
    if (!originalOrder) return;

    // Optimistic update - update UI immediately
    setOrders(prev => prev.map(o =>
      o.id === orderId
        ? { ...o, status: newStatus }
        : o
    ));

    try {
      const updatedOrder = await ordersService.updateStatus(orderId, newStatus);
      if (updatedOrder) {
        // Update with server response
        setOrders(prev => prev.map(o => (o.id === orderId ? updatedOrder : o)));
        toast({
          title: 'Estado actualizado',
          description: `Estado cambiado a ${statusLabels[newStatus]}`,
        });
      } else {
        // Revert optimistic update on failure
        setOrders(prev => prev.map(o => (o.id === orderId ? originalOrder : o)));
        throw new Error('Failed to update status');
      }
    } catch (error) {
      // Revert optimistic update on error
      setOrders(prev => prev.map(o => (o.id === orderId ? originalOrder : o)));
      toast({
        title: 'Error',
        description: 'No se pudo actualizar el estado',
        variant: 'destructive',
      });
    }
  }, [orders, toast]);

  const handleCreateOrder = useCallback(async (data: any) => {
    console.log('🚀 [ORDERS] Creating order with data:', data);

    try {
      const product = await productsService.getById(data.product);
      if (!product) {
        console.error('❌ [ORDERS] Product not found:', data.product);
        return;
      }

      console.log('📦 [ORDERS] Product found:', product.name);

      const newOrder = await ordersService.create({
        customer: data.customer,
        phone: data.phone,
        address: data.address,
        product: product.name,
        product_id: product.id, // ✅ Pass product_id
        quantity: data.quantity,
        total: product.price * data.quantity,
        status: 'pending',
        carrier: data.carrier,
        paymentMethod: data.paymentMethod,
        confirmedByWhatsApp: false,
      } as any);

      console.log('✅ [ORDERS] Order created:', newOrder);

      const updatedOrders = await ordersService.getAll();
      setOrders(updatedOrders);
      setDialogOpen(false);

      toast({
        title: '✅ Pedido creado',
        description: 'El pedido ha sido registrado exitosamente.',
      });
    } catch (error) {
      console.error('💥 [ORDERS] Error creating order:', error);
      toast({
        title: '❌ Error',
        description: 'No se pudo crear el pedido',
        variant: 'destructive',
      });
    }
  }, [toast]);

  const handleEditOrder = useCallback((order: Order) => {
    setOrderToEdit(order);
    setEditDialogOpen(true);
  }, []);

  const handleUpdateOrder = useCallback(async (data: any) => {
    if (!orderToEdit) return;

    try {
      const product = await productsService.getById(data.product);
      if (!product) {
        toast({
          title: '❌ Error',
          description: 'Producto no encontrado',
          variant: 'destructive',
        });
        return;
      }

      const updatedOrder = await ordersService.update(orderToEdit.id, {
        customer: data.customer,
        phone: data.phone,
        address: data.address,
        product: product.name,
        product_id: product.id, // ✅ Pass product_id
        quantity: data.quantity,
        total: product.price * data.quantity,
        carrier: data.carrier,
        paymentMethod: data.paymentMethod,
      } as any);

      if (updatedOrder) {
        setOrders(prev => prev.map(o => (o.id === orderToEdit.id ? updatedOrder : o)));
        setEditDialogOpen(false);
        setOrderToEdit(null);
        toast({
          title: '✅ Pedido actualizado',
          description: 'Los cambios han sido guardados exitosamente.',
        });
      }
    } catch (error) {
      console.error('Error updating order:', error);
      toast({
        title: '❌ Error',
        description: 'No se pudo actualizar el pedido',
        variant: 'destructive',
      });
    }
  }, [orderToEdit, toast]);

  const handleDeleteOrder = useCallback((orderId: string) => {
    setOrderToDelete(orderId);
    setDeleteDialogOpen(true);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!orderToDelete) return;

    try {
      const success = await ordersService.delete(orderToDelete);
      if (success) {
        setOrders(prev => prev.filter(o => o.id !== orderToDelete));
        setDeleteDialogOpen(false);
        setOrderToDelete(null);
        toast({
          title: '✅ Pedido eliminado',
          description: 'El pedido ha sido eliminado exitosamente.',
        });
      } else {
        throw new Error('Failed to delete order');
      }
    } catch (error) {
      console.error('Error deleting order:', error);
      toast({
        title: '❌ Error',
        description: 'No se pudo eliminar el pedido',
        variant: 'destructive',
      });
    }
  }, [orderToDelete, toast]);

  // Manual refresh for impatient users
  const handleManualRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refetch();
      toast({
        title: '✅ Actualizado',
        description: 'Lista de pedidos actualizada',
      });
    } catch (error) {
      console.error('Error refreshing orders:', error);
      toast({
        title: '❌ Error',
        description: 'No se pudo actualizar la lista de pedidos',
        variant: 'destructive',
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [refetch, toast]);

  // Memoize filtered orders to avoid recalculation on every render
  const filteredOrders = useMemo(() => {
    return orders.filter(order => {
      // Aplicar filtros de chips (estado del pedido)
      if (chipFilters.status && order.status !== chipFilters.status) return false;

      // Aplicar filtro de confirmación
      if (confirmationFilter === 'pending' && order.confirmedByWhatsApp) return false;
      if (confirmationFilter === 'confirmed' && !order.confirmedByWhatsApp) return false;

      // Aplicar búsqueda de texto
      if (debouncedSearch) {
        const searchLower = debouncedSearch.toLowerCase();
        return (
          order.id.toLowerCase().includes(searchLower) ||
          order.customer.toLowerCase().includes(searchLower) ||
          order.phone.includes(debouncedSearch) ||
          order.product.toLowerCase().includes(searchLower)
        );
      }

      return true;
    });
  }, [orders, chipFilters, confirmationFilter, debouncedSearch]);

  // Selection handlers
  const handleToggleSelectAll = useCallback(() => {
    if (selectedOrderIds.size === filteredOrders.filter(o => o.delivery_link_token).length) {
      setSelectedOrderIds(new Set());
    } else {
      const printableIds = filteredOrders
        .filter(o => o.delivery_link_token)
        .map(o => o.id);
      setSelectedOrderIds(new Set(printableIds));
    }
  }, [selectedOrderIds, filteredOrders]);

  const handleToggleSelect = useCallback((orderId: string) => {
    setSelectedOrderIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(orderId)) {
        newSet.delete(orderId);
      } else {
        newSet.add(orderId);
      }
      return newSet;
    });
  }, []);

  // Print handlers
  const handlePrintLabel = useCallback(async (order: Order) => {
    setOrderToPrint(order);
    setPrintLabelDialogOpen(true);
  }, []);

  const handleOrderPrinted = useCallback(async (orderId: string) => {
    try {
      // Mark order as printed
      const updatedOrder = await ordersService.markAsPrinted(orderId);
      if (updatedOrder) {
        setOrders(prev => prev.map(o => o.id === orderId ? updatedOrder : o));
      }

      // Update status to in_transit
      const transitOrder = await ordersService.updateStatus(orderId, 'in_transit');
      if (transitOrder) {
        setOrders(prev => prev.map(o => o.id === orderId ? transitOrder : o));
        toast({
          title: 'Pedido en tránsito',
          description: 'El pedido ha sido marcado como en tránsito',
        });
      }
    } catch (error) {
      console.error('Error updating order after print:', error);
      toast({
        title: 'Error',
        description: 'No se pudo actualizar el estado del pedido',
        variant: 'destructive',
      });
    }
  }, [toast]);

  const handleBulkPrint = useCallback(async () => {
    const selectedOrders = orders.filter(o => selectedOrderIds.has(o.id));
    if (selectedOrders.length === 0) {
      toast({
        title: 'Sin selección',
        description: 'Selecciona al menos un pedido para imprimir',
        variant: 'destructive',
      });
      return;
    }

    setBulkPrintOrders(selectedOrders);
    setBulkPrintIndex(0);
    setIsPrintingBulk(true);
  }, [orders, selectedOrderIds, toast]);

  const handleNextBulkPrint = useCallback(async () => {
    // Update current order status to in_transit before moving to next
    const currentOrder = bulkPrintOrders[bulkPrintIndex];
    if (currentOrder) {
      try {
        await ordersService.markAsPrinted(currentOrder.id);
        await ordersService.updateStatus(currentOrder.id, 'in_transit');
        setOrders(prev => prev.map(o =>
          o.id === currentOrder.id
            ? { ...o, status: 'in_transit' }
            : o
        ));
      } catch (error) {
        console.error('Error updating order:', error);
      }
    }

    if (bulkPrintIndex < bulkPrintOrders.length - 1) {
      setBulkPrintIndex(prev => prev + 1);
    } else {
      // Finished bulk printing
      toast({
        title: 'Impresión completada',
        description: `${bulkPrintOrders.length} pedidos marcados como en tránsito`,
      });

      setIsPrintingBulk(false);
      setBulkPrintOrders([]);
      setBulkPrintIndex(0);
      setSelectedOrderIds(new Set());
    }
  }, [bulkPrintIndex, bulkPrintOrders, toast]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card className="p-4">
          <div className="h-12 bg-muted animate-pulse rounded" />
        </Card>
        <TableSkeleton rows={8} columns={8} />
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Pedidos</h2>
            <p className="text-muted-foreground">Gestiona tus pedidos</p>
          </div>
        </div>
        <EmptyState
          icon={ShoppingCart}
          title="No hay pedidos aún"
          description="Comienza creando tu primer pedido para empezar a gestionar tus ventas."
          action={{
            label: 'Crear Primer Pedido',
            onClick: () => {
              console.log('🖱️ [ORDERS] Empty state button clicked');
              setDialogOpen(true);
            },
          }}
        />

        {/* Create Order Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Nuevo Pedido</DialogTitle>
            </DialogHeader>
            <OrderForm
              onSubmit={handleCreateOrder}
              onCancel={() => setDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Pedidos</h2>
          <div className="flex items-center gap-3">
            <p className="text-muted-foreground">{filteredOrders.length} pedidos encontrados</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="gap-2 text-xs h-7 px-2 text-muted-foreground hover:text-foreground"
              title="Actualizar lista de pedidos"
            >
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
            </Button>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        {/* Global View Toggle - Left */}
        <div className="mr-auto">
          <GlobalViewToggle enabled={isGlobalView} onToggle={setIsGlobalView} />
        </div>

        {/* Actions - Right */}
        <div className="flex items-center gap-2">
          {selectedOrderIds.size > 0 && (
            <Button
              variant="default"
              onClick={handleBulkPrint}
              className="gap-2 bg-blue-600 hover:bg-blue-700"
            >
              <Printer size={18} />
              Imprimir {selectedOrderIds.size} etiqueta{selectedOrderIds.size > 1 ? 's' : ''}
            </Button>
          )}

          <ExportButton
            data={filteredOrders}
            filename="pedidos"
            columns={ordersExportColumns}
            title="Reporte de Pedidos - Ordefy"
            variant="outline"
          />
          <Button
            onClick={() => {
              console.log('🖱️ [ORDERS] Button clicked');
              setDialogOpen(true);
            }}
            className="gap-2"
          >
            <Plus size={18} />
            Nuevo Pedido
          </Button>
        </div>
      </div>

      {/* Filtros con chips de estado */}
      <Card className="p-4 space-y-4">
        {/* Chips de filtro rápido por estado */}
        <FilterChips
          storageKey="orders_filters"
          onFilterApply={(filters) => setChipFilters(filters)}
        />

        {/* Barra de búsqueda y filtros adicionales */}
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
            <Input
              placeholder="Buscar por cliente, producto o ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={confirmationFilter} onValueChange={setConfirmationFilter}>
            <SelectTrigger className="w-full md:w-48">
              <SelectValue placeholder="Confirmación" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="pending">Pendientes</SelectItem>
              <SelectItem value="confirmed">Confirmados</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant={viewMode === 'calendar' ? 'default' : 'outline'}
            className="gap-2"
            onClick={() => setViewMode(viewMode === 'table' ? 'calendar' : 'table')}
          >
            {viewMode === 'table' ? <CalendarIcon size={18} /> : <List size={18} />}
            {viewMode === 'table' ? 'Calendario' : 'Tabla'}
          </Button>
        </div>

        {/* Order Counter */}
        <div className="flex items-center gap-2 pt-2 border-t">
          <Package2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Total de pedidos:
          </span>
          <Badge variant="secondary" className="text-sm font-semibold">
            {filteredOrders.length}
          </Badge>
        </div>
      </Card>

      {/* View Toggle */}
      {
        viewMode === 'calendar' ? (
          <OrdersCalendar />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-center py-4 px-3 text-sm font-medium text-muted-foreground w-12">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={handleToggleSelectAll}
                        disabled={filteredOrders.filter(o => o.delivery_link_token).length === 0}
                      >
                        <div className={`h-4 w-4 rounded border-2 flex items-center justify-center transition-colors ${selectedOrderIds.size === filteredOrders.filter(o => o.delivery_link_token).length && selectedOrderIds.size > 0
                          ? 'bg-primary border-primary'
                          : 'border-muted-foreground/40 hover:border-primary'
                          }`}>
                          {selectedOrderIds.size === filteredOrders.filter(o => o.delivery_link_token).length && selectedOrderIds.size > 0 && (
                            <Check size={12} className="text-primary-foreground" />
                          )}
                        </div>
                      </Button>
                    </th>
                    <th className="text-left py-4 px-6 text-sm font-medium text-muted-foreground">
                      ID Pedido
                    </th>
                    {isGlobalView && (
                      <th className="text-left py-4 px-6 text-sm font-medium text-muted-foreground">
                        Tienda
                      </th>
                    )}
                    <th className="text-left py-4 px-6 text-sm font-medium text-muted-foreground">
                      Cliente
                    </th>
                    <th className="text-left py-4 px-6 text-sm font-medium text-muted-foreground">
                      Producto
                    </th>
                    <th className="text-center py-4 px-6 text-sm font-medium text-muted-foreground">
                      Estado
                    </th>
                    <th className="text-left py-4 px-6 text-sm font-medium text-muted-foreground">
                      Transportadora
                    </th>
                    <th className="text-center py-4 px-6 text-sm font-medium text-muted-foreground">
                      Confirmación
                    </th>
                    <th className="text-right py-4 px-6 text-sm font-medium text-muted-foreground">
                      Total
                    </th>
                    <th className="text-center py-4 px-6 text-sm font-medium text-muted-foreground">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => (
                    <tr
                      key={order.id}
                      id={`item-${order.id}`}
                      className={`border-t border-border hover:bg-muted/30 transition-all ${isHighlighted(order.id)
                        ? 'bg-yellow-100 dark:bg-yellow-900/30 ring-2 ring-yellow-400 dark:ring-yellow-500'
                        : ''
                        }`}
                    >
                      <td className="py-4 px-3 text-center">
                        {order.delivery_link_token ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleToggleSelect(order.id)}
                          >
                            <div className={`h-4 w-4 rounded border-2 flex items-center justify-center transition-colors ${selectedOrderIds.has(order.id)
                              ? 'bg-primary border-primary'
                              : 'border-muted-foreground/40 hover:border-primary'
                              }`}>
                              {selectedOrderIds.has(order.id) && (
                                <Check size={12} className="text-primary-foreground" />
                              )}
                            </div>
                          </Button>
                        ) : (
                          <div className="h-8 w-8" />
                        )}
                      </td>
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono">
                            {order.shopify_order_name ||
                              (order.shopify_order_number ? `#${order.shopify_order_number}` : null) ||
                              (order.shopify_order_id ? `SH#${order.shopify_order_id}` : null) ||
                              `OR#${order.id.substring(0, 8)}`}
                          </span>
                          {order.shopify_order_id && (
                            <Badge
                              variant="outline"
                              className="bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-800 text-xs px-1.5 py-0"
                            >
                              Shopify
                            </Badge>
                          )}
                          {order.payment_gateway && (
                            <Badge
                              variant="outline"
                              className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800 text-xs px-1.5 py-0"
                              title={`Gateway: ${order.payment_gateway}`}
                            >
                              {order.payment_gateway === 'shopify_payments' ? '💳' :
                                order.payment_gateway === 'manual' ? '📝' :
                                  order.payment_gateway === 'cash_on_delivery' ? '💵' :
                                    order.payment_gateway === 'paypal' ? 'PP' :
                                      order.payment_gateway === 'mercadopago' ? 'MP' :
                                        '💰'}
                            </Badge>
                          )}
                        </div>
                      </td>
                      {isGlobalView && (
                        <td className="py-4 px-6">
                          {(order as any).store_name && (
                            <Badge variant="outline" className="text-[10px] h-5 bg-blue-50 text-blue-700 border-blue-200">
                              {(order as any).store_name}
                            </Badge>
                          )}
                        </td>
                      )}
                      <td className="py-4 px-6">
                        <div>
                          <p className="text-sm font-medium">{order.customer}</p>
                          <p className="text-xs text-muted-foreground">{order.phone}</p>
                        </div>
                      </td>
                      <td className="py-4 px-6 text-sm">{order.product}</td>
                      <td className="py-4 px-6 text-center">
                        <Select
                          value={order.status}
                          onValueChange={(newStatus: Order['status']) => handleStatusUpdate(order.id, newStatus)}
                        >
                          <SelectTrigger className={`w-36 h-8 ${statusColors[order.status]}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending">Pendiente</SelectItem>
                            <SelectItem value="confirmed">Confirmado</SelectItem>
                            <SelectItem value="in_preparation">En Preparación</SelectItem>
                            <SelectItem value="ready_to_ship">Preparado</SelectItem>
                            <SelectItem value="shipped">En Tránsito</SelectItem>
                            <SelectItem value="delivered">Entregado</SelectItem>
                            <SelectItem value="returned">Devuelto</SelectItem>
                            <SelectItem value="cancelled">Cancelado</SelectItem>
                            <SelectItem value="incident">Incidencia</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="py-4 px-6 text-sm">{getCarrierName(order.carrier)}</td>
                      <td className="py-4 px-6 text-center">
                        {order.confirmedByWhatsApp ? (
                          <Badge variant="outline" className="bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 border-green-300 dark:border-green-800">
                            <CheckCircle size={14} className="mr-1" />
                            Confirmado
                          </Badge>
                        ) : order.status === 'cancelled' || order.status === 'rejected' ? (
                          <Badge variant="outline" className="bg-gray-50 dark:bg-gray-950/20 text-gray-700 dark:text-gray-400 border-gray-300 dark:border-gray-800">
                            <XCircle size={14} className="mr-1" />
                            {order.status === 'cancelled' ? 'Cancelado' : 'Rechazado'}
                          </Badge>
                        ) : (
                          <div className="flex gap-1 justify-center">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 border-green-300 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/30 hover:border-green-400 dark:hover:border-green-700 hover:shadow-sm transition-all duration-200"
                              onClick={() => {
                                setOrderToConfirm(order);
                                setConfirmDialogOpen(true);
                              }}
                            >
                              <CheckCircle size={14} className="mr-1" />
                              Confirmar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 border-red-300 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/30 hover:border-red-400 dark:hover:border-red-700 hover:shadow-sm transition-all duration-200"
                              onClick={() => handleReject(order.id)}
                            >
                              <XCircle size={14} className="mr-1" />
                              Rechazar
                            </Button>
                          </div>
                        )}
                      </td>
                      <td className="py-4 px-6 text-right text-sm font-semibold">
                        {formatCurrency(order.total ?? 0)}
                      </td>
                      <td className="py-4 px-6">
                        <div className="flex items-center justify-center gap-1">
                          {/* Botón de impresión siempre primero */}
                          {order.delivery_link_token && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setOrderToPrint(order);
                                setPrintLabelDialogOpen(true);
                              }}
                              title="Imprimir etiqueta de entrega"
                              className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/20"
                            >
                              <Printer size={16} />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setSelectedOrder(order);
                              setIsQuickViewOpen(true);
                            }}
                            title="Ver detalles"
                          >
                            <Eye size={16} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEditOrder(order)}
                            title="Editar pedido"
                          >
                            <Edit size={16} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              // Clean phone number: remove spaces and non-numeric chars except +
                              const cleanPhone = order.phone.replace(/\s+/g, '').replace(/[^0-9+]/g, '');
                              // Ensure phone has + prefix for international WhatsApp format
                              const whatsappNumber = cleanPhone.startsWith('+') ? cleanPhone.substring(1) : cleanPhone;
                              window.open(`https://wa.me/${whatsappNumber}`, '_blank');
                            }}
                            title="Contactar por WhatsApp"
                          >
                            <Phone size={16} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setSelectedOrderForAttempts(order);
                              setAttemptsDialogOpen(true);
                            }}
                            title="Ver intentos de entrega"
                          >
                            <Package2 size={16} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleDeleteOrder(order.id)}
                            title="Eliminar pedido"
                          >
                            <Trash2 size={16} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      }

      <OrderQuickView
        order={selectedOrder}
        open={isQuickViewOpen}
        onOpenChange={setIsQuickViewOpen}
        onStatusUpdate={handleStatusUpdate}
      />

      {/* Create Order Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo Pedido</DialogTitle>
          </DialogHeader>
          <OrderForm
            onSubmit={handleCreateOrder}
            onCancel={() => setDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Follow-Up Settings Dialog */}
      <Dialog open={followUpDialogOpen} onOpenChange={setFollowUpDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Configuración de Follow-ups por WhatsApp</DialogTitle>
          </DialogHeader>
          <FollowUpSettings />
        </DialogContent>
      </Dialog>

      {/* Delivery Map Dialog */}
      <Dialog open={mapDialogOpen} onOpenChange={setMapDialogOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Mapa de Entregas</DialogTitle>
          </DialogHeader>
          <div className="h-[600px]">
            <DeliveryMap
              orders={filteredOrders.filter(o => o.latitude && o.longitude)}
              height="100%"
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Delivery Attempts Dialog */}
      <Dialog open={attemptsDialogOpen} onOpenChange={setAttemptsDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Intentos de Entrega</DialogTitle>
          </DialogHeader>
          {selectedOrderForAttempts && (
            <DeliveryAttemptsPanel
              orderId={selectedOrderForAttempts.id}
              orderNumber={selectedOrderForAttempts.id}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Order Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Pedido</DialogTitle>
          </DialogHeader>
          {orderToEdit && (
            <OrderForm
              initialData={{
                customer: orderToEdit.customer,
                phone: orderToEdit.phone,
                address: (orderToEdit as any).address || '',
                product: orderToEdit.product,
                quantity: orderToEdit.quantity,
                carrier: orderToEdit.carrier,
                paymentMethod: (orderToEdit as any).paymentMethod || 'pending',
              }}
              onSubmit={handleUpdateOrder}
              onCancel={() => {
                setEditDialogOpen(false);
                setOrderToEdit(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Order Confirmation Dialog */}
      <OrderConfirmationDialog
        open={confirmDialogOpen}
        onOpenChange={setConfirmDialogOpen}
        order={orderToConfirm}
        onConfirmed={async () => {
          // Optimistic update - mark order as confirmed immediately
          if (orderToConfirm) {
            setOrders(prev => prev.map(o =>
              o.id === orderToConfirm.id
                ? { ...o, status: 'confirmed', confirmedByWhatsApp: true }
                : o
            ));
          }

          // Refresh orders list after confirmation to get full updated data
          try {
            const data = await ordersService.getAll();
            setOrders(data);
          } catch (error) {
            console.error('Error refreshing orders:', error);
            // Keep optimistic update even if refresh fails
          }
        }}
      />

      {/* Print Label Dialog */}
      <Dialog open={printLabelDialogOpen} onOpenChange={setPrintLabelDialogOpen}>
        <DialogContent className="max-w-[950px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Etiqueta de Entrega</DialogTitle>
          </DialogHeader>
          {orderToPrint && orderToPrint.delivery_link_token && (
            <OrderShippingLabel
              orderId={orderToPrint.id}
              deliveryToken={orderToPrint.delivery_link_token}
              customerName={orderToPrint.customer}
              customerPhone={orderToPrint.phone}
              customerAddress={orderToPrint.address || orderToPrint.customer_address}
              addressReference={orderToPrint.address_reference}
              neighborhood={orderToPrint.neighborhood}
              deliveryNotes={orderToPrint.delivery_notes}
              courierName={getCarrierName(orderToPrint.carrier)}
              codAmount={orderToPrint.cod_amount}
              products={[
                {
                  name: orderToPrint.product,
                  quantity: orderToPrint.quantity,
                },
              ]}
              onPrinted={() => handleOrderPrinted(orderToPrint.id)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="¿Eliminar pedido?"
        description="Esta acción no se puede deshacer. El pedido será eliminado permanentemente del sistema."
        onConfirm={confirmDelete}
        variant="destructive"
        confirmText="Eliminar"
      />

      {/* Bulk Print Dialog */}
      <Dialog open={isPrintingBulk} onOpenChange={setIsPrintingBulk}>
        <DialogContent className="max-w-[950px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Impresión Masiva - Etiqueta {bulkPrintIndex + 1} de {bulkPrintOrders.length}
            </DialogTitle>
          </DialogHeader>
          {bulkPrintOrders[bulkPrintIndex] && bulkPrintOrders[bulkPrintIndex].delivery_link_token && (
            <>
              <OrderShippingLabel
                orderId={bulkPrintOrders[bulkPrintIndex].id}
                deliveryToken={bulkPrintOrders[bulkPrintIndex].delivery_link_token}
                customerName={bulkPrintOrders[bulkPrintIndex].customer}
                customerPhone={bulkPrintOrders[bulkPrintIndex].phone}
                customerAddress={bulkPrintOrders[bulkPrintIndex].address || bulkPrintOrders[bulkPrintIndex].customer_address}
                addressReference={bulkPrintOrders[bulkPrintIndex].address_reference}
                neighborhood={bulkPrintOrders[bulkPrintIndex].neighborhood}
                deliveryNotes={bulkPrintOrders[bulkPrintIndex].delivery_notes}
                courierName={getCarrierName(bulkPrintOrders[bulkPrintIndex].carrier)}
                codAmount={bulkPrintOrders[bulkPrintIndex].cod_amount}
                products={[
                  {
                    name: bulkPrintOrders[bulkPrintIndex].product,
                    quantity: bulkPrintOrders[bulkPrintIndex].quantity,
                  },
                ]}
              />
              <div className="flex items-center justify-between pt-4 border-t">
                <div className="text-sm text-muted-foreground">
                  {bulkPrintIndex < bulkPrintOrders.length - 1 ? (
                    <p>Imprime esta etiqueta y haz clic en "Siguiente" para continuar</p>
                  ) : (
                    <p>Esta es la última etiqueta. Haz clic en "Finalizar" para terminar</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsPrintingBulk(false);
                      setBulkPrintOrders([]);
                      setBulkPrintIndex(0);
                      setSelectedOrderIds(new Set());
                    }}
                  >
                    Cancelar
                  </Button>
                  <Button onClick={handleNextBulkPrint}>
                    {bulkPrintIndex < bulkPrintOrders.length - 1 ? 'Siguiente' : 'Finalizar'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div >
  );
}
