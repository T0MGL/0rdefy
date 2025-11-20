import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { MetricCard } from '@/components/MetricCard';
import { Card } from '@/components/ui/card';
import { analyticsService } from '@/services/analytics.service';
import { codMetricsService } from '@/services/cod-metrics.service';
import { QuickActions } from '@/components/QuickActions';
import { DailySummary } from '@/components/DailySummary';
import { MetricDetailModal } from '@/components/MetricDetailModal';
import { PeriodComparator } from '@/components/PeriodComparator';
import { RevenueIntelligence } from '@/components/RevenueIntelligence';
import { RevenueProjectionCard } from '@/components/RevenueProjectionCard';
import { PeriodType } from '@/utils/periodComparison';
import { DashboardOverview, ChartData, Product, ConfirmationMetrics } from '@/types';
import { CardSkeleton } from '@/components/skeletons/CardSkeleton';
import { calculateRevenueProjection } from '@/utils/recommendationEngine';
import {
  ShoppingBag,
  DollarSign,
  TrendingDown,
  Megaphone,
  TrendingUp,
  Percent,
  Target,
  Truck,
  CheckCircle2,
  AlertCircle,
  Package2,
  Receipt,
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
  PieChart,
  Pie,
  Cell,
} from 'recharts';

export default function Dashboard() {
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodType>('week-lastweek');
  const [customDates, setCustomDates] = useState<{ start: Date; end: Date } | undefined>();
  const [isLoading, setIsLoading] = useState(true);

  // Real analytics data
  const [dashboardOverview, setDashboardOverview] = useState<DashboardOverview | null>(null);
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [topProducts, setTopProducts] = useState<Product[]>([]);
  const [confirmationMetrics, setConfirmationMetrics] = useState<ConfirmationMetrics | null>(null);
  const [orderStatusData, setOrderStatusData] = useState<any[]>([]);
  const [codMetrics, setCodMetrics] = useState<any>(null);

  // Memoize status map to avoid recreation
  const statusMap = useMemo(() => ({
    'confirmed': { name: 'Confirmado', color: 'hsl(84, 81%, 63%)' },
    'shipped': { name: 'En tránsito', color: 'hsl(217, 91%, 60%)' },
    'delivered': { name: 'Entregado', color: 'hsl(142, 76%, 45%)' },
    'cancelled': { name: 'Cancelado', color: 'hsl(0, 84%, 60%)' },
    'pending': { name: 'Pendiente', color: 'hsl(45, 93%, 47%)' },
  }), []);

  // Calculate date ranges based on selected period
  const getDateRange = useMemo(() => {
    const now = new Date();
    let startDate: Date;
    let endDate: Date = now;
    let days = 7;

    if (selectedPeriod === 'custom' && customDates) {
      startDate = customDates.start;
      endDate = customDates.end;
      const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
      days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    } else if (selectedPeriod === 'today-yesterday') {
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      days = 1;
    } else if (selectedPeriod === 'week-lastweek') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      days = 7;
    } else if (selectedPeriod === 'month-lastmonth') {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      days = 30;
    } else {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      days = 7;
    }

    const range = {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      days,
    };

    console.log('📅 Date range calculated:', { period: selectedPeriod, ...range });
    return range;
  }, [selectedPeriod, customDates]);

  const loadDashboardData = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    try {
      const dateParams = {
        startDate: getDateRange.startDate,
        endDate: getDateRange.endDate,
      };

      console.log('📊 Loading dashboard data with params:', dateParams);

      const [overview, chart, products, confirmation, statusDist, codData] = await Promise.all([
        analyticsService.getOverview(dateParams),
        analyticsService.getChartData(getDateRange.days, dateParams),
        analyticsService.getTopProducts(5, dateParams),
        analyticsService.getConfirmationMetrics(dateParams),
        analyticsService.getOrderStatusDistribution(dateParams),
        codMetricsService.getMetrics({
          start_date: dateParams.startDate, // ✅ Already a string, no need for toISOString()
          end_date: dateParams.endDate, // ✅ Already a string, no need for toISOString()
        }).catch(() => null), // Fail silently if COD metrics not available
      ]);

      // Check if request was aborted before updating state
      if (signal?.aborted) {
        console.log('Dashboard data load was cancelled');
        return;
      }

      setDashboardOverview(overview);
      setChartData(chart);
      setTopProducts(products);
      setConfirmationMetrics(confirmation);
      setCodMetrics(codData);

      // Transform status distribution for pie chart
      const transformedStatus = statusDist.map(item => ({
        name: statusMap[item.status]?.name || item.status,
        value: item.percentage,
        color: statusMap[item.status]?.color || 'hsl(0, 0%, 50%)',
      }));

      setOrderStatusData(transformedStatus);
    } catch (error: any) {
      // Ignore abort errors
      if (error.name === 'AbortError' || error.name === 'CanceledError') {
        console.log('Dashboard data load was cancelled');
        return;
      }
      console.error('Error loading dashboard data:', error);
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  }, [statusMap, getDateRange]);

  useEffect(() => {
    const abortController = new AbortController();
    loadDashboardData(abortController.signal);

    // Cleanup function to abort requests when component unmounts or dependencies change
    return () => {
      abortController.abort();
    };
  }, [loadDashboardData]);

  const handlePeriodChange = useCallback((period: PeriodType, dates?: { start: Date; end: Date }) => {
    console.log('🔄 Period changed:', period, dates);
    setSelectedPeriod(period);
    if (period === 'custom' && dates) {
      setCustomDates(dates);
    } else {
      setCustomDates(undefined);
    }
  }, []);

  const handleMetricClick = useCallback((metric: string) => {
    setSelectedMetric(metric);
    setModalOpen(true);
  }, []);

  // Calculate revenue projection (memoized to avoid recalculation)
  const revenueProjection = useMemo(() => {
    if (!dashboardOverview) return null;
    return calculateRevenueProjection(dashboardOverview);
  }, [dashboardOverview]);

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

  if (!dashboardOverview || !confirmationMetrics) {
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
  
  return (
    <div className="space-y-6">
      {/* Daily Summary */}
      <DailySummary />

      {/* Quick Actions */}
      <QuickActions />
      
      {/* Period Comparator */}
      <div className="flex justify-end">
        <PeriodComparator value={selectedPeriod} onPeriodChange={handlePeriodChange} />
      </div>

      {/* Revenue Projection Card (only shows with ≥10% growth) */}
      {revenueProjection && <RevenueProjectionCard projection={revenueProjection} />}

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Pedidos"
          value={dashboardOverview.totalOrders}
          change={dashboardOverview.changes?.totalOrders !== null ? Math.abs(dashboardOverview.changes?.totalOrders || 0) : undefined}
          trend={dashboardOverview.changes?.totalOrders !== null ? (dashboardOverview.changes?.totalOrders >= 0 ? 'up' : 'down') : undefined}
          icon={<ShoppingBag className="text-primary" size={20} />}
          onClick={() => handleMetricClick('orders')}
        />
        <MetricCard
          title="Ingresos"
          value={`Gs. ${dashboardOverview.revenue.toLocaleString()}`}
          change={dashboardOverview.changes?.revenue !== null ? Math.abs(dashboardOverview.changes?.revenue || 0) : undefined}
          trend={dashboardOverview.changes?.revenue !== null ? (dashboardOverview.changes?.revenue >= 0 ? 'up' : 'down') : undefined}
          icon={<DollarSign className="text-primary" size={20} />}
        />
        <MetricCard
          title="Costos"
          value={`Gs. ${dashboardOverview.costs.toLocaleString()}`}
          change={dashboardOverview.changes?.costs !== null ? Math.abs(dashboardOverview.changes?.costs || 0) : undefined}
          trend={dashboardOverview.changes?.costs !== null ? (dashboardOverview.changes?.costs >= 0 ? 'up' : 'down') : undefined}
          icon={<TrendingDown className="text-red-600" size={20} />}
        />
        <MetricCard
          title={`IVA Recolectado (${dashboardOverview.taxRate}%)`}
          value={`Gs. ${dashboardOverview.taxCollected.toLocaleString()}`}
          change={dashboardOverview.changes?.taxCollected !== null ? Math.abs(dashboardOverview.changes?.taxCollected || 0) : undefined}
          trend={dashboardOverview.changes?.taxCollected !== null ? (dashboardOverview.changes?.taxCollected >= 0 ? 'up' : 'down') : undefined}
          icon={<Receipt className="text-orange-600" size={20} />}
        />
        <MetricCard
          title="Marketing"
          value={`Gs. ${dashboardOverview.marketing.toLocaleString()}`}
          change={dashboardOverview.changes?.marketing !== null ? Math.abs(dashboardOverview.changes?.marketing || 0) : undefined}
          trend={dashboardOverview.changes?.marketing !== null ? (dashboardOverview.changes?.marketing >= 0 ? 'up' : 'down') : undefined}
          icon={<Megaphone className="text-blue-600" size={20} />}
        />
        <MetricCard
          title="Beneficio Neto"
          value={`Gs. ${dashboardOverview.netProfit.toLocaleString()}`}
          change={dashboardOverview.changes?.netProfit !== null ? Math.abs(dashboardOverview.changes?.netProfit || 0) : undefined}
          trend={dashboardOverview.changes?.netProfit !== null ? (dashboardOverview.changes?.netProfit >= 0 ? 'up' : 'down') : undefined}
          icon={<TrendingUp className="text-primary" size={20} />}
        />
        <MetricCard
          title="Margen de Beneficio"
          value={`${dashboardOverview.profitMargin}%`}
          change={dashboardOverview.changes?.profitMargin !== null ? Math.abs(dashboardOverview.changes?.profitMargin || 0) : undefined}
          trend={dashboardOverview.changes?.profitMargin !== null ? (dashboardOverview.changes?.profitMargin >= 0 ? 'up' : 'down') : undefined}
          icon={<Percent className="text-primary" size={20} />}
        />
        <MetricCard
          title="ROI"
          value={`${dashboardOverview.roi}x`}
          change={dashboardOverview.changes?.roi !== null ? Math.abs(dashboardOverview.changes?.roi || 0) : undefined}
          trend={dashboardOverview.changes?.roi !== null ? (dashboardOverview.changes?.roi >= 0 ? 'up' : 'down') : undefined}
          icon={<Target className="text-blue-600" size={20} />}
        />
        <MetricCard
          title="Tasa de Entrega"
          value={`${dashboardOverview.deliveryRate}%`}
          change={dashboardOverview.changes?.deliveryRate !== null ? Math.abs(dashboardOverview.changes?.deliveryRate || 0) : undefined}
          trend={dashboardOverview.changes?.deliveryRate !== null ? (dashboardOverview.changes?.deliveryRate >= 0 ? 'up' : 'down') : undefined}
          icon={<Truck className="text-purple-600" size={20} />}
          onClick={() => handleMetricClick('delivery')}
        />
        <MetricCard
          title="Tasa de Confirmación"
          value={`${confirmationMetrics.confirmationRate.toFixed(1)}%`}
          change={confirmationMetrics.confirmationRateChange !== null ? Math.abs(confirmationMetrics.confirmationRateChange || 0) : undefined}
          trend={confirmationMetrics.confirmationRateChange !== null ? (confirmationMetrics.confirmationRateChange >= 0 ? 'up' : 'down') : undefined}
          icon={<CheckCircle2 className="text-green-600" size={20} />}
          onClick={() => handleMetricClick('confirmation')}
        />
      </div>

      {/* COD Metrics Section */}
      {codMetrics && (
        <>
          <div className="flex items-center gap-2 mt-8">
            <h3 className="text-xl font-bold">Métricas COD (Contra Entrega)</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title="Efectivo Pendiente"
              value={`Gs. ${codMetrics.pending_cash.toLocaleString()}`}
              icon={<DollarSign className="text-yellow-600" size={20} />}
            />
            <MetricCard
              title="Cobrado Hoy"
              value={`Gs. ${codMetrics.collected_today.toLocaleString()}`}
              icon={<CheckCircle2 className="text-green-600" size={20} />}
            />
            <MetricCard
              title="Pedidos en Entrega"
              value={codMetrics.orders_in_delivery}
              icon={<Truck className="text-blue-600" size={20} />}
            />
            <MetricCard
              title="Tasa de Pago Exitoso"
              value={`${codMetrics.payment_success_rate}%`}
              icon={<Percent className="text-green-600" size={20} />}
            />
            <MetricCard
              title="Intentos Promedio"
              value={codMetrics.average_delivery_attempts.toFixed(1)}
              icon={<Package2 className="text-purple-600" size={20} />}
            />
            <MetricCard
              title="Pérdidas por Fallos"
              value={`Gs. ${codMetrics.failed_deliveries_loss.toLocaleString()}`}
              icon={<AlertCircle className="text-red-600" size={20} />}
            />
          </div>
        </>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Financial Chart */}
        <Card className="p-6 lg:col-span-2 bg-card">
          <h3 className="text-lg font-semibold mb-4 text-card-foreground">Resumen Financiero</h3>
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
              />
              <Legend wrapperStyle={{ color: 'hsl(var(--card-foreground))' }} />
              <Line
                type="monotone"
                dataKey="revenue"
                stroke="hsl(84, 81%, 63%)"
                strokeWidth={2.5}
                name="Ingresos"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="costs"
                stroke="hsl(0, 84%, 60%)"
                strokeWidth={2.5}
                name="Costos"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="marketing"
                stroke="hsl(217, 91%, 60%)"
                strokeWidth={2.5}
                name="Marketing"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="profit"
                stroke="hsl(142, 76%, 45%)"
                strokeWidth={2.5}
                name="Beneficio"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        {/* Order Status Pie Chart */}
        <Card className="p-6 bg-card">
          <h3 className="text-lg font-semibold mb-4 text-card-foreground">Estados de Pedidos</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={orderStatusData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={5}
                dataKey="value"
              >
                {orderStatusData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  color: 'hsl(var(--card-foreground))',
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-4 space-y-2">
            {orderStatusData.map((item) => (
              <div key={item.name} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-muted-foreground">{item.name}</span>
                </div>
                <span className="font-medium text-card-foreground">{item.value}%</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Top Products Table */}
      <Card className="p-6 bg-card">
        <h3 className="text-lg font-semibold mb-4 text-card-foreground">Productos Más Vendidos</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                  Producto
                </th>
                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                  Stock
                </th>
                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                  Precio
                </th>
                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                  Rentabilidad
                </th>
                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                  Ventas
                </th>
              </tr>
            </thead>
            <tbody>
              {topProducts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-muted-foreground">
                    No hay datos de productos disponibles
                  </td>
                </tr>
              ) : (
                topProducts.map((product) => (
                  <tr key={product.id} className="border-b border-border last:border-0">
                    <td className="py-4 px-4 text-sm font-medium text-card-foreground">{product.name}</td>
                    <td className="text-right py-4 px-4 text-sm text-card-foreground">{product.stock}</td>
                    <td className="text-right py-4 px-4 text-sm text-card-foreground">
                      Gs. {product.price.toLocaleString()}
                    </td>
                    <td className="text-right py-4 px-4">
                      <span className="inline-flex items-center gap-1 text-sm font-semibold text-green-700">
                        {product.profitability}%
                      </span>
                    </td>
                    <td className="text-right py-4 px-4 text-sm font-medium text-card-foreground">{product.sales}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Revenue Intelligence Section */}
      <RevenueIntelligence />
      
      {/* Metric Detail Modal */}
      <MetricDetailModal
        metric={selectedMetric}
        open={modalOpen}
        onOpenChange={setModalOpen}
      />
    </div>
  );
}
