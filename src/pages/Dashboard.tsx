import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { MetricCard } from '@/components/MetricCard';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { analyticsService } from '@/services/analytics.service';
import { unifiedService } from '@/services/unified.service';
import { QuickActions } from '@/components/QuickActions';
import { DailySummary } from '@/components/DailySummary';
import { RevenueIntelligence } from '@/components/RevenueIntelligence';
import { InfoTooltip } from '@/components/InfoTooltip';
import { UsageLimitsIndicator } from '@/components/UsageLimitsIndicator';
import { OnboardingChecklist } from '@/components/OnboardingChecklist';
import { useAuth, Module } from '@/contexts/AuthContext';
import { useDateRange } from '@/contexts/DateRangeContext';
import { useGlobalView } from '@/contexts/GlobalViewContext';
import { DashboardOverview, ChartData } from '@/types';
import { CardSkeleton } from '@/components/skeletons/CardSkeleton';
import { calculateRevenueProjection } from '@/utils/recommendationEngine';
import { formatCurrency, getCurrencySymbol } from '@/utils/currency';
import { logger } from '@/utils/logger';
import {
  DollarSign,
  TrendingDown,
  Megaphone,
  TrendingUp,
  Percent,
  Target,
  Truck,
  Package2,
  Receipt,
  ChevronDown,
  ChevronUp,
  ShoppingCart,
  Activity,
  Globe,
  Store,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

export default function Dashboard() {
  const [isLoading, setIsLoading] = useState(true);
  const [showSecondaryMetrics, setShowSecondaryMetrics] = useState(false);
  const [showAdvancedMetrics, setShowAdvancedMetrics] = useState(false);

  // Global View state from context (toggle is in Header, only shown on Dashboard)
  const { stores, permissions, loading: authLoading } = useAuth();
  const { globalViewEnabled } = useGlobalView();
  const [globalViewStores, setGlobalViewStores] = useState<{ id: string; name: string }[]>([]);

  // Check if user has analytics permission (wait for auth to load)
  const hasAnalyticsAccess = !authLoading && permissions.canAccessModule(Module.ANALYTICS);

  // Check if user has multiple stores (2 or more)
  const hasMultipleStores = (stores?.length || 0) >= 2;

  // Use global date range context
  const { getDateRange } = useDateRange();

  // Real analytics data
  const [dashboardOverview, setDashboardOverview] = useState<DashboardOverview | null>(null);
  const [chartData, setChartData] = useState<ChartData[]>([]);

  // Safe accessors for change metrics (prevents null reference errors)
  const getChange = (metric: string) => {
    if (!dashboardOverview?.changes) return undefined;
    const value = (dashboardOverview.changes as any)[metric];
    return value !== null && value !== undefined ? Math.abs(value) : undefined;
  };

  const getTrend = (metric: string): 'up' | 'down' | undefined => {
    if (!dashboardOverview?.changes) return undefined;
    const value = (dashboardOverview.changes as any)[metric];
    if (value === null || value === undefined) return undefined;
    return value >= 0 ? 'up' : 'down';
  };

  // Calculate date ranges from global context
  const dateRange = useMemo(() => {
    const range = getDateRange();
    const diffTime = Math.abs(range.to.getTime() - range.from.getTime());
    const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;

    const result = {
      startDate: range.from.toISOString().split('T')[0],
      endDate: range.to.toISOString().split('T')[0],
      days,
    };

    logger.log('📅 Date range calculated:', result);
    return result;
  }, [getDateRange]);

  const loadDashboardData = useCallback(async (signal?: AbortSignal) => {
    // Skip loading analytics for users without analytics access
    if (!hasAnalyticsAccess) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const dateParams = {
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
      };

      const useGlobalView = globalViewEnabled && hasMultipleStores;
      logger.log('📊 [Dashboard] Loading data:', { globalViewEnabled, hasMultipleStores, useGlobalView, storesCount: stores?.length });

      let overview: DashboardOverview | null;
      let chart: ChartData[];

      if (useGlobalView) {
        // Fetch unified data from all stores
        logger.log('🌍 [Dashboard] Fetching UNIFIED data from all stores...');
        const [unifiedOverview, unifiedChart] = await Promise.all([
          unifiedService.getAnalyticsOverview(dateParams),
          unifiedService.getAnalyticsChart(dateRange.days, dateParams),
        ]);

        logger.log('🌍 [Dashboard] Unified response:', {
          stores: unifiedOverview.stores,
          storeCount: unifiedOverview.storeCount,
          hasData: !!unifiedOverview.data,
          totalOrders: unifiedOverview.data?.totalOrders,
          revenue: unifiedOverview.data?.revenue
        });

        overview = unifiedOverview.data;
        chart = unifiedChart;
        setGlobalViewStores(unifiedOverview.stores);
      } else {
        // Fetch data from current store only
        const [singleOverview, singleChart] = await Promise.all([
          analyticsService.getOverview(dateParams),
          analyticsService.getChartData(dateRange.days, dateParams),
        ]);

        overview = singleOverview;
        chart = singleChart;
        setGlobalViewStores([]);
      }

      // Check if request was aborted before updating state
      if (signal?.aborted) {
        return;
      }

      setDashboardOverview(overview);
      setChartData(chart);
    } catch (error: any) {
      // Ignore abort errors
      if (error.name === 'AbortError' || error.name === 'CanceledError') {
        return;
      }
      logger.error('[Dashboard] Error loading data:', error);
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  }, [dateRange, globalViewEnabled, hasMultipleStores, stores, hasAnalyticsAccess]);

  useEffect(() => {
    const abortController = new AbortController();
    loadDashboardData(abortController.signal);

    // Cleanup function to abort requests when component unmounts or dependencies change
    return () => {
      abortController.abort();
    };
  }, [loadDashboardData]);

  // Calculate revenue projection (memoized to avoid recalculation)
  const revenueProjection = useMemo(() => {
    if (!dashboardOverview) return null;
    return calculateRevenueProjection(dashboardOverview);
  }, [dashboardOverview]);

  // Wait for auth to load before determining which dashboard to show
  if (authLoading) {
    return (
      <div className="space-y-6">
        <DailySummary />
        <QuickActions />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  // Simplified dashboard for roles without analytics access (e.g., confirmador)
  if (!hasAnalyticsAccess) {
    return (
      <div className="space-y-6">
        {/* Onboarding Checklist - Shows for new users */}
        <OnboardingChecklist />

        {/* Daily Summary - Already handles permissions internally */}
        <DailySummary />

        {/* Quick Actions */}
        <QuickActions />

        {/* Usage Limits Indicator - Shows when near/at limit */}
        <UsageLimitsIndicator />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <DailySummary />
        <QuickActions />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(10)].map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (!dashboardOverview) {
    return (
      <div className="space-y-6">
        <DailySummary />
        <QuickActions />
        <Card className="p-6">
          <p className="text-center text-muted-foreground">
            No hay datos disponibles. Por favor, intente nuevamente.
          </p>
        </Card>
      </div>
    );
  }

  // Determine if we're showing global view
  const isShowingGlobalView = globalViewEnabled && hasMultipleStores && globalViewStores.length > 0;

  return (
    <div className="space-y-6">
      {/* Global View Store Badges - Shows which stores are being aggregated */}
      {isShowingGlobalView && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-blue-50 dark:bg-blue-950/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
          <Globe size={14} className="text-blue-500" />
          <span>Vista Global activa - Mostrando datos de:</span>
          <div className="flex flex-wrap gap-1">
            {globalViewStores.map((store) => (
              <Badge key={store.id} variant="secondary" className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                <Store size={10} className="mr-1" />
                {store.name}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Onboarding Checklist - Shows for new users */}
      <OnboardingChecklist />

      {/* Daily Summary */}
      <DailySummary />

      {/* Quick Actions */}
      <QuickActions />

      {/* Usage Limits Indicator - Shows when near/at limit */}
      <UsageLimitsIndicator />

      {/* Priority Metrics - Always Visible */}
      <div>
        <h2 className="text-2xl font-bold mb-4 text-card-foreground">
          {isShowingGlobalView ? 'Resumen de Ventas (Todas las Tiendas)' : 'Resumen de Ventas'}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
          <MetricCard
            title={
              <div className="flex items-center">
                Facturación Bruta
                <InfoTooltip content="Ingresos totales por ventas de pedidos entregados (incluye costos)." />
              </div>
            }
            value={formatCurrency(dashboardOverview.realRevenue ?? dashboardOverview.revenue)}
            change={getChange('realRevenue')}
            trend={getTrend('realRevenue')}
            icon={<DollarSign className="text-primary" size={24} />}
            variant="primary"
            subtitle="Solo pedidos entregados"
          />
          <MetricCard
            title={
              <div className="flex items-center">
                Facturación Proyectada
                <InfoTooltip content="Estimación de ingresos sumando pedidos entregados y en tránsito." />
              </div>
            }
            value={formatCurrency(dashboardOverview.projectedRevenue ?? dashboardOverview.realRevenue ?? dashboardOverview.revenue)}
            change={undefined}
            trend={undefined}
            icon={<Activity className="text-cyan-600" size={24} />}
            variant="secondary"
            subtitle="Entregados + en tránsito"
          />
          <MetricCard
            title={
              <div className="flex items-center">
                Beneficio Neto Real
                <InfoTooltip content="Ganancia real después de descontar costos de productos, envío y publicidad." />
              </div>
            }
            value={formatCurrency(dashboardOverview.realNetProfit ?? dashboardOverview.netProfit)}
            change={getChange('realNetProfit')}
            trend={getTrend('realNetProfit')}
            icon={<TrendingUp className="text-green-600" size={24} />}
            variant="accent"
            subtitle="Solo pedidos entregados"
          />
          <MetricCard
            title={
              <div className="flex items-center">
                Tasa de Entrega
                <InfoTooltip content="Porcentaje de pedidos entregados exitosamente sobre el total despachado." />
              </div>
            }
            value={`${dashboardOverview.deliveryRate}%`}
            change={getChange('deliveryRate')}
            trend={getTrend('deliveryRate')}
            icon={<Truck className="text-purple-600" size={24} />}
            variant="purple"
          />
          <MetricCard
            title={
              <div className="flex items-center">
                Ticket Promedio
                <InfoTooltip content="Valor promedio de venta por cada pedido realizado." />
              </div>
            }
            value={formatCurrency(dashboardOverview.averageOrderValue)}
            change={getChange('averageOrderValue')}
            trend={getTrend('averageOrderValue')}
            icon={<ShoppingCart className="text-orange-600" size={24} />}
          />
        </div>
      </div>

      {/* Secondary Metrics - Collapsible */}
      <div className="space-y-4">
        <Button
          variant="ghost"
          className="w-full flex items-center justify-between p-4 hover:bg-accent"
          onClick={() => setShowSecondaryMetrics(!showSecondaryMetrics)}
        >
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">Métricas de Rentabilidad</h3>
            <span className="text-sm text-muted-foreground">
              ({showSecondaryMetrics ? 'Ocultar' : 'Mostrar'})
            </span>
          </div>
          {showSecondaryMetrics ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </Button>

        {showSecondaryMetrics && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <MetricCard
              title={
                <div className="flex items-center">
                  ROAS
                  <InfoTooltip content="Retorno de la inversión publicitaria (solo pedidos entregados)." />
                </div>
              }
              value={
                dashboardOverview.gasto_publicitario > 0 && (dashboardOverview.realRevenue ?? 0) > 0
                  ? `${(dashboardOverview.realRoas ?? dashboardOverview.roas).toFixed(2)}x`
                  : 'N/A'
              }
              change={
                dashboardOverview.gasto_publicitario > 0 &&
                (dashboardOverview.realRevenue ?? 0) > 0
                  ? getChange('realRoas')
                  : undefined
              }
              trend={
                dashboardOverview.gasto_publicitario > 0 &&
                (dashboardOverview.realRevenue ?? 0) > 0
                  ? getTrend('realRoas')
                  : undefined
              }
              icon={<Target className="text-green-600" size={20} />}
              subtitle={
                dashboardOverview.gasto_publicitario === 0
                  ? 'Sin campañas activas'
                  : (dashboardOverview.realRevenue ?? 0) === 0
                  ? 'Sin pedidos entregados'
                  : undefined
              }
            />
            <MetricCard
              title={
                <div className="flex items-center">
                  ROI General
                  <InfoTooltip content="Retorno sobre la inversión total (solo pedidos entregados)." />
                </div>
              }
              value={
                (dashboardOverview.realCosts ?? 0) > 0 && (dashboardOverview.realRevenue ?? 0) > 0
                  ? `${(dashboardOverview.realRoi ?? dashboardOverview.roi).toFixed(1)}%`
                  : 'N/A'
              }
              change={
                (dashboardOverview.realCosts ?? 0) > 0 &&
                (dashboardOverview.realRevenue ?? 0) > 0
                  ? getChange('realRoi')
                  : undefined
              }
              trend={
                (dashboardOverview.realCosts ?? 0) > 0 &&
                (dashboardOverview.realRevenue ?? 0) > 0
                  ? getTrend('realRoi')
                  : undefined
              }
              icon={<Target className="text-blue-600" size={20} />}
              subtitle={(dashboardOverview.realRevenue ?? 0) === 0 ? 'Sin pedidos entregados' : undefined}
            />
            <MetricCard
              title={
                <div className="flex items-center">
                  Margen Bruto
                  <InfoTooltip content="Beneficio sobre venta después de costos de producto (solo entregados)." />
                </div>
              }
              value={
                (dashboardOverview.realRevenue ?? 0) > 0
                  ? `${(dashboardOverview.realGrossMargin ?? dashboardOverview.grossMargin)}%`
                  : 'N/A'
              }
              change={(dashboardOverview.realRevenue ?? 0) > 0 ? getChange('realGrossMargin') : undefined}
              trend={(dashboardOverview.realRevenue ?? 0) > 0 ? getTrend('realGrossMargin') : undefined}
              icon={<Percent className="text-emerald-600" size={20} />}
              subtitle={(dashboardOverview.realRevenue ?? 0) === 0 ? 'Sin pedidos entregados' : undefined}
            />
            <MetricCard
              title={
                <div className="flex items-center">
                  Margen Neto
                  <InfoTooltip content="Beneficio final sobre venta después de todos los gastos (solo entregados)." />
                </div>
              }
              value={
                (dashboardOverview.realRevenue ?? 0) > 0
                  ? `${(dashboardOverview.realNetMargin ?? dashboardOverview.netMargin)}%`
                  : 'N/A'
              }
              change={(dashboardOverview.realRevenue ?? 0) > 0 ? getChange('realNetMargin') : undefined}
              trend={(dashboardOverview.realRevenue ?? 0) > 0 ? getTrend('realNetMargin') : undefined}
              icon={<Percent className="text-primary" size={20} />}
              subtitle={(dashboardOverview.realRevenue ?? 0) === 0 ? 'Sin pedidos entregados' : undefined}
            />
            <MetricCard
              title={
                <div className="flex items-center">
                  Costo por Pedido
                  <InfoTooltip content="Costo promedio total de adquirir y procesar un pedido." />
                </div>
              }
              value={formatCurrency(dashboardOverview.costPerOrder)}
              change={getChange('costPerOrder')}
              trend={getTrend('costPerOrder')}
              icon={<Package2 className="text-gray-600" size={20} />}
            />
          </div>
        )}
      </div>

      {/* Cost Breakdown - Collapsible */}
      <div className="space-y-4">
        <Button
          variant="ghost"
          className="w-full flex items-center justify-between p-4 hover:bg-accent"
          onClick={() => setShowAdvancedMetrics(!showAdvancedMetrics)}
        >
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">Desglose de Costos</h3>
            <span className="text-sm text-muted-foreground">
              ({showAdvancedMetrics ? 'Ocultar' : 'Mostrar'})
            </span>
          </div>
          {showAdvancedMetrics ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </Button>

        {showAdvancedMetrics && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title={
                <div className="flex items-center">
                  Costos de Productos
                  <InfoTooltip content="Valor total del costo de la mercancía vendida (COGS)." />
                </div>
              }
              value={formatCurrency(dashboardOverview.realProductCosts ?? dashboardOverview.productCosts)}
              change={dashboardOverview.changes?.realProductCosts !== null ? Math.abs(dashboardOverview.changes?.realProductCosts || 0) : undefined}
              trend={dashboardOverview.changes?.realProductCosts !== null ? (dashboardOverview.changes?.realProductCosts >= 0 ? 'up' : 'down') : undefined}
              icon={<TrendingDown className="text-red-600" size={20} />}
              subtitle="Solo pedidos entregados"
            />
            <MetricCard
              title={
                <div className="flex items-center">
                  Costos de Envío
                  <InfoTooltip content="Gasto total en servicios de logística y transporte." />
                </div>
              }
              value={formatCurrency(dashboardOverview.realDeliveryCosts ?? dashboardOverview.deliveryCosts)}
              change={dashboardOverview.changes?.realDeliveryCosts !== null ? Math.abs(dashboardOverview.changes?.realDeliveryCosts || 0) : undefined}
              trend={dashboardOverview.changes?.realDeliveryCosts !== null ? (dashboardOverview.changes?.realDeliveryCosts >= 0 ? 'up' : 'down') : undefined}
              icon={<Truck className="text-orange-600" size={20} />}
              subtitle="Solo pedidos entregados"
            />
            <MetricCard
              title={
                <div className="flex items-center">
                  Gasto Publicitario
                  <InfoTooltip content="Inversión total realizada en campañas de marketing." />
                </div>
              }
              value={formatCurrency(dashboardOverview.gasto_publicitario)}
              change={dashboardOverview.changes?.gasto_publicitario !== null ? Math.abs(dashboardOverview.changes?.gasto_publicitario || 0) : undefined}
              trend={dashboardOverview.changes?.gasto_publicitario !== null ? (dashboardOverview.changes?.gasto_publicitario >= 0 ? 'up' : 'down') : undefined}
              icon={<Megaphone className="text-blue-600" size={20} />}
              subtitle="Inversión publicitaria"
            />
            <MetricCard
              title={
                <div className="flex items-center">
                  {/* Special case for dynamic title */}
                  <span>IVA Recolectado ({dashboardOverview.taxRate}%)</span>
                  <InfoTooltip content="Monto total de impuestos recaudados sobre las ventas." />
                </div>
              }
              value={formatCurrency(dashboardOverview.taxCollected)}
              change={dashboardOverview.changes?.taxCollected !== null ? Math.abs(dashboardOverview.changes?.taxCollected || 0) : undefined}
              trend={dashboardOverview.changes?.taxCollected !== null ? (dashboardOverview.changes?.taxCollected >= 0 ? 'up' : 'down') : undefined}
              icon={<Receipt className="text-orange-600" size={20} />}
              subtitle="Incluido en facturación"
            />
          </div>
        )}
      </div>

      {/* Financial Chart */}
      <Card className="p-6 bg-card">
        <h3 className="text-lg font-semibold mb-4 text-card-foreground">Resumen Financiero (Pedidos Entregados)</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Ingresos, costos y beneficio basados únicamente en pedidos entregados
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="date" className="stroke-muted-foreground" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
            <YAxis className="stroke-muted-foreground" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
                color: 'hsl(var(--card-foreground))',
              }}
              formatter={(value: number, name: string) => {
                return [formatCurrency(value), name];
              }}
            />
            <Legend wrapperStyle={{ color: 'hsl(var(--card-foreground))' }} />
            <Line
              type="monotone"
              dataKey="realRevenue"
              stroke="hsl(84, 81%, 63%)"
              strokeWidth={2.5}
              name="Ingresos Reales"
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="costs"
              stroke="hsl(0, 84%, 60%)"
              strokeWidth={2.5}
              name="Costos (Producto + Envío)"
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="gasto_publicitario"
              stroke="hsl(217, 91%, 60%)"
              strokeWidth={2.5}
              name="Gasto Publicitario"
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="profit"
              stroke="hsl(142, 76%, 45%)"
              strokeWidth={2.5}
              name="Beneficio Neto"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* Revenue Intelligence Section */}
      <RevenueIntelligence />
    </div>
  );
}
