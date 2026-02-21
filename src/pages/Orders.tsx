import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { OrderQuickView } from '@/components/OrderQuickView';
import { OrdersCalendar } from '@/components/OrdersCalendar';
import { OrderForm } from '@/components/forms/OrderForm';
import { ExportButton } from '@/components/ExportButton';
import { OrderConfirmationDialog } from '@/components/OrderConfirmationDialog';
import { CarrierAssignmentDialog } from '@/components/CarrierAssignmentDialog';
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
import { ordersExportColumns, createPlanillaTransportadoraColumns } from '@/utils/exportConfigs';
import { formatCurrency } from '@/utils/currency';
import { showErrorToast } from '@/utils/errorMessages';
import { logger } from '@/utils/logger';
import { startOfDayInTimezone, endOfDayInTimezone } from '@/utils/timeUtils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, Filter, Eye, Phone, Calendar as CalendarIcon, CalendarClock, List, CheckCircle, XCircle, Plus, ShoppingCart, Edit, Trash2, Printer, Check, RefreshCw, Package2, Package, Loader2, PackageOpen, MessageSquare, Truck, RotateCcw, AlertTriangle, Store, MoreHorizontal, Star, StickyNote, X } from 'lucide-react';
import { format, isAfter, startOfDay } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { DeliveryAttemptsPanel } from '@/components/DeliveryAttemptsPanel';
import { printBatchLabelsPDF } from '@/components/printing/printLabelPDF';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const statusColors = {
  pending: 'bg-yellow-50 dark:bg-yellow-950/20 text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-800',
  contacted: 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800',
  awaiting_carrier: 'bg-orange-50 dark:bg-orange-950/20 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-800',
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
  contacted: 'Contactado',
  awaiting_carrier: 'Esperando Asignación',
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

// Helper to check if order has active delivery restriction (scheduled for future)
const getScheduledDeliveryInfo = (order: Order): { isScheduled: boolean; date: Date | null; summary: string | null } => {
  const prefs = (order as any).delivery_preferences;
  if (!prefs || !prefs.not_before_date) {
    return { isScheduled: false, date: null, summary: null };
  }

  const notBeforeDate = new Date(prefs.not_before_date);
  const today = startOfDay(new Date());

  if (!isAfter(notBeforeDate, today)) {
    return { isScheduled: false, date: notBeforeDate, summary: null };
  }

  // Build summary
  const parts: string[] = [];
  parts.push(format(notBeforeDate, "dd/MM", { locale: es }));

  if (prefs.preferred_time_slot && prefs.preferred_time_slot !== 'any') {
    const slots: Record<string, string> = { morning: 'Mañana', afternoon: 'Tarde', evening: 'Noche' };
    parts.push(slots[prefs.preferred_time_slot] || prefs.preferred_time_slot);
  }

  return {
    isScheduled: true,
    date: notBeforeDate,
    summary: parts.join(' • ')
  };
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
  const remainingCount = Math.max(0, lineItems.length - 3);

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
                      loading="lazy"
                      decoding="async"
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
  const userRole = currentStore?.role?.toLowerCase() || 'viewer'; // Role is on store, not user

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
  const [scheduledFilter, setScheduledFilter] = useState<'all' | 'scheduled' | 'ready'>('all'); // Filter for scheduled orders
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
  // Carrier assignment dialog (for awaiting_carrier orders)
  const [carrierAssignmentDialogOpen, setCarrierAssignmentDialogOpen] = useState(false);
  const [orderToAssignCarrier, setOrderToAssignCarrier] = useState<Order | null>(null);
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
  const debouncedSearch = useDebounce(search, 500);
  const { isHighlighted } = useHighlight();
  const previousCountRef = useRef(0);
  // AbortController for load-more requests: cancelled when filters/date change to prevent
  // stale paginated data from being appended on top of newly filtered results
  const loadMoreAbortRef = useRef<AbortController | null>(null);

  // Store timezone from preferences (IANA format, e.g., "America/Asuncion")
  const storeTimezone = currentStore?.timezone || 'America/Asuncion';

  // Memoize date params to trigger refetch when date range changes
  // Uses the store's configured timezone for accurate day boundaries
  const dateParams = useMemo(() => {
    const dateRange = getDateRange();
    return {
      startDate: startOfDayInTimezone(dateRange.from, storeTimezone),
      endDate: endOfDayInTimezone(dateRange.to, storeTimezone),
    };
  }, [getDateRange, storeTimezone]);

  // Build server-side filter params (status + carrier + scheduled sent to API for correct pagination)
  const serverFilters = useMemo(() => {
    const filters: { status?: string; carrier_id?: string; search?: string; scheduled_filter?: 'all' | 'scheduled' | 'ready'; timezone?: string } = {};
    if (chipFilters.status) filters.status = chipFilters.status;
    if (carrierFilter !== 'all') filters.carrier_id = carrierFilter;
    if (debouncedSearch && debouncedSearch.length >= 2) filters.search = debouncedSearch;
    if (scheduledFilter !== 'all') {
      filters.scheduled_filter = scheduledFilter;
      // Always send store timezone so backend calculates "today" in the correct local time,
      // not UTC (which can differ by several hours from Paraguay time)
      filters.timezone = storeTimezone;
    }
    return filters;
  }, [chipFilters.status, carrierFilter, debouncedSearch, scheduledFilter, storeTimezone]);

  // Use refs for stable queryFn (avoids recreating polling interval)
  const dateParamsRef = useRef(dateParams);
  useEffect(() => {
    dateParamsRef.current = dateParams;
  }, [dateParams]);

  const serverFiltersRef = useRef(serverFilters);
  useEffect(() => {
    serverFiltersRef.current = serverFilters;
  }, [serverFilters]);

  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const paginationLimitRef = useRef(pagination.limit);
  useEffect(() => {
    paginationLimitRef.current = pagination.limit;
  }, [pagination.limit]);

  // Memoize queryFn to prevent infinite re-renders
  // CRITICAL: This function must be stable to avoid recreating the polling interval
  const queryFn = useCallback(async () => {
    // CRITICAL: When user searches by name/ID, ignore date range to find ANY matching order
    // across all time. If ivan has an order from 2 months ago and you search "ivan", it
    // MUST be found regardless of current date filter. Searching bypasses pagination filters.
    const isSearching = !!serverFiltersRef.current.search;

    const result = await ordersService.getAll({
      ...(isSearching ? {} : dateParamsRef.current),
      ...serverFiltersRef.current,
      limit: paginationLimitRef.current,
      offset: 0
    });
    const data = result.data;
    const paginationData = result.pagination;

    // Check for new orders (only when no filters active to avoid false positives)
    if (!serverFiltersRef.current.status && !serverFiltersRef.current.carrier_id && !serverFiltersRef.current.search) {
      if (data.length > previousCountRef.current && previousCountRef.current > 0) {
        const newOrdersCount = data.length - previousCountRef.current;
        toastRef.current({
          title: `🔔 ${newOrdersCount} Nuevo${newOrdersCount > 1 ? 's' : ''} Pedido${newOrdersCount > 1 ? 's' : ''}!`,
          description: `Tienes ${newOrdersCount} nuevo${newOrdersCount > 1 ? 's' : ''} pedido${newOrdersCount > 1 ? 's' : ''}`,
        });
      }
    }

    setOrders(data);
    setPagination(paginationData);
    previousCountRef.current = data.length;
    setIsLoading(false);
    return data;
  }, []); // Empty deps - uses refs for all values to stay stable

  // Smart polling - only polls when page is visible
  const { refetch } = useSmartPolling({
    queryFn,
    interval: 60000, // Poll every 60 seconds when page is visible (75% reduction in API calls)
    enabled: true,
    fetchOnMount: true,
  });

  // Load more orders (pagination)
  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || !pagination.hasMore) return;

    // Cancel any in-flight load-more from a previous click
    loadMoreAbortRef.current?.abort();
    const abortController = new AbortController();
    loadMoreAbortRef.current = abortController;

    setIsLoadingMore(true);
    try {
      const newOffset = pagination.offset + pagination.limit;
      // CRITICAL: When user searches, ignore date range (same as initial search behavior).
      // Load more must continue searching across all time, not just current date range.
      const isSearching = !!serverFilters.search;

      const result = await ordersService.getAll({
        ...(isSearching ? {} : dateParams),
        ...serverFilters,
        limit: pagination.limit,
        offset: newOffset
      });

      // Abort guard: don't apply if filters changed while this request was in-flight
      if (abortController.signal.aborted) return;

      // Append new orders to existing ones
      setOrders(prev => [...prev, ...(result.data as Order[])]);
      setPagination(result.pagination);
    } catch (error) {
      if (abortController.signal.aborted) return;
      logger.error('Error loading more orders:', error);
      toast({
        title: 'Error',
        description: 'No se pudieron cargar más pedidos',
        variant: 'destructive'
      });
    } finally {
      if (!abortController.signal.aborted) {
        setIsLoadingMore(false);
      }
    }
  }, [isLoadingMore, pagination, dateParams, serverFilters, toast]);

  // Store refetch in ref to avoid including it in effect dependencies
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  // Refetch when date range or server filters change - reset pagination
  // CRITICAL FIX: Call fetch directly with current values instead of relying on refs
  // to avoid race condition where serverFiltersRef.current might not be updated yet.
  // AbortController cancels in-flight requests when filters change again (rapid filter clicks),
  // preventing a slow stale request from overwriting the correct filtered data.
  // Also aborts any pending load-more: its stale paginated data must not be appended to new results.
  useEffect(() => {
    // Kill any in-flight load-more so it doesn't append stale pages on top of new filter results
    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = null;
    setIsLoadingMore(false);

    // Clear selected order IDs — the new filter may show completely different orders,
    // and stale selections would let users accidentally bulk-print/delete invisible orders
    setSelectedOrderIds(new Set());

    const abortController = new AbortController();

    setPagination(prev => ({ ...prev, offset: 0 }));
    previousCountRef.current = 0; // Reset new-order detection when filters change
    setIsLoading(true);

    // CRITICAL: When user searches, ignore date range to find ANY order by name/ID.
    // Otherwise if ivan's orders are from 2 months ago and you're viewing "this week",
    // searching "ivan" returns 0 results. Search must bypass pagination date filters.
    const isSearching = !!serverFilters.search;

    // Fetch directly with current filter values (not refs)
    ordersService.getAll({
      ...(isSearching ? {} : dateParams),
      ...serverFilters,
      limit: paginationLimitRef.current,
      offset: 0
    }).then(result => {
      if (abortController.signal.aborted) return;
      setOrders(result.data);
      setPagination(result.pagination);
      setIsLoading(false);
    }).catch(error => {
      if (abortController.signal.aborted) return;
      logger.error('Error fetching orders:', error);
      setIsLoading(false);
    });

    return () => {
      abortController.abort();
    };
  }, [dateParams, serverFilters]);

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
        case 'awaiting_carrier':
          setChipFilters({ status: 'awaiting_carrier' });
          break;
        case 'confirmed':
          setChipFilters({ status: 'confirmed' });
          break;
        case 'shipped':
        case 'in_transit':
          // 'shipped' is a legacy URL alias — the current status name is 'in_transit'
          setChipFilters({ status: 'in_transit' });
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
    // Store original order for rollback
    let originalOrder: Order | null = null;

    // Optimistic update - update UI immediately
    setOrders(prev => {
      originalOrder = prev.find(o => o.id === orderId) || null;
      if (!originalOrder) return prev;
      return prev.map(o =>
        o.id === orderId
          ? { ...o, status: 'confirmed', confirmedByWhatsApp: true }
          : o
      );
    });

    if (!originalOrder) return;

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
        setOrders(prev => prev.map(o => (o.id === orderId ? originalOrder! : o)));
        throw new Error('Error al confirmar pedido');
      }
    } catch (error) {
      // Revert optimistic update on error
      setOrders(prev => prev.map(o => (o.id === orderId ? originalOrder! : o)));
      showErrorToast(toast, error, {
        module: 'orders',
        action: 'confirm',
        entity: 'pedido',
      });
    }
  }, [toast]);

  const handleReject = useCallback(async (orderId: string) => {
    // Store original order for rollback
    let originalOrder: Order | null = null;

    // Optimistic update - update UI immediately
    setOrders(prev => {
      originalOrder = prev.find(o => o.id === orderId) || null;
      if (!originalOrder) return prev;
      return prev.map(o =>
        o.id === orderId
          ? { ...o, status: 'cancelled', confirmedByWhatsApp: false }
          : o
      );
    });

    if (!originalOrder) return;

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
        setOrders(prev => prev.map(o => (o.id === orderId ? originalOrder! : o)));
        throw new Error('Error al rechazar pedido');
      }
    } catch (error) {
      // Revert optimistic update on error
      setOrders(prev => prev.map(o => (o.id === orderId ? originalOrder! : o)));
      showErrorToast(toast, error, {
        module: 'orders',
        action: 'cancel',
        entity: 'pedido',
      });
    }
  }, [toast]);

  // Handle marking order as contacted (WhatsApp message sent)
  const handleContact = useCallback(async (orderId: string, whatsappLink: string) => {
    // Store original order for rollback
    let originalOrder: Order | null = null;

    // Only update status if order is pending (not if already contacted)
    const orderToUpdate = orders.find(o => o.id === orderId);
    if (!orderToUpdate || orderToUpdate.status !== 'pending') {
      // Just open WhatsApp if not pending
      window.open(whatsappLink, '_blank');
      return;
    }

    // Open WhatsApp first for better UX
    window.open(whatsappLink, '_blank');

    // Optimistic update - update UI immediately
    setOrders(prev => {
      originalOrder = prev.find(o => o.id === orderId) || null;
      if (!originalOrder) return prev;
      return prev.map(o =>
        o.id === orderId
          ? { ...o, status: 'contacted' as Order['status'] }
          : o
      );
    });

    if (!originalOrder) return;

    try {
      const updatedOrder = await ordersService.contact(orderId);
      if (updatedOrder) {
        // Update with server response (no flickering - smooth transition)
        setOrders(prev => prev.map(o => (o.id === orderId ? updatedOrder : o)));
        toast({
          title: 'Mensaje enviado',
          description: 'El pedido ha sido marcado como contactado',
        });
      } else {
        // Revert optimistic update on failure
        setOrders(prev => prev.map(o => (o.id === orderId ? originalOrder! : o)));
      }
    } catch (error) {
      // Revert optimistic update on error
      setOrders(prev => prev.map(o => (o.id === orderId ? originalOrder! : o)));
      // Don't show error - WhatsApp was opened successfully, just status update failed
      console.error('Error updating order status to contacted:', error);
    }
  }, [toast, orders]);

  // Helper function to generate WhatsApp confirmation message
  const generateWhatsAppConfirmationLink = useCallback((order: Order) => {
    const storeName = currentStore?.name || 'Nuestra Tienda';
    const lineItems = order.order_line_items || [];

    // Build product list
    let productList = '';
    if (lineItems.length > 0) {
      productList = lineItems.map(item => {
        const productName = item.product_name || item.title;
        return `${productName}${item.quantity > 1 ? ` – ${item.quantity} unidades` : ''}`;
      }).join('\n');
    } else if (order.product) {
      productList = `${order.product}${order.quantity > 1 ? ` – ${order.quantity} unidades` : ''}`;
    }

    // Build address section - prioritize google_maps_link, then check if address is a Maps link
    const address = order.address || '';
    const googleMapsLink = order.google_maps_link || '';
    const isAddressAMapsLink = address.includes('maps.google.com') || address.includes('goo.gl/maps') || address.includes('maps.app.goo.gl');

    let locationSection: string;
    if (googleMapsLink) {
      locationSection = address ? `📍 Envío: ${address}\n${googleMapsLink}` : `📍 Envío: ${googleMapsLink}`;
    } else if (isAddressAMapsLink) {
      locationSection = `📍 Envío: ${address}`;
    } else if (address) {
      locationSection = `📍 Envío: ${address}\n\n📌 Para coordinar la entrega, por favor envianos tu ubicación exacta (pin de Google Maps) por este chat.`;
    } else {
      locationSection = `📍 Envío: No especificada\n\n📌 Por favor envianos tu dirección y ubicación exacta (pin de Google Maps) para coordinar la entrega.`;
    }

    const message = `Hola *${order.customer}* 👋

Tu pedido en *${storeName}* ya está reservado por unas horas ⏳

🛍 Producto:
${productList}

${locationSection}

💰 Total a pagar:
${formatCurrency(order.total ?? 0)}

Para CONFIRMAR tu pedido y enviarlo lo antes posible, respondé:
👉 *SI*`;

    // Clean phone number and create WhatsApp link
    const cleanPhone = order.phone.replace(/\s+/g, '').replace(/[^0-9+]/g, '');
    const whatsappNumber = cleanPhone.startsWith('+') ? cleanPhone.substring(1) : cleanPhone;

    return `https://api.whatsapp.com/send?phone=${whatsappNumber}&text=${encodeURIComponent(message)}`;
  }, [currentStore]);

  // Follow-up message for re-send on contacted orders that haven't responded
  const generateWhatsAppFollowUpLink = useCallback((order: Order) => {
    const storeName = currentStore?.name || 'Nuestra Tienda';
    const lineItems = order.order_line_items || [];

    let productSummary = '';
    if (lineItems.length > 0) {
      productSummary = lineItems.map(item => {
        const productName = item.product_name || item.title;
        return `${productName}${item.quantity > 1 ? ` (x${item.quantity})` : ''}`;
      }).join(', ');
    } else if (order.product) {
      productSummary = `${order.product}${order.quantity > 1 ? ` (x${order.quantity})` : ''}`;
    }

    const message = `Hola *${order.customer}* 👋

Te escribimos nuevamente de *${storeName}*. Te habíamos contactado por tu pedido y queremos saber si seguís interesado/a.

🛍 ${productSummary}
💰 Total: ${formatCurrency(order.total ?? 0)}

Tu pedido sigue reservado, pero necesitamos tu confirmación para enviarlo 📦

¿Podés respondernos *SI* para confirmar o *NO* si preferís cancelar?

¡Gracias! 🙌`;

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
        // Merge with existing order so UI metadata (e.g. thumbnails) is not lost
        // when backend returns a partial payload on status updates.
        setOrders(prev => prev.map(o => (
          o.id === orderId
            ? {
              ...o,
              ...updatedOrder,
              order_line_items: updatedOrder.order_line_items?.length
                ? updatedOrder.order_line_items
                : o.order_line_items,
            }
            : o
        )));
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

  // Handle internal notes update from QuickView
  const handleNotesUpdate = useCallback((orderId: string, notes: string | null) => {
    setOrders(prev => prev.map(o =>
      o.id === orderId
        ? { ...o, internal_notes: notes, has_internal_notes: !!notes }
        : o
    ));
    // Also update selectedOrder if it's the same order
    setSelectedOrder(prev =>
      prev?.id === orderId
        ? { ...prev, internal_notes: notes, has_internal_notes: !!notes }
        : prev
    );
    toast({
      title: 'Nota guardada',
      description: notes ? 'Nota interna actualizada correctamente' : 'Nota interna eliminada',
    });
  }, [toast]);

  const handleCreateOrder = useCallback(async (data: any) => {
    logger.log('🚀 [ORDERS] Creating order with data:', data);

    try {
      const product = await productsService.getById(data.product);
      if (!product) {
        logger.error('❌ [ORDERS] Product not found:', data.product);
        return;
      }

      logger.log('📦 [ORDERS] Product found:', product.name);

      // Migration 097: Determine price based on variant or product
      const unitPrice = data.variantPrice || product.price;
      const productName = data.variantTitle
        ? `${product.name} - ${data.variantTitle}`
        : product.name;

      logger.log('📦 [ORDERS] Variant info:', {
        variantId: data.variantId,
        variantTitle: data.variantTitle,
        variantPrice: data.variantPrice,
        unitsPerPack: data.unitsPerPack,
        finalPrice: unitPrice
      });

      // Fetch upsell product if provided
      let upsellProduct = null;
      let upsellTotal = 0;
      if (data.upsellProductId) {
        upsellProduct = await productsService.getById(data.upsellProductId);
        if (!upsellProduct) {
          toast({
            title: '❌ Error',
            description: 'Producto de upsell no encontrado',
            variant: 'destructive',
          });
          return;
        }
        // Ensure price is converted to number (may come as string from DB)
        const upsellPrice = Number(upsellProduct.price) || 0;
        const upsellQty = Number(data.upsellQuantity) || 1;
        upsellTotal = upsellPrice * upsellQty;
        logger.log('📦 [ORDERS] Upsell product found:', upsellProduct.name, 'Price:', upsellPrice, 'Qty:', upsellQty, 'Total:', upsellTotal);
      }

      // Calculate total including upsell (ensure all values are numbers)
      const mainProductTotal = Number(unitPrice) * Number(data.quantity);
      const orderTotal = mainProductTotal + upsellTotal;

      logger.log('💰 [ORDERS] Total calculation:', {
        mainProductTotal,
        upsellTotal,
        orderTotal
      });

      const newOrder = await ordersService.create({
        customer: data.customer,
        phone: data.phone,
        address: data.address,
        product: productName,
        product_id: product.id,
        product_sku: product.sku || null, // Migration 098: SKU for fallback mapping
        quantity: data.quantity,
        total: orderTotal,
        status: 'pending',
        carrier: data.isPickup ? undefined : data.carrier,
        paymentMethod: data.paymentMethod,
        confirmedByWhatsApp: false,
        // New shipping fields from OrderForm
        google_maps_link: data.googleMapsLink || null,
        shipping_city: data.shippingCity || null,
        shipping_city_normalized: data.shippingCityNormalized || null,
        delivery_zone: data.deliveryZone || null,
        shipping_cost: data.shippingCost || 0,
        is_pickup: data.isPickup || false,
        // Delivery preferences (scheduling)
        delivery_preferences: data.deliveryPreferences || null,
        // Migration 097: Variant support
        variant_id: data.variantId || null,
        variant_title: data.variantTitle || null,
        units_per_pack: data.unitsPerPack || 1,
        // Internal notes (admin only)
        internal_notes: data.internalNotes || null,
        // Upsell support
        upsell_product_id: data.upsellProductId || null,
        upsell_product_name: upsellProduct?.name || null,
        upsell_product_price: upsellProduct?.price || null,
        upsell_quantity: data.upsellQuantity || 1,
      } as any);

      logger.log('✅ [ORDERS] Order created:', newOrder);

      const updatedOrdersResponse = await ordersService.getAll();
      setOrders(updatedOrdersResponse.data || []);
      setDialogOpen(false);

      toast({
        title: '✅ Pedido creado',
        description: 'El pedido ha sido registrado exitosamente.',
      });
    } catch (error) {
      logger.error('💥 [ORDERS] Error creating order:', error);
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

      // Fetch upsell product if provided
      let upsellProduct = null;
      if (data.upsellProductId) {
        upsellProduct = await productsService.getById(data.upsellProductId);
        if (!upsellProduct) {
          toast({
            title: '❌ Error',
            description: 'Producto de upsell no encontrado',
            variant: 'destructive',
          });
          return;
        }
      }

      // Detect if the main product changed vs. the original order
      const originalMainItem = orderToEdit.order_line_items?.find((item: any) => !item.is_upsell)
        || orderToEdit.order_line_items?.[0];
      const originalProductId = originalMainItem?.product_id;
      const productChanged = data.product !== originalProductId;

      // Preserve original unit price when product didn't change
      // This prevents Shopify/webhook prices from being overwritten by current catalog prices
      let mainUnitPrice: number;
      if (!productChanged && originalMainItem?.unit_price != null) {
        mainUnitPrice = Number(originalMainItem.unit_price);
      } else {
        mainUnitPrice = Number(product.price);
      }
      const mainProductTotal = mainUnitPrice * Number(data.quantity);

      // Same logic for upsell: preserve original price if upsell product didn't change
      const originalUpsellItem = orderToEdit.order_line_items?.find((item: any) => item.is_upsell === true);
      const upsellChanged = data.upsellProductId !== originalUpsellItem?.product_id;
      let upsellUnitPrice = 0;
      if (upsellProduct) {
        if (!upsellChanged && originalUpsellItem?.unit_price != null) {
          upsellUnitPrice = Number(originalUpsellItem.unit_price);
        } else {
          upsellUnitPrice = Number(upsellProduct.price) || 0;
        }
      }
      const upsellQty = Number(data.upsellQuantity) || 1;
      const upsellTotal = upsellProduct ? upsellUnitPrice * upsellQty : 0;
      const orderTotal = mainProductTotal + upsellTotal;

      logger.log('💰 [ORDERS] Update total calculation:', {
        productChanged,
        mainUnitPrice,
        mainProductTotal,
        upsellChanged,
        upsellUnitPrice,
        upsellQty,
        upsellTotal,
        orderTotal
      });

      // Pass mainProductTotal (not orderTotal) — upsell is handled by the separate /upsell endpoint
      // This ensures line_items get the correct unit price (not inflated by upsell)
      const updatedOrder = await ordersService.update(orderToEdit.id, {
        customer: data.customer,
        phone: data.phone,
        address: data.address,
        google_maps_link: data.googleMapsLink,
        product: product.name,
        product_id: product.id,
        quantity: data.quantity,
        total: mainProductTotal,
        carrier: data.carrier,
        paymentMethod: data.paymentMethod,
        // Shipping info
        shipping_city: data.shippingCity,
        shipping_city_normalized: data.shippingCityNormalized,
        is_pickup: data.isPickup,
        // Delivery preferences (scheduling)
        delivery_preferences: data.deliveryPreferences || null,
        // Upsell data
        upsell_product_id: data.upsellProductId,
        upsell_product_name: upsellProduct?.name,
        upsell_product_price: upsellChanged ? upsellProduct?.price : upsellUnitPrice || upsellProduct?.price,
        upsell_quantity: data.upsellQuantity,
        // Internal notes (admin only)
        internal_notes: data.internalNotes || null,
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
      logger.error('Error updating order:', error);
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

    // Test orders can always be deleted regardless of status
    const isTest = order?.is_test === true;

    // Non-test orders that are shipped/in_transit should wait
    if (!isTest && order && (order.status === 'shipped' || order.status === 'in_transit')) {
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
          logger.warn('Refetch after delete failed:', refetchError);
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
      logger.error('Error deleting order:', error);
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
          logger.warn('Refetch after delete failed, local state already updated:', refetchError);
        }

        toast({
          title: '✅ Pedido eliminado permanentemente',
          description: 'El pedido ha sido eliminado de forma permanente.',
        });
      }
    } catch (error: any) {
      logger.error('Error permanently deleting order:', error);
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
      logger.error('Error restoring order:', error);
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
      logger.error('Error toggling test status:', error);
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
      logger.error('Error creating picking session:', error);
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
      logger.error('Error refreshing orders:', error);
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
  // Show all carriers in the dropdown filter (not limited to current results,
  // since server-side filtering would hide carriers not in current result set)
  const carriersForFilter = carriers;

  // ALL filters now server-side (Migration 125) - no client-side filtering needed
  // filteredOrders is now just orders (all filtering done in API)
  const filteredOrders = useMemo(() => {
    return orders;
  }, [orders]);

  // Export filename: StoreName DD.MM.YYYY
  const exportFilename = useMemo(() => {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const safeName = (currentStore?.name || 'Pedidos').replace(/[<>:"/\\|?*]/g, '').trim();
    return `${safeName} ${dd}.${mm}.${yyyy}`;
  }, [currentStore?.name]);

  // Planilla transportadora columns — EMPRESA column uses the store name
  const planillaColumns = useMemo(
    () => createPlanillaTransportadoraColumns(currentStore?.name || 'Empresa'),
    [currentStore?.name]
  );

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

      // IMPORTANT: Only auto-transition to in_transit for plans WITHOUT warehouse/dispatch
      // Plans with warehouse feature use dispatch sessions to control the in_transit transition
      if (!hasWarehouseFeature) {
        // Free plan: simplified flow, print = mark as in transit
        const transitOrder = await ordersService.updateStatus(orderId, 'in_transit');
        if (transitOrder) {
          setOrders(prev => prev.map(o => o.id === orderId ? transitOrder : o));
          toast({
            title: 'Pedido en tránsito',
            description: 'El pedido ha sido marcado como en tránsito',
          });
        }
      } else {
        // Paid plans with warehouse: printing just marks as printed
        // Status transitions are handled by dispatch sessions
        toast({
          title: 'Etiqueta impresa',
          description: 'Usa el sistema de Despacho para enviar los pedidos',
        });
      }
    } catch (error) {
      logger.error('Error updating order after print:', error);
      showErrorToast(toast, error, {
        module: 'orders',
        action: 'mark_printed',
        entity: 'pedido',
      });
    }
  }, [toast, hasWarehouseFeature]);

  const handlePrintLabel = useCallback(async (order: Order) => {
    // Use PDF system directly (same as confirmation dialog)
    try {
      setPrintingOrderId(order.id);
      const { printLabelPDF } = await import('@/components/printing/printLabelPDF');

      const labelData = {
        storeName: currentStore?.name || 'ORDEFY',
        orderNumber: order.shopify_order_name || order.id.substring(0, 8),
        orderDate: order.date ? format(new Date(order.date), "dd/MM/yyyy", { locale: es }) : undefined,
        customerName: order.customer,
        customerPhone: order.phone,
        customerAddress: order.address || order.customer_address,
        city: order.shipping_city,
        neighborhood: order.neighborhood,
        addressReference: order.address_reference,
        carrierName: getCarrierName(order.carrier),
        codAmount: order.cod_amount,
        totalPrice: order.total || order.total_price, // Fallback for COD amount
        discountAmount: order.total_discounts, // Discount applied to order
        paymentMethod: order.payment_method,
        paymentGateway: order.payment_gateway, // Most reliable COD indicator from Shopify
        financialStatus: order.financial_status,
        prepaidMethod: order.prepaid_method, // Manual prepaid: transfer, qr, etc.
        deliveryToken: order.delivery_link_token || '',
        items: order.order_line_items && order.order_line_items.length > 0
          ? order.order_line_items.map((item: any) => ({
            name: item.product_name || item.title,
            quantity: item.quantity,
            price: item.price || item.unit_price,
          }))
          : [{
              name: order.product,
              quantity: order.quantity ?? 1,
              price: (typeof order.total_price === 'number' && !isNaN(order.total_price) && (order.quantity ?? 0) > 0)
                ? order.total_price / (order.quantity ?? 1)
                : 0
            }],
      };

      logger.log('🏷️ [ORDERS] Label data for single print:', labelData);

      const success = await printLabelPDF(labelData);

      if (success) {
        // Mark as printed and update status
        await handleOrderPrinted(order.id);
      }
    } catch (error) {
      logger.error('Error printing label:', error);
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
        orderDate: order.date ? format(new Date(order.date), "dd/MM/yyyy", { locale: es }) : undefined,
        customerName: order.customer,
        customerPhone: order.phone,
        customerAddress: order.address || order.customer_address,
        city: order.shipping_city,
        neighborhood: order.neighborhood,
        addressReference: order.address_reference,
        carrierName: getCarrierName(order.carrier),
        codAmount: order.cod_amount,
        totalPrice: order.total || order.total_price, // Fallback for COD amount
        discountAmount: order.total_discounts, // Discount applied to order
        paymentMethod: order.payment_method,
        paymentGateway: order.payment_gateway, // Most reliable COD indicator from Shopify
        financialStatus: order.financial_status,
        prepaidMethod: order.prepaid_method, // Manual prepaid: transfer, qr, etc.
        deliveryToken: order.delivery_link_token || '',
        items: order.order_line_items && order.order_line_items.length > 0
          ? order.order_line_items.map((item: any) => ({
            name: item.product_name || item.title,
            quantity: item.quantity,
            price: item.price || item.unit_price,
          }))
          : [{
              name: order.product,
              quantity: order.quantity ?? 1,
              price: (typeof order.total_price === 'number' && !isNaN(order.total_price) && (order.quantity ?? 0) > 0)
                ? order.total_price / (order.quantity ?? 1)
                : 0
            }],
      }));

      logger.log('🏷️ [ORDERS] Label data for batch print:', labelsData);

      const success = await printBatchLabelsPDF(labelsData);

      if (!success) {
        // CRITICAL: PDF generation failed - do NOT mark anything
        toast({
          title: '❌ Error generando PDF',
          description: 'No se pudo generar el archivo PDF de etiquetas. No se marcó ningún pedido como impreso.',
          variant: 'destructive',
        });
        return;
      }

      // PDF generated successfully - use atomic bulk endpoint
      logger.log('✅ [ORDERS] PDF generated successfully, marking orders as printed...');

      const result = await ordersService.bulkPrintAndDispatch(
        printableOrders.map(o => o.id)
      );

      // Refresh local orders state
      const updatedOrdersResponse = await ordersService.getAll();
      setOrders(updatedOrdersResponse.data || []);

      // Show detailed feedback based on results
      if (!result.success || result.data.failed > 0) {
        const { succeeded, failed, failures } = result.data;
        const failedOrderNumbers = failures.map(f => f.order_number).join(', ');

        toast({
          title: `⚠️ Impresión parcial (${succeeded}/${succeeded + failed})`,
          description: `Pedidos que FALLARON: ${failedOrderNumbers}. Revisar consola para detalles.`,
          variant: 'destructive',
          duration: 10000, // Longer duration to review
        });

        // Log detailed errors for debugging
        logger.error('🚨 [BULK PRINT] Failures:', failures);
      } else {
        toast({
          title: '✅ Impresión completada',
          description: hasWarehouseFeature
            ? `${result.data.succeeded} etiquetas impresas. Usa el sistema de Despacho para enviar los pedidos.`
            : `${result.data.succeeded} pedidos marcados como listos para despacho`,
        });
      }

      // Only clear selection if ALL succeeded
      if (result.success && result.data.failed === 0) {
        setSelectedOrderIds(new Set());
      }
    } catch (error) {
      logger.error('Bulk print error:', error);
      showErrorToast(toast, error, {
        module: 'orders',
        action: 'bulk_print',
        entity: 'etiquetas',
      });
    } finally {
      setIsPrinting(false);
    }
  }, [orders, selectedOrderIds, currentStore, getCarrierName, toast, hasWarehouseFeature]);

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
              logger.log('🖱️ [ORDERS] Empty state button clicked');
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
            {/* Clear Filters Button - ALWAYS visible, enables clearing even with 0 results */}
            {/* Shows when: status filter OR carrier filter OR search OR scheduled filter is active */}
            {/* This ensures users can ALWAYS clear filters regardless of result count */}
            {(chipFilters.status || carrierFilter !== 'all' || search || scheduledFilter !== 'all') && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setChipFilters({});
                  setCarrierFilter('all');
                  setSearch('');  // Clear search input
                  setScheduledFilter('all');
                }}
                className="gap-2 text-xs h-7 px-3 border-orange-400 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/20"
                title="Limpiar todos los filtros y búsqueda"
              >
                <X size={14} />
                Limpiar Filtros
              </Button>
            )}
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
            filename={exportFilename}
            columns={ordersExportColumns}
            planillaColumns={planillaColumns}
            title={`Reporte de Pedidos - ${currentStore?.name || 'Ordefy'}`}
            variant="outline"
          />
          <Button
            onClick={() => {
              logger.log('🖱️ [ORDERS] Button clicked');
              setDialogOpen(true);
            }}
            className="gap-2"
            data-tour-target="new-order-button"
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

        {/* Filtro de pedidos programados */}
        <div className="flex items-center gap-2 flex-wrap border-t pt-3">
          <span className="text-sm text-muted-foreground mr-2">Programación:</span>
          <Badge
            variant="outline"
            className={`cursor-pointer px-3 py-1.5 text-sm transition-colors ${
              scheduledFilter === 'all'
                ? 'bg-primary/20 text-primary border-primary'
                : 'hover:bg-muted'
            }`}
            onClick={() => setScheduledFilter('all')}
          >
            Todos
          </Badge>
          <Badge
            variant="outline"
            className={`cursor-pointer px-3 py-1.5 text-sm transition-colors ${
              scheduledFilter === 'ready'
                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-400 dark:border-green-700'
                : 'hover:bg-muted'
            }`}
            onClick={() => setScheduledFilter('ready')}
          >
            <Check size={14} className="mr-1.5" />
            Listos para entregar
          </Badge>
          <Badge
            variant="outline"
            className={`cursor-pointer px-3 py-1.5 text-sm transition-colors ${
              scheduledFilter === 'scheduled'
                ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 border-violet-400 dark:border-violet-700'
                : 'hover:bg-muted'
            }`}
            onClick={() => setScheduledFilter('scheduled')}
          >
            <CalendarClock size={14} className="mr-1.5" />
            Programados
          </Badge>
          {scheduledFilter !== 'all' && (
            <span className="text-xs text-muted-foreground ml-2">
              ({filteredOrders.length} pedidos)
            </span>
          )}
        </div>

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
              <SelectItem value="pickup">Retiro en local</SelectItem>
              <SelectItem value="none">Sin transportadora</SelectItem>
              {carriersForFilter.map(carrier => (
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
        ) : filteredOrders.length === 0 ? (
          // No results with active filters
          <Card className="p-12">
            <div className="flex flex-col items-center justify-center text-center space-y-4">
              <div className="rounded-full bg-orange-100 dark:bg-orange-900/20 p-4">
                <Search className="h-8 w-8 text-orange-600 dark:text-orange-400" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">No se encontraron pedidos</h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  {chipFilters.status && `Estado: ${chipFilters.status}`}
                  {carrierFilter !== 'all' && ` • Transportadora seleccionada`}
                  {search && ` • Búsqueda: "${search}"`}
                  {scheduledFilter !== 'all' && ` • Filtro de programación activo`}
                </p>
                <p className="text-xs text-muted-foreground mt-4">Usa el botón "Limpiar Filtros" en la barra superior para limpiar los filtros activos</p>
              </div>
            </div>
          </Card>
        ) : (
          <Card className="overflow-hidden" data-tour-target="orders-table">
            <div className="overflow-x-auto">
              <table className="w-full table-fixed">
                <colgroup>
                  <col className="w-12" />
                  <col className="w-[170px]" />
                  <col className="w-[240px]" />
                  <col className="w-[120px]" />
                  <col className="w-[170px]" />
                  <col className="w-[170px]" />
                  <col className="w-[190px]" />
                  <col className="w-[140px]" />
                  <col className="w-[140px]" />
                </colgroup>
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
                          {!order.shopify_order_id && (order.n8n_sent || order.n8n_processed_at) && (
                            <Badge
                              variant="outline"
                              className="bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-800 text-xs px-1.5 py-0"
                            >
                              WEBHOOK
                            </Badge>
                          )}
                          {!order.shopify_order_id && !order.n8n_sent && !order.n8n_processed_at && (
                            <Badge
                              variant="outline"
                              className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800 text-xs px-1.5 py-0"
                            >
                              ORDEFY
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
                          <p className="text-sm font-medium flex items-center gap-1.5 max-w-[220px]">
                            <span className="truncate">{order.customer}</span>
                            {order.has_internal_notes && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <StickyNote
                                    size={14}
                                    className="text-amber-500 flex-shrink-0 cursor-help"
                                  />
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-xs">
                                  <p className="font-medium text-xs mb-1">Nota interna:</p>
                                  <p className="text-xs whitespace-pre-wrap">{order.internal_notes?.substring(0, 150)}{order.internal_notes && order.internal_notes.length > 150 ? '...' : ''}</p>
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </p>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(order.phone);
                              toast({
                                title: 'Teléfono copiado',
                                description: order.phone,
                              });
                            }}
                            className="block max-w-[220px] truncate text-xs text-muted-foreground hover:text-foreground hover:underline cursor-pointer transition-colors"
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
                            <SelectItem value="contacted">Contactado</SelectItem>
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
                      <td className="py-4 px-6 text-sm whitespace-nowrap">
                        {order.is_pickup ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            <Store size={12} />
                            Retiro en local
                          </span>
                        ) : (
                          getCarrierName(order.carrier)
                        )}
                      </td>
                      <td className="py-4 px-6">
                        {/* Siguiente Paso - Acción principal + dropdown para secundarias */}
                        <div className="flex items-center justify-center gap-1">
                        {order.status === 'pending' && (
                          <>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2.5 text-xs bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 border-green-300 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/30 hover:border-green-400 dark:hover:border-green-700 hover:shadow-sm transition-all duration-200"
                                    onClick={() => handleContact(order.id, generateWhatsAppConfirmationLink(order))}
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
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground">
                                  <MoreHorizontal size={14} />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem
                                  className="text-blue-700 dark:text-blue-400"
                                  onClick={() => {
                                    setOrderToConfirm(order);
                                    setConfirmDialogOpen(true);
                                  }}
                                >
                                  <CheckCircle size={14} className="mr-2" />
                                  Confirmar
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-red-600 dark:text-red-400"
                                  onClick={() => handleReject(order.id)}
                                >
                                  <XCircle size={14} className="mr-2" />
                                  Rechazar
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </>
                        )}
                        {order.status === 'contacted' && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2.5 text-xs bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/30 hover:border-blue-400 dark:hover:border-blue-700 hover:shadow-sm transition-all duration-200"
                              onClick={() => {
                                setOrderToConfirm(order);
                                setConfirmDialogOpen(true);
                              }}
                            >
                              <CheckCircle size={14} className="mr-1" />
                              Confirmar
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground">
                                  <MoreHorizontal size={14} />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem
                                  className="text-amber-700 dark:text-amber-400"
                                  onClick={() => window.open(generateWhatsAppFollowUpLink(order), '_blank')}
                                >
                                  <MessageSquare size={14} className="mr-2" />
                                  Re-enviar WhatsApp
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-red-600 dark:text-red-400"
                                  onClick={() => handleReject(order.id)}
                                >
                                  <XCircle size={14} className="mr-2" />
                                  Rechazar
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </>
                        )}
                        {order.status === 'awaiting_carrier' && (
                          <>
                            {(userRole === 'owner' || userRole === 'admin') ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2.5 text-xs bg-orange-50 dark:bg-orange-950/20 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-800 hover:bg-orange-100 dark:hover:bg-orange-900/30 hover:border-orange-400 dark:hover:border-orange-700 hover:shadow-sm transition-all duration-200"
                                  onClick={() => {
                                    setOrderToAssignCarrier(order);
                                    setCarrierAssignmentDialogOpen(true);
                                  }}
                                >
                                  <Truck size={14} className="mr-1" />
                                  Asignar
                                </Button>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground">
                                      <MoreHorizontal size={14} />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-44">
                                    <DropdownMenuItem
                                      className="text-red-600 dark:text-red-400"
                                      onClick={() => handleReject(order.id)}
                                    >
                                      <XCircle size={14} className="mr-2" />
                                      Rechazar
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </>
                            ) : (
                              <Badge variant="outline" className={`${statusColors.awaiting_carrier} font-medium`}>
                                <Truck size={14} className="mr-1" />
                                Esperando
                              </Badge>
                            )}
                          </>
                        )}
                        {order.status === 'confirmed' && hasWarehouseFeature && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2.5 text-xs bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-400 border-indigo-300 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 hover:border-indigo-400 dark:hover:border-indigo-700 hover:shadow-sm transition-all duration-200"
                            onClick={() => handleQuickPrepare(order.id)}
                          >
                            <PackageOpen size={14} className="mr-1" />
                            Preparar
                          </Button>
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
                            className="h-7 px-2.5 text-xs bg-purple-50 dark:bg-purple-950/20 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-800 hover:bg-purple-100 dark:hover:bg-purple-900/30 hover:border-purple-400 dark:hover:border-purple-700 hover:shadow-sm transition-all duration-200"
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
                          <>
                            <Badge variant="outline" className={`${statusColors[order.status]} font-medium`}>
                              <CheckCircle size={14} className="mr-1" />
                              Entregado
                            </Badge>
                            {order.delivery_rating && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge
                                      variant="outline"
                                      className="bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700 text-[10px] px-1.5 py-0 cursor-help"
                                    >
                                      <Star size={10} className="mr-0.5 fill-amber-500 text-amber-500" />
                                      {order.delivery_rating}/5
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent side="bottom" className="max-w-xs">
                                    <p className="font-medium">Calificación del Cliente</p>
                                    <div className="flex items-center gap-1 mt-1">
                                      {[1, 2, 3, 4, 5].map((star) => (
                                        <Star
                                          key={star}
                                          size={14}
                                          className={star <= order.delivery_rating! ? 'fill-amber-500 text-amber-500' : 'text-gray-300'}
                                        />
                                      ))}
                                    </div>
                                    {order.delivery_rating_comment && (
                                      <p className="text-xs text-muted-foreground mt-2 italic">
                                        "{order.delivery_rating_comment}"
                                      </p>
                                    )}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </>
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
                            className="h-7 px-2.5 text-xs bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/30 hover:border-blue-400 dark:hover:border-blue-700 hover:shadow-sm transition-all duration-200"
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
                            className="h-7 px-2.5 text-xs bg-orange-50 dark:bg-orange-950/20 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-800 hover:bg-orange-100 dark:hover:bg-orange-900/30 hover:border-orange-400 dark:hover:border-orange-700 hover:shadow-sm transition-all duration-200"
                            onClick={() => navigate(`/incidents?order=${order.id}`)}
                          >
                            <AlertTriangle size={14} className="mr-1" />
                            Ver Incidencia
                          </Button>
                        )}
                        </div>
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
                          {/* Acciones principales visibles */}
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

                          {/* Dropdown con más acciones */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" title="Más acciones">
                                <MoreHorizontal size={16} />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              {/* Imprimir etiqueta */}
                              {order.delivery_link_token && (
                                <DropdownMenuItem
                                  onClick={() => handlePrintLabel(order)}
                                  disabled={printingOrderId === order.id}
                                  className="text-blue-600 dark:text-blue-400"
                                >
                                  {printingOrderId === order.id ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  ) : (
                                    <Printer className="mr-2 h-4 w-4" />
                                  )}
                                  Imprimir etiqueta
                                </DropdownMenuItem>
                              )}

                              {/* WhatsApp */}
                              <DropdownMenuItem
                                onClick={() => {
                                  const cleanPhone = order.phone.replace(/\s+/g, '').replace(/[^0-9+]/g, '');
                                  const whatsappNumber = cleanPhone.startsWith('+') ? cleanPhone.substring(1) : cleanPhone;
                                  window.open(`https://wa.me/${whatsappNumber}`, '_blank');
                                }}
                              >
                                <Phone className="mr-2 h-4 w-4" />
                                Contactar WhatsApp
                              </DropdownMenuItem>

                              {/* Quick Prepare - solo para confirmed */}
                              {order.status === 'confirmed' && !isDeleted && (
                                <DropdownMenuItem
                                  onClick={() => handleQuickPrepare(order.id)}
                                  className="text-blue-600 dark:text-blue-400"
                                >
                                  <PackageOpen className="mr-2 h-4 w-4" />
                                  Preparar pedido
                                </DropdownMenuItem>
                              )}

                              {/* Intentos de entrega */}
                              <DropdownMenuItem
                                onClick={() => {
                                  setSelectedOrderForAttempts(order);
                                  setAttemptsDialogOpen(true);
                                }}
                              >
                                <Package2 className="mr-2 h-4 w-4" />
                                Intentos de entrega
                              </DropdownMenuItem>

                              <DropdownMenuSeparator />

                              {isDeleted ? (
                                <>
                                  {/* Opciones para pedidos eliminados */}
                                  <DropdownMenuItem
                                    onClick={() => handleRestoreOrder(order.id)}
                                    className="text-green-600 dark:text-green-400"
                                  >
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                    Restaurar pedido
                                  </DropdownMenuItem>
                                  {userRole === 'owner' && (
                                    <DropdownMenuItem
                                      onClick={() => handlePermanentDeleteClick(order.id)}
                                      className="text-destructive"
                                    >
                                      <Trash2 className="mr-2 h-4 w-4" />
                                      Eliminar permanente
                                    </DropdownMenuItem>
                                  )}
                                </>
                              ) : (
                                <>
                                  {/* Opciones para pedidos activos */}
                                  <DropdownMenuItem
                                    onClick={() => handleToggleTest(order.id, !isTest)}
                                    className={isTest ? "text-orange-600 dark:text-orange-400" : ""}
                                  >
                                    <Package className="mr-2 h-4 w-4" />
                                    {isTest ? "Desmarcar test" : "Marcar como test"}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleDeleteOrder(order.id)}
                                    className="text-destructive"
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Eliminar pedido
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
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
                      Cargar más ({Math.max(0, pagination.total - orders.length)} restantes)
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
        onNotesUpdate={handleNotesUpdate}
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
          {orderToEdit && (() => {
            // Find upsell product from order_line_items (is_upsell = true)
            const upsellItem = orderToEdit.order_line_items?.find((item: any) => item.is_upsell === true);
            // Get main product (first non-upsell item or first item)
            const mainItem = orderToEdit.order_line_items?.find((item: any) => !item.is_upsell) || orderToEdit.order_line_items?.[0];

            return (
              <OrderForm
                initialData={{
                  customer: orderToEdit.customer,
                  phone: orderToEdit.phone,
                  address: (orderToEdit as any).address || orderToEdit.customer_address || '',
                  googleMapsLink: orderToEdit.google_maps_link || '',
                  // Get main product (non-upsell)
                  product: mainItem?.product_id || '',
                  quantity: mainItem?.quantity || orderToEdit.quantity,
                  // Use carrier_id (UUID) instead of carrier name
                  carrier: orderToEdit.carrier_id || '',
                  // Map payment_method: 'cash'/'efectivo' → 'cod', else → 'paid'
                  paymentMethod: (['cash', 'efectivo', 'cod'].includes(orderToEdit.payment_method?.toLowerCase() || '')) ? 'cod' : 'paid',
                  // Shipping info
                  shippingCity: orderToEdit.shipping_city,
                  shippingCityNormalized: orderToEdit.shipping_city_normalized,
                  isPickup: orderToEdit.is_pickup || false,
                  // Delivery preferences (scheduling)
                  deliveryPreferences: (orderToEdit as any).delivery_preferences || null,
                  // Upsell data (if exists)
                  upsellProductId: upsellItem?.product_id || undefined,
                  upsellQuantity: upsellItem?.quantity || undefined,
                  // Internal notes
                  internalNotes: orderToEdit.internal_notes || '',
                }}
                onSubmit={handleUpdateOrder}
                onCancel={() => {
                  setEditDialogOpen(false);
                  setOrderToEdit(null);
                }}
              />
            );
          })()}
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
            logger.error('Error refreshing orders:', error);
            // Keep optimistic update even if refresh fails
          }
        }}
      />

      {/* Carrier Assignment Dialog (for awaiting_carrier orders) */}
      <CarrierAssignmentDialog
        open={carrierAssignmentDialogOpen}
        onOpenChange={setCarrierAssignmentDialogOpen}
        order={orderToAssignCarrier}
        onAssigned={async () => {
          // Optimistic update - mark order as confirmed immediately
          if (orderToAssignCarrier) {
            setOrders(prev => prev.map(o =>
              o.id === orderToAssignCarrier.id
                ? { ...o, status: 'confirmed' }
                : o
            ));
          }

          // Refresh orders list after assignment to get full updated data
          try {
            const response = await ordersService.getAll();
            setOrders(response.data || []);
          } catch (error) {
            logger.error('Error refreshing orders:', error);
          }
        }}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={userRole === 'owner' ? '⚠️ ¿Eliminar pedido permanentemente?' : '¿Eliminar pedido?'}
        description={(() => {
          const order = orders.find(o => o.id === orderToDelete);
          const affectedInventory = order && ['ready_to_ship', 'shipped', 'delivered'].includes(order.status);
          const isTest = order?.is_test === true;

          if (userRole !== 'owner') {
            return 'El pedido será marcado como eliminado. Podrás restaurarlo desde los filtros si es necesario.';
          }

          if (isTest) {
            return 'Esta es una orden de prueba. Será eliminada permanentemente del sistema.';
          }

          if (affectedInventory) {
            return `⚠️ Esta orden está en estado "${order?.status}" y ya afectó el inventario. Al eliminarla, el stock de los productos será RESTAURADO automáticamente. Esta acción NO se puede deshacer.`;
          }

          return 'Esta acción NO se puede deshacer. El pedido será eliminado PERMANENTEMENTE del sistema junto con todos sus datos asociados.';
        })()}
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
