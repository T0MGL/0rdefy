import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { OrderQuickView } from '@/components/OrderQuickView';
import { OrdersCalendar } from '@/components/OrdersCalendar';
import { OrderForm } from '@/components/forms/OrderForm';
import { ExportButton } from '@/components/ExportButton';
import { OrderConfirmationDialog } from '@/components/OrderConfirmationDialog';
import { TableSkeleton } from '@/components/skeletons/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { FirstTimeWelcomeBanner } from '@/components/FirstTimeTooltip';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FilterChips } from '@/components/FilterChips';
import { ordersService } from '@/services/orders.service';
import { productsService } from '@/services/products.service';
import { useCarriers } from '@/hooks/useCarriers';
import { useDebounce } from '@/hooks/useDebounce';
import { useSmartPolling } from '@/hooks/useSmartPolling';
import { useUndoRedo } from '@/hooks/useUndoRedo';
import { useDateRange } from '@/contexts/DateRangeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useHighlight } from '@/hooks/useHighlight';
import * as warehouseService from '@/services/warehouse.service';
import { Order } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ordersExportColumns } from '@/utils/exportConfigs';
import { formatCurrency } from '@/utils/currency';
import { showErrorToast } from '@/utils/errorMessages';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, Filter, Eye, Phone, Calendar as CalendarIcon, List, CheckCircle, XCircle, Plus, ShoppingCart, Edit, Trash2, Printer, Check, RefreshCw, Package2, Package, Loader2, PackageOpen, MessageSquare, Truck, RotateCcw, AlertTriangle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { DeliveryAttemptsPanel } from '@/components/DeliveryAttemptsPanel';
import { printBatchLabelsPDF } from '@/components/printing/printLabelPDF';

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

const statusLabels: Record<string, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmado',
  in_preparation: 'En Preparación',
  ready_to_ship: 'Preparado',
  shipped: 'Despachado',
  in_transit: 'En Tránsito',
  delivered: 'Entregado',
  returned: 'Devuelto',
  cancelled: 'Cancelado',
  rejected: 'Rechazado',
  incident: 'Incidencia',
};

