import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExportButton } from '@/components/ExportButton';
import { analyticsService } from '@/services/analytics.service';
import { ordersService } from '@/services/orders.service';
import { useDateRange } from '@/contexts/DateRangeContext';
import { InfoTooltip } from '@/components/InfoTooltip';
import type { DashboardOverview } from '@/types';
import {
  Truck,
  DollarSign,
  Package,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  TrendingUp,
  TrendingDown,
  Clock,
} from 'lucide-react';
import {
  BarChart,
  Bar,
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
import { cn } from '@/lib/utils';

interface LogisticsMetrics {
  totalDispatched: number;
  dispatchedValue: number;
  failedRate: number;
  totalFailed: number;
  failedOrdersValue: number;
  doorRejectionRate: number;
  doorRejections: number;
  deliveryAttempts: number;
  cashCollectionRate: number;
  expectedCash: number;
  collectedCash: number;
  pendingCashAmount: number;
  pendingCollectionOrders: number;
  inTransitOrders: number;
  inTransitValue: number;
  avgDeliveryDays: number;
  avgDeliveryAttempts: number;
  costPerFailedAttempt: number;
  totalOrders: number;
  deliveredOrders: number;
}

export default function Logistics() {
  const [isLoading, setIsLoading] = useState(true);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [logisticsMetrics, setLogisticsMetrics] = useState<LogisticsMetrics | null>(null);
  const [orders, setOrders] = useState<any[]>([]);

  // Use global date range context
  const { getDateRange } = useDateRange();

  // Calculate date ranges from global context
  const dateRange = useMemo(() => {
    const range = getDateRange();
    return {
      startDate: range.from.toISOString().split('T')[0],
      endDate: range.to.toISOString().split('T')[0],
    };
  }, [getDateRange]);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        const dateParams = {
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
        };

        const [overviewData, ordersData] = await Promise.all([
          analyticsService.getOverview(dateParams),
          ordersService.getAll(),
        ]);

        setOverview(overviewData);
        setOrders(ordersData);

        // Fetch logistics metrics
        try {
          const response = await fetch(
            `/api/analytics/logistics-metrics?startDate=${dateParams.startDate}&endDate=${dateParams.endDate}`,
            {
              headers: {
                Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
                'X-Store-ID': localStorage.getItem('current_store_id') || '',
              },
            }
          );

          if (response.ok) {
            const { data } = await response.json();
            setLogisticsMetrics(data);
          }
        } catch (error) {
          console.error('Error loading logistics metrics:', error);
        }
      } catch (error) {
        console.error('Error loading logistics data:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, [dateRange]);

  if (isLoading || !overview) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-muted animate-pulse rounded" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="p-6">
              <div className="space-y-4">
                <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                <div className="h-24 bg-muted animate-pulse rounded" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Calculate delivery costs breakdown by carrier
  const deliveredOrders = orders.filter((o) => o.sleeves_status === 'delivered');
  const carrierCosts: Record<string, { name: string; cost: number; orders: number }> = {};

  deliveredOrders.forEach((order) => {
    const carrierName = order.carrier || 'Sin Transportista';
    const shippingCost = Number(order.shipping_cost) || 0;

    if (!carrierCosts[carrierName]) {
      carrierCosts[carrierName] = {
        name: carrierName,
        cost: 0,
        orders: 0,
      };
    }

    carrierCosts[carrierName].cost += shippingCost;
    carrierCosts[carrierName].orders += 1;
  });

  const carrierBreakdown = Object.values(carrierCosts).sort((a, b) => b.cost - a.cost);

  // Calculate pending payments (orders shipped but not yet delivered/paid)
  const shippedOrders = orders.filter((o) => o.sleeves_status === 'shipped');
  const pendingPayments = shippedOrders.reduce(
    (sum, order) => sum + (Number(order.shipping_cost) || 0),
    0
  );

  // Total delivery costs (already paid + pending)
  const totalDeliveryCosts = overview.realDeliveryCosts ?? overview.deliveryCosts ?? 0;
  const totalPending = pendingPayments;

  // Pie chart data for payment status
  const paymentStatusData = [
    { name: 'Pagado (Entregados)', value: Math.round(totalDeliveryCosts), color: 'hsl(142, 76%, 45%)' },
    { name: 'Pendiente (En Tránsito)', value: Math.round(totalPending), color: 'hsl(48, 96%, 53%)' },
  ].filter(item => item.value > 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-card-foreground">Dashboard Logístico</h2>
          <p className="text-sm text-muted-foreground">
            Seguimiento de costos de envío y métricas de entrega
          </p>
        </div>
        <ExportButton
          data={carrierBreakdown}
          filename="logistics-delivery-costs"
          variant="default"
          columns={[
            { header: 'Transportista', key: 'name' },
            { header: 'Pedidos', key: 'orders' },
            {
              header: 'Costo Total',
              key: 'cost',
              format: (val: any) =>
                new Intl.NumberFormat('es-PY', {
                  style: 'currency',
                  currency: 'PYG',
                  maximumFractionDigits: 0,
                }).format(Number(val)),
            },
          ]}
        />
      </div>

      {/* Top Metrics - Delivery Costs */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Costos de Envío</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="border-primary/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center">
                <DollarSign className="mr-2 text-green-600" size={18} />
                Costos Pagados
                <InfoTooltip content="Costos de envío de pedidos ya entregados que deben ser pagados a transportistas" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-card-foreground">
                Gs. {Math.round(totalDeliveryCosts).toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {deliveredOrders.length} pedidos entregados
              </p>
            </CardContent>
          </Card>

          <Card className="border-primary/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center">
                <Clock className="mr-2 text-yellow-600" size={18} />
                Costos Pendientes
                <InfoTooltip content="Costos estimados de pedidos en tránsito (aún no entregados)" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-card-foreground">
                Gs. {Math.round(totalPending).toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {shippedOrders.length} pedidos en tránsito
              </p>
            </CardContent>
          </Card>

          <Card className="border-primary/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center">
                <Package className="mr-2 text-blue-600" size={18} />
                Costo por Entrega
                <InfoTooltip content="Costo promedio de envío por pedido entregado" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-card-foreground">
                Gs.{' '}
                {deliveredOrders.length > 0
                  ? Math.round(totalDeliveryCosts / deliveredOrders.length).toLocaleString()
                  : 0}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Promedio por pedido</p>
            </CardContent>
          </Card>

          <Card className="border-primary/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center">
                <Truck className="mr-2 text-purple-600" size={18} />
                Total General
                <InfoTooltip content="Suma total de costos de envío (pagados + pendientes)" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-card-foreground">
                Gs. {Math.round(totalDeliveryCosts + totalPending).toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Pagado + Pendiente</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Logistics Performance Metrics */}
      {logisticsMetrics && (
        <div>
          <h3 className="text-lg font-semibold mb-4">Métricas de Rendimiento</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card className="border-primary/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center">
                  <CheckCircle2 className="mr-2 text-green-600" size={18} />
                  Tasa de Éxito
                  <InfoTooltip content="Porcentaje de pedidos entregados exitosamente sobre el total despachado" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-card-foreground">
                  {(100 - logisticsMetrics.failedRate).toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {logisticsMetrics.deliveredOrders} de {logisticsMetrics.totalDispatched} despachados
                </p>
              </CardContent>
            </Card>

            <Card className="border-primary/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center">
                  <XCircle className="mr-2 text-red-600" size={18} />
                  Tasa de Fallo
                  <InfoTooltip content="Porcentaje de pedidos que fallaron después del despacho (cancelados, devueltos, rechazados)" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-card-foreground">
                  {logisticsMetrics.failedRate.toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {logisticsMetrics.totalFailed} pedidos fallidos
                </p>
              </CardContent>
            </Card>

            <Card className="border-primary/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center">
                  <AlertTriangle className="mr-2 text-orange-600" size={18} />
                  Rechazo en Puerta
                  <InfoTooltip content="Porcentaje de pedidos rechazados por el cliente al momento de la entrega" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-card-foreground">
                  {logisticsMetrics.doorRejectionRate.toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {logisticsMetrics.doorRejections} rechazos
                </p>
              </CardContent>
            </Card>

            <Card className="border-primary/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center">
                  <Clock className="mr-2 text-blue-600" size={18} />
                  Tiempo de Entrega
                  <InfoTooltip content="Promedio de días desde la creación del pedido hasta la entrega" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-card-foreground">
                  {logisticsMetrics.avgDeliveryDays.toFixed(1)} días
                </p>
                <p className="text-xs text-muted-foreground mt-1">Promedio de entrega</p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Carrier Breakdown Chart */}
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle className="text-base">Costos por Transportista</CardTitle>
          </CardHeader>
          <CardContent>
            {carrierBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={carrierBreakdown}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="name"
                    className="stroke-muted-foreground"
                    tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <YAxis
                    className="stroke-muted-foreground"
                    tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      color: 'hsl(var(--card-foreground))',
                    }}
                    formatter={(value: number) => [`Gs. ${value.toLocaleString()}`, 'Costo']}
                  />
                  <Legend wrapperStyle={{ color: 'hsl(var(--card-foreground))' }} />
                  <Bar dataKey="cost" fill="hsl(48, 96%, 53%)" name="Costo Total" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                No hay datos de transportistas disponibles
              </div>
            )}
          </CardContent>
        </Card>

        {/* Payment Status Pie Chart */}
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle className="text-base">Estado de Pagos</CardTitle>
          </CardHeader>
          <CardContent>
            {paymentStatusData.length > 0 ? (
              <div className="flex items-center gap-6">
                <ResponsiveContainer width="50%" height={200}>
                  <PieChart>
                    <Pie
                      data={paymentStatusData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {paymentStatusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) => `Gs. ${value.toLocaleString()}`}
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        color: 'hsl(var(--card-foreground))',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-3">
                  {paymentStatusData.map((item, index) => (
                    <div key={index} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="text-sm text-muted-foreground">{item.name}</span>
                      </div>
                      <span className="text-sm font-semibold text-card-foreground">
                        Gs. {item.value.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                No hay datos de pagos disponibles
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Carrier Details Table */}
      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle>Detalle por Transportista</CardTitle>
        </CardHeader>
        <CardContent>
          {carrierBreakdown.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                      Transportista
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                      Pedidos Entregados
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                      Costo Total
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                      Costo Promedio
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {carrierBreakdown.map((carrier, index) => (
                    <tr
                      key={index}
                      className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors"
                    >
                      <td className="py-4 px-4">
                        <span className="text-sm font-medium text-card-foreground">
                          {carrier.name}
                        </span>
                      </td>
                      <td className="text-right py-4 px-4 text-sm text-card-foreground">
                        {carrier.orders}
                      </td>
                      <td className="text-right py-4 px-4 text-sm font-semibold text-card-foreground">
                        Gs. {Math.round(carrier.cost).toLocaleString()}
                      </td>
                      <td className="text-right py-4 px-4 text-sm text-card-foreground">
                        Gs. {Math.round(carrier.cost / carrier.orders).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-border">
                  <tr className="bg-muted/30">
                    <td className="py-4 px-4">
                      <span className="text-sm font-bold text-card-foreground">TOTAL</span>
                    </td>
                    <td className="text-right py-4 px-4 text-sm font-bold text-card-foreground">
                      {carrierBreakdown.reduce((sum, c) => sum + c.orders, 0)}
                    </td>
                    <td className="text-right py-4 px-4 text-sm font-bold text-card-foreground">
                      Gs. {Math.round(carrierBreakdown.reduce((sum, c) => sum + c.cost, 0)).toLocaleString()}
                    </td>
                    <td className="text-right py-4 px-4"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              No hay datos de transportistas disponibles
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
