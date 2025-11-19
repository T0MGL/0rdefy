import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { OrderQuickView } from '@/components/OrderQuickView';
import { OrdersCalendar } from '@/components/OrdersCalendar';
import { FilterChips } from '@/components/FilterChips';
import { OrderForm } from '@/components/forms/OrderForm';
import { FollowUpSettings } from '@/components/FollowUpSettings';
import { ExportButton } from '@/components/ExportButton';
import { OrderConfirmationDialog } from '@/components/OrderConfirmationDialog';
import { TableSkeleton } from '@/components/skeletons/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ordersService } from '@/services/orders.service';
import { productsService } from '@/services/products.service';
import { useDebounce } from '@/hooks/useDebounce';
import { useSmartPolling } from '@/hooks/useSmartPolling';
import { useUndoRedo } from '@/hooks/useUndoRedo';
import { Order } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ordersExportColumns } from '@/utils/exportConfigs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, Filter, Eye, Phone, Calendar as CalendarIcon, List, CheckCircle, XCircle, Plus, ShoppingCart, MessageSquare, Map, Package2, Edit, Trash2, Printer } from 'lucide-react';
import { DeliveryMap } from '@/components/DeliveryMap';
import { DeliveryAttemptsPanel } from '@/components/DeliveryAttemptsPanel';
import { OrderShippingLabel } from '@/components/OrderShippingLabel';

const statusColors = {
  pending: 'bg-yellow-50 dark:bg-yellow-950/20 text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-800',
  confirmed: 'bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-800',
  in_transit: 'bg-purple-50 dark:bg-purple-950/20 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-800',
  delivered: 'bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 border-green-300 dark:border-green-800',
  cancelled: 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 border-red-300 dark:border-red-800',
};

