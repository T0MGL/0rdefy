import { useState, useEffect, useMemo, useCallback } from 'react';
import { MetricCard } from '@/components/MetricCard';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { analyticsService, LogisticsMetrics, IncidentsMetrics } from '@/services/analytics.service';
import { codMetricsService } from '@/services/cod-metrics.service';
import { InfoTooltip } from '@/components/InfoTooltip';
import { useDateRange } from '@/contexts/DateRangeContext';
import { DashboardOverview, ConfirmationMetrics } from '@/types';
import { CardSkeleton } from '@/components/skeletons/CardSkeleton';
import { formatCurrency } from '@/utils/currency';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { FeatureBlockedPage } from '@/components/FeatureGate';
import {
  Truck,
  CheckCircle2,
  AlertCircle,
  Package2,
  Percent,
  ChevronDown,
  ChevronUp,
  PackageCheck,
  Clock,
  TrendingUp,
  XCircle,
  DoorOpen,
  Banknote,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';

export default function DashboardLogistics() {
  const { hasFeature, loading: subscriptionLoading } = useSubscription();
  const [isLoading, setIsLoading] = useState(true);
  const [showDetailedMetrics, setShowDetailedMetrics] = useState(false);

  // Use global date range context
  const { getDateRange } = useDateRange();

  // Real analytics data
  const [dashboardOverview, setDashboardOverview] = useState<DashboardOverview | null>(null);
  const [confirmationMetrics, setConfirmationMetrics] = useState<ConfirmationMetrics | null>(null);
  const [orderStatusData, setOrderStatusData] = useState<any[]>([]);
  const [codMetrics, setCodMetrics] = useState<any>(null);
  const [logisticsMetrics, setLogisticsMetrics] = useState<LogisticsMetrics | null>(null);
  const [incidentsMetrics, setIncidentsMetrics] = useState<IncidentsMetrics | null>(null);

  // Memoize status map to avoid recreation
  const statusMap = useMemo(() => ({
    'confirmed': { name: 'Confirmado', color: 'hsl(84, 81%, 63%)' },
    'in_preparation': { name: 'En preparación', color: 'hsl(45, 93%, 47%)' },
    'ready_to_ship': { name: 'Listo para enviar', color: 'hsl(200, 91%, 60%)' },
    'shipped': { name: 'En tránsito', color: 'hsl(217, 91%, 60%)' },
    'delivered': { name: 'Entregado', color: 'hsl(142, 76%, 45%)' },
    'cancelled': { name: 'Cancelado', color: 'hsl(0, 84%, 60%)' },
    'pending': { name: 'Pendiente', color: 'hsl(280, 60%, 60%)' },
  }), []);

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

    return result;
  }, [getDateRange]);

  const loadDashboardData = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    try {
      const dateParams = {
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
      };

      const [overview, confirmation, statusDist, codData, logisticsData, incidentsData] = await Promise.all([
        analyticsService.getOverview(dateParams),
        analyticsService.getConfirmationMetrics(dateParams),
        analyticsService.getOrderStatusDistribution(dateParams),
        codMetricsService.getMetrics({
          start_date: dateParams.startDate,
          end_date: dateParams.endDate,
        }).catch(() => null),
        analyticsService.getLogisticsMetrics(dateParams).catch(() => null),
        analyticsService.getIncidentsMetrics(dateParams).catch(() => null),
      ]);

      // Check if request was aborted before updating state
      if (signal?.aborted) {
        return;
      }

      setDashboardOverview(overview);
      setConfirmationMetrics(confirmation);
      setCodMetrics(codData);
      setLogisticsMetrics(logisticsData);
      setIncidentsMetrics(incidentsData);

      // Transform status distribution for pie chart
      const transformedStatus = statusDist.map(item => ({
        name: statusMap[item.status]?.name || item.status,
        value: item.count,
        percentage: item.percentage,
        color: statusMap[item.status]?.color || 'hsl(0, 0%, 50%)',
      }));

      setOrderStatusData(transformedStatus);
    } catch (error: any) {
      if (error.name === 'AbortError' || error.name === 'CanceledError') {
        return;
      }
      console.error('Error loading logistics dashboard data:', error);
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  }, [statusMap, dateRange]);

  useEffect(() => {
    if (!hasFeature('warehouse')) return;
    const abortController = new AbortController();
    loadDashboardData(abortController.signal);

    return () => {
      abortController.abort();
    };
  }, [loadDashboardData, hasFeature]);

  // Check warehouse feature access - AFTER all hooks
  // Wait for subscription to load to prevent flash of upgrade modal
  if (subscriptionLoading) {
    return null;
  }
  if (!hasFeature('warehouse')) {
    return <FeatureBlockedPage feature="warehouse" />;
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (!dashboardOverview || !confirmationMetrics) {
    return (
      <Card className="p-6">
        <p className="text-center text-muted-foreground">
          No hay datos disponibles. Por favor, intente nuevamente.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-card-foreground">Dashboard Logístico</h1>
        <p className="text-muted-foreground mt-2">
          Métricas operativas y seguimiento de entregas
        </p>
      </div>

      {/* Main Logistics Metrics */}
      <div>
        <h2 className="text-2xl font-bold mb-4 text-card-foreground">Métricas Principales</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <MetricCard
            title={
              <div className="flex items-center">
                Tasa de Entrega
                <InfoTooltip content="Porcentaje de pedidos entregados exitosamente sobre el total despachado." />
              </div>
            }
            value={`${(dashboardOverview.deliveryRate || 0).toFixed(1)}%`}
            change={dashboardOverview.changes?.deliveryRate !== null && dashboardOverview.changes?.deliveryRate !== undefined ? Math.abs(dashboardOverview.changes.deliveryRate) : undefined}
            trend={dashboardOverview.changes?.deliveryRate !== null && dashboardOverview.changes?.deliveryRate !== undefined ? (dashboardOverview.changes.deliveryRate >= 0 ? 'up' : 'down') : undefined}
            icon={<Truck className="text-purple-600" size={24} />}
            variant="purple"
          />
          <MetricCard
            title={
              <div className="flex items-center">
                Tasa de Confirmación
                <InfoTooltip content="Porcentaje de pedidos confirmados sobre el total de pedidos recibidos." />
              </div>
            }
            value={`${(confirmationMetrics?.confirmationRate || 0).toFixed(1)}%`}
            change={confirmationMetrics?.confirmationRateChange !== null && confirmationMetrics?.confirmationRateChange !== undefined ? Math.abs(confirmationMetrics.confirmationRateChange) : undefined}
            trend={confirmationMetrics?.confirmationRateChange !== null && confirmationMetrics?.confirmationRateChange !== undefined ? (confirmationMetrics.confirmationRateChange >= 0 ? 'up' : 'down') : undefined}
            icon={<CheckCircle2 className="text-green-600" size={24} />}
          />
          <MetricCard
            title={
              <div className="flex items-center">
                Pedidos Totales
                <InfoTooltip content="Número total de pedidos procesados en el periodo seleccionado." />
              </div>
            }
            value={(dashboardOverview.totalOrders || 0).toString()}
            change={dashboardOverview.changes?.totalOrders !== null && dashboardOverview.changes?.totalOrders !== undefined ? Math.abs(dashboardOverview.changes.totalOrders) : undefined}
            trend={dashboardOverview.changes?.totalOrders !== null && dashboardOverview.changes?.totalOrders !== undefined ? (dashboardOverview.changes.totalOrders >= 0 ? 'up' : 'down') : undefined}
            icon={<PackageCheck className="text-blue-600" size={24} />}
          />
          <MetricCard
            title={
              <div className="flex items-center">
                Tiempo Promedio
                <InfoTooltip content="Tiempo promedio transcurrido desde la confirmación hasta la entrega." />
              </div>
            }
            value={confirmationMetrics?.avgDeliveryTime ? `${confirmationMetrics.avgDeliveryTime.toFixed(1)} días` : '0.0 días'}
            icon={<Clock className="text-orange-600" size={24} />}
          />
        </div>
      </div>

      {/* Nuevas Métricas de Logística Avanzada */}
      {logisticsMetrics && (
        <div>
          <h2 className="text-2xl font-bold mb-4 text-card-foreground">Métricas de Logística</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <MetricCard
              title={
                <div className="flex items-center">
                  Pedidos Despachados
                  <InfoTooltip content="Cantidad total de pedidos que han salido del almacén." />
                </div>
              }
              value={logisticsMetrics.totalDispatched}
              subtitle={formatCurrency(logisticsMetrics.dispatchedValue)}
              icon={<PackageCheck className="text-blue-600" size={20} />}
              variant="secondary"
            />
            <MetricCard
              title={
                <div className="flex items-center">
                  Tasa de Pedidos Fallidos
                  <InfoTooltip content="Porcentaje de pedidos que no pudieron ser entregados." />
                </div>
              }
              value={`${logisticsMetrics.failedRate}%`}
              subtitle={`${logisticsMetrics.totalFailed} pedidos · ${formatCurrency(logisticsMetrics.failedOrdersValue)} perdidos`}
              icon={<XCircle className="text-red-600" size={20} />}
            />
            <MetricCard
              title={
                <div className="flex items-center">
                  Tasa de Rechazo en Puerta
                  <InfoTooltip content="Porcentaje de envíos rechazados por el cliente al momento de la entrega." />
                </div>
              }
              value={`${logisticsMetrics.doorRejectionRate}%`}
              subtitle={`${logisticsMetrics.doorRejections} rechazos de ${logisticsMetrics.deliveryAttempts} intentos`}
              icon={<DoorOpen className="text-orange-600" size={20} />}
            />
            <MetricCard
              title={
                <div className="flex items-center">
                  Cash Collection
                  <InfoTooltip content="Porcentaje de dinero recaudado sobre el total esperado (Contra Entrega)." />
                </div>
              }
              value={`${logisticsMetrics.cashCollectionRate}%`}
              subtitle={`Cobrado: ${formatCurrency(logisticsMetrics.collectedCash)} · Pendiente: ${formatCurrency(logisticsMetrics.pendingCashAmount)}`}
              icon={<Banknote className="text-green-600" size={20} />}
              variant="accent"
            />
            {incidentsMetrics && (
              <MetricCard
                title={
                  <div className="flex items-center">
                    Incidencias
                    <InfoTooltip content="Número total de problemas reportados durante el proceso de envío." />
                  </div>
                }
                value={incidentsMetrics.totalIncidents}
                subtitle={`Activas: ${incidentsMetrics.activeIncidents} · Resueltas: ${incidentsMetrics.resolvedIncidents}`}
                icon={<AlertCircle className="text-yellow-600" size={20} />}
              />
            )}
          </div>
        </div>
      )}

      {/* COD Metrics Section */}
      {codMetrics && (
        <div>
          <h2 className="text-2xl font-bold mb-4 text-card-foreground">Métricas COD (Contra Entrega)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <MetricCard
              title="Cobrado Hoy"
              value={formatCurrency(codMetrics.collected_today || 0)}
              icon={<CheckCircle2 className="text-green-600" size={20} />}
              variant="accent"
            />
            <MetricCard
              title="Proyección de Caja"
              value={formatCurrency(codMetrics.pending_cash || 0)}
              icon={<TrendingUp className="text-blue-600" size={20} />}
              variant="secondary"
            />
            <MetricCard
              title="Pedidos en Entrega"
              value={codMetrics.orders_in_delivery || 0}
              icon={<Truck className="text-blue-600" size={20} />}
            />
            <MetricCard
              title="Tasa de Pago Exitoso"
              value={`${codMetrics.payment_success_rate || 0}%`}
              icon={<Percent className="text-green-600" size={20} />}
            />
            <MetricCard
              title="Intentos Promedio"
              value={(codMetrics.average_delivery_attempts || 0).toFixed(1)}
              icon={<Package2 className="text-purple-600" size={20} />}
            />
          </div>
        </div>
      )}

      {/* Additional COD Metrics - Collapsible */}
      {codMetrics && (
        <div className="space-y-4">
          <Button
            variant="ghost"
            className="w-full flex items-center justify-between p-4 hover:bg-accent"
            onClick={() => setShowDetailedMetrics(!showDetailedMetrics)}
          >
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold">Métricas Detalladas</h3>
              <span className="text-sm text-muted-foreground">
                ({showDetailedMetrics ? 'Ocultar' : 'Mostrar'})
              </span>
            </div>
            {showDetailedMetrics ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </Button>

          {showDetailedMetrics && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <MetricCard
                title="Pérdidas por Fallos"
                value={formatCurrency(codMetrics.failed_deliveries_loss || 0)}
                icon={<AlertCircle className="text-red-600" size={20} />}
              />
              <MetricCard
                title="Tiempo Prom. Confirmación"
                value={`${(confirmationMetrics?.avgConfirmationTime || 0).toFixed(1)}h`}
                icon={<Clock className="text-blue-600" size={20} />}
              />
              <MetricCard
                title="Pedidos Confirmados Hoy"
                value={confirmationMetrics?.confirmationsToday || 0}
                icon={<CheckCircle2 className="text-green-600" size={20} />}
              />
            </div>
          )}
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Order Status Distribution */}
        <Card className="p-6 bg-card">
          <h3 className="text-lg font-semibold mb-4 text-card-foreground">
            Distribución de Estados
          </h3>
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
                label={({ name, percentage }) => `${name}: ${percentage}%`}
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
                formatter={(value: any, name: string, props: any) => [
                  `${value} pedidos (${props.payload.percentage}%)`,
                  name
                ]}
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
                <div className="flex items-center gap-3">
                  <span className="font-medium text-card-foreground">{item.value}</span>
                  <span className="text-muted-foreground text-xs">({item.percentage}%)</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Status Flow Bar Chart */}
        <Card className="p-6 bg-card">
          <h3 className="text-lg font-semibold mb-4 text-card-foreground">
            Flujo de Pedidos por Estado
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={orderStatusData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis type="number" className="stroke-muted-foreground" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
              <YAxis dataKey="name" type="category" className="stroke-muted-foreground" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} width={120} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  color: 'hsl(var(--card-foreground))',
                }}
                formatter={(value: any) => [`${value} pedidos`, 'Cantidad']}
              />
              <Bar dataKey="value" radius={[0, 8, 8, 0]}>
                {orderStatusData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}
