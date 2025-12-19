import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { MetricCard } from '@/components/MetricCard';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { analyticsService } from '@/services/analytics.service';
import { QuickActions } from '@/components/QuickActions';
import { DailySummary } from '@/components/DailySummary';
import { MetricDetailModal } from '@/components/MetricDetailModal';
import { RevenueIntelligence } from '@/components/RevenueIntelligence';
import { useDateRange } from '@/contexts/DateRangeContext';
import { DashboardOverview, ChartData } from '@/types';
import { CardSkeleton } from '@/components/skeletons/CardSkeleton';
import { calculateRevenueProjection } from '@/utils/recommendationEngine';
import { formatCurrency, getCurrencySymbol } from '@/utils/currency';
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
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showSecondaryMetrics, setShowSecondaryMetrics] = useState(false);
  const [showAdvancedMetrics, setShowAdvancedMetrics] = useState(false);

  // Use global date range context
  const { getDateRange } = useDateRange();

  // Real analytics data
  const [dashboardOverview, setDashboardOverview] = useState<DashboardOverview | null>(null);
  const [chartData, setChartData] = useState<ChartData[]>([]);

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

    console.log('📅 Date range calculated:', result);
    return result;
  }, [getDateRange]);

  const loadDashboardData = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    try {
      const dateParams = {
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
      };

      console.log('📊 Loading dashboard data with params:', dateParams);

      const [overview, chart] = await Promise.all([
        analyticsService.getOverview(dateParams),
        analyticsService.getChartData(dateRange.days, dateParams),
      ]);

      // Check if request was aborted before updating state
      if (signal?.aborted) {
        console.log('Dashboard data load was cancelled');
        return;
      }

      setDashboardOverview(overview);
      setChartData(chart);
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
  }, [dateRange]);

  useEffect(() => {
    const abortController = new AbortController();
    loadDashboardData(abortController.signal);

    // Cleanup function to abort requests when component unmounts or dependencies change
    return () => {
      abortController.abort();
    };
  }, [loadDashboardData]);

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

  return (
    <div className="space-y-6">
      {/* Daily Summary */}
      <DailySummary />

      {/* Quick Actions */}
      <QuickActions />

      {/* Priority Metrics - Always Visible */}
      <div>
        <h2 className="text-2xl font-bold mb-4 text-card-foreground">Resumen de Ventas</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
          <MetricCard
            title="Facturación Bruta"
            value={formatCurrency(dashboardOverview.realRevenue ?? dashboardOverview.revenue)}
            change={dashboardOverview.changes?.realRevenue !== null ? Math.abs(dashboardOverview.changes?.realRevenue || 0) : undefined}
            trend={dashboardOverview.changes?.realRevenue !== null ? (dashboardOverview.changes?.realRevenue >= 0 ? 'up' : 'down') : undefined}
            icon={<DollarSign className="text-primary" size={24} />}
            variant="primary"
            subtitle="Solo pedidos entregados"
          />
          <MetricCard
            title="Facturación Proyectada"
            value={formatCurrency(dashboardOverview.projectedRevenue ?? dashboardOverview.realRevenue ?? dashboardOverview.revenue)}
            change={undefined}
            trend={undefined}
            icon={<Activity className="text-cyan-600" size={24} />}
            variant="secondary"
            subtitle="Entregados + en tránsito"
          />
          <MetricCard
            title="Beneficio Neto Real"
            value={formatCurrency(dashboardOverview.realNetProfit ?? dashboardOverview.netProfit)}
            change={dashboardOverview.changes?.realNetProfit !== null ? Math.abs(dashboardOverview.changes?.realNetProfit || 0) : undefined}
            trend={dashboardOverview.changes?.realNetProfit !== null ? (dashboardOverview.changes?.realNetProfit >= 0 ? 'up' : 'down') : undefined}
            icon={<TrendingUp className="text-green-600" size={24} />}
            variant="accent"
            subtitle="Solo pedidos entregados"
          />
          <MetricCard
            title="Tasa de Entrega"
            value={`${dashboardOverview.deliveryRate}%`}
            change={dashboardOverview.changes?.deliveryRate !== null ? Math.abs(dashboardOverview.changes?.deliveryRate || 0) : undefined}
            trend={dashboardOverview.changes?.deliveryRate !== null ? (dashboardOverview.changes?.deliveryRate >= 0 ? 'up' : 'down') : undefined}
            icon={<Truck className="text-purple-600" size={24} />}
            variant="purple"
            onClick={() => handleMetricClick('delivery')}
          />
          <MetricCard
            title="Ticket Promedio"
            value={formatCurrency(dashboardOverview.averageOrderValue)}
            change={dashboardOverview.changes?.averageOrderValue !== null ? Math.abs(dashboardOverview.changes?.averageOrderValue || 0) : undefined}
            trend={dashboardOverview.changes?.averageOrderValue !== null ? (dashboardOverview.changes?.averageOrderValue >= 0 ? 'up' : 'down') : undefined}
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
              title="ROAS"
              value={`${dashboardOverview.roas.toFixed(2)}x`}
              change={dashboardOverview.changes?.roas !== null ? Math.abs(dashboardOverview.changes?.roas || 0) : undefined}
              trend={dashboardOverview.changes?.roas !== null ? (dashboardOverview.changes?.roas >= 0 ? 'up' : 'down') : undefined}
              icon={<Target className="text-green-600" size={20} />}
            />
            <MetricCard
              title="ROI General"
              value={`${dashboardOverview.roi.toFixed(1)}%`}
              change={dashboardOverview.changes?.roi !== null ? Math.abs(dashboardOverview.changes?.roi || 0) : undefined}
              trend={dashboardOverview.changes?.roi !== null ? (dashboardOverview.changes?.roi >= 0 ? 'up' : 'down') : undefined}
              icon={<Target className="text-blue-600" size={20} />}
            />
            <MetricCard
              title="Margen Bruto"
              value={`${dashboardOverview.grossMargin}%`}
              change={dashboardOverview.changes?.grossMargin !== null ? Math.abs(dashboardOverview.changes?.grossMargin || 0) : undefined}
              trend={dashboardOverview.changes?.grossMargin !== null ? (dashboardOverview.changes?.grossMargin >= 0 ? 'up' : 'down') : undefined}
              icon={<Percent className="text-emerald-600" size={20} />}
            />
            <MetricCard
              title="Margen Neto"
              value={`${dashboardOverview.netMargin}%`}
              change={dashboardOverview.changes?.netMargin !== null ? Math.abs(dashboardOverview.changes?.netMargin || 0) : undefined}
              trend={dashboardOverview.changes?.netMargin !== null ? (dashboardOverview.changes?.netMargin >= 0 ? 'up' : 'down') : undefined}
              icon={<Percent className="text-primary" size={20} />}
            />
            <MetricCard
              title="Costo por Pedido"
              value={formatCurrency(dashboardOverview.costPerOrder)}
              change={dashboardOverview.changes?.costPerOrder !== null ? Math.abs(dashboardOverview.changes?.costPerOrder || 0) : undefined}
              trend={dashboardOverview.changes?.costPerOrder !== null ? (dashboardOverview.changes?.costPerOrder >= 0 ? 'up' : 'down') : undefined}
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
              title="Costos de Productos"
              value={formatCurrency(dashboardOverview.realProductCosts ?? dashboardOverview.productCosts)}
              change={dashboardOverview.changes?.realProductCosts !== null ? Math.abs(dashboardOverview.changes?.realProductCosts || 0) : undefined}
              trend={dashboardOverview.changes?.realProductCosts !== null ? (dashboardOverview.changes?.realProductCosts >= 0 ? 'up' : 'down') : undefined}
              icon={<TrendingDown className="text-red-600" size={20} />}
              subtitle="Solo pedidos entregados"
            />
            <MetricCard
              title="Costos de Envío"
              value={formatCurrency(dashboardOverview.realDeliveryCosts ?? dashboardOverview.deliveryCosts)}
              change={dashboardOverview.changes?.realDeliveryCosts !== null ? Math.abs(dashboardOverview.changes?.realDeliveryCosts || 0) : undefined}
              trend={dashboardOverview.changes?.realDeliveryCosts !== null ? (dashboardOverview.changes?.realDeliveryCosts >= 0 ? 'up' : 'down') : undefined}
              icon={<Truck className="text-orange-600" size={20} />}
              subtitle="Solo pedidos entregados"
            />
            <MetricCard
              title="Gasto Publicitario"
              value={formatCurrency(dashboardOverview.gasto_publicitario)}
              change={dashboardOverview.changes?.gasto_publicitario !== null ? Math.abs(dashboardOverview.changes?.gasto_publicitario || 0) : undefined}
              trend={dashboardOverview.changes?.gasto_publicitario !== null ? (dashboardOverview.changes?.gasto_publicitario >= 0 ? 'up' : 'down') : undefined}
              icon={<Megaphone className="text-blue-600" size={20} />}
              subtitle="Inversión publicitaria"
            />
            <MetricCard
              title={`IVA Recolectado (${dashboardOverview.taxRate}%)`}
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
              name="Beneficio"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
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