// Component to display product thumbnails with tooltips
const ProductThumbnails = memo(({ order }: { order: Order }) => {
  // Check if we have line items with products
  const lineItems = order.order_line_items || [];

  if (lineItems.length === 0) {
    // Fallback to old product field
    return <span className="text-sm truncate max-w-[200px]">{order.product}</span>;
  }

  // Show first 3 products as thumbnails
  const visibleItems = lineItems.slice(0, 3);
  const remainingCount = lineItems.length - 3;

  return (
    <TooltipProvider>
      <div className={`flex items-center gap-1 ${lineItems.length === 1 ? 'justify-center' : ''}`}>
        {visibleItems.map((item, index) => {
          // Try image_url directly on line_item first (new), fallback to products relation (old)
          const productImage = item.image_url || item.products?.image_url;
          const productName = item.product_name;
          const quantity = item.quantity;

          return (
            <Tooltip key={item.id || index}>
              <TooltipTrigger asChild>
                <div className="relative group cursor-pointer">
                  {productImage ? (
                    <img
                      src={productImage}
                      alt={productName}
                      className="w-8 h-8 rounded object-cover border border-border group-hover:ring-2 group-hover:ring-primary transition-all"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded bg-muted border border-border flex items-center justify-center group-hover:ring-2 group-hover:ring-primary transition-all">
                      <Package size={16} className="text-muted-foreground" />
                    </div>
                  )}
                  {quantity > 1 && (
                    <div className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-semibold">
                      {quantity}
                    </div>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-medium">{productName}</p>
                {item.variant_title && (
                  <p className="text-xs text-muted-foreground">{item.variant_title}</p>
                )}
                <p className="text-xs">Cantidad: {quantity}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
        {remainingCount > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="w-8 h-8 rounded bg-muted border border-border flex items-center justify-center text-xs font-medium cursor-pointer hover:ring-2 hover:ring-primary transition-all">
                +{remainingCount}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-medium">{remainingCount} producto{remainingCount > 1 ? 's' : ''} más</p>
              {lineItems.slice(3).map((item, idx) => (
                <p key={idx} className="text-xs">
                  • {item.product_name} ({item.quantity})
                </p>
              ))}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
});

export default function Orders() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentStore, user } = useAuth();
  const { hasFeature } = useSubscription();
  const userRole = user?.role || 'viewer'; // Default to viewer if no role

  // Plan-based feature checks
  const hasWarehouseFeature = hasFeature('warehouse');
  const { getDateRange } = useDateRange();
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Pagination state
  const [pagination, setPagination] = useState({
    total: 0,
    limit: 50,
    offset: 0,
    hasMore: false
  });
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Use centralized carriers hook with caching
  const { carriers, getCarrierName } = useCarriers();
  const [search, setSearch] = useState('');
  const [chipFilters, setChipFilters] = useState<Record<string, any>>({});
  const [carrierFilter, setCarrierFilter] = useState('all');
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
  // Selection state
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  // Permanent delete confirmation
  const [permanentDeleteDialogOpen, setPermanentDeleteDialogOpen] = useState(false);
  const [orderToPermanentDelete, setOrderToPermanentDelete] = useState<string | null>(null);

  // Printing feedback
  const [isPrinting, setIsPrinting] = useState(false);
  const [printingOrderId, setPrintingOrderId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { executeAction } = useUndoRedo({ toastDuration: 5000 });
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

  // Use ref for dateParams to avoid recreating queryFn on every dateParams change
  const dateParamsRef = useRef(dateParams);
  useEffect(() => {
    dateParamsRef.current = dateParams;
  }, [dateParams]);

  // Use ref for toast to keep queryFn stable
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  // Smart polling - only polls when page is visible
  // queryFn uses refs to remain stable and prevent memory leaks
  const { refetch } = useSmartPolling({
    queryFn: useCallback(async () => {
      const result = await ordersService.getAll({
        ...dateParamsRef.current,
        limit: 50,
        offset: 0
      });
      const data = result.data;
      const paginationData = result.pagination;

      // Check for new orders
      if (data.length > previousCountRef.current && previousCountRef.current > 0) {
        const newOrdersCount = data.length - previousCountRef.current;
        toastRef.current({
          title: `🔔 ${newOrdersCount} Nuevo${newOrdersCount > 1 ? 's' : ''} Pedido${newOrdersCount > 1 ? 's' : ''}!`,
          description: `Tienes ${newOrdersCount} nuevo${newOrdersCount > 1 ? 's' : ''} pedido${newOrdersCount > 1 ? 's' : ''}`,
        });
      }

      setOrders(data);
      setPagination(paginationData);
      previousCountRef.current = data.length;
      setIsLoading(false);
      return data;
    }, []), // No dependencies - uses refs for all external values
    interval: 15000, // Poll every 15 seconds when page is visible
    enabled: true,
    fetchOnMount: true,
  });

  // Load more orders (pagination)
  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || !pagination.hasMore) return;

    setIsLoadingMore(true);
    try {
      const newOffset = pagination.offset + pagination.limit;
      const result = await ordersService.getAll({
        ...dateParams,
        limit: 50,
        offset: newOffset
      });

      // Append new orders to existing ones
      setOrders(prev => [...prev, ...(result.data as Order[])]);
      setPagination(result.pagination);
    } catch (error) {
      console.error('Error loading more orders:', error);
      toast({
        title: 'Error',
        description: 'No se pudieron cargar más pedidos',
        variant: 'destructive'
      });
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, pagination, dateParams, toast]);

  // Refetch when date range changes - reset pagination
  useEffect(() => {
    setPagination(prev => ({ ...prev, offset: 0 }));
    refetch();
  }, [dateParams, refetch]);

  // Process URL query parameters for filtering and navigation from notifications
  useEffect(() => {
    const filter = searchParams.get('filter');
    const sort = searchParams.get('sort');
    const highlightId = searchParams.get('highlight');

    // Apply filter from URL
    if (filter) {
      switch (filter) {
        case 'pending':
          setChipFilters({ status: 'pending' });
          break;
        case 'confirmed':
          setChipFilters({ status: 'confirmed' });
          break;
        case 'shipped':
          setChipFilters({ status: 'shipped' });
          break;
        case 'delivered':
          setChipFilters({ status: 'delivered' });
          break;
        case 'cancelled':
          setChipFilters({ status: 'cancelled' });
          break;
        case 'tomorrow-delivery':
          // This is handled by the calendar view or a special filter
          setViewMode('calendar');
          break;
        default:
          // Unknown filter - clear it
          break;
      }

      // Clean up URL after applying filter (keep highlight if present)
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('filter');
      newParams.delete('sort');
      if (newParams.toString() !== searchParams.toString()) {
        setSearchParams(newParams, { replace: true });
      }
    }

    // Scroll to highlighted order after data loads
    if (highlightId && orders.length > 0) {
      // Check if the order exists
      const orderExists = orders.some(o => o.id === highlightId);
      if (!orderExists) {
        // Order not found - show toast and clean URL
        toast({
          title: 'Pedido no encontrado',
          description: 'El pedido al que intentas acceder ya no existe o fue eliminado.',
          variant: 'destructive',
        });
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('highlight');
        setSearchParams(newParams, { replace: true });
      }
    }
  }, [searchParams, setSearchParams, orders, toast]);

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
        // Update with server response (no flickering - smooth transition)
        setOrders(prev => prev.map(o => (o.id === orderId ? updatedOrder : o)));
        toast({
          title: 'Pedido confirmado',
          description: 'El pedido ha sido confirmado exitosamente',
        });
      } else {
        // Revert optimistic update on failure
        setOrders(prev => prev.map(o => (o.id === orderId ? originalOrder : o)));
        throw new Error('Error al confirmar pedido');
      }
    } catch (error) {
      // Revert optimistic update on error
      setOrders(prev => prev.map(o => (o.id === orderId ? originalOrder : o)));
      showErrorToast(toast, error, {
        module: 'orders',
        action: 'confirm',
        entity: 'pedido',
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
        throw new Error('Error al rechazar pedido');
      }
    } catch (error) {
      // Revert optimistic update on error
      setOrders(prev => prev.map(o => (o.id === orderId ? originalOrder : o)));
      showErrorToast(toast, error, {
        module: 'orders',
        action: 'cancel',
        entity: 'pedido',
      });
    }
  }, [orders, toast]);

  // Helper function to generate WhatsApp confirmation message
  const generateWhatsAppConfirmationLink = useCallback((order: Order) => {
    const storeName = currentStore?.name || 'Nuestra Tienda';
    const lineItems = order.order_line_items || [];

    // Build product list
    let productList = '';
    if (lineItems.length > 0) {
      productList = lineItems.map(item =>
        `- ${item.product_name || item.title}${item.quantity > 1 ? ` (x${item.quantity})` : ''}`
      ).join('\n');
    } else if (order.product) {
      productList = `- ${order.product}${order.quantity > 1 ? ` (x${order.quantity})` : ''}`;
    }

    // Build address
    const address = order.address || 'No especificada';

    const message = `Hola ${order.customer}!

Gracias por tu pedido en *${storeName}*

*Tu pedido:*
${productList}

*Dirección de envío:*
${address}

*Total:* ${formatCurrency(order.total ?? 0)}

Por favor confirma respondiendo *SI* para proceder con tu pedido.`;

    // Clean phone number and create WhatsApp link
    const cleanPhone = order.phone.replace(/\s+/g, '').replace(/[^0-9+]/g, '');
    const whatsappNumber = cleanPhone.startsWith('+') ? cleanPhone.substring(1) : cleanPhone;

    return `https://api.whatsapp.com/send?phone=${whatsappNumber}&text=${encodeURIComponent(message)}`;
  }, [currentStore]);

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
        throw new Error('Error al actualizar estado');
      }
    } catch (error: any) {
      // Revert optimistic update on error
      setOrders(prev => prev.map(o => (o.id === orderId ? originalOrder : o)));

      // Extract detailed error info from backend response
      const errorResponse = error?.response?.data;
      const errorDetails = errorResponse?.details;

      // Pass the backend error details to the error handler
      showErrorToast(toast, error, {
        module: 'orders',
        action: 'update_status',
        entity: 'pedido',
        details: {
          from: errorDetails?.from || originalOrder.status,
          fromLabel: errorDetails?.fromLabel || statusLabels[originalOrder.status],
          to: errorDetails?.to || newStatus,
          toLabel: errorDetails?.toLabel || statusLabels[newStatus],
          message: errorResponse?.message,
          suggestion: errorDetails?.suggestion,
        },
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

      const updatedOrdersResponse = await ordersService.getAll();
      setOrders(updatedOrdersResponse.data || []);
      setDialogOpen(false);

      toast({
        title: '✅ Pedido creado',
        description: 'El pedido ha sido registrado exitosamente.',
      });
    } catch (error) {
      console.error('💥 [ORDERS] Error creating order:', error);
      showErrorToast(toast, error, {
        module: 'orders',
        action: 'create',
        entity: 'pedido',
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
      showErrorToast(toast, error, {
        module: 'orders',
        action: 'update',
        entity: 'pedido',
      });
    }
  }, [orderToEdit, toast]);

  const handleDeleteOrder = useCallback((orderId: string) => {
    // Find the order to check its status
    const order = orders.find(o => o.id === orderId);

    // Block deletion of delivered orders with a clear message
    if (order && order.status === 'delivered') {
      toast({
        title: '❌ No se puede eliminar',
        description: 'Los pedidos entregados no pueden ser eliminados porque ya afectaron el inventario y las métricas de la tienda.',
        variant: 'destructive',
      });
      return;
    }

    // Block deletion of shipped orders
    if (order && order.status === 'shipped') {
      toast({
        title: '❌ No se puede eliminar',
        description: 'Los pedidos despachados no pueden ser eliminados. Espere a que se marquen como entregados o devueltos.',
        variant: 'destructive',
      });
      return;
    }

    setOrderToDelete(orderId);
    setDeleteDialogOpen(true);
  }, [orders, toast]);

  const confirmDelete = useCallback(async () => {
    if (!orderToDelete) return;

    // Owner = hard delete (permanent), collaborators = soft delete
    const isOwner = userRole === 'owner';
    const isPermanent = isOwner;

    try {
      const success = await ordersService.delete(orderToDelete, isPermanent);
      if (success) {
        if (isPermanent) {
          // Hard delete: remove from local state
          setOrders(prev => prev.filter(o => o.id !== orderToDelete));
        }

        // Refresh orders to show updated state
        try {
          await refetch();
        } catch (refetchError) {
          console.warn('Refetch after delete failed:', refetchError);
        }

        setDeleteDialogOpen(false);
        setOrderToDelete(null);

        toast({
          title: isPermanent ? '✅ Pedido eliminado permanentemente' : '✅ Pedido eliminado',
          description: isPermanent
            ? 'El pedido ha sido eliminado de forma permanente.'
            : 'El pedido ha sido marcado como eliminado. Puede restaurarlo desde los filtros.',
        });
      }
    } catch (error: any) {
      console.error('Error deleting order:', error);
      showErrorToast(toast, error, {
        module: 'orders',
        action: 'delete',
        entity: 'pedido',
        details: { status: orders.find(o => o.id === orderToDelete)?.status },
      });
    }
  }, [orderToDelete, toast, refetch, userRole]);

  // Show confirmation dialog for permanent delete
  const handlePermanentDeleteClick = useCallback((orderId: string) => {
    if (userRole !== 'owner') {
      toast({
        title: '❌ Acceso denegado',
        description: 'Solo el owner puede eliminar permanentemente pedidos',
        variant: 'destructive',
      });
      return;
    }
    setOrderToPermanentDelete(orderId);
    setPermanentDeleteDialogOpen(true);
  }, [userRole, toast]);

  // Actually perform permanent delete after confirmation
  const handlePermanentDelete = useCallback(async () => {
    if (!orderToPermanentDelete) return;

    setPermanentDeleteDialogOpen(false);
    const orderId = orderToPermanentDelete;
    setOrderToPermanentDelete(null);

    try {
      const success = await ordersService.delete(orderId, true);
      if (success) {
        // Remove from local state first (optimistic)
        setOrders(prev => prev.filter(o => o.id !== orderId));

        // Try to refetch, but don't fail if it errors
        try {
          await refetch();
        } catch (refetchError) {
          console.warn('Refetch after delete failed, local state already updated:', refetchError);
        }

        toast({
          title: '✅ Pedido eliminado permanentemente',
          description: 'El pedido ha sido eliminado de forma permanente.',
        });
      }
    } catch (error: any) {
      console.error('Error permanently deleting order:', error);
      showErrorToast(toast, error, {
        module: 'orders',
        action: 'permanent_delete',
        entity: 'pedido',
      });
    }
  }, [orderToPermanentDelete, toast, refetch]);

  const handleRestoreOrder = useCallback(async (orderId: string) => {
    try {
      const success = await ordersService.restore(orderId);
      if (success) {
        await refetch();
        toast({
          title: '✅ Pedido restaurado',
          description: 'El pedido ha sido restaurado exitosamente.',
        });
      }
    } catch (error: any) {
      console.error('Error restoring order:', error);
      showErrorToast(toast, error, {
        module: 'orders',
        action: 'restore',
        entity: 'pedido',
      });
    }
  }, [toast, refetch]);

  const handleToggleTest = useCallback(async (orderId: string, isTest: boolean) => {
    try {
      const success = await ordersService.markAsTest(orderId, isTest);
      if (success) {
        await refetch();
        toast({
          title: isTest ? '🧪 Pedido marcado como test' : '✅ Pedido desmarcado como test',
          description: isTest
            ? 'El pedido ahora se mostrará con opacidad reducida'
            : 'El pedido ahora se muestra normalmente',
        });
      }
    } catch (error: any) {
      console.error('Error toggling test status:', error);
      showErrorToast(toast, error, {
        module: 'orders',
        action: 'toggle_test',
        entity: 'pedido',
      });
    }
  }, [toast, refetch]);

  // Quick prepare: Create picking session and redirect to warehouse
  const handleQuickPrepare = useCallback(async (orderId: string) => {
    try {
      toast({
        title: '📦 Creando sesión de picking...',
        description: 'Un momento por favor',
      });

      // Create picking session with this single order
      const session = await warehouseService.createSession([orderId]);

      if (session) {
        toast({
          title: '✅ Sesión creada',
          description: 'Redirigiendo a Almacén...',
        });

        // Redirect to warehouse with session ID (will auto-open picking)
        navigate(`/warehouse?session=${session.id}`);
      }
    } catch (error: any) {
      console.error('Error creating picking session:', error);
      showErrorToast(toast, error, {
        module: 'warehouse',
        action: 'create_session',
        entity: 'sesión de picking',
      });
    }
  }, [toast, navigate]);

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
      showErrorToast(toast, error, {
        module: 'orders',
        action: 'refresh',
        entity: 'lista de pedidos',
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [refetch, toast]);

  // Memoize filtered orders to avoid recalculation on every render
  // Get carriers that have orders (for dropdown filter)
  const carriersWithOrders = useMemo(() => {
    const carrierIdsInOrders = new Set(orders.map(o => o.carrier_id).filter(Boolean));
    return carriers.filter(c => carrierIdsInOrders.has(c.id));
  }, [carriers, orders]);

  const filteredOrders = useMemo(() => {
    return orders.filter(order => {
      // Aplicar filtros de chips (estado del pedido)
      if (chipFilters.status && order.status !== chipFilters.status) return false;

      // Aplicar filtro de transportadora
      if (carrierFilter !== 'all') {
        if (carrierFilter === 'none') {
          // Filtrar pedidos sin transportadora
          if (order.carrier_id) return false;
        } else {
          // Filtrar por transportadora específica
          if (order.carrier_id !== carrierFilter) return false;
        }
      }

      // Aplicar búsqueda de texto
      if (debouncedSearch) {
        const searchLower = debouncedSearch.toLowerCase().trim();
        const searchClean = searchLower.replace('#', ''); // Allow searching "1001" to find "#1001"

        return (
          // Search by Customer Name
          order.customer.toLowerCase().includes(searchLower) ||
          // Search by Phone
          order.phone.includes(debouncedSearch) ||
          // Search by Product Name
          order.product.toLowerCase().includes(searchLower) ||
          // Search by Internal ID (partial match)
          order.id.toLowerCase().includes(searchLower) ||
          // Search by Order Number (ignoring #)
          (order as any).order_number?.toString().toLowerCase().includes(searchClean) ||
          // Search by Shopify Order Name (e.g. "#1001")
          order.shopify_order_name?.toLowerCase().includes(searchClean) ||
          // Search by Shopify Order Number (e.g. "1001")
          order.shopify_order_number?.toString().includes(searchClean) ||
          // Search by Email (if available)
          (order as any).customer_email?.toLowerCase().includes(searchLower)
        );
      }

      return true;
    });
  }, [orders, chipFilters, carrierFilter, debouncedSearch]);

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
      showErrorToast(toast, error, {
        module: 'orders',
        action: 'mark_printed',
        entity: 'pedido',
      });
    }
  }, [toast]);

  const handlePrintLabel = useCallback(async (order: Order) => {
    // Use PDF system directly (same as confirmation dialog)
    try {
      setPrintingOrderId(order.id);
      const { printLabelPDF } = await import('@/components/printing/printLabelPDF');

      const labelData = {
        storeName: currentStore?.name || 'ORDEFY',
        orderNumber: order.shopify_order_name || order.id.substring(0, 8),
        customerName: order.customer,
        customerPhone: order.phone,
        customerAddress: order.address || order.customer_address,
        neighborhood: order.neighborhood,
        addressReference: order.address_reference,
        carrierName: getCarrierName(order.carrier),
        codAmount: order.cod_amount,
        totalPrice: order.total || order.total_price, // Fallback for COD amount
        discountAmount: order.total_discounts, // Discount applied to order
        paymentMethod: order.payment_method,
        paymentGateway: order.payment_gateway, // Most reliable COD indicator from Shopify
        financialStatus: order.financial_status,
        deliveryToken: order.delivery_link_token || '',
        items: order.order_line_items && order.order_line_items.length > 0
          ? order.order_line_items.map((item: any) => ({
            name: item.product_name || item.title,
            quantity: item.quantity,
            price: item.price || item.unit_price,
          }))
          : [{
              name: order.product,
              quantity: order.quantity,
              price: order.total_price ? order.total_price / order.quantity : 0
            }],
      };

      console.log('🏷️ [ORDERS] Label data for single print:', labelData);

      const success = await printLabelPDF(labelData);

      if (success) {
        // Mark as printed and update status
        await handleOrderPrinted(order.id);
      }
    } catch (error) {
      console.error('Error printing label:', error);
      showErrorToast(toast, error, {
        module: 'orders',
        action: 'print_label',
        entity: 'etiqueta',
      });
    } finally {
      setPrintingOrderId(null);
    }
  }, [currentStore, getCarrierName, handleOrderPrinted, toast]);


  const handleBulkPrint = useCallback(async () => {
    const printableOrders = orders.filter(o => selectedOrderIds.has(o.id) && o.delivery_link_token);
    if (printableOrders.length === 0) {
      toast({
        title: 'Sin selección',
        description: 'Selecciona al menos un pedido con token de entrega para imprimir',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsPrinting(true);
      const labelsData = printableOrders.map(order => ({
        storeName: currentStore?.name || 'ORDEFY',
        orderNumber: order.shopify_order_name || order.id.substring(0, 8),
        customerName: order.customer,
        customerPhone: order.phone,
        customerAddress: order.address || order.customer_address,
        neighborhood: order.neighborhood,
        addressReference: order.address_reference,
        carrierName: getCarrierName(order.carrier),
        codAmount: order.cod_amount,
        totalPrice: order.total || order.total_price, // Fallback for COD amount
        discountAmount: order.total_discounts, // Discount applied to order
        paymentMethod: order.payment_method,
        paymentGateway: order.payment_gateway, // Most reliable COD indicator from Shopify
        financialStatus: order.financial_status,
        deliveryToken: order.delivery_link_token || '',
        items: order.order_line_items && order.order_line_items.length > 0
          ? order.order_line_items.map((item: any) => ({
            name: item.product_name || item.title,
            quantity: item.quantity,
            price: item.price || item.unit_price,
          }))
          : [{
              name: order.product,
              quantity: order.quantity,
              price: order.total_price ? order.total_price / order.quantity : 0
            }],
      }));

      console.log('🏷️ [ORDERS] Label data for batch print:', labelsData);

      const success = await printBatchLabelsPDF(labelsData);

      if (success) {
        // Mark all selected orders as printed and update status
        for (const order of printableOrders) {
          try {
            await ordersService.markAsPrinted(order.id);
            await ordersService.updateStatus(order.id, 'in_transit');
          } catch (e) {
            console.error(`Failed to update order ${order.id}:`, e);
          }
        }

        // Refresh local orders state
        const updatedOrdersResponse = await ordersService.getAll();
        setOrders(updatedOrdersResponse.data || []);

        toast({
          title: 'Impresión completada',
          description: `${printableOrders.length} pedidos marcados como en tránsito`,
        });

        setSelectedOrderIds(new Set());
      }
    } catch (error) {
      console.error('Bulk print error:', error);
      showErrorToast(toast, error, {
        module: 'orders',
        action: 'bulk_print',
        entity: 'etiquetas',
      });
    } finally {
      setIsPrinting(false);
    }
  }, [orders, selectedOrderIds, currentStore, getCarrierName, toast]);

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
    <div className="space-y-4">
      {/* First-time Welcome Banner */}
      <FirstTimeWelcomeBanner
        moduleId="orders"
        title="¡Bienvenido a Pedidos!"
        description="Aquí gestionas todas tus ventas. Puedes crear, confirmar, preparar y dar seguimiento a cada pedido."
        tips={['Usa filtros para encontrar pedidos', 'Imprime etiquetas en lote', 'Confirma por WhatsApp']}
      />

      {/* Header with Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Pedidos</h2>
          <div className="flex items-center gap-3">
            <p className="text-muted-foreground">
              {filteredOrders.length} pedidos{pagination.total > orders.length && ` (${pagination.total} en total)`}
            </p>
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

        {/* Actions - Right (aligned with title) */}
        <div className="flex items-center gap-2">
          {selectedOrderIds.size > 0 && (
            <Button
              variant="default"
              onClick={handleBulkPrint}
              disabled={isPrinting}
              className="gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
            >
              {isPrinting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Imprimiendo etiquetas...
                </>
              ) : (
                <>
                  <Printer size={18} />
                  Imprimir Seleccionados ({selectedOrderIds.size})
                </>
              )}
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
              placeholder="Buscar por cliente, email, producto, ID o # de orden..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={carrierFilter} onValueChange={setCarrierFilter}>
            <SelectTrigger className="w-full md:w-48">
              <SelectValue placeholder="Transportadora" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las transportadoras</SelectItem>
              <SelectItem value="none">Sin transportadora</SelectItem>
              {carriersWithOrders.map(carrier => (
                <SelectItem key={carrier.id} value={carrier.id}>
                  {carrier.name}
                </SelectItem>
              ))}
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
            {pagination.total > orders.length && ` de ${pagination.total}`}
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
                      Siguiente Paso
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
                  {filteredOrders.map((order) => {
                    const isDeleted = !!order.deleted_at;
                    const isTest = !!order.is_test;
                    const rowOpacity = isDeleted || isTest ? 'opacity-40' : '';

                    return (
                    <tr
                      key={order.id}
                      id={`item-${order.id}`}
                      className={`border-t border-border hover:bg-muted/30 transition-all ${rowOpacity} ${isHighlighted(order.id)
                        ? 'bg-yellow-100 dark:bg-yellow-900/30 ring-2 ring-yellow-400 dark:ring-yellow-500'
                        : ''
                        }`}
                    >
                      <td className="py-4 px-3 text-center">
                        {order.delivery_link_token && !isDeleted ? (
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
                        <div className="flex items-center gap-2 flex-wrap">
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
                          {isDeleted && (
                            <Badge
                              variant="outline"
                              className="bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-300 dark:border-red-800 text-xs px-1.5 py-0"
                            >
                              Eliminado
                            </Badge>
                          )}
                          {isTest && !isDeleted && (
                            <Badge
                              variant="outline"
                              className="bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-800 text-xs px-1.5 py-0"
                            >
                              Test
                            </Badge>
                          )}
                          {order.payment_gateway && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge
                                  variant="outline"
                                  className={`text-xs px-1.5 py-0 cursor-help ${order.payment_gateway === 'cash_on_delivery'
                                    ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800'
                                    : 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800'
                                    }`}
                                >
                                  {order.payment_gateway === 'shopify_payments' ? '💳' :
                                    order.payment_gateway === 'manual' ? '📝' :
                                      order.payment_gateway === 'cash_on_delivery' ? '💵' :
                                        order.payment_gateway === 'paypal' ? 'PP' :
                                          order.payment_gateway === 'mercadopago' ? 'MP' :
                                            '💰'}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="space-y-1">
                                  <p className="font-medium">
                                    {order.payment_gateway === 'shopify_payments' ? 'Pago con Tarjeta (Shopify Payments)' :
                                      order.payment_gateway === 'manual' ? 'Pago Manual' :
                                        order.payment_gateway === 'cash_on_delivery' ? 'Pago Contra Entrega (COD)' :
                                          order.payment_gateway === 'paypal' ? 'PayPal' :
                                            order.payment_gateway === 'mercadopago' ? 'Mercado Pago' :
                                              order.payment_gateway}
                                  </p>
                                  {order.financial_status && (
                                    <p className="text-xs text-muted-foreground">
                                      Estado: {order.financial_status === 'paid' ? 'Pagado' :
                                        order.financial_status === 'pending' ? 'Pendiente' :
                                          order.financial_status === 'authorized' ? 'Autorizado' :
                                            order.financial_status === 'refunded' ? 'Reembolsado' :
                                              order.financial_status}
                                    </p>
                                  )}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <div>
                          <p className="text-sm font-medium">{order.customer}</p>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(order.phone);
                              toast({
                                title: 'Teléfono copiado',
                                description: order.phone,
                              });
                            }}
                            className="text-xs text-muted-foreground hover:text-foreground hover:underline cursor-pointer transition-colors"
                            title="Click para copiar"
                          >
                            {order.phone}
                          </button>
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <ProductThumbnails order={order} />
                      </td>
                      <td className="py-4 px-6 text-center">
                        <Select
                          value={order.status}
                          onValueChange={(newStatus: Order['status']) => handleStatusUpdate(order.id, newStatus)}
                        >
                          <SelectTrigger className={`w-36 h-8 ${statusColors[order.status]}`}>
                            <span className="truncate">{statusLabels[order.status] || order.status}</span>
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
                        {/* Siguiente Paso - Acciones contextuales según el estado */}
                        {order.status === 'pending' && (
                          <div className="flex gap-1 justify-center flex-wrap">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 text-xs bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 border-green-300 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/30 hover:border-green-400 dark:hover:border-green-700 hover:shadow-sm transition-all duration-200"
                                    onClick={() => window.open(generateWhatsAppConfirmationLink(order), '_blank')}
                                  >
                                    <MessageSquare size={14} className="mr-1" />
                                    Enviar
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Enviar mensaje de confirmación por WhatsApp</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/30 hover:border-blue-400 dark:hover:border-blue-700 hover:shadow-sm transition-all duration-200"
                              onClick={() => {
                                // Always show confirmation dialog to assign carrier, zone, upsell, etc.
                                // This is required for dispatch/settlement reconciliation
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
                        {order.status === 'confirmed' && hasWarehouseFeature && (
                          <div className="flex gap-1 justify-center">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-400 border-indigo-300 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 hover:border-indigo-400 dark:hover:border-indigo-700 hover:shadow-sm transition-all duration-200"
                              onClick={() => handleQuickPrepare(order.id)}
                            >
                              <PackageOpen size={14} className="mr-1" />
                              Preparar
                            </Button>
                          </div>
                        )}
                        {order.status === 'confirmed' && !hasWarehouseFeature && (
                          <Badge variant="outline" className={`${statusColors[order.status]} font-medium`}>
                            <CheckCircle size={14} className="mr-1" />
                            Confirmado
                          </Badge>
                        )}
                        {order.status === 'in_preparation' && (
                          <Badge variant="outline" className={`${statusColors[order.status]} font-medium`}>
                            <PackageOpen size={14} className="mr-1" />
                            En Preparación
                          </Badge>
                        )}
                        {order.status === 'ready_to_ship' && hasWarehouseFeature && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs bg-purple-50 dark:bg-purple-950/20 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-800 hover:bg-purple-100 dark:hover:bg-purple-900/30 hover:border-purple-400 dark:hover:border-purple-700 hover:shadow-sm transition-all duration-200"
                            onClick={() => handleStatusUpdate(order.id, 'shipped')}
                          >
                            <Truck size={14} className="mr-1" />
                            Despachar
                          </Button>
                        )}
                        {order.status === 'ready_to_ship' && !hasWarehouseFeature && (
                          <Badge variant="outline" className={`${statusColors[order.status]} font-medium`}>
                            <Package size={14} className="mr-1" />
                            Preparado
                          </Badge>
                        )}
                        {(order.status === 'shipped' || order.status === 'in_transit') && (
                          <Badge variant="outline" className={`${statusColors[order.status]} font-medium`}>
                            <Truck size={14} className="mr-1" />
                            En Camino
                          </Badge>
                        )}
                        {order.status === 'delivered' && (
                          <Badge variant="outline" className={`${statusColors[order.status]} font-medium`}>
                            <CheckCircle size={14} className="mr-1" />
                            Entregado
                          </Badge>
                        )}
                        {order.status === 'returned' && (
                          <Badge variant="outline" className={`${statusColors[order.status]} font-medium`}>
                            <RotateCcw size={14} className="mr-1" />
                            Devuelto
                          </Badge>
                        )}
                        {order.status === 'cancelled' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/30 hover:border-blue-400 dark:hover:border-blue-700 hover:shadow-sm transition-all duration-200"
                            onClick={() => handleStatusUpdate(order.id, 'pending')}
                          >
                            <RefreshCw size={14} className="mr-1" />
                            Reactivar
                          </Button>
                        )}
                        {order.status === 'incident' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs bg-orange-50 dark:bg-orange-950/20 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-800 hover:bg-orange-100 dark:hover:bg-orange-900/30 hover:border-orange-400 dark:hover:border-orange-700 hover:shadow-sm transition-all duration-200"
                            onClick={() => navigate(`/incidents?order=${order.id}`)}
                          >
                            <AlertTriangle size={14} className="mr-1" />
                            Ver Incidencia
                          </Button>
                        )}
                      </td>
                      <td className="py-4 px-6 text-right text-sm font-semibold">
                        <div className="flex flex-col items-end gap-1">
                          <span>{formatCurrency(order.total ?? 0)}</span>
                          {order.has_amount_discrepancy && order.amount_collected !== undefined && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge
                                    variant="outline"
                                    className="bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-700 text-[10px] px-1.5 py-0 cursor-help"
                                  >
                                    <AlertTriangle className="h-3 w-3 mr-1" />
                                    Cobró: {formatCurrency(order.amount_collected)}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="max-w-xs">
                                  <p className="font-medium">Monto Diferente Cobrado</p>
                                  <p className="text-xs text-muted-foreground">
                                    Esperado: {formatCurrency(order.cod_amount ?? order.total ?? 0)}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    Cobrado: {formatCurrency(order.amount_collected)}
                                  </p>
                                  <p className="text-xs mt-1 text-orange-600 dark:text-orange-400">
                                    Diferencia: {formatCurrency(order.amount_collected - (order.cod_amount ?? order.total ?? 0))}
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <div className="flex items-center justify-center gap-1">
                          {/* Botón de impresión siempre primero */}
                          {order.delivery_link_token && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handlePrintLabel(order)}
                              disabled={printingOrderId === order.id}
                              title="Imprimir etiqueta de entrega"
                              className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/20"
                            >
                              {printingOrderId === order.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Printer size={16} />
                              )}
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

                          {/* Quick Prepare button (only for confirmed orders) */}
                          {order.sleeves_status === 'confirmed' && !isDeleted && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleQuickPrepare(order.id)}
                              title="Preparar pedido (Picking & Packing)"
                              className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/20"
                            >
                              <PackageOpen size={16} />
                            </Button>
                          )}

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
                          {isDeleted ? (
                            <>
                              {/* Botones para pedidos eliminados */}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRestoreOrder(order.id)}
                                title="Restaurar pedido"
                                className="text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/20"
                              >
                                <RefreshCw size={16} />
                              </Button>
                              {userRole === 'owner' && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                  onClick={() => handlePermanentDeleteClick(order.id)}
                                  title="Eliminar permanentemente (solo owner)"
                                >
                                  <Trash2 size={16} />
                                </Button>
                              )}
                            </>
                          ) : (
                            <>
                              {/* Botones normales para pedidos activos */}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleToggleTest(order.id, !isTest)}
                                title={isTest ? "Desmarcar como test" : "Marcar como test"}
                                className={isTest ? "text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:hover:bg-orange-950/20" : ""}
                              >
                                <Package size={16} />
                              </Button>
                              {/* No mostrar botón eliminar para pedidos entregados o despachados */}
                              {order.status !== 'delivered' && order.status !== 'shipped' && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                  onClick={() => handleDeleteOrder(order.id)}
                                  title="Eliminar pedido"
                                >
                                  <Trash2 size={16} />
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Load More Button */}
            {pagination.hasMore && (
              <div className="flex justify-center py-4">
                <Button
                  variant="outline"
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className="min-w-[200px]"
                >
                  {isLoadingMore ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Cargando...
                    </>
                  ) : (
                    <>
                      Cargar más ({pagination.total - orders.length} restantes)
                    </>
                  )}
                </Button>
              </div>
            )}
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
            const response = await ordersService.getAll();
            setOrders(response.data || []);
          } catch (error) {
            console.error('Error refreshing orders:', error);
            // Keep optimistic update even if refresh fails
          }
        }}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={userRole === 'owner' ? '⚠️ ¿Eliminar pedido permanentemente?' : '¿Eliminar pedido?'}
        description={userRole === 'owner'
          ? 'Esta acción NO se puede deshacer. El pedido será eliminado PERMANENTEMENTE del sistema junto con todos sus datos asociados.'
          : 'El pedido será marcado como eliminado. Podrás restaurarlo desde los filtros si es necesario.'}
        onConfirm={confirmDelete}
        variant="destructive"
        confirmText={userRole === 'owner' ? 'Eliminar Permanentemente' : 'Eliminar'}
      />

      {/* Permanent Delete Confirmation Dialog */}
      <ConfirmDialog
        open={permanentDeleteDialogOpen}
        onOpenChange={setPermanentDeleteDialogOpen}
        title="⚠️ Eliminación PERMANENTE"
        description="Esta acción NO se puede deshacer. El pedido será eliminado PERMANENTEMENTE del sistema junto con todos sus datos asociados (historial de estados, intentos de entrega, etc.). ¿Estás seguro?"
        onConfirm={handlePermanentDelete}
        variant="destructive"
        confirmText="Eliminar Permanentemente"
        cancelText="Cancelar"
      />
    </div>
  );
}