const statusLabels = {
  pending: 'Pendiente',
  confirmed: 'Confirmado',
  in_transit: 'En Tránsito',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
};

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [confirmationFilter, setConfirmationFilter] = useState('all');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isQuickViewOpen, setIsQuickViewOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'calendar'>('table');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [followUpDialogOpen, setFollowUpDialogOpen] = useState(false);
  const [mapDialogOpen, setMapDialogOpen] = useState(false);
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
  const { toast} = useToast();
  const { executeAction } = useUndoRedo({ toastDuration: 5000 });
  const debouncedSearch = useDebounce(search, 300);
  const previousCountRef = useRef(0);

  // Smart polling - only polls when page is visible
  useSmartPolling({
    queryFn: async () => {
      const data = await ordersService.getAll();

      // Check for new orders
      if (data.length > previousCountRef.current && previousCountRef.current > 0) {
        const newOrdersCount = data.length - previousCountRef.current;
        toast({
          title: `🔔 ${newOrdersCount} Nuevo${newOrdersCount > 1 ? 's' : ''} Pedido${newOrdersCount > 1 ? 's' : ''}!`,
          description: 'Tienes nuevos pedidos',
        });
      }

      setOrders(data);
      previousCountRef.current = data.length;
      setIsLoading(false);
      return data;
    },
    interval: 15000, // Poll every 15 seconds when page is visible
    enabled: true,
    fetchOnMount: true,
  });
  
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

  // Memoize filtered orders to avoid recalculation on every render
  const filteredOrders = useMemo(() => {
    return orders.filter(order => {
      if (statusFilter !== 'all' && order.status !== statusFilter) return false;
      if (confirmationFilter === 'pending' && order.confirmedByWhatsApp) return false;
      if (confirmationFilter === 'confirmed' && !order.confirmedByWhatsApp) return false;

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
  }, [orders, statusFilter, confirmationFilter, debouncedSearch]);

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
      const updatedOrder = await ordersService.markAsPrinted(orderId);
      if (updatedOrder) {
        setOrders(prev => prev.map(o => o.id === orderId ? updatedOrder : o));
        toast({
          title: 'Etiqueta marcada como impresa',
          description: 'El pedido ha sido marcado como impreso',
        });
      }
    } catch (error) {
      console.error('Error marking order as printed:', error);
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
    if (bulkPrintIndex < bulkPrintOrders.length - 1) {
      setBulkPrintIndex(prev => prev + 1);
    } else {
      // Finished bulk printing - mark all as printed
      const orderIds = bulkPrintOrders.map(o => o.id);
      const success = await ordersService.markAsPrintedBulk(orderIds);

      if (success) {
        // Refresh orders to get updated printed status
        const refreshedOrders = await ordersService.getAll();
        setOrders(refreshedOrders);

        toast({
          title: 'Impresión completada',
          description: `${orderIds.length} etiquetas marcadas como impresas`,
        });
      }

      setIsPrintingBulk(false);
      setBulkPrintOrders([]);
      setBulkPrintIndex(0);
      setSelectedOrderIds(new Set());
    }
  }, [bulkPrintIndex, bulkPrintOrders, toast]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <FilterChips 
          storageKey="orders-filters" 
          onFilterApply={(filters) => console.log('Aplicar filtros:', filters)} 
        />
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
          <p className="text-muted-foreground">{filteredOrders.length} pedidos encontrados</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setMapDialogOpen(true)}
            className="gap-2"
          >
            <Map size={18} />
            Ver Mapa
          </Button>
          <Button
            variant="outline"
            onClick={() => setFollowUpDialogOpen(true)}
            className="gap-2"
          >
            <MessageSquare size={18} />
            Follow-ups
          </Button>
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

      <FilterChips 
        storageKey="orders-filters" 
        onFilterApply={(filters) => console.log('Aplicar filtros:', filters)} 
      />

      {/* Filters */}
      <Card className="p-4">
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
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full md:w-48">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              <SelectItem value="pending">Pendiente</SelectItem>
              <SelectItem value="confirmed">Confirmado</SelectItem>
              <SelectItem value="in_transit">En Tránsito</SelectItem>
              <SelectItem value="delivered">Entregado</SelectItem>
              <SelectItem value="cancelled">Cancelado</SelectItem>
            </SelectContent>
          </Select>
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
            variant="outline"
            className="gap-2"
            onClick={() => {
              toast({
                title: "Filtros avanzados",
                description: "Panel de filtros avanzados próximamente disponible.",
              });
            }}
          >
            <Filter size={18} />
            Más filtros
          </Button>
          <Button 
            variant={viewMode === 'calendar' ? 'default' : 'outline'} 
            className="gap-2"
            onClick={() => setViewMode(viewMode === 'table' ? 'calendar' : 'table')}
          >
            {viewMode === 'table' ? <CalendarIcon size={18} /> : <List size={18} />}
            {viewMode === 'table' ? 'Calendario' : 'Tabla'}
          </Button>
        </div>
      </Card>

      {/* View Toggle */}
      {viewMode === 'calendar' ? (
        <OrdersCalendar />
      ) : (
        <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left py-4 px-6 text-sm font-medium text-muted-foreground">
                  ID Pedido
                </th>
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
                <tr key={order.id} className="border-t border-border hover:bg-muted/30 transition-colors">
                  <td className="py-4 px-6 text-sm font-mono">{order.id}</td>
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
                        <SelectItem value="in_transit">En Tránsito</SelectItem>
                        <SelectItem value="delivered">Entregado</SelectItem>
                        <SelectItem value="cancelled">Cancelado</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-4 px-6 text-sm">{order.carrier}</td>
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
                    Gs. {order.total.toLocaleString()}
                  </td>
                  <td className="py-4 px-6">
                    <div className="flex items-center justify-center gap-1">
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
      )}

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
              customerAddress={orderToPrint.address}
              courierName={orderToPrint.carrier}
              products={[
                {
                  name: orderToPrint.product,
                  quantity: orderToPrint.quantity,
                },
              ]}
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
    </div>
  );
}
