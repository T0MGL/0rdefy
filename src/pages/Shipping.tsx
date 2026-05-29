/**
 * Shipping Page (Wave Dispatch)
 * Manages dispatch of prepared orders to couriers.
 *
 * Two complementary views, both URL-driven so filters survive reloads
 * and links are shareable:
 *   - cards (default): one card per product with aggregated stats. The
 *     operator picks an entire wave (one or more products) and the
 *     toolbar surfaces all batch actions on the selected orders.
 *   - flat: traditional list, controlled by the same product + carrier
 *     filters. Used when the operator needs to see every order one by
 *     one or to drill into the "Mixtos" bucket.
 *
 * The cards view never mixes mono-product and multi-product orders. The
 * "Mixtos" card is always visible separately and links to a filtered
 * flat view; that is the operator's signal that those orders need
 * special attention before dispatch.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Truck,
  Send,
  CheckCircle,
  Package,
  MapPin,
  Phone,
  DollarSign,
  FileText,
  Download,
  FileSpreadsheet,
  ClipboardList,
  LayoutGrid,
  List as ListIcon,
  Filter as FilterIcon,
  X,
  AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { FeatureBlockedPage } from '@/components/FeatureGate';
import { FirstTimeWelcomeBanner } from '@/components/FirstTimeTooltip';
import { onboardingService } from '@/services/onboarding.service';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { OrderListSkeleton } from '@/components/ui/skeleton-matched';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ProductMultiSelect } from '@/components/ProductMultiSelect';
import { DispatchProductCard } from '@/components/dispatch/DispatchProductCard';
import { useToast } from '@/hooks/use-toast';
import { useCarriers } from '@/hooks/useCarriers';
import * as shippingService from '@/services/shipping.service';
import {
  exportDispatchExcel,
  type ReadyToShipOrder,
  type BatchDispatchResponse,
  type DispatchProductSummary,
} from '@/services/shipping.service';
import { printPickListPDF } from '@/components/printing/printPickListPDF';
import { formatCurrency } from '@/utils/currency';
import { logger } from '@/utils/logger';
import { cn } from '@/lib/utils';

type ViewMode = 'cards' | 'flat';

export default function Shipping() {
  const { currentStore } = useAuth();
  const { hasFeature, loading: subscriptionLoading } = useSubscription();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { carriers } = useCarriers({ activeOnly: true });

  const hasWarehouseFeature = hasFeature('warehouse');

  // ----- URL state -----
  const [searchParams, setSearchParams] = useSearchParams();
  const productFilter = useMemo(() => {
    const raw = searchParams.get('products');
    if (!raw) return [] as string[];
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }, [searchParams]);
  const carrierFilter = searchParams.get('carrier') || 'all';
  const view: ViewMode = (searchParams.get('view') === 'flat' ? 'flat' : 'cards');
  const showMixed = searchParams.get('mixed') === 'true';

  const setProductFilter = useCallback((ids: string[]) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (ids.length > 0) next.set('products', ids.join(','));
      else next.delete('products');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setCarrierFilter = useCallback((value: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (value && value !== 'all') next.set('carrier', value);
      else next.delete('carrier');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setView = useCallback((mode: ViewMode) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (mode !== 'cards') next.set('view', mode);
      else next.delete('view');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setShowMixed = useCallback((value: boolean) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (value) next.set('mixed', 'true');
      else next.delete('mixed');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // ----- Local UI state -----
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [selectedSummaryIds, setSelectedSummaryIds] = useState<Set<string>>(new Set());
  const [dispatchDialogOpen, setDispatchDialogOpen] = useState(false);
  const [singleDispatchOrder, setSingleDispatchOrder] = useState<ReadyToShipOrder | null>(null);
  const [dispatchNotes, setDispatchNotes] = useState('');
  const [dispatching, setDispatching] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [printingPickList, setPrintingPickList] = useState(false);

  // ----- Memory-leak prevention -----
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // ----- Data: dispatch summary (cards) -----
  const summaryQuery = useQuery({
    queryKey: ['dispatch-summary'],
    queryFn: shippingService.getDispatchSummary,
    enabled: hasWarehouseFeature,
    staleTime: 30_000,
  });

  // ----- Data: ready-to-ship orders (filtered) -----
  // Mono-product filter happens server-side via product_ids query param.
  // Carrier filter is applied client-side because it is cheap and avoids
  // a refetch when the operator hops between carriers in the same wave.
  const ordersQuery = useQuery({
    queryKey: ['ready-to-ship', productFilter, showMixed],
    queryFn: () =>
      shippingService.getReadyToShipOrders(
        productFilter.length > 0 ? productFilter : undefined,
        productFilter.length === 0 && showMixed ? true : undefined
      ),
    enabled: hasWarehouseFeature,
    staleTime: 15_000,
  });

  const orders = ordersQuery.data || [];
  const summary = summaryQuery.data || [];

  // Apply carrier filter client-side. If `mixed=true`, restrict to orders
  // present in summary.is_mono === false bucket. We do not have the order
  // ids in the summary yet, so we approximate by filtering orders that are
  // multi-line based on carrier; the proper server-side mixed filter is a
  // future enhancement once volume justifies it.
  const filteredOrders = useMemo(() => {
    let next = orders;
    if (carrierFilter !== 'all') {
      next = next.filter(o => o.carrier_id === carrierFilter);
    }
    return next;
  }, [orders, carrierFilter]);

  // ----- Helpers -----
  const refreshAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['ready-to-ship'] });
    queryClient.invalidateQueries({ queryKey: ['dispatch-summary'] });
  }, [queryClient]);

  const toggleOrderSelection = useCallback((orderId: string) => {
    setSelectedOrders(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedOrders(prev => {
      if (prev.size === filteredOrders.length && filteredOrders.length > 0) {
        return new Set();
      }
      return new Set(filteredOrders.map(o => o.id));
    });
  }, [filteredOrders]);

  // Card selection: when the operator clicks "Seleccionar" on a card we
  // both add the product to the URL filter AND mark the card as selected
  // for the toolbar batch action. Cards are not the same as orders.
  const toggleSummarySelect = useCallback((productId: string | null) => {
    if (!productId) return; // Mixtos has no product_id
    const ids = new Set(productFilter);
    if (ids.has(productId)) {
      ids.delete(productId);
    } else {
      ids.add(productId);
    }
    setProductFilter(Array.from(ids));
    setSelectedSummaryIds(new Set(ids));
  }, [productFilter, setProductFilter]);

  // Auto-select all returned orders when the user enters a product in the
  // filter from a card click. This is the wave selection: the operator
  // expects the toolbar to operate on every order matching the chosen
  // products, not to require a second click on each row.
  useEffect(() => {
    if (productFilter.length > 0 && view === 'cards' && filteredOrders.length > 0) {
      setSelectedOrders(new Set(filteredOrders.map(o => o.id)));
    } else if (productFilter.length === 0) {
      setSelectedOrders(new Set());
    }
    // We intentionally only react to the productFilter array length changing
    // and the orders array identity. Selecting/deselecting individual orders
    // inside the wave should not be overridden.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productFilter.join(','), filteredOrders.length, view]);

  const goToMixed = useCallback(() => {
    setView('flat');
    setShowMixed(true);
    setProductFilter([]);
    setSelectedSummaryIds(new Set());
  }, [setProductFilter, setShowMixed, setView]);

  // ----- Subscription guard -----
  if (subscriptionLoading) return null;
  if (!hasWarehouseFeature) return <FeatureBlockedPage feature="warehouse" />;

  // ----- Selection state -----
  const allSelected =
    filteredOrders.length > 0 && selectedOrders.size === filteredOrders.length;
  const hasSelection = selectedOrders.size > 0;
  const totalUnitsInSummary = summary
    .filter(s => s.is_mono)
    .reduce((sum, s) => sum + s.unit_count, 0);

  // ----- Actions -----
  function handleOpenDispatchDialog() {
    if (!hasSelection) {
      toast({
        title: 'Sin seleccion',
        description: 'Selecciona al menos un pedido para despachar',
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

  async function handleGenerateManifest() {
    if (!hasSelection) {
      toast({
        title: 'Sin seleccion',
        description: 'Selecciona al menos un pedido',
        variant: 'destructive',
      });
      return;
    }

    const selectedOrdersList = filteredOrders.filter(o => selectedOrders.has(o.id));
    const carrierName = selectedOrdersList[0]?.carrier_name || 'Transportadora';
    const storeName = currentStore?.name || 'Mi Tienda';

    const { DeliveryManifestGenerator } = await import('@/components/DeliveryManifest');
    await DeliveryManifestGenerator.generate({
      orders: selectedOrdersList,
      carrierName,
      dispatchDate: new Date(),
      storeName,
      notes: dispatchNotes || undefined,
      timezone: currentStore?.timezone,
    });

    toast({
      title: 'Orden de entrega generada',
      description: `PDF descargado con ${selectedOrdersList.length} pedido(s)`,
    });
  }

  async function handleExportExcel() {
    if (!hasSelection) {
      toast({
        title: 'Sin seleccion',
        description: 'Selecciona al menos un pedido',
        variant: 'destructive',
      });
      return;
    }

    setExporting(true);
    try {
      const selectedOrdersList = filteredOrders.filter(o => selectedOrders.has(o.id));
      const carrierName = selectedOrdersList[0]?.carrier_name || 'Transportadora';

      await exportDispatchExcel(selectedOrdersList, carrierName);

      toast({
        title: 'Excel exportado',
        description: `Planilla descargada con ${selectedOrdersList.length} pedido(s)`,
      });
    } catch (error) {
      logger.error('Error exporting Excel:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'No se pudo exportar la planilla',
        variant: 'destructive',
      });
    } finally {
      if (isMountedRef.current) setExporting(false);
    }
  }

  async function handlePickList() {
    if (!hasSelection) {
      toast({
        title: 'Sin seleccion',
        description: 'Selecciona al menos un pedido para generar el pick list',
        variant: 'destructive',
      });
      return;
    }

    setPrintingPickList(true);
    try {
      const orderIds = Array.from(selectedOrders);
      const result = await printPickListPDF({
        orderIds,
        storeName: currentStore?.name,
        totalOrders: orderIds.length,
      });

      toast({
        title: 'Pick list generado',
        description: `Ola ${result.waveCode}, ${orderIds.length} pedido(s)`,
      });
    } catch (error) {
      logger.error('Error generating pick list:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'No se pudo generar el pick list',
        variant: 'destructive',
      });
    } finally {
      if (isMountedRef.current) setPrintingPickList(false);
    }
  }

  async function handleDispatch() {
    if (!hasSelection) return;

    setDispatching(true);
    try {
      const result: BatchDispatchResponse = await shippingService.dispatchBatch(
        Array.from(selectedOrders),
        dispatchNotes || undefined
      );

      if (result.failed > 0) {
        toast({
          title: 'Despacho parcial',
          description: `${result.succeeded} pedidos despachados, ${result.failed} fallaron`,
        });
      } else {
        toast({
          title: 'Despacho exitoso',
          description: `${result.succeeded} pedidos marcados como en transito`,
        });
      }

      if (result.succeeded > 0) {
        onboardingService.markFirstActionCompleted('shipping');
      }

      setDispatchDialogOpen(false);
      setDispatchNotes('');
      setSelectedOrders(new Set());
      setSingleDispatchOrder(null);
      refreshAll();
    } catch (error) {
      logger.error('Error dispatching orders:', error);
      const errAny = error as { response?: { data?: { details?: string } }; message?: string };
      toast({
        title: 'Error',
        description: errAny?.response?.data?.details || errAny?.message || 'No se pudieron despachar los pedidos',
        variant: 'destructive',
      });
    } finally {
      if (isMountedRef.current) setDispatching(false);
    }
  }

  const isLoading = ordersQuery.isLoading || summaryQuery.isLoading;
  const totalCardOrders = summary
    .filter(s => s.is_mono)
    .reduce((sum, s) => sum + s.order_count, 0);
  const mixedCard = summary.find(s => !s.is_mono);

  return (
    <div className="p-4 md:p-6 space-y-6 pb-32 lg:pb-6">
      <FirstTimeWelcomeBanner
        moduleId="shipping"
        title="Despacho por producto"
        description="Arma olas por producto. Genera pick lists, etiquetas y manifiestos para cada batch sin mezclar pedidos multi producto."
        tips={[
          'Las cards muestran cuantos pedidos hay listos por SKU',
          'Pick list aggregado para el picker',
          'Mixtos siempre separados, nunca silenciosamente mezclados',
        ]}
      />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Despacho</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Entrega de pedidos preparados a couriers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={view === 'cards' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('cards')}
            className="gap-2"
          >
            <LayoutGrid className="h-4 w-4" />
            Cards
          </Button>
          <Button
            variant={view === 'flat' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('flat')}
            className="gap-2"
          >
            <ListIcon className="h-4 w-4" />
            Lista
          </Button>
        </div>
      </div>

      {/* Stats: always show absolute totals from the summary so the operator
          knows the wave size at a glance regardless of active filters. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatPill
          icon={<Package className="h-4 w-4" />}
          label="Pedidos listos"
          value={(totalCardOrders + (mixedCard?.order_count || 0)).toString()}
          tone="blue"
        />
        <StatPill
          icon={<CheckCircle className="h-4 w-4" />}
          label="Seleccionados"
          value={selectedOrders.size.toString()}
          tone="green"
        />
        <StatPill
          icon={<Truck className="h-4 w-4" />}
          label="Unidades"
          value={totalUnitsInSummary.toString()}
          tone="purple"
        />
        <StatPill
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Mixtos"
          value={(mixedCard?.order_count || 0).toString()}
          tone="red"
        />
      </div>

      {/* Active filters bar */}
      {(productFilter.length > 0 || carrierFilter !== 'all' || showMixed) && (
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Filtros activos:
          </span>
          {productFilter.length > 0 && (
            <Badge
              variant="secondary"
              className="gap-1.5 pl-2.5 pr-1.5 py-1 cursor-pointer hover:bg-secondary/80"
              onClick={() => setProductFilter([])}
            >
              Productos: {productFilter.length}
              <X className="h-3 w-3" />
            </Badge>
          )}
          {carrierFilter !== 'all' && (
            <Badge
              variant="secondary"
              className="gap-1.5 pl-2.5 pr-1.5 py-1 cursor-pointer hover:bg-secondary/80"
              onClick={() => setCarrierFilter('all')}
            >
              {carriers.find(c => c.id === carrierFilter)?.name || 'Carrier'}
              <X className="h-3 w-3" />
            </Badge>
          )}
          {showMixed && (
            <Badge
              variant="outline"
              className="gap-1.5 pl-2.5 pr-1.5 py-1 cursor-pointer border-red-300 dark:border-red-800 text-red-700 dark:text-red-300"
              onClick={() => setShowMixed(false)}
            >
              Solo mixtos
              <X className="h-3 w-3" />
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {filteredOrders.length} pedido{filteredOrders.length === 1 ? '' : 's'}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setProductFilter([]);
              setCarrierFilter('all');
              setShowMixed(false);
              setSelectedSummaryIds(new Set());
            }}
            className="h-7 text-xs"
          >
            Limpiar
          </Button>
        </div>
      )}

      {/* Cards view */}
      {view === 'cards' && (
        <>
          {isLoading ? (
            <OrderListSkeleton count={6} />
          ) : summary.length === 0 ? (
            <Card className="p-12">
              <div className="text-center">
                <Package className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-semibold mb-2">No hay pedidos preparados</h3>
                <p className="text-sm text-muted-foreground">
                  Los pedidos que completen el proceso de warehouse apareceran aqui
                </p>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <AnimatePresence mode="popLayout">
                {summary.map(card => (
                  <DispatchProductCard
                    key={card.product_id || '__mixed'}
                    summary={card}
                    selected={
                      card.is_mono && card.product_id
                        ? productFilter.includes(card.product_id)
                        : false
                    }
                    onToggleSelect={() => toggleSummarySelect(card.product_id)}
                    onView={goToMixed}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </>
      )}

      {/* Flat view */}
      {view === 'flat' && (
        <>
          {/* Toolbar filters */}
          <div className="flex flex-col md:flex-row gap-3">
            <ProductMultiSelect
              value={productFilter}
              onChange={setProductFilter}
              placeholder="Filtrar por producto"
              triggerClassName="w-full md:w-64"
            />
            <Select value={carrierFilter} onValueChange={setCarrierFilter}>
              <SelectTrigger className="w-full md:w-48">
                <SelectValue placeholder="Transportadora" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las transportadoras</SelectItem>
                {carriers.map(carrier => (
                  <SelectItem key={carrier.id} value={carrier.id}>
                    {carrier.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Selection toolbar */}
          {filteredOrders.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap">
              <Checkbox
                checked={allSelected}
                onCheckedChange={selectAll}
                className="h-5 w-5"
              />
              <span className="text-sm text-muted-foreground">
                {allSelected ? 'Deseleccionar todos' : 'Seleccionar todos'}
              </span>
              <span className="text-sm text-muted-foreground">
                {filteredOrders.length} resultado{filteredOrders.length === 1 ? '' : 's'}
              </span>
            </div>
          )}

          {/* Orders */}
          {ordersQuery.isLoading ? (
            <OrderListSkeleton count={6} />
          ) : filteredOrders.length === 0 ? (
            <Card className="p-12">
              <div className="text-center">
                <FilterIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-semibold mb-2">Sin resultados</h3>
                <p className="text-sm text-muted-foreground">
                  Ajusta los filtros para ver pedidos
                </p>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {filteredOrders.map(order => (
                <OrderCardRow
                  key={order.id}
                  order={order}
                  selected={selectedOrders.has(order.id)}
                  onToggle={() => toggleOrderSelection(order.id)}
                  onSingleDispatch={() => handleOpenSingleDispatch(order)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Sticky toolbar (when there is a selection) */}
      <AnimatePresence>
        {hasSelection && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', damping: 24, stiffness: 280 }}
            className="fixed bottom-20 lg:bottom-4 left-4 right-4 z-30"
          >
            <Card className="p-3 shadow-2xl border-primary/30 bg-card/95 backdrop-blur-md">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-2 mr-auto">
                  <Badge variant="secondary" className="font-mono">
                    {selectedOrders.size} seleccionado{selectedOrders.size === 1 ? '' : 's'}
                  </Badge>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handlePickList}
                  disabled={printingPickList}
                  className="gap-2"
                >
                  {printingPickList ? (
                    <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-current" />
                  ) : (
                    <ClipboardList className="h-4 w-4" />
                  )}
                  Pick List
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExportExcel}
                  disabled={exporting}
                  className="gap-2"
                >
                  {exporting ? (
                    <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-current" />
                  ) : (
                    <FileSpreadsheet className="h-4 w-4" />
                  )}
                  Excel
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleGenerateManifest}
                  className="gap-2"
                >
                  <FileText className="h-4 w-4" />
                  Manifiesto
                </Button>
                <Button size="sm" onClick={handleOpenDispatchDialog} className="gap-2">
                  <Send className="h-4 w-4" />
                  Despachar ({selectedOrders.size})
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedOrders(new Set())}
                  className="gap-2"
                  aria-label="Limpiar seleccion"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dispatch dialog */}
      <Dialog open={dispatchDialogOpen} onOpenChange={setDispatchDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {singleDispatchOrder ? 'Despachar Pedido' : 'Confirmar Despacho'}
            </DialogTitle>
            <DialogDescription>
              {singleDispatchOrder
                ? `Despachar pedido ${singleDispatchOrder.order_number} a ${singleDispatchOrder.carrier_name}`
                : `Se marcaran ${selectedOrders.size} pedido(s) como en transito`}
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
                      Genera una orden de entrega legal antes de despachar. Debe ser firmada por el encargado y el repartidor.
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
              <p className="text-sm font-medium mb-2">
                Pedidos seleccionados ({selectedOrders.size}):
              </p>
              <div className="max-h-56 overflow-y-auto rounded-md border bg-muted/30 divide-y">
                {Array.from(selectedOrders).map(orderId => {
                  const order = orders.find(o => o.id === orderId);
                  if (!order) return null;
                  return (
                    <div
                      key={orderId}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">
                          {order.customer_name || 'Cliente'}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {order.customer_phone || 'Sin telefono'}
                        </p>
                      </div>
                      <Badge variant="secondary" className="font-mono shrink-0">
                        {order.order_number}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Notas (opcional)</label>
              <Textarea
                placeholder="Ej: Entregado a Juan, conductor placa ABC-123"
                value={dispatchNotes}
                onChange={e => setDispatchNotes(e.target.value)}
                rows={3}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Informacion sobre quien recibio los pedidos, vehiculo, etc.
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
            <Button onClick={handleDispatch} disabled={dispatching} className="gap-2">
              {dispatching ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
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
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

interface StatPillProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: 'blue' | 'green' | 'purple' | 'red';
}

function StatPill({ icon, label, value, tone }: StatPillProps) {
  const tones: Record<StatPillProps['tone'], string> = {
    blue: 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300',
    green: 'bg-primary/5 dark:bg-primary/30 text-primary dark:text-primary',
    purple: 'bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300',
    red: 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300',
  };
  return (
    <Card className="p-3">
      <div className="flex items-center gap-3">
        <div className={cn('p-2 rounded-lg', tones[tone])}>{icon}</div>
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground truncate">
            {label}
          </p>
          <p className="text-xl font-bold tabular-nums">{value}</p>
        </div>
      </div>
    </Card>
  );
}

interface OrderCardRowProps {
  order: ReadyToShipOrder;
  selected: boolean;
  onToggle: () => void;
  onSingleDispatch: () => void;
}

function OrderCardRow({ order, selected, onToggle, onSingleDispatch }: OrderCardRowProps) {
  return (
    <Card
      className={cn(
        'p-4 transition-all cursor-pointer',
        selected
          ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
          : 'hover:border-primary/50'
      )}
      onClick={onToggle}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          className="mt-1"
          onClick={e => e.stopPropagation()}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <div className="min-w-0">
              <h3 className="font-bold text-base truncate">{order.order_number}</h3>
              <p className="text-sm text-muted-foreground truncate">{order.customer_name}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950/20">
                {order.total_items} items
              </Badge>
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex items-start gap-2">
              <Phone className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <span className="text-muted-foreground truncate">{order.customer_phone}</span>
            </div>
            <div className="flex items-start gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <span className="text-muted-foreground line-clamp-2">{order.customer_address}</span>
            </div>
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="font-medium truncate">{order.carrier_name}</span>
            </div>
            {order.cod_amount > 0 && (
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-primary dark:text-primary flex-shrink-0" />
                <span className="font-semibold text-primary dark:text-primary">
                  {formatCurrency(order.cod_amount)} COD
                </span>
              </div>
            )}
          </div>

          <div className="mt-3 pt-3 border-t flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {new Date(order.created_at).toLocaleDateString('es-ES', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="gap-2 h-7 text-xs"
              onClick={e => {
                e.stopPropagation();
                onSingleDispatch();
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
}
