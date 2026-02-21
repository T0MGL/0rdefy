import { useState, useEffect, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { logger } from '@/utils/logger';
import { formatLocalDate } from '@/utils/timeUtils';
import { formatCurrency } from '@/utils/currency';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  ShoppingBag,
  DollarSign,
  AlertTriangle,
  CheckCircle,
  Package2
} from 'lucide-react';
import { ordersService } from '@/services/orders.service';
import { analyticsService } from '@/services/analytics.service';
import { unifiedService } from '@/services/unified.service';
import { useDateRange } from '@/contexts/DateRangeContext';
import { useAuth, Module } from '@/contexts/AuthContext';
import { useGlobalView } from '@/contexts/GlobalViewContext';
import type { Order, DashboardOverview } from '@/types';

export function DailySummary() {
  const [isOpen, setIsOpen] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check if user has analytics permission (wait for auth to load)
  const { permissions, loading: authLoading, currentStore, stores } = useAuth();
  const { globalViewEnabled } = useGlobalView();
  const hasAnalyticsAccess = !authLoading && permissions.canAccessModule(Module.ANALYTICS);
  const hasMultipleStores = (stores?.length || 0) >= 2;
  const useGlobalViewData = globalViewEnabled && hasMultipleStores;

  // Use global date range context
  const { selectedRange, getDateRange } = useDateRange();

  const storeTimezone = currentStore?.timezone || 'America/Asuncion';

  // Calculate date ranges from global context using store timezone
  const dateRange = useMemo(() => {
    const range = getDateRange();
    return {
      startDate: formatLocalDate(range.from, storeTimezone),
      endDate: formatLocalDate(range.to, storeTimezone),
    };
  }, [getDateRange, storeTimezone]);

  // Get title based on selected range
  const getSummaryTitle = () => {
    switch (selectedRange) {
      case 'today':
        return 'Resumen Ejecutivo del Día';
      case '7d':
        return 'Resumen Ejecutivo de la Semana';
      case '30d':
        return 'Resumen Ejecutivo del Mes';
      case 'custom':
        return 'Resumen Ejecutivo Personalizado';
      default:
        return 'Resumen Ejecutivo';
    }
  };

  useEffect(() => {
    // Wait for auth to load before fetching data
    if (authLoading) {
      return;
    }

    const loadData = async () => {
      setIsLoading(true);
      let fetchedOrdersCount = 0;
      try {
        const dateParams = {
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
        };

        // Always load orders (all roles with Dashboard access can see orders)
        let ordersData: Order[] = [];
        if (useGlobalViewData) {
          const unifiedOrders = await unifiedService.getOrders({
            startDate: dateParams.startDate,
            endDate: dateParams.endDate,
            limit: 2000,
          });
          ordersData = (unifiedOrders.data || []) as unknown as Order[];
        } else {
          const ordersResponse = await ordersService.getAll(dateParams);
          ordersData = ordersResponse.data || [];
        }

        fetchedOrdersCount = ordersData.length;
        setOrders(ordersData);

        // Only load analytics if user has permission
        if (hasAnalyticsAccess) {
          if (useGlobalViewData) {
            const unifiedOverview = await unifiedService.getAnalyticsOverview(dateParams);
            setOverview(unifiedOverview.data || {
              totalOrders: ordersData.length,
              revenue: 0,
              deliveryRate: 0,
              profitMargin: 0,
              netProfit: 0,
              changes: null,
            } as DashboardOverview);
          } else {
            const overviewData = await analyticsService.getOverview(dateParams);
            setOverview(overviewData);
          }
        } else {
          // Calculate basic metrics from orders for roles without analytics access
          const totalRevenue = ordersData.reduce((sum: number, o: Order) => sum + (o.total_price || 0), 0);
          const deliveredOrders = ordersData.filter((o: Order) => o.status === 'delivered');
          const deliveryRate = ordersData.length > 0
            ? Math.round((deliveredOrders.length / ordersData.length) * 100)
            : 0;

          // Create a simplified overview from orders data
          const simplifiedOverview: DashboardOverview = {
            totalOrders: ordersData.length,
            revenue: totalRevenue,
            deliveryRate,
            profitMargin: 0, // Not available without analytics
            netProfit: 0, // Not available without analytics
            changes: null, // No comparison data available
          } as DashboardOverview;

          setOverview(simplifiedOverview);
        }
      } catch (error) {
        logger.error('Error loading daily summary data:', error);
        // Even on error, set a basic overview to prevent crash
        setOverview({
          totalOrders: fetchedOrdersCount,
          revenue: 0,
          deliveryRate: 0,
          profitMargin: 0,
          netProfit: 0,
          changes: null,
        } as DashboardOverview);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, [dateRange, hasAnalyticsAccess, authLoading, useGlobalViewData]);

  if (authLoading || isLoading || !overview) {
    return (
      <Card className="p-6 bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20">
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="h-6 w-64 bg-muted animate-pulse rounded" />
            <div className="h-4 w-48 bg-muted animate-pulse rounded" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="p-4 bg-card rounded-lg border space-y-2">
                <div className="h-5 w-5 bg-muted animate-pulse rounded" />
                <div className="h-8 w-20 bg-muted animate-pulse rounded" />
                <div className="h-3 w-24 bg-muted animate-pulse rounded" />
              </div>
            ))}
          </div>
        </div>
      </Card>
    );
  }

  // ===== USAR DATOS DEL OVERVIEW (YA FILTRADOS POR FECHA) =====
  // El overview ya contiene las métricas del período seleccionado y las comparativas con el período anterior

  // Contar pedidos pendientes en el período seleccionado
  const pendingConfirmation = orders.filter(o => o.status === 'pending' && !o.confirmedByWhatsApp);

  // Contar pedidos en preparación en el período seleccionado
  const inPreparation = orders.filter(o => o.status === 'in_preparation');

  // Obtener el label correcto basado en el período seleccionado
  const getMetricLabel = (baseLabel: string) => {
    switch (selectedRange) {
      case 'today':
        return baseLabel.replace('Nuevos', 'del Día').replace('del Período', 'del Día');
      case '7d':
        return baseLabel.replace('Nuevos', 'de la Semana').replace('del Período', 'de la Semana');
      case '30d':
        return baseLabel.replace('Nuevos', 'del Mes').replace('del Período', 'del Mes');
      case 'custom':
        return baseLabel.replace('Nuevos', 'del Período').replace('del Día', 'del Período');
      default:
        return baseLabel;
    }
  };

  const metrics = [
    {
      label: getMetricLabel('Pedidos Nuevos'),
      value: overview?.totalOrders ?? 0,
      change: overview?.changes?.totalOrders != null ? overview.changes.totalOrders : null,
      icon: ShoppingBag,
      trend: overview?.changes?.totalOrders != null ? (overview.changes.totalOrders >= 0 ? 'up' as const : 'down' as const) : undefined,
    },
    {
      label: getMetricLabel('Ventas del Período'),
      value: formatCurrency(overview?.revenue ?? 0),
      change: overview?.changes?.revenue != null ? overview.changes.revenue : null,
      icon: DollarSign,
      trend: overview?.changes?.revenue != null ? (overview.changes.revenue >= 0 ? 'up' as const : 'down' as const) : undefined,
    },
    {
      label: 'Pendientes Confirmar',
      value: pendingConfirmation.length,
      change: null, // No tiene sentido comparar pendientes con período anterior
      icon: AlertTriangle,
      trend: undefined,
    },
    {
      label: 'En Preparación',
      value: inPreparation.length,
      change: null, // No tiene sentido comparar en preparación con período anterior
      icon: Package2,
      trend: undefined,
    },
  ];
  
  return (
    <Card className="p-6 bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold">{getSummaryTitle()}</h3>
            <p className="text-sm text-muted-foreground">
              {selectedRange === 'custom'
                ? `${new Date(dateRange.startDate).toLocaleDateString('es-ES')} - ${new Date(dateRange.endDate).toLocaleDateString('es-ES')}`
                : new Date().toLocaleDateString('es-ES', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })
              }
            </p>
          </div>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              {isOpen ? 'Ocultar' : 'Ver detalles'}
              {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </Button>
          </CollapsibleTrigger>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {metrics.map((metric, i) => {
            const Icon = metric.icon;
            const shouldShowChange = metric.change !== null && metric.trend !== undefined &&
              (typeof metric.value === 'number' ? metric.value !== 0 : true);

            return (
              <div key={i} className="p-4 bg-card rounded-lg border">
                <div className="flex items-center justify-between mb-2">
                  <Icon size={20} className="text-primary" />
                  {shouldShowChange && (
                    <Badge
                      variant="outline"
                      className={metric.trend === 'up' ? 'text-green-600' : 'text-red-600'}
                    >
                      {metric.trend === 'up' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      {Math.abs(metric.change!)}%
                    </Badge>
                  )}
                </div>
                <p className="text-2xl font-bold">{metric.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{metric.label}</p>
              </div>
            );
          })}
        </div>
        
        <CollapsibleContent className="mt-4">
          <div className="grid md:grid-cols-2 gap-4 pt-4 border-t">
            <div>
              <h4 className="font-semibold mb-2">Alertas Importantes</h4>
              <ul className="space-y-2 text-sm">
                {pendingConfirmation.length > 0 && (
                  <li className="flex items-start gap-2">
                    <AlertTriangle size={16} className="text-yellow-600 mt-0.5" />
                    <span>{pendingConfirmation.length} pedidos pendientes de confirmación</span>
                  </li>
                )}
                <li className="flex items-start gap-2">
                  <CheckCircle size={16} className="text-green-600 mt-0.5" />
                  <span>Tasa de entrega: {overview?.deliveryRate ?? 0}%</span>
                </li>
              </ul>
            </div>
            {hasAnalyticsAccess ? (
              <div>
                <h4 className="font-semibold mb-2">Estado General</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Margen de Beneficio</span>
                    <span className="font-semibold">{overview?.profitMargin ?? 0}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Beneficio Neto</span>
                    <span className="font-semibold">{formatCurrency(overview?.netProfit ?? 0)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <h4 className="font-semibold mb-2">Estado de Pedidos</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">En preparación</span>
                    <span className="font-semibold">{inPreparation.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total del período</span>
                    <span className="font-semibold">{orders.length}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
